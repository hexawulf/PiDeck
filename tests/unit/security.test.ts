import { describe, expect, it } from "vitest";
import { cspDirectives, resolveFirebaseAuthOrigin } from "../../server/security";

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
});
