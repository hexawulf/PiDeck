// GET /api/health (public): is the hub able to serve? Checks the database
// (one `SELECT 1`, 2 s budget) and whether the schema is migrated. Answers
// 200 when both hold, 503 otherwise. Booleans only: the route is public.
import type { Request, Response } from "express";

export interface HealthDeps {
  ping: () => Promise<unknown>;
  schemaReady: () => boolean;
  timeoutMs?: number;
  cacheMs?: number;
  now?: () => number;
}

export function createHealthHandler({
  ping,
  schemaReady,
  timeoutMs = 2000,
  cacheMs = 5000,
  now = Date.now,
}: HealthDeps) {
  let cached: { db: boolean; at: number } | null = null;
  let inFlight: Promise<boolean> | null = null;

  const checkDb = async (): Promise<boolean> => {
    const t = now();
    if (cached && cacheMs > 0 && t - cached.at < cacheMs) {
      return cached.db;
    }
    if (!inFlight) {
      let timer: NodeJS.Timeout | undefined;
      inFlight = Promise.race([
        ping().then(() => true, () => false),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
      ]).then((db) => {
        clearTimeout(timer);
        cached = { db, at: now() };
        inFlight = null;
        return db;
      });
    }
    return inFlight;
  };

  return async (_req: Request, res: Response) => {
    const db = await checkDb();
    const schema = schemaReady();
    const ok = db && schema;
    res.status(ok ? 200 : 503).set("Cache-Control", "no-store").json({ ok, ts: now(), db, schema });
  };
}
