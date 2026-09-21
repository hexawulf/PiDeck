// Bootstrap / no-DB admin password from APP_PASSWORD or APP_PASSWORD_FILE.
// Checked BEFORE the DB so a correct env/file password never counts as a
// failed attempt against the DB admin's lockout counter.
import crypto from "crypto";
import fs from "fs";

export function expectedEnvPassword(env: NodeJS.ProcessEnv = process.env): string {
  const direct = (env.APP_PASSWORD || "").trim();
  if (direct) return direct;
  if (!env.APP_PASSWORD_FILE) return "";
  try {
    return fs.readFileSync(env.APP_PASSWORD_FILE, "utf8").trim();
  } catch {
    return ""; // unreadable file = no env password configured
  }
}

export function envPasswordMatches(supplied: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = expectedEnvPassword(env);
  if (!expected) return false;
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const a = crypto.createHash("sha256").update((supplied || "").trim()).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
