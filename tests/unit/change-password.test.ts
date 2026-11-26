import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { createChangePasswordHandler } from "../../server/routes";
import { createLoginLockout, MAX_FAILURES } from "../../server/services/login-lockout";
import { rateLimitLogin } from "../../server/middleware/rateLimitLogin";

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
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
  return res;
}

describe("POST /api/auth/change-password hardening (AUTHN-002)", () => {
  it("locks out after repeated incorrect currentPassword attempts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lockout = createLoginLockout(() => 1_000_000);
    const handler = createChangePasswordHandler({
      lockout,
      validatePassword: async () => ({ isValid: false, error: "invalid_password" }),
    });

    for (let i = 0; i < MAX_FAILURES; i++) {
      const res = makeRes();
      const req = {
        ip: "198.51.100.10",
        headers: {},
        body: { currentPassword: "wrong", newPassword: "NewStrongPassword123!", confirmNewPassword: "NewStrongPassword123!" },
      } as unknown as Request;
      await handler(req, res as unknown as Response);
      expect(res.statusCode).toBe(401);
    }

    const lockedRes = makeRes();
    const lockedReq = {
      ip: "198.51.100.10",
      headers: {},
      body: { currentPassword: "wrong", newPassword: "NewStrongPassword123!", confirmNewPassword: "NewStrongPassword123!" },
    } as unknown as Request;
    await handler(lockedReq, lockedRes as unknown as Response);
    expect(lockedRes.statusCode).toBe(403);
    warn.mockRestore();
  });

  it("regenerates session ID before deleting other sessions on password change", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const lockout = createLoginLockout(() => 1_000_000);
    const deletedKeeping: string[] = [];
    let regenerated = false;
    let saved = false;

    const handler = createChangePasswordHandler({
      lockout,
      validatePassword: async () => ({
        isValid: true,
        user: {
          id: 1,
          username: "admin",
          password_hash: "oldhash",
          last_password_change: new Date(),
          failed_login_attempts: 0,
          account_locked_until: null,
        },
      }),
      validatePasswordStrength: () => ({ isValid: true }),
      hashPassword: async () => "newhash",
      updateUser: async () => undefined,
      markPasswordChanged: () => undefined,
      deleteOtherSessions: async (keepSid) => {
        deletedKeeping.push(keepSid);
        return { rowCount: 2 };
      },
    });

    const req = {
      ip: "198.51.100.11",
      headers: {},
      sessionID: "old-sid",
      body: {
        currentPassword: "old-password",
        newPassword: "NewStrongPassword123!",
        confirmNewPassword: "NewStrongPassword123!",
      },
      session: {
        authenticated: true,
        userId: 1,
        authMethod: "password",
        regenerate(cb: (err?: Error) => void) {
          regenerated = true;
          req.sessionID = "new-sid";
          cb();
        },
        save(cb: (err?: Error) => void) {
          saved = true;
          cb();
        },
      },
    } as unknown as Request;

    const res = makeRes();
    await handler(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(regenerated).toBe(true);
    expect(saved).toBe(true);
    expect(deletedKeeping).toEqual(["new-sid"]);
    log.mockRestore();
  });

  it("rateLimitLogin throttles rapid attempts from the same IP", () => {
    const ip = "198.51.100.99";
    for (let i = 0; i < 10; i++) {
      let called = false;
      const res = makeRes();
      rateLimitLogin({ ip, headers: {} } as unknown as Request, res as unknown as Response, () => {
        called = true;
      });
      expect(called).toBe(true);
    }
    let blockedNext = false;
    const res = makeRes();
    rateLimitLogin({ ip, headers: {} } as unknown as Request, res as unknown as Response, () => {
      blockedNext = true;
    });
    expect(blockedNext).toBe(false);
    expect(res.statusCode).toBe(429);
  });
});
