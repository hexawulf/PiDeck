import { Router } from "express";
import { SystemService } from "../services/system";

export const metricsRouter = Router();

// Filesystem usage
metricsRouter.get("/metrics/filesystems", async (_req, res) => {
  try {
    const filesystems = await SystemService.getFilesystemUsage();
    res.json(filesystems);
  } catch (error) {
    console.error("[metricsRouter] Failed to get filesystem usage", error);
    res.json([]);
  }
});

// Mount info
metricsRouter.get("/metrics/mounts", async (_req, res) => {
  try {
    const mounts = await SystemService.getMountInfo();
    res.json(mounts);
  } catch (error) {
    console.error("[metricsRouter] Failed to get mount info", error);
    res.json([]);
  }
});

// Memory stats
metricsRouter.get("/metrics/ram", async (_req, res) => {
  try {
    const memory = await SystemService.getMemoryStats();
    res.json(memory);
  } catch (error) {
    console.error("[metricsRouter] Failed to get memory stats", error);
    res.json({ total: 0, used: 0, free: 0, usage: 0 });
  }
});

// Swap stats
metricsRouter.get("/metrics/swap", async (_req, res) => {
  try {
    const swap = await SystemService.getSwapStats();
    res.json(swap);
  } catch (error) {
    console.error("[metricsRouter] Failed to get swap stats", error);
    res.json({ total: 0, used: 0, free: 0 });
  }
});

// Top processes
metricsRouter.get("/metrics/top-processes", async (req, res) => {
  try {
    const n = parseInt(req.query.n as string) || 10;
    const processes = await SystemService.getTopProcesses(Math.min(n, 20));
    res.json(processes);
  } catch (error) {
    console.error("[metricsRouter] Failed to get top processes", error);
    res.json([]);
  }
});

// CPU frequency
metricsRouter.get("/metrics/cpu-freq", async (_req, res) => {
  try {
    const frequencies = await SystemService.getCpuFrequency();
    res.json(frequencies);
  } catch (error) {
    console.error("[metricsRouter] Failed to get CPU frequency", error);
    res.json([{ core: "cpu0", freq: "N/A" }]);
  }
});

export default metricsRouter;