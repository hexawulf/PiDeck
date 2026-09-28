// Test double for scripts/install-helper.mjs: same commands and outputs, but
// the "database" is a few files in $PIDECK_TEST_STATE instead of Postgres.
//   tables       → present once the (stubbed) drizzle push has run
//   admin        → "default" after the schema push, then sha256 of the password
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const state = process.env.PIDECK_TEST_STATE;
const f = (name) => path.join(state, name);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const readSecret = (file) => {
  if (fs.statSync(file).mode & 0o077) fail(`${file} must be 0600`);
  return fs.readFileSync(file, "utf8").replace(/\r?\n$/, "");
};
function fail(msg) {
  process.stderr.write(`fake-helper: ${msg}\n`);
  process.exit(2);
}
function strengthProblem(pw) {
  if (pw.length < 8) return "at least 8 characters";
  if (!/[a-z]/.test(pw)) return "a lowercase letter";
  if (!/[A-Z]/.test(pw)) return "an uppercase letter";
  if (!/[0-9]/.test(pw)) return "a number";
  if (!/[^a-zA-Z0-9]/.test(pw)) return "a special character";
  return null;
}
function adminState(pw) {
  if (!fs.existsSync(f("admin"))) return "missing";
  const h = fs.readFileSync(f("admin"), "utf8").trim();
  if (h === "default") return "default";
  return pw && h === sha(pw) ? "matches" : "custom";
}

const [cmd, ...args] = process.argv.slice(2);
if (!["strength", "login-body"].includes(cmd) && !process.env.DATABASE_URL) fail("DATABASE_URL is not set");
switch (cmd) {
  case "db-check":
    console.log("ok");
    break;
  case "tables":
    console.log(fs.existsSync(f("tables")) ? "" : "users historical_metrics");
    break;
  case "admin-state":
    console.log(adminState(fs.existsSync(args[0] ?? "") ? readSecret(args[0]) : ""));
    break;
  case "set-admin": {
    const pw = readSecret(args[0]);
    const st = adminState(pw);
    if (st === "matches") console.log("unchanged");
    else if (st === "custom" && !args.includes("--force")) console.log("unchanged-custom");
    else {
      fs.writeFileSync(f("admin"), sha(pw));
      console.log("set");
    }
    break;
  }
  case "strength":
    console.log(strengthProblem(readSecret(args[0])) ?? "ok");
    break;
  case "login-body":
    fs.writeFileSync(args[1], JSON.stringify({ password: readSecret(args[0]) }), { mode: 0o600 });
    break;
  default:
    fail(`unknown command ${cmd}`);
}
