// Per-host history and alerts on a real Postgres whose TimeZone is
// Asia/Taipei (like prod): the `timestamp` column holds UTC wall time, so
// every cutoff is a UTC ISO string computed in JS, never now() in SQL.
// Needs PIDECK_TEST_PG_URL (see tests/db/pg-helpers.ts); skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "../../scripts/migrate-core.mjs";
import { connect, dbUrl, dropDb, hasPg, PROD_TZ, quiet, scratchDb } from "../db/pg-helpers";

if (!hasPg) console.warn("[history.db.test] PIDECK_TEST_PG_URL not set: history/alerts database tests skipped");

const MIN = 60_000;
const NOW = Date.parse("2026-09-29T04:00:00Z"); // 12:00 in Taipei

let name = "";
let client: pg.Client;
type Mods = {
  history: typeof import("../../server/services/history");
  alerts: typeof import("../../server/services/alerts");
};
let m: Mods;

beforeAll(async () => {
  if (!hasPg) return;
  name = await scratchDb("pideck_hist");
  client = await connect(dbUrl(name));
  // Every session of this database (incl. the app's postgres-js pool) runs in Taipei time.
  await client.query(`ALTER DATABASE "${name}" SET TimeZone = '${PROD_TZ}'`);
  await migrate(client, { log: quiet });
  process.env.DATABASE_URL = dbUrl(name);
  m = { history: await import("../../server/services/history"), alerts: await import("../../server/services/alerts") };
});
afterAll(async () => {
  if (!hasPg) return;
  await client.end().catch(() => {});
  await dropDb(name);
});

const point = (hostId: string, at: number, cpu = 10) => ({
  hostId, timestamp: new Date(at).toISOString(), cpuUsage: cpu, memoryUsage: 20, temperature: 50,
  diskReadSpeed: 1, diskWriteSpeed: 2, networkRx: 3, networkTx: 4,
});

describe.skipIf(!hasPg)("history under TimeZone=Asia/Taipei", () => {
  it("the app's own connection really is in Taipei time", async () => {
    const { getDb } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const rows = (await getDb().execute(sql`show timezone`)) as unknown as { TimeZone: string }[];
    expect(rows[0].TimeZone).toBe(PROD_TZ);
  });

  it("stores UTC wall time, reads it back as the same instant", async () => {
    const { historyStore } = m.history;
    await historyStore.insert([point("t-rt", NOW)]);
    const raw = await client.query(`SELECT "timestamp"::text AS t FROM historical_metrics WHERE host_id = 't-rt'`);
    expect(raw.rows[0].t).toBe("2026-09-29 04:00:00"); // UTC, not 12:00
    const [row] = await historyStore.range("t-rt", "2026-09-29T03:59:00.000Z");
    expect(new Date(`${String(row.timestamp).replace(" ", "T")}Z`).getTime()).toBe(NOW);
    expect(row).not.toHaveProperty("hostId");
  });

  it("range: only that host, only since the UTC cutoff, oldest first", async () => {
    const { historyStore, utcCutoff } = m.history;
    const pts = [];
    for (let i = 0; i < 120; i++) pts.push(point("t-a", NOW - i * MIN, i), point("t-b", NOW - i * MIN, 500 + i));
    await historyStore.insert(pts);
    const hour = await historyStore.range("t-a", utcCutoff(60 * MIN, NOW));
    expect(hour).toHaveLength(61); // NOW-60min .. NOW inclusive
    expect(hour.every((r) => r.cpuUsage! < 500)).toBe(true);
    expect(hour.map((r) => r.cpuUsage)).toEqual([...Array(61).keys()].reverse());
    expect(await historyStore.range("t-a", utcCutoff(15 * MIN, NOW))).toHaveLength(16);
  });

  it("a naive now()-based cutoff would be 8 hours off (why we never use it)", async () => {
    // Rows written "now" in UTC compared with localtimestamp (Taipei wall time):
    const r = await client.query(
      `SELECT (localtimestamp - $1::timestamp) AS skew`, [new Date().toISOString()],
    );
    const hours = Math.round((r.rows[0].skew.hours ?? 0) + (r.rows[0].skew.minutes ?? 0) / 60);
    expect(hours).toBe(8);
  });

  it("prune drops every host's rows older than the UTC cutoff and nothing newer", async () => {
    const { historyStore, utcCutoff } = m.history;
    await historyStore.insert([point("t-p", NOW - 25 * 60 * MIN), point("t-p", NOW - 23 * 60 * MIN), point("t-q", NOW - 30 * 60 * MIN)]);
    await historyStore.prune(utcCutoff(24 * 60 * MIN, NOW));
    const left = await client.query(`SELECT host_id, "timestamp"::text AS t FROM historical_metrics WHERE host_id IN ('t-p','t-q')`);
    expect(left.rows).toEqual([{ host_id: "t-p", t: "2026-09-28 05:00:00" }]);
  });

  it("latestPerHost: the newest row per host, as a UTC ISO string", async () => {
    const { historyStore } = m.history;
    await historyStore.insert([point("t-l1", NOW - 5 * MIN), point("t-l1", NOW - MIN, 77), point("t-l2", NOW - 9 * MIN)]);
    const latest = await historyStore.latestPerHost();
    expect(latest.get("t-l1")).toMatchObject({ timestamp: new Date(NOW - MIN).toISOString(), cpuUsage: 77 });
    expect(latest.get("t-l2")?.timestamp).toBe(new Date(NOW - 9 * MIN).toISOString());
  });

  it("rows written before 2.5 (no host id) belong to the hub itself", async () => {
    await client.query(`INSERT INTO historical_metrics ("timestamp", cpu_usage) VALUES ('2026-09-29 03:30:00', 42)`);
    const rows = await m.history.historyStore.range("local", "2026-09-29T03:29:00.000Z");
    expect(rows.map((r) => r.cpuUsage)).toContain(42);
  });
});

