import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { agentAuth, createFailureLimiter, sha256Hex } from "../../server/middleware/agentAuth";
import { createRateLimitLogin } from "../../server/middleware/rateLimitLogin";
import { createSystemUpdateHandler } from "../../server/routes/system-update";

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    headers,
  };
}

describe("security audit logging (LOGGING-003)", () => {
  it("logs throttled audit lines on agent 401 and 429 responses", () => {
    const t = 1_000_000;
    const logs: string[] = [];
    const expected = sha256Hex("valid-secret-token-12345");
    const limiter = createFailureLimiter({ max: 2, windowMs: 60_000, now: () => t });
    const mw = agentAuth(expected, limiter, {
      warn: (m) => logs.push(m),
      logThrottleMs: 60_000,
      now: () => t,
    });

    const req = {
      ip: "198.51.100.5",
      path: "/api/agent/info",
      headers: { authorization: "Bearer wrong-token-123456" },
      socket: { remoteAddress: "198.51.100.5" },
    } as unknown as Request;

    // 1st failure -> 401 logged
    const r1 = makeRes();
    mw(req, r1 as unknown as Response, () => {});
    expect(r1.statusCode).toBe(401);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("[audit] agent-auth result=401 ip=198.51.100.5");

    // 2nd failure -> 401 throttled within window
    const r2 = makeRes();
    mw(req, r2 as unknown as Response, () => {});
    expect(r2.statusCode).toBe(401);
    expect(logs).toHaveLength(1);

    // 3rd failure -> transitions to 429 and logs 429 audit line
    const r3 = makeRes();
    mw(req, r3 as unknown as Response, () => {});
    expect(r3.statusCode).toBe(429);
    expect(logs).toHaveLength(2);
    expect(logs[1]).toContain("[audit] agent-auth result=429 ip=198.51.100.5");
  });

  it("logs an audit line when hub login rate limiter returns 429", () => {
    const logs: string[] = [];
    const mw = createRateLimitLogin({
      maxAttempts: 1,
      windowMs: 60_000,
      warn: (m) => logs.push(m),
    });

    const req = {
      ip: "198.51.100.8",
      path: "/api/auth/login",
      originalUrl: "/api/auth/login",
      headers: {},
    } as unknown as Request;

    let nextCalled = false;
    mw(req, makeRes() as unknown as Response, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(logs).toHaveLength(0);

    const blockedRes = makeRes();
    mw(req, blockedRes as unknown as Response, () => {});
    expect(blockedRes.statusCode).toBe(429);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("[audit] rate-limit result=429 ip=198.51.100.8 path=/api/auth/login");
  });

  it("logs an audit line with actor/IP when system update is started", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const handler = createSystemUpdateHandler({
      runner: {
        start: () => ({ state: "running", startedAt: "2026-11-26T00:00:00Z", log: "update.log" }),
        status: () => ({ state: "idle" }),
      },
      env: {},
      dsm: () => false,
    });
    const req = {
      ip: "198.51.100.12",
      headers: {},
      session: { userId: 1 },
    } as unknown as Request;
    const res = makeRes();
    handler(req, res as unknown as Response);
    expect(res.statusCode).toBe(202);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[audit] system-update action=start result=ok user=1 ip=198.51.100.12"));
    logSpy.mockRestore();
  });
});
