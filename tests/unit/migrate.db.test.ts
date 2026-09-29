// M0 (docs/plans/multi-host-h2.md): baseline mark, fresh databases, re-runs,
// concurrency and failures, on a real Postgres with a prod-shaped fixture.
// Needs PIDECK_TEST_PG_URL (see tests/db/pg-helpers.ts); skipped otherwise.
import { afterAll, describe, expect, it } from "vitest";
import type pg from "pg";
import pgLib from "pg";
import { migrate, migrationStatus, MIGRATIONS_TABLE, readMigrations } from "../../scripts/migrate-core.mjs";
import { checkSchema, resetSchemaState, schemaReady } from "../../server/db-schema";
import {
  catalog, connect, dataFingerprint, dbUrl, dropDb, hasPg, loadProdShape, migrationsSubset, quiet, scratchDb,
  userSessionsFingerprint,
} from "../db/pg-helpers";

if (!hasPg) console.warn("[migrate.db.test] PIDECK_TEST_PG_URL not set: database migration tests skipped");

const created: string[] = [];
const clients: pg.Client[] = [];
async function db(): Promise<{ name: string; client: pg.Client }> {
  const name = await scratchDb();
  created.push(name);
  const client = await connect(dbUrl(name));
  clients.push(client);
  return { name, client };
}
afterAll(async () => {
  for (const c of clients) await c.end().catch(() => {});
  for (const n of created) await dropDb(n);
});

const MIG_TABLES = [MIGRATIONS_TABLE];
const recorded = async (c: pg.Client) =>
  (await c.query(`SELECT hash, created_at FROM public."${MIGRATIONS_TABLE}" ORDER BY id`)).rows.map((r) => Number(r.created_at));
const ALL = readMigrations();

