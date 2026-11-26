// Security headers (helmet) and the Content-Security-Policy for the SPA — the
// same scheme as PiDeck:
//   startup: read <staticDir>/index.html ─► sha256 of each inline <script>
//                                         ─► script-src 'self' 'sha256-…'
//   request: every response gets the CSP (Report-Only while CSP_ENFORCE !== "true");
//            violations are POSTed to /csp-report and logged as one line.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import express, { type Express, type Request, type Response } from "express";
import helmet from "helmet";
import { clientKey } from "./middleware/rateLimitLogin";
import { sanitizeLogValue } from "./services/log-sanitize";

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

// Cloudflare Web Analytics (injected at the edge for proxied pages).
export const CLOUDFLARE_INSIGHTS = {
  script: "https://static.cloudflareinsights.com",
  connect: "https://cloudflareinsights.com",
};

export const FIREBASE_CSP = {
  script: [
    "https://apis.google.com",
    "https://www.gstatic.com",
  ],
  connect: [
    "https://apis.google.com",
    "https://*.googleapis.com",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
  ],
  frame: ["https://accounts.google.com"],
  img: ["https://*.googleusercontent.com", "https://www.gstatic.com"],
};

const VALID_HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * Resolve the exact Firebase auth origin (no wildcards) from
 * FIREBASE_CLIENT_AUTH_DOMAIN or FIREBASE_PROJECT_ID.
 */
export function resolveFirebaseAuthOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const rawDomain = (env.FIREBASE_CLIENT_AUTH_DOMAIN || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  const projectId = (env.FIREBASE_PROJECT_ID || "").trim();
  const candidate =
    rawDomain || (projectId && /^[a-z0-9-]+$/i.test(projectId) ? `${projectId}.firebaseapp.com` : "");
  if (!candidate || candidate.includes("*") || !VALID_HOSTNAME_RE.test(candidate)) return null;
  return `https://${candidate.toLowerCase()}`;
}

export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
    hashes.push(`'sha256-${crypto.createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  }
  return hashes;
}

export function cspDirectives(
  scriptHashes: string[],
  opts?: { firebase?: boolean; env?: NodeJS.ProcessEnv },
): Record<string, string[]> {
  const env = opts?.env ?? process.env;
  const allowFirebase = opts?.firebase ?? (
    (env.FIREBASE_ENABLED || "").trim().toLowerCase() === "true" ||
    (env.FIREBASE_ENABLED || "").trim().toLowerCase() === "1" ||
    (env.FIREBASE_ENABLED || "").trim().toLowerCase() === "yes"
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
    const firebaseOrigin = resolveFirebaseAuthOrigin(env);
    if (firebaseOrigin) {
      connectSrc.push(firebaseOrigin);
      frameSrc.push(firebaseOrigin);
    }
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

export interface CspReportHandlerOptions {
  reportOnly?: boolean;
  perIpLimit?: number;
  globalLimit?: number;
  windowMs?: number;
  maxEntries?: number;
  now?: () => number;
  warn?: (msg: string) => void;
}

/**
 * Rate-limited handler for unauthenticated POST /csp-report (API-002).
 * Enforces bounded per-IP and global budgets and silently returns 204
 * without logging when throttled to prevent log flooding / disk exhaustion.
 */
export function createCspReportHandler(opts: CspReportHandlerOptions = {}) {
  const reportOnly = opts.reportOnly ?? true;
  const perIpLimit = opts.perIpLimit ?? 20;
  const globalLimit = opts.globalLimit ?? 100;
  const windowMs = opts.windowMs ?? 60_000;
  const maxEntries = opts.maxEntries ?? 10_000;
  const nowFn = opts.now ?? Date.now;
  const warn = opts.warn ?? ((msg: string) => console.warn(msg));

  const perIp = new Map<string, { count: number; reset: number }>();
  let globalWindow = { count: 0, reset: 0 };

  const handler = (req: Request, res: Response) => {
    const t = nowFn();
    if (t > globalWindow.reset) {
      globalWindow = { count: 0, reset: t + windowMs };
    }
    globalWindow.count += 1;

    const ip = clientKey(req);
    const existing = perIp.get(ip);
    const entry = existing && t <= existing.reset ? existing : { count: 0, reset: t + windowMs };
    entry.count += 1;
    if (existing) {
      perIp.delete(ip);
    } else if (perIp.size >= maxEntries) {
      const oldest = perIp.keys().next().value;
      if (oldest !== undefined) perIp.delete(oldest);
    }
    perIp.set(ip, entry);

    if (globalWindow.count > globalLimit || entry.count > perIpLimit) {
      return res.sendStatus(204);
    }

    const r = (req.body && (req.body["csp-report"] ?? req.body)) || {};
    const pick = (k: string) => sanitizeLogValue(r[k], 200);
    warn(
      `[csp] ${reportOnly ? "report-only" : "blocked"} directive=${pick("violated-directive")} blocked=${pick("blocked-uri")} page=${pick("document-uri")}`,
    );
    return res.sendStatus(204);
  };

  handler.trackedIps = () => perIp.size;
  return handler;
}

export function installCsp(app: Express, staticDir: string): void {
  const html = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
  const hashes = inlineScriptHashes(html);
  const reportOnly = process.env.CSP_ENFORCE !== "true";
  app.post(
    "/csp-report",
    express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "8kb" }),
    createCspReportHandler({ reportOnly }),
  );
  app.use(helmet.contentSecurityPolicy({ useDefaults: false, reportOnly, directives: cspDirectives(hashes) }));
  console.log(`[csp] ${reportOnly ? "Report-Only" : "enforcing"}; ${hashes.length} inline script hash(es)`);
}
