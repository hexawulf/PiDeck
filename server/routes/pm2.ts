import { Router } from "express";
import pm2, { type ProcessDescription } from "pm2";
import type { PM2Process } from "@shared/schema";

export const pm2Router = Router();



pm2Router.get("/pm2/processes", async (_req, res) => {
  const processes: PM2Process[] = await new Promise((resolve) => {
    pm2.connect((connectError: Error | null) => {
      if (connectError) {
        console.error("[pm2Router] pm2.connect failed", connectError);
        return resolve([]);
      }

      pm2.list((listError: Error | null, list: ProcessDescription[]) => {
        if (listError) {
          console.error("[pm2Router] pm2.list failed", listError);
          pm2.disconnect();
          return resolve([]);
        }

        const formatted: PM2Process[] = list.map((proc) => ({
          id: proc.pid ?? 0,
          name: proc.name ?? "",
          status: proc.pm2_env?.status ?? "unknown",
          cpu: `${proc.monit?.cpu ?? 0}%`,
          memory: `${Math.round(((proc.monit?.memory ?? 0) / 1024 / 1024) * 10) / 10}MB`,
          uptime: formatUptime(proc.pm2_env?.pm_uptime),
        }));

        pm2.disconnect();
        resolve(formatted);
      });
    });
  });

  res.json(processes);
});

function formatUptime(start?: number | null): string {
  if (!start) return "0m";
  const elapsed = Date.now() - Number(start);
  if (Number.isNaN(elapsed) || elapsed <= 0) return "0m";

  const totalSeconds = Math.floor(elapsed / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default pm2Router;
