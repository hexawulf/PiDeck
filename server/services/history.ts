// Per-host metric history in historical_metrics (docs/plans/multi-host-h2.md).
//
// TIMEZONE TRAP: `timestamp` is `timestamp without time zone` holding UTC
// wall time, and prod's database TimeZone is Asia/Taipei. So:
//   • rows are written with JS UTC ISO strings (Postgres drops the "Z" for
//     this type, keeping the UTC wall time);
//   • every cutoff is a UTC ISO string computed here in JS;
//   • nothing compares the column with now()/localtimestamp.
// tests/unit/history.db.test.ts runs these under TimeZone=Asia/Taipei.
import { getDb } from "../db";

export type HistoryPoint = {
  hostId: string;
  /** UTC ISO string. */
  timestamp: string;
  cpuUsage: number | null;
  memoryUsage: number | null;
  temperature: number | null;
  diskReadSpeed: number | null;
  diskWriteSpeed: number | null;
  networkRx: number | null;
  networkTx: number | null;
};

/** One row as /api/history and /api/system/history return it (no host id: the caller asked for one). */
export type HistoryRow = Omit<HistoryPoint, "hostId"> & { id: number };

export const RANGES_MS = { "15m": 15 * 60_000, "1h": 3_600_000, "6h": 6 * 3_600_000, "24h": 24 * 3_600_000 } as const;
export type RangeId = keyof typeof RANGES_MS;
export const isRangeId = (r: unknown): r is RangeId => typeof r === "string" && r in RANGES_MS;

/** A cutoff `ms` before `now`, as the UTC ISO string the column is compared with. */
export const utcCutoff = (ms: number, now = Date.now()) => new Date(now - ms).toISOString();

const round = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v));

async function lazy() {
  const [{ historicalMetrics }, { sql, and, eq, gte, lt, desc, asc }] = await Promise.all([import("@shared/schema"), import("drizzle-orm")]);
  return { db: getDb(), t: historicalMetrics, sql, and, eq, gte, lt, desc, asc };
}

export const historyStore = {
  async insert(points: HistoryPoint[]): Promise<void> {
    if (!points.length) return;
    const { db, t } = await lazy();
    await db.insert(t).values(points.map((p) => ({
      hostId: p.hostId,
      timestamp: p.timestamp,
      cpuUsage: round(p.cpuUsage),
      memoryUsage: round(p.memoryUsage),
      temperature: round(p.temperature),
      diskReadSpeed: round(p.diskReadSpeed),
      diskWriteSpeed: round(p.diskWriteSpeed),
      networkRx: round(p.networkRx),
      networkTx: round(p.networkTx),
    })));
  },

  /** Drop every host's rows older than the cutoff (UTC ISO). */
  async prune(cutoffIso: string): Promise<void> {
    const { db, t, lt } = await lazy();
    await db.delete(t).where(lt(t.timestamp, cutoffIso));
  },

  /** A host's rows since the cutoff (UTC ISO), oldest first. */
  async range(hostId: string, sinceIso: string): Promise<HistoryRow[]> {
    const { db, t, and, eq, gte, asc } = await lazy();
    return db
      .select({
        id: t.id, timestamp: t.timestamp, cpuUsage: t.cpuUsage, memoryUsage: t.memoryUsage, temperature: t.temperature,
        diskReadSpeed: t.diskReadSpeed, diskWriteSpeed: t.diskWriteSpeed, networkRx: t.networkRx, networkTx: t.networkTx,
      })
      .from(t)
      .where(and(eq(t.hostId, hostId), gte(t.timestamp, sinceIso)))
      .orderBy(asc(t.timestamp));
  },

  /** The newest row per host (uses the (host_id, timestamp DESC) index). */
  async latestPerHost(): Promise<Map<string, HistoryPoint>> {
    const { db, sql } = await lazy();
    const rows = (await db.execute(sql`
      SELECT DISTINCT ON (host_id) host_id, "timestamp", cpu_usage, memory_usage, temperature,
             disk_read_speed, disk_write_speed, network_rx, network_tx
      FROM historical_metrics ORDER BY host_id, "timestamp" DESC`)) as unknown as Record<string, unknown>[];
    const out = new Map<string, HistoryPoint>();
    for (const r of rows) {
      out.set(String(r.host_id), {
        hostId: String(r.host_id),
        timestamp: dbTimestampToIso(r.timestamp),
        cpuUsage: r.cpu_usage as number | null, memoryUsage: r.memory_usage as number | null, temperature: r.temperature as number | null,
        diskReadSpeed: r.disk_read_speed as number | null, diskWriteSpeed: r.disk_write_speed as number | null,
        networkRx: r.network_rx as number | null, networkTx: r.network_tx as number | null,
      });
    }
    return out;
  },
};

export type HistoryStore = typeof historyStore;

/**
 * The column's value (UTC wall time, no zone) → ISO with Z. postgres-js gives
 * "2026-09-29 00:00:00" (or a Date when a raw query returns it); both mean UTC.
 */
export function dbTimestampToIso(v: unknown): string {
  if (v instanceof Date) {
    // A Date built from a zone-less value was read as *local* time: undo that.
    return new Date(v.getTime() - v.getTimezoneOffset() * 60_000).toISOString();
  }
  const s = String(v);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`).toISOString();
}
