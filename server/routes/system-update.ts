import type { Request, Response } from "express";
import { isDsm } from "../services/platform";
import { UpdateAlreadyRunning, type UpdateRunner } from "../services/system-update";

// POST /api/system/update starts `sudo apt-get update && sudo apt-get upgrade -y`
// as a background job and answers 202 at once; GET /api/system/update reports
// how it is going (services/system-update.ts).
// PIDECK_DISABLE_SYSTEM_UPDATE=1 turns the POST into a 409 that runs nothing —
// set by scripts/e2e-server.sh, because the E2E build shares the prod host.
export const SYSTEM_UPDATE_DISABLED_MESSAGE = "System update disabled in this environment";

export function systemUpdateDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PIDECK_DISABLE_SYSTEM_UPDATE === "1";
}

type Deps = {
  runner: Pick<UpdateRunner, "start" | "status">;
  env?: NodeJS.ProcessEnv;
  dsm?: () => boolean;
};

export function createSystemUpdateHandler({ runner, env = process.env, dsm = isDsm }: Deps) {
  return (_req: Request, res: Response) => {
    if (systemUpdateDisabled(env)) {
      return res.status(409).json({ message: SYSTEM_UPDATE_DISABLED_MESSAGE });
    }
    if (dsm()) {
      return res.status(409).json({ message: "Not available on DSM (update DSM in Control Panel)" });
    }
    try {
      const status = runner.start();
      res.status(202).json({ message: "System update started", ...status });
    } catch (error) {
      if (error instanceof UpdateAlreadyRunning) {
        return res.status(409).json({ message: error.message, ...runner.status() });
      }
      console.error("System update error:", error);
      res.status(500).json({ message: "Failed to start the system update" });
    }
  };
}

/** GET: idle | running | succeeded | failed, with the log's name and its last lines. */
export function createSystemUpdateStatusHandler({ runner }: Pick<Deps, "runner">) {
  return (_req: Request, res: Response) => {
    try {
      res.json(runner.status());
    } catch (error) {
      console.error("System update status error:", error);
      res.status(500).json({ message: "Failed to read the update status" });
    }
  };
}
