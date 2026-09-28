import { Router, type Request, type Response } from "express";
import type { ActiveAlert, SystemInfo } from "@shared/schema";
import { SystemService } from "../services/system";

export const systemRouter = Router();



systemRouter.get("/system/info", async (_req, res) => {
  try {
    const info: SystemInfo = await SystemService.getSystemInfo();
    res.json(info);
  } catch (error) {
    console.error("[systemRouter] Failed to load system info", error);
    res.status(500).json({ message: "Failed to get system information" });
  }
});

systemRouter.get("/system/alerts", (_req, res) => {
  try {
    const alerts: ActiveAlert[] = SystemService.getActiveAlerts();
    res.json(alerts);
  } catch (error) {
    console.error("[systemRouter] Failed to load system alerts", error);
    res.json([] satisfies ActiveAlert[]);
  }
});

/** GET /api/reboot-check — shared by the hub (routes.ts) and the agent. */
export async function rebootCheckHandler(_req: Request, res: Response) {
  try {
    const rebootRequired = await SystemService.checkRebootRequired();
    res.json({ ok: true, rebootRequired, message: rebootRequired ? "System reboot required" : "System up to date" });
  } catch (error) {
    console.error("Reboot check error:", error);
    res.json({ ok: false, rebootRequired: false, error: "Failed to check reboot status" });
  }
}

export default systemRouter;
