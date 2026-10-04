import { describe, expect, it } from "vitest";
import { cspDirectives } from "../../server/security";

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
});
