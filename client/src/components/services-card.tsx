// The Services card at the top of the Apps tab (docs/plans/services-2.8.0.md):
// read-only systemd units from GET /api/services on the current host. Listed
// units (PIDECK_SERVICES) plus any failed unit; failed and not-found first.
// Lazy chunk (app-monitor.tsx).
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Cog, ScrollText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getQueryFn } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useRefetch } from "@/hooks/useRefetch";
import { useHost, useHostSummary } from "@/hosts/HostProvider";
import { formatLastSeen, hostProblemOf, journalSourceId, remoteLogHref } from "@/hosts/host-path";
import { HostProblemNotice } from "@/widgets/WidgetFrame";
import { widgetQueryKey } from "@/widgets/useWidgetQuery";

const n = z.number().nullable();
const s = z.string().nullable();
export const serviceSchema = z.object({
  unit: z.string(), user: z.boolean(), label: s, description: s, load: s, active: s, sub: s,
  unitFileState: s, type: s, result: s, mainPid: n, restarts: n, memory: n, since: s,
  health: z.enum(["ok", "warn", "fail", "unknown"]), listed: z.boolean(),
});
export const servicesSchema = z.object({
  available: z.boolean(), systemd: s, services: z.array(serviceSchema), failedOnly: z.array(serviceSchema), warnings: z.array(z.string()),
});
export type ServiceRow = z.infer<typeof serviceSchema>;

