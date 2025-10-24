import type { Request, Response, NextFunction } from 'express';

const bucket = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 10 * 60 * 1000; // 10 min
const MAX_ATTEMPTS = 10;

export function rateLimitLogin(req: Request, res: Response, next: NextFunction) {
  const ip = (req.headers['cf-connecting-ip'] as string) || req.ip || 'unknown';
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