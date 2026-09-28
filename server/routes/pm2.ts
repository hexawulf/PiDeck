import fs from "fs";
import os from "os";
import path from "path";
import { Router } from "express";
import type { ProcessDescription } from "pm2";
import type { PM2Process } from "@shared/schema";
import { unavailable } from "../services/unavailable";

export const pm2Router = Router();

/**
 * Is a pm2 daemon running for this user? pm2.connect() *starts* one when
 * there isn't, which would leave a stray daemon behind on a systemd host
 * that doesn't use pm2. So check $PM2_HOME/pm2.pid first.
 */
export function pm2DaemonRunning(
  env: NodeJS.ProcessEnv = process.env,
  read: (p: string) => string = (p) => fs.readFileSync(p, "utf8"),
  exists: (p: string) => boolean = fs.existsSync,
): boolean {
  const home = env.PM2_HOME || path.join(env.HOME || os.homedir(), ".pm2");
  try {
    const pid = read(path.join(home, "pm2.pid")).trim();
    return /^\d+$/.test(pid) && exists(`/proc/${pid}`);
  } catch {
    return false;
  }
}

pm2Router.get("/pm2/processes", async (_req, res) => {
  if (!pm2DaemonRunning()) {
    return res.json(unavailable("not-installed", "pm2 isn't running on this host."));
  }
  // Loaded on first use: the pm2 library is large (tens of MB resident), and
  // hosts without a pm2 daemon — most agents — never need it.
  const pm2 = (await import("pm2")).default;
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
