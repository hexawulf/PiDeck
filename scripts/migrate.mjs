#!/usr/bin/env node
// Author:      0xWulf (zk@hexawulf.dev)
// Description: npm run db:migrate — apply pending PiDeck schema migrations
//              (see scripts/migrate-core.mjs). Reads DATABASE_URL from the
//              environment or the checkout's .env; never prints it.
// Modified:    2026-09-29
// Usage:       node scripts/migrate.mjs            # apply pending migrations
//              node scripts/migrate.mjs --status   # read-only; exit 3 if any are pending
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { migrate, migrationStatus } from "./migrate-core.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
require("dotenv").config({ path: path.join(root, ".env") });

const redact = (s) => String(s).replace(/postgres(ql)?:\/\/[^@\s]*@/g, "postgres://***@");
const fail = (msg, code = 1) => {
  console.error(`[migrate] ${redact(msg)}`);
  process.exit(code);
};

const statusOnly = process.argv.includes("--status");
if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set (environment or .env)", 2);

const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
try {
  await client.connect();
} catch (e) {
  fail(`cannot connect to the database: ${e.message}`, 2);
}
try {
  if (statusOnly) {
    const s = await migrationStatus(client);
    const note = s.baseline === "needed" ? " (baseline mark first: pre-2.5 database)" : s.baseline === "partial" ? " (PARTIAL schema: needs a person)" : "";
    const work = s.pending.length > 0 || s.baseline !== "none";
    console.log(work ? `pending: ${s.pending.join(" ") || "(none)"}${note}` : "up to date");
    await client.end();
    process.exit(work ? 3 : 0);
  }
  const r = await migrate(client);
  console.log(r.applied.length ? `[migrate] done: ${r.applied.length} applied${r.baselined ? " (after baseline mark)" : ""}` : `[migrate] up to date${r.baselined ? " (baseline marked)" : ""}`);
  await client.end();
} catch (e) {
  await client.end().catch(() => {});
  fail(e instanceof Error ? e.message : String(e));
}
