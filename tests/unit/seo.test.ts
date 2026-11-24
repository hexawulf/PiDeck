// Search Console: /robots.txt and /sitemap.xml must be real files, not the SPA
// shell. Vite copies client/public into dist/public; express.static serves them
// before the index.html fallback in server/hub.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { serveStatic } from "../../server/vite";

const root = path.resolve(__dirname, "../..");
const robots = fs.readFileSync(path.join(root, "client/public/robots.txt"), "utf8");
const sitemap = fs.readFileSync(path.join(root, "client/public/sitemap.xml"), "utf8");
const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");

const DESCRIPTION =
  "Self-hosted admin dashboard for Raspberry Pi and small Linux servers: live metrics, logs, Docker and pm2, cron, and your homelab in one place.";

describe("crawl files", () => {
  it("allows crawling and names the sitemap", () => {
    expect(robots).toBe("User-agent: *\nAllow: /\n\nSitemap: https://pideck.dev/sitemap.xml\n");
  });

  it("is a sitemap for the canonical homepage", () => {
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(sitemap).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(sitemap).toContain("<loc>https://pideck.dev/</loc>");
    expect(sitemap).not.toContain("<!doctype html");
  });

  it("declares the canonical host and a short description", () => {
    expect(html).toContain('<link rel="canonical" href="https://pideck.dev/" />');
    expect(html).toContain('<meta property="og:url" content="https://pideck.dev/" />');
    expect(html).toContain(`content="${DESCRIPTION}"`);
    expect(DESCRIPTION.length).toBeLessThanOrEqual(160);
  });
});

describe("static server does not rewrite crawl files to index.html", () => {
  let server: Server;
  let base: string;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-seo-"));
    fs.copyFileSync(path.join(root, "client/public/robots.txt"), path.join(dir, "robots.txt"));
    fs.copyFileSync(path.join(root, "client/public/sitemap.xml"), path.join(dir, "sitemap.xml"));
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>PiDeck</title><div id=\"root\"></div>");

    const app = express();
    serveStatic(app, dir);
    app.get("/{*splat}", (_req, res) => {
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

  it("serves robots.txt as plain text", async () => {
    const r = await fetch(`${base}/robots.txt`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await r.text()).toBe(robots);
  });

  it("serves sitemap.xml as XML", async () => {
    const r = await fetch(`${base}/sitemap.xml`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/xml/);
    expect(await r.text()).toBe(sitemap);
  });

  it("still falls back to the page for other paths", async () => {
    const r = await fetch(`${base}/login`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await r.text()).toContain("<title>PiDeck</title>");
  });
});
