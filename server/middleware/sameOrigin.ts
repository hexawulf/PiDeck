// CSRF guard for the hub's state-changing API routes (system update, Docker
// and pm2 actions, cron run, login, logout, password change).
//
//   GET / HEAD / OPTIONS                      → pass (they change nothing)
//   Origin present                            → its host must be this request's Host
//                                               (or an origin in PIDECK_CORS_ORIGIN)
//   no Origin, Sec-Fetch-Site present         → must be same-origin or none
//   neither header (curl, scripts/install.sh) → pass: no browser, so no ambient cookie
//
// Browsers send Origin on every POST, so a page on another origin — another
// *.piapps.dev app included, which SameSite cookies do not stop — is refused.
// Only hosts are compared, never the scheme: a proxy that doesn't forward the
// scheme must not lock everyone out, and the session cookie is Secure anyway.
import type { NextFunction, Request, Response } from "express";
import { corsOrigins } from "../config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type OriginCheck = {
  method: string;
  /** The request's Host header. */
  host: string | undefined;
  origin: string | undefined;
  secFetchSite: string | undefined;
  /** Extra allowed origins (PIDECK_CORS_ORIGIN), as scheme://host[:port]. */
  allowedOrigins?: readonly string[];
};

/** Is this request allowed to change state? Pure, for tests. */
export function sameOriginAllowed({ method, host, origin, secFetchSite, allowedOrigins = [] }: OriginCheck): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (origin !== undefined) {
    if (allowedOrigins.includes(origin.replace(/\/+$/, ""))) return true;
    let originHost: string;
    try {
      originHost = new URL(origin).host; // "null" (sandboxed page) and junk throw
    } catch {
      return false;
    }
    return !!host && originHost.toLowerCase() === host.toLowerCase();
  }
  if (secFetchSite !== undefined) return secFetchSite === "same-origin" || secFetchSite === "none";
  return true;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function requireSameOrigin(env: NodeJS.ProcessEnv = process.env) {
  const allowedOrigins = corsOrigins(env) || [];
  return (req: Request, res: Response, next: NextFunction) => {
    const ok = sameOriginAllowed({
      method: req.method,
      host: first(req.headers.host),
      origin: first(req.headers.origin),
      secFetchSite: first(req.headers["sec-fetch-site"]),
      allowedOrigins,
    });
    if (ok) return next();
    const origin = String(first(req.headers.origin) ?? "-").replace(/[^\x21-\x7e]/g, "?").slice(0, 120);
    console.warn(`[security] refused cross-origin ${req.method} ${req.path.slice(0, 80)} origin=${origin} ip=${req.ip ?? "?"}`);
    return res.status(403).json({ message: "Cross-origin request refused" });
  };
}
