import crypto from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { cspDirectives, inlineScriptHashes } from "../../server/security";

const sha = (s: string) => `'sha256-${crypto.createHash("sha256").update(s, "utf8").digest("base64")}'`;

describe("inlineScriptHashes", () => {
  it("hashes inline scripts and skips src scripts", () => {
    const html = `<script>a()</script><script type="module" src="/x.js"></script><script defer>b()</script>`;
    expect(inlineScriptHashes(html)).toEqual([sha("a()"), sha("b()")]);
  });

  it("finds exactly the one no-flash script in client/index.html", () => {
    const html = fs.readFileSync(path.resolve(__dirname, "../../client/index.html"), "utf8");
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(1);
    const body = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    expect(hashes[0]).toBe(sha(body));
  });
});

describe("cspDirectives", () => {
  it("allows only self + the given hashes for scripts, no unsafe-inline", () => {
    const d = cspDirectives(["'sha256-abc'"]);
    expect(d["script-src"]).toEqual(["'self'", "'sha256-abc'"]);
    expect(d["script-src"].join(" ")).not.toContain("unsafe");
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["report-uri"]).toEqual(["/csp-report"]);
  });
});