const logsListSchema = z.object({ sources: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough();
const fetchJson = getQueryFn<unknown>({ on401: "throw" });

const RANK: Record<ServiceRow["health"], number> = { fail: 0, warn: 1, unknown: 2, ok: 3 };
/** Failed and not-found first, then down, unknown, ok; listed before unlisted; then by name. */
export function sortServices(rows: ServiceRow[]): ServiceRow[] {
  return [...rows].sort((a, b) => RANK[a.health] - RANK[b.health] || Number(b.listed) - Number(a.listed) || a.unit.localeCompare(b.unit));
}

export function stateText(r: ServiceRow): string {
  if (r.load === "not-found") return "unit not found";
  if (r.health === "unknown") return "unknown";
  return [r.active, r.sub && r.sub !== r.active ? `(${r.sub})` : ""].filter(Boolean).join(" ");
}

export function formatBytes(b: number | null): string {
  if (b === null) return "—";
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

const DOT: Record<ServiceRow["health"], string> = { ok: "bg-pi-success", warn: "bg-pi-warning", fail: "bg-pi-error", unknown: "bg-pi-text-muted" };

export default function ServicesCard() {
  const host = useHost();
  const summary = useHostSummary(host.id);
  // A 2.7 agent has no /api/services: say so instead of asking it.
  const capable = host.isLocal || summary?.services === true;
  const refetchInterval = useRefetch(15_000);
  const q = useQuery({
    queryKey: widgetQueryKey(host.id, "/api/services"),
    queryFn: async (ctx) => servicesSchema.parse(await fetchJson(ctx)),
    refetchInterval,
    enabled: capable,
  });
  // "Logs" links: the agent's journal sources (remote hosts with remote logs).
  const logs = useQuery({
    queryKey: widgetQueryKey(host.id, "/api/agent/logs"),
    queryFn: async (ctx) => logsListSchema.parse(await fetchJson(ctx)),
    enabled: !host.isLocal && summary?.logs === true,
    staleTime: 60_000,
  });
  const logIds = useMemo(() => new Set(logs.data?.sources.map((x) => x.id) ?? []), [logs.data]);
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    const all = sortServices([...(q.data?.services ?? []), ...(q.data?.failedOnly ?? [])]);
    const f = filter.trim().toLowerCase();
    return f ? all.filter((r) => `${r.unit} ${r.label ?? ""} ${r.description ?? ""}`.toLowerCase().includes(f)) : all;
  }, [q.data, filter]);
  const listed = q.data?.services ?? [];
  const okCount = listed.filter((r) => r.health === "ok").length;

  return (
    <Card className="bg-pi-card border-pi-border" data-testid="services-card">
      <CardContent className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-pi-text">
            <Cog className="h-5 w-5" aria-hidden /> Services
            {q.data?.available && listed.length > 0 && (
              <span className="text-sm font-normal text-pi-text-muted" data-testid="services-count">
                {okCount}/{listed.length} ok
              </span>
            )}
          </h3>
          {q.data?.available && (
            <Input aria-label="Filter services" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-full text-xs sm:w-48" />
          )}
        </div>

        {!capable ? (
          <p className="text-sm text-pi-text-muted" data-testid="services-update-agent">
            This agent is older than 2.8: update the agent to see its services.
          </p>
        ) : q.isPending ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : hostProblemOf(q.error) ? (
          <HostProblemNotice problem={hostProblemOf(q.error)!} />
        ) : q.isError ? (
          <p className="text-sm text-pi-error">Couldn't read the services.</p>
        ) : !q.data.available ? (
          <p className="text-sm text-pi-text-muted" data-testid="services-unavailable">systemd isn't available on this host.</p>
        ) : (
          <>
            {rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm" data-testid="services-table">
                  <thead className="text-xs text-pi-text-muted">
                    <tr>
                      <th scope="col" className="py-1 pr-3 font-medium">Service</th>
                      <th scope="col" className="hidden py-1 pr-3 font-medium md:table-cell">Description</th>
                      <th scope="col" className="py-1 pr-3 font-medium">State</th>
                      <th scope="col" className="hidden py-1 pr-3 font-medium sm:table-cell">Since</th>
                      <th scope="col" className="hidden py-1 pr-3 text-right font-medium lg:table-cell">Restarts</th>
                      <th scope="col" className="hidden py-1 pr-3 text-right font-medium lg:table-cell" title="The unit's cgroup memory (systemd MemoryCurrent), including page cache: file reads can make it large">Memory (incl. cache)</th>
                      <th scope="col" className="py-1 font-medium"><span className="sr-only">Logs</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const logId = journalSourceId(r.unit, r.user);
                      return (
                        <tr key={`${r.user ? "u" : "s"}:${r.unit}`} className="border-t border-pi-border align-top" data-unit={r.unit} data-health={r.health}>
                          <td className="py-1.5 pr-3">
                            <span className="flex items-center gap-2">
                              <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[r.health])} aria-hidden />
                              <span className="min-w-0">
                                <span className="font-medium text-pi-text">{r.label ?? r.unit}</span>
                                {r.user && <span className="ml-1 rounded bg-pi-card-hover px-1 text-[10px] text-pi-text-muted">user</span>}
                                {!r.listed && <span className="ml-1 rounded bg-pi-error-soft px-1 text-[10px] text-pi-text">not listed</span>}
                                {r.label && <span className="block text-xs text-pi-text-muted">{r.unit}</span>}
                              </span>
                            </span>
                          </td>
                          <td className="hidden max-w-[20rem] truncate py-1.5 pr-3 text-pi-text-muted md:table-cell" title={r.description ?? undefined}>{r.description ?? "—"}</td>
                          <td className={cn("py-1.5 pr-3", r.health === "ok" ? "text-pi-text" : "font-medium text-pi-text")}>
                            <span className="sr-only">{r.health === "ok" ? "healthy" : r.health === "fail" ? "failed" : r.health === "warn" ? "not running" : "unknown"}: </span>
                            {stateText(r)}
                          </td>
                          <td className="hidden py-1.5 pr-3 text-pi-text-muted sm:table-cell">{r.since ? formatLastSeen(r.since) : "—"}</td>
                          <td className="hidden py-1.5 pr-3 text-right tabular-nums text-pi-text-muted lg:table-cell">{r.restarts ?? "—"}</td>
                          <td className="hidden py-1.5 pr-3 text-right tabular-nums text-pi-text-muted lg:table-cell">{formatBytes(r.memory)}</td>
                          <td className="py-1.5">
                            {logIds.has(logId) && (
                              <Link href={remoteLogHref(host.id, logId)} className="inline-flex items-center gap-1 text-xs text-pi-accent-text underline" aria-label={`Logs of ${r.unit}`}>
                                <ScrollText className="h-3 w-3" aria-hidden /> Logs
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-pi-text-muted">{filter ? "No services match the filter." : "No failed units."}</p>
            )}
            {q.data.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-pi-text-muted" data-testid="services-warnings">
                {q.data.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            {q.data.systemd && <p className="mt-2 text-xs text-pi-text-muted">systemd {q.data.systemd} · read-only</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
