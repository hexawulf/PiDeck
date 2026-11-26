import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import {
  createCspReportHandler,
  cspDirectives,
  isCspReportOnly,
  resolveFirebaseAuthOrigin,
  securityHeaderOptions,
} from "../../server/security";
import { sanitizeLogValue } from "../../server/services/log-sanitize";
import { authLogLine } from "../../server/services/login-lockout";

describe("cspDirectives", () => {
  it("builds a baseline CSP with script hashes", () => {
    const d = cspDirectives(["'sha256-abc'"], { firebase: false });
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["script-src"]).toContain("'sha256-abc'");
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["report-uri"]).toEqual(["/csp-report"]);
    expect(d["connect-src"]).not.toContain("https://identitytoolkit.googleapis.com");
  });

  it("includes Firebase domains when firebase option is true", () => {
    const d = cspDirectives(["'sha256-abc'"], { firebase: true });
    expect(d["script-src"]).toContain("https://apis.google.com");
    expect(d["connect-src"]).toContain("https://apis.google.com");
    expect(d["connect-src"]).toContain("https://identitytoolkit.googleapis.com");
    expect(d["frame-src"]).toContain("https://accounts.google.com");
    expect(d["img-src"]).toContain("https://*.googleusercontent.com");
  });

  it("scopes Firebase CSP to configured auth domain without wildcards (WEB-001)", () => {
    const d = cspDirectives(["'sha256-abc'"], {
      firebase: true,
      env: { FIREBASE_CLIENT_AUTH_DOMAIN: "my-pideck.firebaseapp.com" },
    });
    expect(d["script-src"]).not.toContain("https://*.firebaseapp.com");
    expect(d["script-src"]).not.toContain("https://my-pideck.firebaseapp.com");
    expect(d["connect-src"]).not.toContain("https://*.firebaseapp.com");
    expect(d["connect-src"]).not.toContain("https://*.firebaseio.com");
    expect(d["frame-src"]).not.toContain("https://*.firebaseapp.com");
    expect(d["connect-src"]).toContain("https://my-pideck.firebaseapp.com");
    expect(d["frame-src"]).toContain("https://my-pideck.firebaseapp.com");

    expect(resolveFirebaseAuthOrigin({ FIREBASE_PROJECT_ID: "proj-123" })).toBe("https://proj-123.firebaseapp.com");
    expect(resolveFirebaseAuthOrigin({ FIREBASE_CLIENT_AUTH_DOMAIN: "*.firebaseapp.com" })).toBeNull();
    expect(resolveFirebaseAuthOrigin({ FIREBASE_CLIENT_AUTH_DOMAIN: "evil.example/foo" })).toBeNull();
  });

  it("defaults CSP to enforcing mode and X-Frame-Options to DENY (WEB-002)", () => {
    expect(isCspReportOnly({})).toBe(false);
    expect(isCspReportOnly({ CSP_ENFORCE: "true" })).toBe(false);
    expect(isCspReportOnly({ CSP_ENFORCE: "false" })).toBe(true);
    expect(isCspReportOnly({ CSP_ENFORCE: "0" })).toBe(true);
    expect(isCspReportOnly({ CSP_REPORT_ONLY: "true" })).toBe(true);
    expect(securityHeaderOptions({ https: true }).xFrameOptions).toEqual({ action: "deny" });
  });
});

describe("createCspReportHandler (API-002)", () => {
  const makeReq = (ip: string) =>
    ({
      ip,
      headers: {},
      body: { "csp-report": { "violated-directive": "script-src", "blocked-uri": "https://evil.example", "document-uri": "/" } },
    }) as unknown as Request;

  const makeRes = () => {
    const res = { status: 0, sendStatus(code: number) { this.status = code; return this; } };
    return res;
  };

  it("throttles per-IP and global report floods while returning 204 silently", () => {
    let t = 1_000_000;
    const logs: string[] = [];
    const handler = createCspReportHandler({
      perIpLimit: 2,
      globalLimit: 3,
      windowMs: 60_000,
      maxEntries: 2,
      now: () => t,
      warn: (m) => logs.push(m),
    });

    for (let i = 0; i < 4; i++) {
      const res = makeRes();
      handler(makeReq("198.51.100.1"), res as unknown as Response);
      expect(res.status).toBe(204);
    }
    expect(logs).toHaveLength(2); // capped at perIpLimit=2

    // Different IP hits globalLimit=3 on its first call (global count was already 4 > 3)
    const res2 = makeRes();
    handler(makeReq("198.51.100.2"), res2 as unknown as Response);
    expect(res2.status).toBe(204);
    expect(logs).toHaveLength(2);

    // Bounded IP map size
    handler(makeReq("198.51.100.3"), makeRes() as unknown as Response);
    expect(handler.trackedIps()).toBe(2);

    // After window expires, logging resumes
    t += 61_000;
    handler(makeReq("198.51.100.1"), makeRes() as unknown as Response);
    expect(logs).toHaveLength(3);
  });

  it("strips ANSI escape sequences and C0/C1/line-separator control characters (LOGGING-001)", () => {
    const logs: string[] = [];
    const handler = createCspReportHandler({ warn: (m) => logs.push(m) });
    const req = {
      ip: "198.51.100.9",
      headers: {},
      body: {
        "csp-report": {
          "violated-directive": "script-src\u001b[31mRED\u001b[0m",
          "blocked-uri": "https://evil.example/\u009b2J\u2028fake\u2029line\r\n",
          "document-uri": "/\u0000\u0007\u007fok",
        },
      },
    } as unknown as Request;
    handler(req, makeRes() as unknown as Response);
    expect(logs).toHaveLength(1);
    const hasControl = (s: string) =>
      Array.from(s).some((ch) => {
        const c = ch.charCodeAt(0);
        return c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
      });
    expect(hasControl(logs[0])).toBe(false);
    expect(logs[0]).not.toContain("[31m");
    expect(logs[0]).toContain("directive=script-srcRED");

    expect(sanitizeLogValue("\u001b]0;title\u0007safe\u0085next", 50)).toBe("safe next");
    const authLine = authLogLine({
      method: "google",
      result: "rejected",
      ip: "198.51.100.1\u001b[31m\u0085",
      email: "user@example.com\u2028injected",
    });
    expect(hasControl(authLine)).toBe(false);
    expect(authLine).not.toContain("[31m");
  });
});
