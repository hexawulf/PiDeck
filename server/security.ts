// Security headers (helmet) and the Content-Security-Policy for the SPA — the
// same scheme as PiDeck:
//   startup: read <staticDir>/index.html ─► sha256 of each inline <script>
//                                         ─► script-src 'self' 'sha256-…'
//   request: every response gets the CSP (Report-Only while CSP_ENFORCE !== "true");
//            violations are POSTed to /csp-report and logged as one line.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import express, { type Express } from "express";
import helmet from "helmet";

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

// Cloudflare Web Analytics (injected at the edge for proxied pages).
export const CLOUDFLARE_INSIGHTS = {
  script: "https://static.cloudflareinsights.com",
  connect: "https://cloudflareinsights.com",
};

export const FIREBASE_CSP = {
  script: [
    "https://apis.google.com",
    "https://*.firebaseapp.com",
    "https://www.gstatic.com",
  ],
  connect: [
    "https://apis.google.com",
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "https://*.firebaseapp.com",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
  ],
  frame: ["https://*.firebaseapp.com", "https://accounts.google.com"],
  img: ["https://*.googleusercontent.com", "https://www.gstatic.com"],
};

export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
    hashes.push(`'sha256-${crypto.createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  }
  return hashes;
}

export function cspDirectives(scriptHashes: string[], opts?: { firebase?: boolean }): Record<string, string[]> {
  const allowFirebase = opts?.firebase ?? (
    (process.env.FIREBASE_ENABLED || "").trim().toLowerCase() === "true" ||
    (process.env.FIREBASE_ENABLED || "").trim().toLowerCase() === "1" ||
    (process.env.FIREBASE_ENABLED || "").trim().toLowerCase() === "yes"
  );
  const scriptSrc = ["'self'", ...scriptHashes, CLOUDFLARE_INSIGHTS.script];
  const connectSrc = ["'self'", CLOUDFLARE_INSIGHTS.connect];
  const frameSrc = ["'self'"];
  const imgSrc = ["'self'", "data:"];

  if (allowFirebase) {
    scriptSrc.push(...FIREBASE_CSP.script);
    connectSrc.push(...FIREBASE_CSP.connect);
    frameSrc.push(...FIREBASE_CSP.frame);
    imgSrc.push(...FIREBASE_CSP.img);
  }

  return {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // Radix (popper positioning) writes inline style attributes.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": imgSrc,
    "font-src": ["'self'", "data:"],
    "connect-src": connectSrc,
    "frame-src": frameSrc,
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "report-uri": ["/csp-report"],
  };
}

/**
 * helmet's other headers (no CSP here: installCsp adds it once the build is known).
 * `https`: send HSTS (only when the app is served over HTTPS; a plain-HTTP LAN
 * install must not get it). No includeSubDomains/preload: those are the
 * domain owner's call, not this app's.
 */
export function securityHeaderOptions(opts: { https: boolean }) {
  return {
    contentSecurityPolicy: false as const,
    crossOriginEmbedderPolicy: false as const,
    // Google sign-in uses signInWithPopup, which needs to talk to its popup.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" as const },
    // Firebase's calls to identitytoolkit must keep the origin in Referer
    // (the web API key may be restricted by referrer); paths stay private.
    referrerPolicy: { policy: "strict-origin-when-cross-origin" as const },
    hsts: opts.https ? { maxAge: 180 * 24 * 60 * 60, includeSubDomains: false } : (false as const),
  };
}

export function installSecurityHeaders(app: Express, opts: { https: boolean }): void {
  app.use(helmet(securityHeaderOptions(opts)));
}

export function installCsp(app: Express, staticDir: string): void {
  const html = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
  const hashes = inlineScriptHashes(html);
  const reportOnly = process.env.CSP_ENFORCE !== "true";
  app.post(
    "/csp-report",
    express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "8kb" }),
    (req, res) => {
      const r = (req.body && (req.body["csp-report"] ?? req.body)) || {};
      const pick = (k: string) => String(r[k] ?? "").replace(/[\r\n]/g, " ").slice(0, 200);
      console.warn(`[csp] ${reportOnly ? "report-only" : "blocked"} directive=${pick("violated-directive")} blocked=${pick("blocked-uri")} page=${pick("document-uri")}`);
      res.sendStatus(204);
    },
  );
  app.use(helmet.contentSecurityPolicy({ useDefaults: false, reportOnly, directives: cspDirectives(hashes) }));
  console.log(`[csp] ${reportOnly ? "Report-Only" : "enforcing"}; ${hashes.length} inline script hash(es)`);
}
