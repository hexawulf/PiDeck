/**
 * historical_metrics.timestamp is `timestamp without time zone` holding UTC
 * wall-clock time (the server inserts toISOString(); Postgres drops the Z),
 * so a zone-less value must be read as UTC, not local time.
 */
export function parseDbTimestamp(value: string): number {
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const hasZone = /(Z|[+-]\d{2}(:?\d{2})?)$/.test(iso);
  return Date.parse(hasZone ? iso : `${iso}Z`);
}

export function formatClock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Axis label for multi-day ranges: "Tue 14:00". */
export function formatDayClock(t: number): string {
  return new Date(t).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/** Pick one unit for a whole axis so ticks don't each carry their own. */
export function rateScale(maxKBps: number): { unit: string; divisor: number } {
  if (maxKBps >= 1024 * 1024) return { unit: "GB/s", divisor: 1024 * 1024 };
  if (maxKBps >= 1024) return { unit: "MB/s", divisor: 1024 };
  return { unit: "KB/s", divisor: 1 };
}

export function formatRate(kbps: number): string {
  const { unit, divisor } = rateScale(kbps);
  return `${formatNumber(kbps / divisor)} ${unit}`;
}

export function formatNumber(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** MB → "512 MB" / "1.5 GB" / "2 TB". */
export function formatMB(mb: number): string {
  if (mb >= 1024 * 1024) return `${formatNumber(mb / 1024 / 1024)} TB`;
  if (mb >= 1024) return `${formatNumber(mb / 1024)} GB`;
  return `${formatNumber(mb)} MB`;
}
