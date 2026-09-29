import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useHistory } from "@/hooks/use-system-info";
import { downsample, type Point } from "@/lib/downsample";
import { formatClock, formatDayClock, formatNumber, parseDbTimestamp, rateScale } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { QueryState } from "@/widgets/WidgetFrame";
import { useHost, useHostSummary } from "@/hosts/HostProvider";
import type { z } from "zod";
import type { historySchema } from "@/widgets/schemas";

type HistoryRow = z.infer<typeof historySchema>[number];

export const RANGES = [
  { id: "15m", label: "15m", ms: 15 * 60_000 },
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "6h", label: "6h", ms: 6 * 60 * 60_000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60_000 },
  { id: "3d", label: "3d", ms: 3 * 24 * 60 * 60_000 },
  { id: "7d", label: "7d", ms: 7 * 24 * 60 * 60_000 },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

/** Ranges the hub keeps enough history for (PIDECK_HISTORY_HOURS; 24 h when unknown). */
export function rangesFor(historyHours: number | undefined): (typeof RANGES)[number][] {
  const keptMs = (historyHours ?? 24) * 3_600_000;
  return RANGES.filter((r) => r.ms <= 24 * 3_600_000 || r.ms <= keptMs);
}

export type Series = {
  key: string;
  name: string;
  field: keyof Omit<HistoryRow, "timestamp">;
  color: string; // CSS var, e.g. "var(--pi-chart-1)"
};

/** History rows → points within [now - rangeMs, now], downsampled to ≤300. */
export function toChartPoints(rows: HistoryRow[], series: Series[], rangeMs: number, now: number): Point[] {
  const from = now - rangeMs;
  const pts: Point[] = [];
  for (const row of rows) {
    const t = parseDbTimestamp(row.timestamp);
    if (!Number.isFinite(t) || t < from || t > now) continue;
    const p = { t } as Point;
    for (const s of series) (p as Record<string, number | null>)[s.key] = row[s.field];
    pts.push(p);
  }
  return downsample(pts, 300);
}

function RangePicker({ value, onChange, label, ranges }: { value: RangeId; onChange: (r: RangeId) => void; label: string; ranges: (typeof RANGES)[number][] }) {
  return (
    <div role="group" aria-label={`${label} time range`} className="flex rounded-md border border-pi-border p-0.5">
      {ranges.map((r) => (
        <button
          key={r.id}
          type="button"
          aria-pressed={value === r.id}
          onClick={() => onChange(r.id)}
          className={cn(
            "rounded px-1.5 py-0.5 text-xs",
            value === r.id ? "bg-pi-accent text-pi-on-accent" : "text-pi-text-muted hover:bg-pi-card-hover hover:text-pi-text",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function HistoryChart({ id, label, series, current }: { id: string; label: string; series: Series[]; current?: React.ReactNode }) {
  const ranges = rangesFor(useAuth().user?.historyHours);
  const host = useHost();
  const oldAgent = useHostSummary(host.id)?.history === "unsupported";
  const [picked, setRange] = useState<RangeId>("1h");
  const range = ranges.some((r) => r.id === picked) ? picked : "1h";
  const rangeMs = RANGES.find((r) => r.id === range)!.ms;
  const long = range === "3d" || range === "7d";
  const query = useHistory(long ? range : undefined);
  const tick = long ? formatDayClock : formatClock;

  // Recompute only when a new history payload arrives or the range changes.
  const { points, scale, domain } = useMemo(() => {
    const now = Date.now();
    const points = query.data ? toChartPoints(query.data, series, rangeMs, now) : [];
    let max = 0;
    for (const p of points) for (const s of series) max = Math.max(max, p[s.key] ?? 0);
    // Scale the data (not the tick labels) so Recharts picks round ticks in the shown unit.
    const scale = rateScale(max);
    const scaled = scale.divisor === 1 ? points : points.map((p) => {
      const q = { ...p };
      for (const s of series) {
        const v = p[s.key];
        (q as Record<string, number | null>)[s.key] = v === null ? null : v / scale.divisor;
      }
      return q;
    });
    return { points: scaled, scale, domain: [now - rangeMs, now] as [number, number] };
  }, [query.data, series, rangeMs]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-pi-text-muted tabular-nums">{current}</div>
        <RangePicker value={range} onChange={setRange} label={label} ranges={ranges} />
      </div>
      <QueryState
        query={query}
        isEmpty={() => points.length === 0}
        emptyText={
          oldAgent
            ? "This agent is older than 2.5: update the agent for history."
            : `No samples in the last ${range}. The hub records one per minute while it can reach the host.`
        }
      >
        {() => (
          <div className="h-[var(--pi-chart-h)] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  {series.map((s) => (
                    <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={s.color} stopOpacity={0.6} />
                      <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--pi-border)" strokeOpacity={0.6} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={domain}
                  tickFormatter={tick}
                  stroke="var(--pi-text-muted)"
                  fontSize={11}
                  minTickGap={24}
                />
                <YAxis
                  stroke="var(--pi-text-muted)"
                  fontSize={11}
                  width={52}
                  tickFormatter={(v: number) => formatNumber(v)}
                  label={{ value: scale.unit, angle: -90, position: "insideLeft", fill: "var(--pi-text-muted)", fontSize: 11, dy: 16 }}
                />
                <Tooltip
                  labelFormatter={(t: number) => tick(t)}
                  formatter={(v: number) => `${formatNumber(v)} ${scale.unit}`}
                  contentStyle={{ background: "var(--pi-card)", border: "1px solid var(--pi-border)", borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: "var(--pi-text-muted)" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {series.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    fill={`url(#${id}-${s.key})`}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </QueryState>
      <p className="text-xs text-pi-text-muted">Sampled every minute by the hub — gaps mean the host was unreachable.</p>
    </div>
  );
}
