// PD-12 (security headers), PD-13 (asset caching), PD-14 (JSON 404 for /api).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { installSecurityHeaders, securityHeaderOptions } from "../../server/security";
import { serveStatic, staticCacheControl } from "../../server/vite";

describe("securityHeaderOptions", () => {
  it("sends HSTS only over HTTPS, without includeSubDomains", () => {
    expect(securityHeaderOptions({ https: false }).hsts).toBe(false);
    expect(securityHeaderOptions({ https: true }).hsts).toEqual({ maxAge: 15552000, includeSubDomains: false });
  });
  it("keeps the Google sign-in popup working", () => {
    expect(securityHeaderOptions({ https: true }).crossOriginOpenerPolicy).toEqual({ policy: "same-origin-allow-popups" });
  });
});

describe("staticCacheControl", () => {
  it("makes HTML revalidate and leaves the rest to maxAge", () => {
    expect(staticCacheControl("/x/public/index.html")).toBe("no-cache");
    expect(staticCacheControl("/x/public/favicon.svg")).toBeNull();
  });
});

describe("hub static wiring", () => {
  let server: Server;
  let base: string;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-static-"));
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>PiDeck</title>");
    fs.writeFileSync(path.join(dir, "assets", "index-abc123.js"), "console.log(1)");
    fs.writeFileSync(path.join(dir, "favicon.svg"), "<svg/>");

    const app = express();
    installSecurityHeaders(app, { https: true });
    serveStatic(app, dir);
    app.get("/api/known", (_req, res) => res.json({ ok: true }));
    app.use("/api", (_req, res) => res.status(404).json({ message: "Not found" }));
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(dir, "index.html"));
    });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("sends the helmet headers", async () => {
    const r = await fetch(`${base}/`);
    expect(r.headers.get("strict-transport-security")).toBe("max-age=15552000");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(r.headers.get("cross-origin-opener-policy")).toBe("same-origin-allow-popups");
  });

  it("caches hashed assets for a year, immutable", async () => {
    const r = await fetch(`${base}/assets/index-abc123.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("answers a missing asset with 404, not the page", async () => {
    const r = await fetch(`${base}/assets/gone-000.js`);
    expect(r.status).toBe(404);
  });

  it("serves index.html with no-cache, directly and as SPA fallback", async () => {
    for (const p of ["/", "/index.html", "/logs"]) {
      const r = await fetch(`${base}${p}`);
      expect(r.status, p).toBe(200);
      expect(r.headers.get("cache-control"), p).toBe("no-cache");
      expect(await r.text(), p).toContain("<title>PiDeck</title>");
    }
  });

  it("gives other static files one hour", async () => {
    const r = await fetch(`${base}/favicon.svg`);
    expect(r.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("answers an unknown /api path with JSON 404", async () => {
    const r = await fetch(`${base}/api/does-not-exist`);
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await r.json()).toEqual({ message: "Not found" });
    expect((await fetch(`${base}/api/known`)).status).toBe(200);
  });
});