describe.skipIf(!hasPg)("migrations on a real Postgres", () => {
  describe.each([true, false])("baseline mark on a prod-shaped database (idx_users_username: %s)", (withUsernameIndex) => {
    it("records 0000 without running any DDL; data and user_sessions untouched", async () => {
      const { client } = await db();
      await loadProdShape(client, { withUsernameIndex });
      const before = { cat: await catalog(client), data: await dataFingerprint(client), us: await userSessionsFingerprint(client) };
      const dir = migrationsSubset(1); // just the baseline
      expect((await migrationStatus(client, { dir })).baseline).toBe("needed");
      const warnings: string[] = [];
      const r = await migrate(client, { dir, log: { ...quiet, warn: (m: string) => warnings.push(m) } });
      expect(r).toEqual({ baselined: true, applied: [] });
      expect(warnings.join("\n")).toMatch(/BASELINE: existing PiDeck tables found[\s\S]*WITHOUT running it/);
      expect(await catalog(client, MIG_TABLES)).toEqual(before.cat); // no DDL besides the bookkeeping table
      expect(await dataFingerprint(client)).toBe(before.data);
      expect(await userSessionsFingerprint(client)).toBe(before.us);
      expect(await recorded(client)).toEqual([ALL[0].when]);
    });

    it("then applies the rest; user_sessions still byte-identical; re-run is a no-op", async () => {
      const { client } = await db();
      await loadProdShape(client, { withUsernameIndex });
      const us = await userSessionsFingerprint(client);
      const data = await dataFingerprint(client);
      const r = await migrate(client, { log: quiet });
      expect(r.baselined).toBe(true);
      expect(r.applied).toEqual(ALL.slice(1).map((m) => m.tag));
      expect(await userSessionsFingerprint(client)).toBe(us);
      expect((await client.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n).toBe(1);
      expect((await client.query(`SELECT count(*)::int AS n FROM historical_metrics`)).rows[0].n).toBe(JSON.parse(data).history.n);
      expect((await catalog(client)).some((l) => l.includes("idx_users_username"))).toBe(false);
      const after = await catalog(client);
      expect(await migrate(client, { log: quiet })).toEqual({ baselined: false, applied: [] });
      expect(await catalog(client)).toEqual(after);
      expect((await migrationStatus(client)).pending).toEqual([]);
    });
  });

  it("the generated baseline (0000) builds exactly the prod shape", async () => {
    const prod = await db();
    await loadProdShape(prod.client, { historyRows: 0 });
    const fresh = await db();
    await migrate(fresh.client, { dir: migrationsSubset(1), log: quiet });
    // user_sessions is created by connect-pg-simple at hub start, never by migrations.
    expect(await catalog(fresh.client, [...MIG_TABLES, "user_sessions"])).toEqual(await catalog(prod.client, ["user_sessions"]));
    expect((await catalog(fresh.client)).some((l) => l.includes("user_sessions"))).toBe(false);
  });

  it("a fresh database runs every migration and ends up like a migrated prod database", async () => {
    const fresh = await db();
    const r = await migrate(fresh.client, { log: quiet });
    expect(r).toEqual({ baselined: false, applied: ALL.map((m) => m.tag) });
    const prod = await db();
    await loadProdShape(prod.client, { historyRows: 0 });
    await migrate(prod.client, { log: quiet });
    const pushInstall = await db();
    await loadProdShape(pushInstall.client, { withUsernameIndex: false, historyRows: 0 });
    await migrate(pushInstall.client, { log: quiet });
    const shape = await catalog(fresh.client);
    expect(await catalog(prod.client, ["user_sessions"])).toEqual(shape);
    expect(await catalog(pushInstall.client, ["user_sessions"])).toEqual(shape);
  });

  it("concurrent runs serialise on the advisory lock (each migration applied once)", async () => {
    const { name } = await db();
    const a = await connect(dbUrl(name));
    const b = await connect(dbUrl(name));
    clients.push(a, b);
    const [ra, rb] = await Promise.all([migrate(a, { log: quiet }), migrate(b, { log: quiet })]);
    expect([...ra.applied, ...rb.applied].sort()).toEqual(ALL.map((m) => m.tag).sort());
    expect(await recorded(a)).toEqual(ALL.map((m) => m.when));
  });

  it("a failing migration is rolled back and stops the run (earlier ones stay)", async () => {
    const { client } = await db();
    await loadProdShape(client);
    const good = await catalog(client);
    const dir = migrationsSubset(ALL.length, [
      { tag: "9998_ok", sql: `CREATE TABLE "made_by_ok" (x int);` },
      { tag: "9999_bad", sql: `CREATE TABLE "half_done" (x int);\n--> statement-breakpoint\nSELECT 1/0;` },
    ]);
    await expect(migrate(client, { dir, log: quiet })).rejects.toThrow(/9999_bad failed and was rolled back: division by zero/);
    const cat = await catalog(client, MIG_TABLES);
    expect(cat.some((l) => l.includes("half_done"))).toBe(false); // the failing one left nothing
    expect(cat.some((l) => l.includes("made_by_ok"))).toBe(true); // its predecessor stays applied
    expect((await recorded(client)).length).toBe(ALL.length + 1);
    expect((await migrationStatus(client, { dir })).pending).toEqual(["9999_bad"]);
    expect(good.filter((l) => l.includes("user_sessions"))).toEqual(cat.filter((l) => l.includes("user_sessions")));
    // and the lock was released: another run can go ahead
    await expect(migrate(client, { dir: migrationsSubset(ALL.length), log: quiet })).resolves.toEqual({ baselined: false, applied: [] });
  });

  it("refuses a partial schema instead of guessing", async () => {
    const { client } = await db();
    await client.query(`CREATE TABLE users (id serial PRIMARY KEY)`);
    await expect(migrate(client, { log: quiet })).rejects.toThrow(/some PiDeck tables but not all/);
    expect((await catalog(client)).some((l) => l.includes(MIGRATIONS_TABLE))).toBe(false);
  });

  it("hub startup check: pending on a 2.4 database (logged, not thrown), ready after db:migrate", async () => {
    const { name, client } = await db();
    await loadProdShape(client);
    const pool = new pgLib.Pool({ connectionString: dbUrl(name), options: "-c TimeZone=Asia/Taipei" });
    const errors: string[] = [];
    const log = { info: () => {}, error: (m: string) => errors.push(m) };
    try {
      resetSchemaState();
      const s = await checkSchema(pool, log);
      expect(s.baseline).toBe("needed");
      expect(schemaReady()).toBe(false);
      expect(errors.join()).toMatch(/DATABASE NEEDS MIGRATING .*scripts\/install\.sh --update/);
      await migrate(client, { log: quiet });
      await checkSchema(pool, log);
      expect(schemaReady()).toBe(true);
    } finally {
      resetSchemaState();
      await pool.end();
    }
  });

  it("status is read-only and reports pending work", async () => {
    const { client } = await db();
    await loadProdShape(client);
    const cat = await catalog(client);
    const s = await migrationStatus(client);
    expect(s.baseline).toBe("needed");
    expect(s.pending).toEqual(ALL.slice(1).map((m) => m.tag));
    expect(await catalog(client)).toEqual(cat);
  });
});
