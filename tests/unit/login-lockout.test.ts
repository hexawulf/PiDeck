// PD-17: password lockout per client address, and one log line per sign-in.
import { describe, expect, it } from "vitest";
import { authLogLine, createLoginLockout, LOCK_MS, MAX_FAILURES } from "../../server/services/login-lockout";

describe("createLoginLockout", () => {
  it("locks only the address that failed, for LOCK_MS", () => {
    let t = 1_000_000;
    const l = createLoginLockout(() => t);
    for (let i = 1; i < MAX_FAILURES; i++) expect(l.failure("1.1.1.1")).toBe(false);
    expect(l.lockedFor("1.1.1.1")).toBe(0);
    expect(l.failure("1.1.1.1")).toBe(true);
    expect(l.lockedFor("1.1.1.1")).toBe(LOCK_MS);
    expect(l.lockedFor("2.2.2.2")).toBe(0); // the operator elsewhere is not locked out
    t += LOCK_MS;
    expect(l.lockedFor("1.1.1.1")).toBe(0);
    expect(l.failure("1.1.1.1")).toBe(false); // a fresh count after the lock
  });

  it("a success clears the address's count", () => {
    const l = createLoginLockout(() => 0);
    for (let i = 1; i < MAX_FAILURES; i++) l.failure("a");
    l.success("a");
    expect(l.failure("a")).toBe(false);
  });

  it("a failure streak older than an hour starts over, and old entries are pruned", () => {
    let t = 0;
    const l = createLoginLockout(() => t);
    for (let i = 1; i < MAX_FAILURES; i++) l.failure("a");
    t += 61 * 60 * 1000;
    expect(l.failure("a")).toBe(false);
    l.failure("b");
    t += 61 * 60 * 1000;
    l.failure("c");
    expect(l.size()).toBe(1);
  });
});

describe("authLogLine", () => {
  it("names method, result, address and (for Google) the email", () => {
    expect(authLogLine({ method: "password", result: "ok", ip: "10.0.0.1" })).toBe("[auth] sign-in method=password result=ok ip=10.0.0.1");
    expect(authLogLine({ method: "google", result: "ok", ip: "10.0.0.1", email: "a@b.c" })).toBe("[auth] sign-in method=google result=ok ip=10.0.0.1 email=a@b.c");
  });
  it("can't be used to forge log lines", () => {
    const line = authLogLine({ method: "google", result: "rejected", ip: "x", detail: 'bad\n[auth] sign-in result=ok "x"' });
    expect(line).not.toContain("\n");
    expect(line).toBe(`[auth] sign-in method=google result=rejected ip=x detail="bad [auth] sign-in result=ok 'x'"`);
  });
});
