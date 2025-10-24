import { Router } from "express";
import type { ActiveAlert, SystemInfo } from "@shared/schema";
import { SystemService } from "../services/system";

export const systemRouter = Router();

systemRouter.use((req, res, next) => {
  if (!(req.session as any)?.authenticated) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
});

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

export default systemRouter;
