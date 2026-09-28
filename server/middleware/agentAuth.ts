import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Agent token auth: `Authorization: Bearer <token>`, compared as SHA-256
// digests with timingSafeEqual. The agent only ever holds the hash
// (PIDECK_AGENT_TOKEN_SHA256); the token itself lives in the hub's .env.

export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export const sha256Hex = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/** Does the presented token hash to `expectedHex`? Constant-time; never throws. */
export function tokenMatches(expectedHex: string, presented: string | undefined | null): boolean {
  if (!SHA256_HEX_RE.test(expectedHex) || !presented) return false;
  const a = Buffer.from(sha256Hex(presented), "hex");
  const b = Buffer.from(expectedHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(header: string | undefined): string | null {
  const m = /^Bearer ([\x21-\x7e]{1,512})$/.exec(header ?? "");
  return m ? m[1] : null;
}

/**
 * Failed attempts per address: after `max` failures within `windowMs` every
 * request from that address gets 429 until the window ends, token or not.
 * A success does not reset the counter (a guesser that finally succeeds
 * has already been noticed).
 */
export function createFailureLimiter({ max = 10, windowMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const failures = new Map<string, { count: number; reset: number }>();
  const entry = (key: string) => {
    const t = now();
    let e = failures.get(key);
    if (!e || t > e.reset) {
      e = { count: 0, reset: t + windowMs };
      failures.set(key, e);
    }
    return e;
  };
  return {
    blocked: (key: string) => {
      const e = failures.get(key);
      return !!e && now() <= e.reset && e.count >= max;
    },
    fail: (key: string) => {
      entry(key).count += 1;
      if (failures.size > 10_000) failures.clear(); // bounded memory under a spray
    },
    retryAfterSec: (key: string) => Math.max(1, Math.ceil(((failures.get(key)?.reset ?? now()) - now()) / 1000)),
  };
}

/** 401 (no detail) unless the bearer token matches; 429 after repeated failures. */
export function agentAuth(expectedHex: string, limiter = createFailureLimiter()) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    if (limiter.blocked(key)) {
      res.setHeader("Retry-After", String(limiter.retryAfterSec(key)));
      return res.status(429).json({ message: "Too many attempts" });
    }
    if (tokenMatches(expectedHex, bearerToken(req.headers.authorization))) return next();
    limiter.fail(key);
    return res.status(401).json({ message: "Unauthorized" });
  };
}
