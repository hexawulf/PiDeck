import type { Request, Response, NextFunction } from 'express';
import { trustCloudflare } from '../config';

const bucket = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 10 * 60 * 1000; // 10 min
const MAX_ATTEMPTS = 10;

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of bucket) {
    if (now > entry.reset) bucket.delete(ip);
  }
}, 60 * 1000).unref();

/**
 * The address the limit is counted against. CF-Connecting-IP only counts
 * with PIDECK_CLOUDFLARE=1 (see server/config.ts); otherwise it's a
 * client-controlled header and would let anyone dodge the limit. req.ip
 * already honours TRUST_PROXY for X-Forwarded-For.
 */
export function clientKey(
  req: Pick<Request, 'headers' | 'ip'>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (trustCloudflare(env)) {
    const cf = req.headers['cf-connecting-ip'];
    const value = Array.isArray(cf) ? cf[0] : cf;
    if (value && value.trim()) return value.trim();
  }
  return req.ip || 'unknown';
}

export function rateLimitLogin(req: Request, res: Response, next: NextFunction) {
  const ip = clientKey(req);
  const now = Date.now();
  const entry = bucket.get(ip) ?? { count: 0, reset: now + WINDOW_MS };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + WINDOW_MS;
  }
  entry.count += 1;
  bucket.set(ip, entry);
  if (entry.count > MAX_ATTEMPTS) {
    res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000).toString());
    return res.status(429).json({ message: 'Too many login attempts. Try again later.' });
  }
  return next();
}
