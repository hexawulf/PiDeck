// GET /api/services — read-only systemd units (docs/plans/services-2.8.0.md),
// the same handler on the hub (requireAuth) and on agents (token + allowlist).
import type { Request, Response } from "express";
import { localServices } from "../services/systemd";

export async function servicesHandler(_req: Request, res: Response) {
  try {
    res.json(await localServices().get());
  } catch (err) {
    console.error("[services]", err);
    res.status(500).json({ message: "Failed to read services" });
  }
}
