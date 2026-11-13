// Password sign-in lockout per client address (PD-17). It used to be one
// counter on the admin row: five wrong passwords from anyone locked the
// password login for everybody for 15 minutes. Now each address has its own
// count, kept in memory (a restart forgets it; rateLimitLogin still caps
// every address at 10 attempts per 10 minutes on top of this).
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;
const FORGET_MS = 60 * 60 * 1000; // a failure streak older than this starts over

type Entry = { failures: number; lockedUntil: number; last: number };

export function createLoginLockout(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();

  function prune(t: number) {
    for (const [k, e] of entries) if (e.lockedUntil <= t && t - e.last > FORGET_MS) entries.delete(k);
  }

  return {
    /** ms left on this address's lock, or 0. */
    lockedFor(key: string): number {
      const e = entries.get(key);
      return e ? Math.max(0, e.lockedUntil - now()) : 0;
    },
    /** A wrong password from `key`. Returns true when this one locked it. */
    failure(key: string): boolean {
      const t = now();
      prune(t);
      const e = entries.get(key);
      const cur = e && t - e.last <= FORGET_MS && e.lockedUntil <= t ? e : { failures: 0, lockedUntil: 0, last: t };
      cur.failures += 1;
      cur.last = t;
      let locked = false;
      if (cur.failures >= MAX_FAILURES) {
        cur.lockedUntil = t + LOCK_MS;
        cur.failures = 0;
        locked = true;
      }
      entries.set(key, cur);
      return locked;
    },
    /** A successful sign-in from `key` clears its count. */
    success(key: string): void {
      entries.delete(key);
    },
    size: () => entries.size,
  };
}

export const loginLockout = createLoginLockout();

/** One log line per sign-in attempt. Never the password; control characters stripped. */
export function authLogLine(f: { method: "password" | "google"; result: string; ip: string; email?: string; detail?: string }): string {
  const clean = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120);
  const parts = [`[auth] sign-in method=${f.method} result=${clean(f.result)} ip=${clean(f.ip)}`];
  if (f.email) parts.push(`email=${clean(f.email)}`);
  if (f.detail) parts.push(`detail="${clean(f.detail).replace(/"/g, "'")}"`);
  return parts.join(" ");
}
