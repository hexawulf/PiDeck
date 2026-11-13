// When a signed-in session stops counting (PD-18). The cookie is rolling
// (24 h idle), so a tab that polls kept one session alive forever, and a
// Google session outlived its address's removal from the allowlist.
//
//   - absolute lifetime: PIDECK_SESSION_MAX_DAYS (default 30) after sign-in
//   - Google sessions: the email must still be in FIREBASE_ALLOWED_EMAILS
//     and Google sign-in still enabled
//
// Sessions from before this rule have no start time: they get one on first
// use, so the upgrade signs nobody out.
import { getFirebaseAllowedEmails, isFirebaseEnabled } from "./services/firebase-auth";

export const DEFAULT_MAX_DAYS = 30;

export function sessionMaxMs(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number(env.PIDECK_SESSION_MAX_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : DEFAULT_MAX_DAYS) * 24 * 60 * 60 * 1000;
}

export type SessionLike = {
  authenticated?: boolean;
  createdAt?: number;
  authMethod?: string;
  email?: string;
};

export type Verdict = { ok: true } | { ok: false; reason: "expired" | "not-allowed" };

/** Check (and, for old sessions, stamp) a signed-in session. Not signed in → ok (nothing to end). */
export function checkSession(s: SessionLike | undefined, now = Date.now(), env: NodeJS.ProcessEnv = process.env): Verdict {
  if (!s?.authenticated) return { ok: true };
  if (typeof s.createdAt !== "number") s.createdAt = now; // grandfathered
  if (now - s.createdAt > sessionMaxMs(env)) return { ok: false, reason: "expired" };
  if (s.authMethod === "google-firebase") {
    const email = (s.email || "").trim().toLowerCase();
    if (!isFirebaseEnabled(env) || !email || !getFirebaseAllowedEmails(env).includes(email)) {
      return { ok: false, reason: "not-allowed" };
    }
  }
  return { ok: true };
}
