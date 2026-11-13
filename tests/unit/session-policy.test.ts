// PD-18: absolute session lifetime and the Google allowlist re-check.
import { describe, expect, it } from "vitest";
import { checkSession, DEFAULT_MAX_DAYS, sessionMaxMs } from "../../server/session-policy";

const DAY = 24 * 60 * 60 * 1000;
const env = { FIREBASE_ENABLED: "true", FIREBASE_ALLOWED_EMAILS: "Op@Example.com, other@example.com" } as NodeJS.ProcessEnv;

describe("checkSession", () => {
  it("leaves anonymous sessions alone", () => {
    expect(checkSession(undefined, 0, env)).toEqual({ ok: true });
    expect(checkSession({}, 0, env)).toEqual({ ok: true });
  });

  it("ends a session after the absolute lifetime, however busy it was", () => {
    const s = { authenticated: true, createdAt: 0 };
    expect(checkSession(s, DEFAULT_MAX_DAYS * DAY, env)).toEqual({ ok: true });
    expect(checkSession(s, DEFAULT_MAX_DAYS * DAY + 1, env)).toEqual({ ok: false, reason: "expired" });
  });

  it("stamps sessions from before the rule instead of ending them", () => {
    const s: { authenticated: boolean; createdAt?: number } = { authenticated: true };
    expect(checkSession(s, 5 * DAY, env)).toEqual({ ok: true });
    expect(s.createdAt).toBe(5 * DAY);
  });

  it("PIDECK_SESSION_MAX_DAYS sets the lifetime; nonsense falls back to the default", () => {
    expect(sessionMaxMs({ PIDECK_SESSION_MAX_DAYS: "7" } as NodeJS.ProcessEnv)).toBe(7 * DAY);
    for (const v of ["", "0", "-1", "abc"]) expect(sessionMaxMs({ PIDECK_SESSION_MAX_DAYS: v } as NodeJS.ProcessEnv)).toBe(DEFAULT_MAX_DAYS * DAY);
  });

  it("a Google session needs its email still on the allowlist (case-insensitive)", () => {
    const g = (email: string) => ({ authenticated: true, createdAt: 0, authMethod: "google-firebase", email });
    expect(checkSession(g("op@example.com"), 1, env)).toEqual({ ok: true });
    expect(checkSession(g("gone@example.com"), 1, env)).toEqual({ ok: false, reason: "not-allowed" });
    expect(checkSession(g(""), 1, env)).toEqual({ ok: false, reason: "not-allowed" });
    expect(checkSession(g("op@example.com"), 1, { ...env, FIREBASE_ENABLED: "false" })).toEqual({ ok: false, reason: "not-allowed" });
  });

  it("password sessions don't depend on the allowlist", () => {
    expect(checkSession({ authenticated: true, createdAt: 0, authMethod: "password" }, 1, {} as NodeJS.ProcessEnv)).toEqual({ ok: true });
  });
});
