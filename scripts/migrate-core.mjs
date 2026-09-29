// Author:      0xWulf (zk@hexawulf.dev)
// Description: PiDeck schema migrations (docs/plans/multi-host-h2.md › M0).
//              Applies drizzle-kit's migrations/ (journal + SQL) with the same
//              bookkeeping as drizzle-orm's migrator — table
//              public.__drizzle_migrations (id, hash = sha256 of the file,
//              created_at = the journal's "when") — so drizzle tooling stays
//              compatible, plus what that migrator lacks:
//                • a session advisory lock (concurrent runs serialise),
//                • one transaction per migration (a failure rolls back only
//                  that migration and stops),
//                • a baseline mark for databases created by `drizzle-kit
//                  push` (PiDeck ≤ 2.4): app tables present, no migrations
//                  table → record 0000 as applied WITHOUT running it.
//              Used by scripts/migrate.mjs (npm run db:migrate) and by the hub
//              at startup (migrationStatus, read-only).
// Modified:    2026-09-29
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** migrations/ next to this checkout: scripts/, server/ and dist/ are all one level below the root. */
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
export const MIGRATIONS_TABLE = "__drizzle_migrations";
/** Tables every pre-migrations PiDeck database has (what migrations/0000 creates). */
export const BASELINE_TABLES = ["users", "sessions", "historical_metrics"];
/** pg_advisory_lock key ("PiDeck migrate"); distinct from the sampler's key. */
export const MIGRATE_LOCK_KEY = 0x506944656b6d;

/** Every migration in the journal, in order: { idx, tag, when, hash, statements }. */
export function readMigrations(dir = MIGRATIONS_DIR) {
  const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"));
  return journal.entries.map((e) => {
    const sql = fs.readFileSync(path.join(dir, `${e.tag}.sql`), "utf8");
    return {
      idx: e.idx,
      tag: e.tag,
      when: e.when,
      hash: crypto.createHash("sha256").update(sql).digest("hex"),
      statements: sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean),
    };
  });
}

async function tableExists(client, name) {
  const { rows } = await client.query("SELECT to_regclass($1) AS t", [`public."${name}"`]);
  return rows[0].t !== null;
}

/**
 * Read-only: what migrate() would do.
 * { tracked, baseline: "none"|"needed"|"partial", applied: [{hash, created_at}], pending: [tag], edited: [tag] }
 */
export async function migrationStatus(client, { dir = MIGRATIONS_DIR } = {}) {
  const migrations = readMigrations(dir);
  const tracked = await tableExists(client, MIGRATIONS_TABLE);
  const present = [];
  for (const t of BASELINE_TABLES) if (await tableExists(client, t)) present.push(t);
  let baseline = "none";
  if (!tracked && present.length === BASELINE_TABLES.length) baseline = "needed";
  else if (!tracked && present.length > 0) baseline = "partial";

  let applied = [];
  if (tracked) {
    const { rows } = await client.query(`SELECT hash, created_at FROM public."${MIGRATIONS_TABLE}" ORDER BY created_at`);
    applied = rows.map((r) => ({ hash: r.hash, created_at: Number(r.created_at) }));
  }
  // drizzle's rule: everything newer than the newest recorded migration is pending.
  let last = applied.length ? Math.max(...applied.map((a) => a.created_at)) : -Infinity;
  if (baseline === "needed") last = migrations[0]?.when ?? last; // 0000 will be marked, not run
  const pending = migrations.filter((m) => m.when > last).map((m) => m.tag);
  const hashes = new Set(applied.map((a) => a.hash));
  const edited = migrations.filter((m) => m.when <= last && tracked && !hashes.has(m.hash)).map((m) => m.tag);
  return { tracked, baseline, applied, pending, edited };
}

const say = (log, level, msg) => (log?.[level] ?? console[level])(msg);

/**
 * Apply every pending migration. Holds a session advisory lock for the whole
 * run; each migration runs in its own transaction together with its
 * bookkeeping row. Throws (after rolling back the failing migration) on the
 * first error. Returns { baselined, applied: [tag] }.
 */
export async function migrate(client, { dir = MIGRATIONS_DIR, log = console } = {}) {
  const migrations = readMigrations(dir);
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]);
  try {
    const status = await migrationStatus(client, { dir });
    if (status.baseline === "partial") {
      throw new Error(
        `the database has some PiDeck tables but not all (${BASELINE_TABLES.join(", ")}) and no ${MIGRATIONS_TABLE}: ` +
          "refusing to guess. Restore it from a backup or fix it by hand.",
      );
    }
    for (const tag of status.edited) {
      say(log, "warn", `[migrate] WARNING: ${tag}.sql differs from what was applied — never edit an applied migration; add a new one.`);
    }
    let baselined = false;
    if (!status.tracked) {
      await client.query(
        `CREATE TABLE IF NOT EXISTS public."${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
      );
    }
    if (status.baseline === "needed") {
      const base = migrations[0];
      await client.query(`INSERT INTO public."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`, [base.hash, base.when]);
      baselined = true;
      say(log, "warn", "[migrate] ============================================================");
      say(log, "warn", `[migrate] BASELINE: existing PiDeck tables found (${BASELINE_TABLES.join(", ")}) and no migration history.`);
      say(log, "warn", `[migrate] Recorded ${base.tag} as applied WITHOUT running it (no schema change).`);
      say(log, "warn", "[migrate] ============================================================");
    }
    const applied = [];
    for (const m of migrations.filter((x) => status.pending.includes(x.tag))) {
      await client.query("BEGIN");
      try {
        for (const stmt of m.statements) await client.query(stmt);
        await client.query(`INSERT INTO public."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`, [m.hash, m.when]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        const e = new Error(`migration ${m.tag} failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`);
        e.cause = err;
        throw e;
      }
      applied.push(m.tag);
      say(log, "info", `[migrate] applied ${m.tag}`);
    }
    return { baselined, applied };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]).catch(() => {});
  }
}
