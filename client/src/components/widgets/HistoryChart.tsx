import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useHistory } from "@/hooks/use-system-info";
import { downsample, type Point } from "@/lib/downsample";
import { formatClock, formatNumber, parseDbTimestamp, rateScale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { QueryState } from "@/widgets/WidgetFrame";
import type { z } from "zod";
import type { historySchema } from "@/widgets/schemas";

type HistoryRow = z.infer<typeof historySchema>[number];

export const RANGES = [
  { id: "15m", label: "15m", ms: 15 * 60_000 },
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "6h", label: "6h", ms: 6 * 60 * 60_000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60_000 },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

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

function RangePicker({ value, onChange, label }: { value: RangeId; onChange: (r: RangeId) => void; label: string }) {
  return (
    <div role="group" aria-label={`${label} time range`} className="flex rounded-md border border-pi-border p-0.5">
      {RANGES.map((r) => (
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
  const query = useHistory();
  const [range, setRange] = useState<RangeId>("1h");
  const rangeMs = RANGES.find((r) => r.id === range)!.ms;

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
        <RangePicker value={range} onChange={setRange} label={label} />
      </div>
      <QueryState
        query={query}
        isEmpty={() => points.length === 0}
        emptyText={`No samples in the last ${range}. History is only recorded while PiDeck is open.`}
      >
        {() => (
          <div className="h-[220px] min-w-0">
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
                  tickFormatter={formatClock}
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
                  labelFormatter={(t: number) => formatClock(t)}
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
      <p className="text-xs text-pi-text-muted">Data only while PiDeck is open — gaps mean no tab was polling.</p>
    </div>
  );
}