describe.skipIf(!hasPg)("alerts table", () => {
  it("open alerts survive a restart (a new manager loads them)", async () => {
    const { createAlertManager, pgAlertStore } = m.alerts;
    let t = NOW;
    const m1 = createAlertManager({ store: pgAlertStore, now: () => new Date(t) });
    await m1.load();
    expect(await m1.evaluate("a-host", "offline", true, { severity: "critical", message: "gone", startedAt: new Date(NOW - 7 * MIN) })).toBe("opened");
    expect(await m1.evaluate("a-host", "temperature", true, { severity: "warning", message: "hot" })).toBe("opened");
    const m2 = createAlertManager({ store: pgAlertStore, now: () => new Date(t) });
    await m2.load();
    const open = m2.openAlerts("a-host");
    expect(open.map((a) => a.type).sort()).toEqual(["offline", "temperature"]);
    expect(open.find((a) => a.type === "offline")!.startedAt).toEqual(new Date(NOW - 7 * MIN)); // timestamptz: exact instant
    t += MIN;
    expect(await m2.evaluate("a-host", "offline", false, { severity: "critical", message: "" })).toBe("resolved");
    const recent = await pgAlertStore.listRecent(new Date(NOW));
    expect(recent.find((a) => a.type === "offline")?.resolvedAt).toEqual(new Date(NOW + MIN));
  });

  it("at most one open alert per (host, type): the partial unique index", async () => {
    const { pgAlertStore } = m.alerts;
    const a = { hostId: "u-host", type: "temperature" as const, severity: "warning" as const, message: "x", startedAt: new Date(NOW) };
    const first = await pgAlertStore.open(a);
    await expect(pgAlertStore.open(a)).rejects.toThrow();
    await pgAlertStore.resolve(first.id, new Date(NOW));
    await expect(pgAlertStore.open(a)).resolves.toMatchObject({ hostId: "u-host" }); // resolved ones don't count
  });

  it("pruneResolved removes only resolved alerts older than the cutoff", async () => {
    const { pgAlertStore } = m.alerts;
    const old = await pgAlertStore.open({ hostId: "p-host", type: "offline", severity: "critical", message: "old", startedAt: new Date(NOW - 50 * 60 * MIN) });
    await pgAlertStore.resolve(old.id, new Date(NOW - 49 * 60 * MIN));
    await pgAlertStore.open({ hostId: "p-host", type: "temperature", severity: "warning", message: "still open", startedAt: new Date(NOW - 50 * 60 * MIN) });
    await pgAlertStore.pruneResolved(new Date(NOW - 24 * 60 * MIN));
    const left = await client.query(`SELECT message FROM alerts WHERE host_id = 'p-host'`);
    expect(left.rows).toEqual([{ message: "still open" }]);
  });
});
