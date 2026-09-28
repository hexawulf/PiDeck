import type { Request, Response } from "express";

// POST /api/system/update runs `sudo apt-get update && sudo apt-get upgrade -y`.
// PIDECK_DISABLE_SYSTEM_UPDATE=1 turns it into a 409 that runs nothing — set
// by scripts/e2e-server.sh, because the E2E build shares the prod host.
export const SYSTEM_UPDATE_DISABLED_MESSAGE = "System update disabled in this environment";

export function systemUpdateDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PIDECK_DISABLE_SYSTEM_UPDATE === "1";
}

export function createSystemUpdateHandler({
  run,
  env = process.env,
}: {
  run: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
}) {
  return async (_req: Request, res: Response) => {
    if (systemUpdateDisabled(env)) {
      return res.status(409).json({ message: SYSTEM_UPDATE_DISABLED_MESSAGE });
    }
    try {
      const output = await run();
      res.json({ message: "System updated", output });
    } catch (error) {
      console.error("System update error:", error);
      res.status(500).json({ message: "Failed to update system" });
    }
  };
}
