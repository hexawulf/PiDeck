#!/usr/bin/env node
// Author:      0xWulf (zk@hexawulf.dev)
// Description: Node side of scripts/install.sh — things bash can't do safely:
//              talk to Postgres and bcrypt the admin password. Secrets come
//              from the environment (DATABASE_URL) or a 0600 file, never from
//              argv, and are never printed.
// Modified:    2026-09-28
// Usage:       DATABASE_URL=… node scripts/install-helper.mjs <command> [args]
//   db-check                     → "ok" | exits 2 with a one-line reason
//   tables                       → missing PiDeck tables, space-separated ("" = all present)
//   admin-state <pwfile>         → missing | default | matches | custom
//   set-admin <pwfile> [--force] → set | unchanged-custom   (without --force only
//                                   replaces a missing admin or the seeded "admin")
//   strength <pwfile>            → ok | the first failed rule (same rules as the UI)
//   login-body <pwfile> <out>    → writes {"password":…} to <out> with mode 0600
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DEFAULT_ADMIN_PASSWORD = "admin"; // what server/storage.ts seeds
const TABLES = ["users", "historical_metrics"];

const readSecret = (file) => {
  if (!file) fail("missing password file argument");
  const st = fs.statSync(file);
  if (st.mode & 0o077) fail(`${file} must not be readable by group/others (chmod 600)`);
  const value = fs.readFileSync(file, "utf8").replace(/\r?\n$/, "");
  if (!value) fail(`${file} is empty`);
  return value;
};

function fail(msg, code = 2) {
  process.stderr.write(`install-helper: ${msg}\n`);
  process.exit(code);
}

async function withDb(fn) {
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");
  const { Client } = require("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
  } catch (e) {
    fail(`cannot connect to the database: ${String(e.message).replace(/postgres(ql)?:\/\/[^@\s]*@/g, "postgres://***@")}`);
  }
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export function strengthProblem(pw) {
  // Mirrors AuthService.validatePasswordStrength so the UI accepts it later.
  if (pw.length < 8) return "at least 8 characters";
  if (!/[a-z]/.test(pw)) return "a lowercase letter";
  if (!/[A-Z]/.test(pw)) return "an uppercase letter";
  if (!/[0-9]/.test(pw)) return "a number";
  if (!/[^a-zA-Z0-9]/.test(pw)) return "a special character";
  return null;
}

async function adminState(client, pw) {
  const bcrypt = require("bcrypt");
  const { rows } = await client.query("SELECT password_hash FROM users WHERE username = 'admin'");
  if (!rows.length) return "missing";
  if (await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, rows[0].password_hash)) return "default";
  if (pw && (await bcrypt.compare(pw, rows[0].password_hash))) return "matches";
  return "custom";
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "db-check":
    await withDb(async (c) => c.query("SELECT 1"));
    console.log("ok");
    break;
  case "tables": {
    const missing = await withDb(async (c) => {
      const { rows } = await c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
      const have = new Set(rows.map((r) => r.tablename));
      return TABLES.filter((t) => !have.has(t));
    });
    console.log(missing.join(" "));
    break;
  }
  case "admin-state": {
    const pw = fs.existsSync(args[0] ?? "") ? readSecret(args[0]) : "";
    console.log(await withDb((c) => adminState(c, pw)));
    break;
  }
  case "set-admin": {
    const pw = readSecret(args[0]);
    const force = args.includes("--force");
    const problem = strengthProblem(pw);
    if (problem) fail(`password needs ${problem}`);
    const result = await withDb(async (c) => {
      const state = await adminState(c, pw);
      if (state === "matches") return "unchanged";
      if (state === "custom" && !force) return "unchanged-custom";
      const hash = await require("bcrypt").hash(pw, 10);
      await c.query(
        `INSERT INTO users (username, password_hash, last_password_change, failed_login_attempts, account_locked_until)
         VALUES ('admin', $1, now(), 0, NULL)
         ON CONFLICT (username) DO UPDATE
           SET password_hash = EXCLUDED.password_hash, last_password_change = now(),
               failed_login_attempts = 0, account_locked_until = NULL`,
        [hash],
      );
      return "set";
    });
    console.log(result);
    break;
  }
  case "strength": {
    console.log(strengthProblem(readSecret(args[0])) ?? "ok");
    break;
  }
  case "login-body": {
    const [pwFile, out] = args;
    if (!out) fail("usage: login-body <pwfile> <out>");
    fs.writeFileSync(out, JSON.stringify({ password: readSecret(pwFile) }), { mode: 0o600 });
    fs.chmodSync(out, 0o600);
    break;
  }
  default:
    fail(`unknown command "${cmd ?? ""}"`, 64);
}
