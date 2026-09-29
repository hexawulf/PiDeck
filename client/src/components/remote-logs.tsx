// The Logs tab of a remote host (H3 Track B): sources from the agent's
// GET /api/agent/logs, tails from /api/agent/logs/<id> through the hub's
// proxy. No streaming: the open tail polls at the header's refresh speed
// (Live/Relaxed/Slow, off while paused). Redaction happens on the agent;
// this view only marks the [REDACTED] spans. Lazy chunk (app-shell.tsx).
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { AlertCircle, Box, FileText, Pin, PinOff, RefreshCw, ScrollText, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DownloadLogButton } from "@/components/logview/download-log-button";
import { Input } from "@/components/ui/input";
import { getQueryFn } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useRefetch } from "@/hooks/useRefetch";
import { toast } from "@/hooks/use-toast";
import { addPin, removePin, samePin } from "@/hooks/use-log-pins";
import { useHost, useHostSummary } from "@/hosts/HostProvider";
import { formatLastSeen, hostHref, hostProblemOf, parseRemotePinId, remotePinId } from "@/hosts/host-path";
import { useUiPrefs, useUiPrefsDispatch } from "@/prefs/UiPrefsProvider";
import { widgetQueryKey } from "@/widgets/useWidgetQuery";

const sourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["file", "journal", "docker"]),
  readable: z.boolean(),
  hint: z.string().optional(),
  size: z.number().optional(),
  mtime: z.string().optional(),
  state: z.string().optional(),
  image: z.string().optional(),
});
const listSchema = z.object({
  sources: z.array(sourceSchema),
  docker: z.object({ enabled: z.boolean(), reachable: z.boolean(), hint: z.string().optional() }),
});
const tailSchema = z.object({
  id: z.string(),
  label: z.string(),
  lines: z.array(z.string()),
  truncated: z.boolean(),
  redacted: z.number(),
  redactedLines: z.array(z.number()).optional(),
});
type Source = z.infer<typeof sourceSchema>;

export const LINE_CHOICES = [200, 500, 1000, 2000] as const;
const TAIL_BASE_MS = 5_000;
const fetchJson = getQueryFn<unknown>({ on401: "throw" });

/** "404: {"message":"container no longer exists"}" → the message. */
export function problemMessage(error: unknown): { status: number | null; message: string } {
  const text = error instanceof Error ? error.message : String(error);
  const m = /^(\d{3}): ([\s\S]*)$/.exec(text);
  if (!m) return { status: null, message: text };
  let message = m[2];
  try {
    const body = JSON.parse(m[2]);
    if (typeof body?.message === "string") message = body.message;
  } catch {
    // plain text
  }
  return { status: Number(m[1]), message };
}

/** A tail's URL (the hub validates lines/filter again). */
export function tailUrl(sourceId: string, lines: number, filter: string): string {
  const q = new URLSearchParams({ lines: String(lines) });
  if (filter.trim()) q.set("filter", filter.trim());
  return `/api/agent/logs/${sourceId}?${q.toString()}`;
}

/** A line with its [REDACTED] spans marked. */
export function RedactedLine({ line }: { line: string }) {
  if (!line.includes("[REDACTED]")) return <>{line || " "}</>;
  const parts = line.split("[REDACTED]");
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <mark className="rounded bg-pi-warning-soft px-0.5 text-pi-text" title="Redacted on the agent" data-redacted>
              [REDACTED]
            </mark>
          )}
        </span>
      ))}
    </>
  );
}

const KIND_META: Record<Source["kind"], { label: string; Icon: React.ElementType }> = {
  docker: { label: "Docker", Icon: Box },
  file: { label: "Files", Icon: FileText },
  journal: { label: "Journal", Icon: ScrollText },
};
const KIND_ORDER: Source["kind"][] = ["file", "journal", "docker"];

function useRemotePins(hostId: string) {
  const { pins } = useUiPrefs();
  const dispatch = useUiPrefsDispatch();
  const mine = useMemo(() => pins.flatMap((p) => {
    const r = parseRemotePinId(p.logId);
    return r && r.hostId === hostId ? [{ ...p, sourceId: r.sourceId }] : [];
  }), [pins, hostId]);
  return {
    pins: mine,
    isPinned: (sourceId: string, grep?: string) => pins.some((p) => samePin(p, { logId: remotePinId(hostId, sourceId), grep })),
    pin: (sourceId: string, label: string, grep?: string) => {
      const { pins: next, result } = addPin(pins, { logId: remotePinId(hostId, sourceId), label, grep });
      if (result === "full") toast({ title: "Pin limit reached (100)", description: "Unpin something first.", variant: "destructive" });
      if (result === "added") dispatch({ type: "setPins", pins: next });
    },
    unpin: (sourceId: string, grep?: string) => dispatch({ type: "setPins", pins: removePin(pins, { logId: remotePinId(hostId, sourceId), grep }) }),
  };
}

