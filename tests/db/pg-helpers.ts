// Real-Postgres test helpers (tests/unit/*.db.test.ts). Set PIDECK_TEST_PG_URL
// to an admin URL that may CREATE/DROP DATABASE, e.g.
//   PIDECK_TEST_PG_URL=postgres://postgres@127.0.0.1:5432/postgres npm test
// Without it those suites are skipped (with a warning). Every connection uses
// the session TimeZone Asia/Taipei, like prod.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

export const ADMIN_URL = process.env.PIDECK_TEST_PG_URL ?? "";
export const hasPg = ADMIN_URL !== "";
export const PROD_TZ = "Asia/Taipei";
const FIXTURE = path.resolve(__dirname, "fixtures", "prod-shape.sql");

export function dbUrl(name: string) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

export async function connect(url: string) {
  const c = new pg.Client({ connectionString: url, options: `-c TimeZone=${PROD_TZ}` });
  await c.connect();
  return c;
}

let counter = 0;
/** A fresh, empty scratch database; returns its name. */
export async function scratchDb(prefix = "pideck_t"): Promise<string> {
  const name = `${prefix}_${process.pid}_${Date.now().toString(36)}_${counter++}`;
  const admin = await connect(ADMIN_URL);
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  return name;
}

export async function dropDb(name: string) {
  const admin = await connect(ADMIN_URL);
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/**
 * The prod-shaped database (docs/plans/multi-host-h2.md › "Where we are"):
 * schema from tests/db/fixtures/prod-shape.sql, optionally without
 * idx_users_username (a 2.3/2.4 push install), and prod-like rows: 1 admin,
 * user_sessions rows, ~1,440 history rows over 24 h with UTC wall-clock
 * timestamps in a `timestamp without time zone` column.
 */
export async function loadProdShape(client: pg.Client, { withUsernameIndex = true, historyRows = 1440 } = {}) {
  let ddl = fs.readFileSync(FIXTURE, "utf8");
  if (!withUsernameIndex) ddl = ddl.replace(/^CREATE INDEX idx_users_username .*$/m, "");
  await client.query(ddl);
  await client.query(`INSERT INTO users (username, password_hash, last_password_change, failed_login_attempts)
    VALUES ('admin', '$2b$10$abcdefghijklmnopqrstuuFakeHashForTestsOnly00000000000', '2026-09-01 10:00:00', 0)`);
  await client.query(`INSERT INTO user_sessions (sid, sess, expire) VALUES
    ('sid-one', '{"cookie":{"path":"/"},"authenticated":true,"userId":1}', '2026-10-01 00:00:00'),
    ('sid-two', '{"cookie":{"path":"/"},"authenticated":false}', '2026-10-02 12:34:56.123456')`);
  const end = Date.parse("2026-09-29T00:00:00Z");
  const values: string[] = [];
  for (let i = 0; i < historyRows; i++) {
    const iso = new Date(end - (historyRows - i) * 60_000).toISOString();
    values.push(`('${iso}', ${i % 100}, ${(i * 7) % 100}, ${40 + (i % 20)}, ${i}, ${i * 2}, ${i % 50}, ${i % 30})`);
  }
  for (let i = 0; i < values.length; i += 500) {
    await client.query(`INSERT INTO historical_metrics (timestamp, cpu_usage, memory_usage, temperature, disk_read_speed, disk_write_speed, network_rx, network_tx)
      VALUES ${values.slice(i, i + 500).join(",")}`);
  }
}

/**
 * The public schema as comparable text: columns, constraints (incl. PG 18's
 * NOT NULL entries), indexes, sequences. `exclude` drops tables by name.
 */
export async function catalog(client: pg.Client, exclude: string[] = []): Promise<string[]> {
  const ex = new Set(exclude);
  const out: string[] = [];
  const cols = await client.query(`SELECT table_name, column_name, data_type, udt_name, character_maximum_length, datetime_precision,
      is_nullable, column_default, ordinal_position
    FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`);
  for (const r of cols.rows) if (!ex.has(r.table_name)) out.push(`col ${r.table_name}.${r.column_name} ${r.data_type}/${r.udt_name}(${r.character_maximum_length ?? ""},${r.datetime_precision ?? ""}) null=${r.is_nullable} default=${r.column_default ?? ""}`);
  const cons = await client.query(`SELECT c.conname, t.relname, c.contype, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' ORDER BY t.relname, c.conname`);
  for (const r of cons.rows) if (!ex.has(r.relname)) out.push(`con ${r.relname}.${r.conname} ${r.contype} ${r.def}`);
  const idx = await client.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`);
  for (const r of idx.rows) if (!ex.has(r.tablename)) out.push(`idx ${r.tablename}.${r.indexname} ${r.indexdef}`);
  const seq = await client.query(`SELECT s.sequencename, d.refobjid::regclass::text AS owner
    FROM pg_sequences s LEFT JOIN pg_depend d ON d.objid = (quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename))::regclass AND d.deptype = 'a'
    WHERE s.schemaname = 'public' ORDER BY s.sequencename`);
  for (const r of seq.rows) if (!ex.has(String(r.owner))) out.push(`seq ${r.sequencename} owned-by ${r.owner ?? ""}`);
  return out;
}

/** Everything about user_sessions (catalog + rows), to prove it is byte-identical. */
export async function userSessionsFingerprint(client: pg.Client): Promise<string> {
  const cat = (await catalog(client)).filter((l) => l.includes("user_sessions"));
  const rows = await client.query(`SELECT sid, sess::text AS sess, expire::text AS expire FROM user_sessions ORDER BY sid`);
  return JSON.stringify({ cat, rows: rows.rows });
}

/** Row data of the app tables (to prove a baseline mark changes nothing). */
export async function dataFingerprint(client: pg.Client): Promise<string> {
  const u = await client.query(`SELECT * FROM users ORDER BY id`);
  const h = await client.query(`SELECT count(*)::int AS n, md5(string_agg(t::text, '|' ORDER BY id)) AS sum FROM historical_metrics t`);
  return JSON.stringify({ users: u.rows, history: h.rows[0] });
}

/** A migrations dir with only the first `n` entries of the real one (plus optional extra files). */
export function migrationsSubset(n: number, extra: { tag: string; sql: string }[] = []): string {
  const src = path.resolve(__dirname, "..", "..", "migrations");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-mig-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync(path.join(src, "meta", "_journal.json"), "utf8"));
  const entries = journal.entries.slice(0, n);
  for (const e of entries) fs.copyFileSync(path.join(src, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  let when = entries.length ? entries[entries.length - 1].when : 1;
  for (const x of extra) {
    when += 1000;
    entries.push({ idx: entries.length, version: "7", when, tag: x.tag, breakpoints: true });
    fs.writeFileSync(path.join(dir, `${x.tag}.sql`), x.sql);
  }
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }, null, 2));
  return dir;
}

export const quiet = { info: () => {}, warn: () => {}, error: () => {} };
