// Per-host alerts (docs/plans/multi-host-h2.md › "Per-host alerts").
//
//   evaluate(host, type, active)   active: true → open (or update the message)
//                                          false → resolve an open one
//                                          null  → unknown: change nothing
//
// State is keyed by (host, type) and lives in the `alerts` table: open rows
// are loaded into memory at start, so alerts survive a hub restart. The
// partial unique index allows at most one open alert per (host, type).
// Times are timestamptz written from JS (never a database default).
import { getDb } from "../db";

export type AlertType = "temperature" | "offline";
export type Severity = "warning" | "critical";
export type Alert = {
  id: number;
  hostId: string;
  type: AlertType;
  severity: Severity;
  message: string;
  startedAt: Date;
  resolvedAt: Date | null;
};
export type NewAlert = Omit<Alert, "id" | "resolvedAt">;

export interface AlertStore {
  listOpen(): Promise<Alert[]>;
  open(a: NewAlert): Promise<Alert>;
  update(id: number, message: string): Promise<void>;
  resolve(id: number, at: Date): Promise<void>;
  /** Open alerts plus those resolved at or after `since`. */
  listRecent(since: Date): Promise<Alert[]>;
  pruneResolved(before: Date): Promise<void>;
}

export const TEMPERATURE_THRESHOLD = 70; // °C, the rule PiDeck has always had

async function lazy() {
  const [{ alerts }, { and, eq, gte, isNull, isNotNull, lt, or, asc }] = await Promise.all([import("@shared/schema"), import("drizzle-orm")]);
  return { db: getDb(), t: alerts, and, eq, gte, isNull, isNotNull, lt, or, asc };
}
const fromRow = (r: { id: number; hostId: string; type: string; severity: string; message: string; startedAt: Date; resolvedAt: Date | null }): Alert =>
  ({ ...r, type: r.type as AlertType, severity: r.severity as Severity });

export const pgAlertStore: AlertStore = {
  async listOpen() {
    const { db, t, isNull, asc } = await lazy();
    return (await db.select().from(t).where(isNull(t.resolvedAt)).orderBy(asc(t.startedAt))).map(fromRow);
  },
  async open(a) {
    const { db, t } = await lazy();
    const [row] = await db.insert(t).values({ ...a, resolvedAt: null }).returning();
    return fromRow(row);
  },
  async update(id, message) {
    const { db, t, eq } = await lazy();
    await db.update(t).set({ message }).where(eq(t.id, id));
  },
  async resolve(id, at) {
    const { db, t, eq } = await lazy();
    await db.update(t).set({ resolvedAt: at }).where(eq(t.id, id));
  },
  async listRecent(since) {
    const { db, t, or, isNull, gte, asc } = await lazy();
    return (await db.select().from(t).where(or(isNull(t.resolvedAt), gte(t.resolvedAt, since))).orderBy(asc(t.startedAt))).map(fromRow);
  },
  async pruneResolved(before) {
    const { db, t, and, isNotNull, lt } = await lazy();
    await db.delete(t).where(and(isNotNull(t.resolvedAt), lt(t.resolvedAt, before)));
  },
};

/** In memory, same contract (unit tests). */
export function memoryAlertStore(seed: Alert[] = []): AlertStore & { rows: Alert[] } {
  const rows = seed.map((a) => ({ ...a }));
  let nextId = rows.reduce((m, a) => Math.max(m, a.id), 0) + 1;
  return {
    rows,
    async listOpen() { return rows.filter((a) => !a.resolvedAt).map((a) => ({ ...a })); },
    async open(a) {
      if (rows.some((r) => !r.resolvedAt && r.hostId === a.hostId && r.type === a.type)) throw new Error("duplicate open alert");
      const row = { ...a, id: nextId++, resolvedAt: null };
      rows.push(row);
      return { ...row };
    },
    async update(id, message) { const r = rows.find((x) => x.id === id); if (r) r.message = message; },
    async resolve(id, at) { const r = rows.find((x) => x.id === id); if (r) r.resolvedAt = at; },
    async listRecent(since) { return rows.filter((a) => !a.resolvedAt || a.resolvedAt >= since).map((a) => ({ ...a })); },
    async pruneResolved(before) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].resolvedAt && rows[i].resolvedAt! < before) rows.splice(i, 1);
    },
  };
}

export type Change = "opened" | "updated" | "resolved" | "none";

export function createAlertManager({ store = pgAlertStore, now = () => new Date() }: { store?: AlertStore; now?: () => Date } = {}) {
  const open = new Map<string, Alert>();
  const key = (host: string, type: string) => `${host}\u0000${type}`;
  let loaded = false;

  return {
    get loaded() {
      return loaded;
    },

    /** Load open alerts from the store (at start: they survive a restart). */
    async load() {
      open.clear();
      for (const a of await store.listOpen()) open.set(key(a.hostId, a.type), a);
      loaded = true;
    },

    async evaluate(
      hostId: string,
      type: AlertType,
      active: boolean | null,
      info: { severity: Severity; message: string; startedAt?: Date },
    ): Promise<Change> {
      if (active === null) return "none";
      const k = key(hostId, type);
      const cur = open.get(k);
      if (active && !cur) {
        const a = await store.open({ hostId, type, severity: info.severity, message: info.message, startedAt: info.startedAt ?? now() });
        open.set(k, a);
        return "opened";
      }
      if (active && cur) {
        if (cur.message === info.message) return "none";
        await store.update(cur.id, info.message);
        cur.message = info.message;
        return "updated";
      }
      if (!active && cur) {
        await store.resolve(cur.id, now());
        open.delete(k);
        return "resolved";
      }
      return "none";
    },

    /** Open alerts (all hosts, or one). */
    openAlerts(hostId?: string): Alert[] {
      return [...open.values()].filter((a) => hostId === undefined || a.hostId === hostId).map((a) => ({ ...a }));
    },

    listRecent: (since: Date) => store.listRecent(since),
    pruneResolved: (before: Date) => store.pruneResolved(before),
  };
}

export type AlertManager = ReturnType<typeof createAlertManager>;

export function temperatureMessage(t: number) {
  return `Temperature above ${TEMPERATURE_THRESHOLD} °C (${t.toFixed(1)} °C)`;
}
export function offlineMessage(since: Date) {
  return `Not answering since ${since.toISOString()}`;
}