export default function RemoteLogs() {
  const host = useHost();
  const summary = useHostSummary(host.id);
  const label = summary?.label ?? host.id;
  const search = useSearch();
  const [, navigate] = useLocation();
  const listRefetch = useRefetch(60_000);
  const tailRefetch = useRefetch(TAIL_BASE_MS);
  const pins = useRemotePins(host.id);

  const lastKey = `logViewer:lastRemote:${host.id}`;
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem(lastKey);
    } catch {
      return null;
    }
  });
  const [filterDraft, setFilterDraft] = useState("");
  const [filter, setFilter] = useState("");
  const [lines, setLines] = useState<number>(200);

  const list = useQuery({
    queryKey: widgetQueryKey(host.id, "/api/agent/logs"),
    queryFn: async (ctx) => listSchema.parse(await fetchJson(ctx)),
    refetchInterval: listRefetch,
  });

  // ?log=<id>[&grep=…] (pins, palette): open it once, then drop the query.
  useEffect(() => {
    const p = new URLSearchParams(search);
    const wanted = p.get("log");
    if (!wanted) return;
    const grep = p.get("grep") ?? "";
    setSelected(wanted);
    setFilterDraft(grep);
    setFilter(grep);
    navigate(hostHref(host.id, "logs"), { replace: true });
  }, [search, host.id, navigate]);

  useEffect(() => {
    try {
      if (selected) localStorage.setItem(lastKey, selected);
    } catch {
      // private mode: fine
    }
  }, [selected, lastKey]);

  const sources = list.data?.sources ?? [];
  const current = sources.find((s) => s.id === selected) ?? null;
  const tail = useQuery({
    queryKey: widgetQueryKey(host.id, tailUrl(selected ?? "none", lines, filter)),
    queryFn: async (ctx) => tailSchema.parse(await fetchJson(ctx)),
    enabled: !!current?.readable,
    refetchInterval: tailRefetch,
    retry: false,
  });

  // A source that vanished (container removed, file gone): refresh the list once.
  const tailStatus = tail.error ? problemMessage(tail.error).status : null;
  useEffect(() => {
    if (tailStatus === 404) void list.refetch();
  }, [tailStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const g: Partial<Record<Source["kind"], Source[]>> = {};
    for (const s of sources) (g[s.kind] ??= []).push(s);
    return g;
  }, [sources]);

  const hostProblem = hostProblemOf(list.error);
  const tailProblem = tail.error ? problemMessage(tail.error) : null;
  const grep = filter.trim() || undefined;
  const pinned = current ? pins.isPinned(current.id, grep) : false;

  const open = (id: string, g = "") => {
    setSelected(id);
    setFilterDraft(g);
    setFilter(g);
  };

  if (list.isPending) return <p className="text-sm text-pi-text-muted">Loading {label}'s log sources…</p>;
  if (list.isError) {
    return (
      <div role="alert" className="rounded-xl border border-pi-border bg-pi-card p-4 text-sm text-pi-text" data-testid="remote-logs-error">
        {hostProblem?.kind === "offline"
          ? `${label} is offline (last seen ${formatLastSeen(hostProblem.lastSeen)}).`
          : hostProblem?.kind === "auth"
            ? `Can't authenticate to ${label}: check its token.`
            : `Couldn't list ${label}'s logs: ${problemMessage(list.error).message}`}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-12rem)] lg:flex-row" data-testid="remote-logs">
      <aside aria-label={`${label} log sources`} className="max-h-[50vh] w-full flex-shrink-0 overflow-y-auto rounded-xl border border-pi-border bg-pi-card p-3 lg:max-h-none lg:w-72">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-pi-text">
          <ScrollText className="h-4 w-4 text-pi-accent-text" aria-hidden /> Logs on {label}
        </h2>
        {pins.pins.length > 0 && (
          <section aria-label="Pinned logs" className="mb-2 border-b border-pi-border pb-2">
            <ul className="space-y-0.5" data-testid="remote-pins">
              {pins.pins.map((p) => (
                <li key={`${p.sourceId}:${p.grep ?? ""}`}>
                  <button type="button" onClick={() => open(p.sourceId, p.grep ?? "")} className="w-full truncate rounded-md px-2 py-1 text-left text-xs text-pi-text hover:bg-pi-card-hover">
                    <Pin className="mr-1 inline h-3 w-3" aria-hidden />
                    {p.label ?? p.sourceId}
                    {p.grep && <span className="text-pi-text-muted"> — “{p.grep}”</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {sources.length === 0 && <p className="py-4 text-center text-xs text-pi-text-muted">No log sources configured on this agent.</p>}
        {KIND_ORDER.map((kind) => {
          const items = groups[kind];
          if (!items?.length) return null;
          const { label: kindLabel, Icon } = KIND_META[kind];
          return (
            <section key={kind} className="mb-2" aria-label={kindLabel}>
              <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-pi-text-muted">
                <Icon className="h-3 w-3" aria-hidden /> {kindLabel} <span className="tabular-nums">({items.length})</span>
              </h3>
              <ul className="space-y-0.5">
                {items.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => open(s.id)}
                      aria-current={s.id === selected ? "true" : undefined}
                      data-source={s.id}
                      data-readable={s.readable}
                      title={s.readable ? undefined : s.hint}
                      className={cn(
                        "w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-pi-card-hover",
                        s.id === selected && "bg-pi-card-hover font-semibold",
                        s.readable ? "text-pi-text" : "text-pi-text-muted",
                      )}
                    >
                      <span className="block truncate">
                        {s.label}
                        {s.state && s.state !== "running" && <span className="text-pi-text-muted"> · {s.state}</span>}
                      </span>
                      {!s.readable && s.hint && <span className="block text-[11px] leading-snug">{s.hint}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {list.data?.docker.enabled && !list.data.docker.reachable && (
          <p className="mt-2 rounded-md border border-pi-border px-2 py-1.5 text-xs text-pi-text-muted" data-testid="docker-unreachable">
            Docker not reachable: {list.data.docker.hint}
          </p>
        )}
      </aside>

      <section aria-label="Log content" className="flex min-w-0 flex-1 flex-col rounded-xl border border-pi-border bg-pi-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-pi-text" data-testid="remote-log-title">
            {current ? current.label : "Select a log source"}
          </h2>
          {current && (
            <>
              {tail.data && tail.data.redacted > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-pi-warning-soft px-2 py-0.5 text-xs text-pi-text" data-testid="redacted-count">
                  <ShieldAlert className="h-3 w-3" aria-hidden /> {tail.data.redacted} redacted
                </span>
              )}
              <DownloadLogButton lines={tail.data?.lines ?? []} host={host.id} source={current.id} />
              <Button size="sm" variant="outline" aria-pressed={pinned} aria-label={pinned ? "Unpin" : "Pin"} title={pinned ? "Unpin" : "Pin (with this filter)"}
                onClick={() => (pinned ? pins.unpin(current.id, grep) : pins.pin(current.id, `${label}: ${current.label}`, grep))}>
                {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </Button>
              <Button size="sm" variant="outline" aria-label="Refresh" onClick={() => void tail.refetch()} disabled={!current.readable}>
                <RefreshCw className={cn("h-4 w-4", tail.isFetching && "animate-spin")} />
              </Button>
            </>
          )}
        </div>
        {current && (
          <form
            className="mb-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              setFilter(filterDraft);
            }}
          >
            <Input aria-label="Filter" placeholder="Filter (text, or /regex/)" value={filterDraft} maxLength={200} onChange={(e) => setFilterDraft(e.target.value)} className="flex-1" />
            <select aria-label="Lines" value={lines} onChange={(e) => setLines(Number(e.target.value))} className="h-10 rounded-md border border-pi-border bg-pi-card-hover px-2 text-sm text-pi-text">
              {LINE_CHOICES.map((n) => <option key={n} value={n}>{n} lines</option>)}
            </select>
            <Button type="submit"><Search className="mr-1 h-4 w-4" aria-hidden /> Apply</Button>
          </form>
        )}
        <div className="min-h-[12rem] flex-1 overflow-auto rounded-lg bg-pi-terminal-bg p-4 font-mono text-sm text-pi-terminal-text custom-scrollbar" data-testid="remote-log-lines">
          {!current && <p className="py-16 text-center text-pi-terminal-muted">{selected ? "This source is no longer listed." : "Select a log source from the list."}</p>}
          {current && !current.readable && (
            <p className="py-16 text-center text-pi-terminal-muted" data-testid="unreadable">{current.hint ?? "This source can't be read."}</p>
          )}
          {current?.readable && tailProblem && (
            <p role="alert" className="flex items-center gap-2 text-pi-terminal-text">
              <AlertCircle className="h-4 w-4" aria-hidden /> {tailProblem.message}
            </p>
          )}
          {current?.readable && tail.isPending && !tailProblem && <p className="text-pi-terminal-muted">Loading…</p>}
          {tail.data?.truncated && (
            <p className="mb-2 text-xs text-pi-terminal-muted" data-testid="truncated">Truncated: long lines are cut at 8 kB and the answer at 1 MB (older lines not shown).</p>
          )}
          {current?.readable && tail.data && tail.data.lines.length === 0 && <p className="text-pi-terminal-muted">No lines{filter ? " match the filter" : ""}.</p>}
          {current?.readable &&
            tail.data?.lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">
                <RedactedLine line={line} />
              </div>
            ))}
        </div>
        <p className="mt-2 text-xs text-pi-text-muted">Read-only, redacted on {label}; refreshes with the header's speed.</p>
      </section>
    </div>
  );
}
