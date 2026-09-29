import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { AlertTriangle } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { useRefetch } from "@/hooks/useRefetch";
import { alertSchema, alertText } from "@/hooks/use-alerts";
import { hostSummarySchema } from "@/hosts/HostProvider";
import { formatLastSeen, hostHref } from "@/hosts/host-path";
import { hostStatusText, needsAgentUpdate, StatusDot } from "@/components/host-switcher";
import { formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";

// The All hosts overview (docs/plans/multi-host-h2.md › UI): one tile per
// host from GET /api/overview (one request; the hub's sampler numbers).
// Its own chunk (lazy in app-shell.tsx).

const num = z.number().nullable();
const overviewSchema = z.object({
  generatedAt: z.string(),
  historyHours: z.number(),
  hosts: z.array(
    hostSummarySchema.extend({
      sample: z.object({ at: z.string(), cpu: num, memory: num, temperature: num, diskUsage: num, rxKBs: num, txKBs: num }).nullable(),
      alerts: z.array(alertSchema),
    }),
  ),
});
type HostTile = z.infer<typeof overviewSchema>["hosts"][number];
const fetchJson = getQueryFn<unknown>({ on401: "throw" });

function useOverview() {
  const refetchInterval = useRefetch(15_000);
  return useQuery({
    queryKey: ["/api/overview"],
    queryFn: async (ctx) => overviewSchema.parse(await fetchJson(ctx)),
    refetchInterval,
  });
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-pi-text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-pi-text">{value}</dd>
    </div>
  );
}

function Tile({ h, hubVersion }: { h: HostTile; hubVersion: string | null }) {
  const reachable = h.status === "online";
  const s = h.sample;
  const alerts = h.alerts;
  return (
    <li>
      <Link
        href={hostHref(h.id, "dashboard")}
        data-testid={`host-tile-${h.id}`}
        data-status={h.status}
        className={cn(
          "block h-full rounded-xl border bg-pi-card p-4 text-pi-text transition-colors hover:bg-pi-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-pi-accent",
          needsAgentUpdate(h) ? "border-pi-warning" : h.status === "auth-error" ? "border-pi-error" : "border-pi-border",
          !reachable && h.status !== "auth-error" && "opacity-70",
        )}
      >
        <div className="mb-3 flex items-center gap-2">
          <StatusDot host={h} hubVersion={hubVersion} />
          <h2 className="min-w-0 flex-1 truncate font-semibold">
            {h.label}
            {h.local && <span className="font-normal text-pi-text-muted"> · this hub</span>}
          </h2>
          {alerts.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-pi-error-soft px-2 py-0.5 text-xs text-pi-text" data-testid="tile-alerts">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}
            </span>
          )}
        </div>
        <p className={cn("mb-3 text-xs", needsAgentUpdate(h) ? "text-pi-text" : "text-pi-text-muted")} data-testid="tile-status">
          {hostStatusText(h, hubVersion)}
        </p>
        {s && reachable ? (
          <dl className="grid grid-cols-4 gap-2">
            <Stat label="CPU" value={pct(s.cpu)} />
            <Stat label="Temp" value={s.temperature === null ? "—" : `${Math.round(s.temperature)}°`} />
            <Stat label="RAM" value={pct(s.memory)} />
            <Stat label="Disk" value={pct(s.diskUsage)} />
          </dl>
        ) : (
          <p className="text-sm text-pi-text-muted">{reachable ? "No sample yet" : `Last seen ${formatLastSeen(h.lastSeen)}`}</p>
        )}
        {s && reachable && s.rxKBs !== null && s.txKBs !== null && (
          <p className="mt-2 text-xs text-pi-text-muted tabular-nums">↓ {formatRate(s.rxKBs)} · ↑ {formatRate(s.txKBs)}</p>
        )}
        {alerts.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-pi-text">
            {alerts.map((a) => (
              <li key={a.id}>{alertText(a).slice(h.label.length + 2)}</li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-pi-text-muted">
          {h.local ? "Sampled by the hub" : `Last seen ${formatLastSeen(h.lastSeen)}`}
        </p>
      </Link>
    </li>
  );
}

export default function HostsOverview() {
  const q = useOverview();
  if (q.isPending) return <p className="text-sm text-pi-text-muted">Loading hosts…</p>;
  if (q.isError) return <p className="text-sm text-pi-text-muted" role="alert">Couldn't load the overview: {q.error.message}</p>;
  const hubVersion = q.data.hosts.find((h) => h.local)?.version ?? null;
  return (
    <section aria-labelledby="hosts-title">
      <h1 id="hosts-title" className="mb-4 text-lg font-semibold text-pi-text">All hosts</h1>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="hosts-overview">
        {q.data.hosts.map((h) => <Tile key={h.id} h={h} hubVersion={hubVersion} />)}
      </ul>
      <p className="mt-4 text-xs text-pi-text-muted">
        Numbers are the hub's one-minute samples; history is kept {q.data.historyHours} h.
      </p>
    </section>
  );
}
