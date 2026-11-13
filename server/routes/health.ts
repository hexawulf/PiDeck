// GET /api/health (public): is the hub able to serve? Checks the database
// (one `SELECT 1`, 2 s budget) and whether the schema is migrated. Answers
// 200 when both hold, 503 otherwise. Booleans only: the route is public.
import type { Request, Response } from "express";

export interface HealthDeps {
  ping: () => Promise<unknown>;
  schemaReady: () => boolean;
  timeoutMs?: number;
}

export function createHealthHandler({ ping, schemaReady, timeoutMs = 2000 }: HealthDeps) {
  return async (_req: Request, res: Response) => {
    let timer: NodeJS.Timeout | undefined;
    const db = await Promise.race([
      ping().then(() => true, () => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
    clearTimeout(timer);
    const schema = schemaReady();
    const ok = db && schema;
    res.status(ok ? 200 : 503).set("Cache-Control", "no-store").json({ ok, ts: Date.now(), db, schema });
  };
}
