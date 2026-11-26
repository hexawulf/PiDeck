import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { sanitizeLogValue } from "../services/log-sanitize";

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
 * Failed attempts per address: after `max` failures within `windowMs`, every
 * request from that address *without the right token* gets 429 until the
 * window ends. A correct token always gets through and clears the count, so a
 * hub that was briefly configured with a wrong token recovers as soon as the
 * token is fixed. (The token is 256 bits: the limit exists to cut noise and
 * log spam, not to make guessing feasible or not.)
 */
export function createFailureLimiter({ max = 10, windowMs = 10 * 60 * 1000, maxEntries = 10_000, now = Date.now } = {}) {
  const failures = new Map<string, { count: number; reset: number }>();
  const evictIfFull = (t: number) => {
    if (failures.size < maxEntries) return;
    for (const [k, v] of failures) {
      if (t > v.reset) failures.delete(k);
    }
    while (failures.size >= maxEntries) {
      const oldest = failures.keys().next().value;
      if (oldest === undefined) break;
      failures.delete(oldest);
    }
  };
  const entry = (key: string) => {
    const t = now();
    let e = failures.get(key);
    if (!e || t > e.reset) {
      if (e) failures.delete(key);
      else evictIfFull(t);
      e = { count: 0, reset: t + windowMs };
      failures.set(key, e);
    } else {
      // Refresh recency so active offenders are not evicted before idle entries.
      failures.delete(key);
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
    },
    reset: (key: string) => {
      failures.delete(key);
    },
    retryAfterSec: (key: string) => Math.max(1, Math.ceil(((failures.get(key)?.reset ?? now()) - now()) / 1000)),
    size: () => failures.size,
  };
}

export interface AgentAuthOptions {
  warn?: (msg: string) => void;
  logThrottleMs?: number;
  now?: () => number;
}

/** 401 (no detail) unless the bearer token matches; 429 after repeated failures. */
export function agentAuth(expectedHex: string, limiter = createFailureLimiter(), opts: AgentAuthOptions = {}) {
  const warn = opts.warn ?? ((msg: string) => console.warn(msg));
  const logThrottleMs = opts.logThrottleMs ?? 60_000;
  const nowFn = opts.now ?? Date.now;
  const lastLog = new Map<string, number>();

  const auditFailure = (key: string, status: 401 | 429, reqPath: string) => {
    const t = nowFn();
    const bucketKey = `${status}:${key}`;
    const prev = lastLog.get(bucketKey);
    if (prev !== undefined && t - prev < logThrottleMs) return;
    if (lastLog.size >= 10_000) {
      const oldest = lastLog.keys().next().value;
      if (oldest !== undefined) lastLog.delete(oldest);
    }
    lastLog.set(bucketKey, t);
    warn(`[audit] agent-auth result=${status} ip=${sanitizeLogValue(key, 64)} path=${sanitizeLogValue(reqPath, 120)}`);
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    if (tokenMatches(expectedHex, bearerToken(req.headers.authorization))) {
      limiter.reset(key);
      return next();
    }
    if (limiter.blocked(key)) {
      auditFailure(key, 429, req.path);
      res.setHeader("Retry-After", String(limiter.retryAfterSec(key)));
      return res.status(429).json({ message: "Too many attempts" });
    }
    limiter.fail(key);
    auditFailure(key, 401, req.path);
    return res.status(401).json({ message: "Unauthorized" });
  };
}
