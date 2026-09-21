// Content-Security-Policy for the built SPA.
//
//   startup: read <staticDir>/index.html ─► sha256 of each inline <script>
//                                         ─► script-src 'self' 'sha256-…'
//   request: every response gets the CSP header (Report-Only while
//            CSP_ENFORCE !== "true"); browsers POST violations to
//            /csp-report, which we log as one line → `pm2 logs pideck`.
//
// Hashing the served file at startup means editing the no-flash script in
// client/index.html never needs a manual hash update.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import express, { type Express } from "express";
import helmet from "helmet";

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
    const digest = crypto.createHash("sha256").update(m[1], "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

export function cspDirectives(scriptHashes: string[]): Record<string, string[]> {
  return {
    "default-src": ["'self'"],
    "script-src": ["'self'", ...scriptHashes],
    // Radix (popper positioning) and Recharts write inline style attributes.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "report-uri": ["/csp-report"],
  };
}

export function installCsp(app: Express, staticDir: string): void {
  const indexPath = path.join(staticDir, "index.html");
  const html = fs.readFileSync(indexPath, "utf8"); // fail fast: no build, no start
  const hashes = inlineScriptHashes(html);
  const reportOnly = process.env.CSP_ENFORCE !== "true";

  app.post(
    "/csp-report",
    express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "8kb" }),
    (req, res) => {
      const r = (req.body && (req.body["csp-report"] ?? req.body)) || {};
      const pick = (k: string) => String(r[k] ?? "").replace(/[\r\n]/g, " ").slice(0, 200);
      console.warn(
        `[csp] ${reportOnly ? "report-only" : "blocked"} directive=${pick("violated-directive")} ` +
          `blocked=${pick("blocked-uri")} page=${pick("document-uri")}`,
      );
      res.sendStatus(204);
    },
  );

  app.use(
    helmet.contentSecurityPolicy({
      useDefaults: false,
      reportOnly,
      directives: cspDirectives(hashes),
    }),
  );
  console.log(`[csp] ${reportOnly ? "Report-Only" : "enforcing"}; ${hashes.length} inline script hash(es)`);
}
