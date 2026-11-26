import net from 'net';
import type { Request, Response, NextFunction } from 'express';
import { trustCloudflare } from '../config';
import { sanitizeLogValue } from '../services/log-sanitize';

const WINDOW_MS = 10 * 60 * 1000; // 10 min
const MAX_ATTEMPTS = 10;
export const MAX_RATE_LIMIT_ENTRIES = 10_000;

/**
 * The address the limit is counted against. CF-Connecting-IP only counts
 * with PIDECK_CLOUDFLARE=1 (see server/config.ts) and only when it parses as
 * a valid IP address; otherwise it's ignored and req.ip is used (which
 * honours TRUST_PROXY for X-Forwarded-For).
 */
export function clientKey(
  req: Pick<Request, 'headers' | 'ip'>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (trustCloudflare(env)) {
    const cf = req.headers['cf-connecting-ip'];
    const value = Array.isArray(cf) ? cf[0] : cf;
    const trimmed = value?.trim();
    if (trimmed && net.isIP(trimmed) !== 0) return trimmed;
  }
  return req.ip || 'unknown';
}

export function createRateLimitLogin(opts?: {
  maxEntries?: number;
  windowMs?: number;
  maxAttempts?: number;
  now?: () => number;
  warn?: (msg: string) => void;
}) {
  const bucket = new Map<string, { count: number; reset: number }>();
  const maxEntries = opts?.maxEntries ?? MAX_RATE_LIMIT_ENTRIES;
  const windowMs = opts?.windowMs ?? WINDOW_MS;
  const maxAttempts = opts?.maxAttempts ?? MAX_ATTEMPTS;
  const nowFn = opts?.now ?? Date.now;
  const warn = opts?.warn ?? ((msg: string) => console.warn(msg));

  setInterval(() => {
    const now = nowFn();
    for (const [ip, entry] of bucket) {
      if (now > entry.reset) bucket.delete(ip);
    }
  }, 60 * 1000).unref();

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const ip = clientKey(req);
    const now = nowFn();
    const existing = bucket.get(ip);
    const entry = existing ?? { count: 0, reset: now + windowMs };
    if (now > entry.reset) {
      entry.count = 0;
      entry.reset = now + windowMs;
    }
    entry.count += 1;
    if (existing) {
      bucket.delete(ip);
    } else if (bucket.size >= maxEntries) {
      const oldest = bucket.keys().next().value;
      if (oldest !== undefined) bucket.delete(oldest);
    }
    bucket.set(ip, entry);
    if (entry.count > maxAttempts) {
      warn(
        `[audit] rate-limit result=429 ip=${sanitizeLogValue(ip, 64)} path=${sanitizeLogValue((req.originalUrl || req.path || '').split('?')[0], 120)}`,
      );
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000).toString());
      return res.status(429).json({ message: 'Too many login attempts. Try again later.' });
    }
    return next();
  };

  middleware.size = () => bucket.size;
  return middleware;
}

export const rateLimitLogin = createRateLimitLogin();
