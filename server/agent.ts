// PIDECK_MODE=agent — the read-only PiDeck agent (docs/plans/multi-host.md).
//
//   request ─► bearer token (sha256, timingSafeEqual; 429 after repeated
//              failures per address) ─► GET + exact allowlist path?
//              ─► the hub's own handlers for that path ─► JSON
//
// JSON only: no sessions, no login, no static files, no sampler, and no
// import of ./storage or a database connection (tests/unit/agent.test.ts).
import os from "node:os";
import express, { type NextFunction, type Request, type Response } from "express";
import { agentAllows, AGENT_PATHS } from "./agent-api";
import { agentAuth, createFailureLimiter } from "./middleware/agentAuth";
import { PIDECK_VERSION } from "./version";
import { readCounters } from "./services/counters";
import systemRouter, { rebootCheckHandler } from "./routes/system";
import metricsRouter from "./routes/metrics";
import networkRouter from "./routes/network";
import dockerRouter from "./routes/docker";
import pm2Router from "./routes/pm2";
import nvmeRouter from "./routes/nvme";
import thermalZonesRouter from "./routes/thermalZones";
import powerStatusRouter from "./routes/powerStatus";

export type AgentInfo = {
  version: string;
  hostname: string;
  /** sample: serves /api/agent/sample, so the hub records history for it (2.5+). */
  capabilities: { read: true; sample: true; actions: false; logs: false; paths: readonly string[] };
};

export function agentInfo(): AgentInfo {
  return {
    version: PIDECK_VERSION,
    hostname: os.hostname(),
    capabilities: { read: true, sample: true, actions: false, logs: false, paths: AGENT_PATHS },
  };
}

export function createAgentApp(opts: { tokenSha256: string; limiter?: ReturnType<typeof createFailureLimiter> }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false); // nothing sits in front of the agent; req.ip is the peer

  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  // Auth first, so an unauthenticated caller can't even learn which paths exist.
  app.use(agentAuth(opts.tokenSha256, opts.limiter));
  app.use((req, res, next) => (agentAllows(req.method, req.path) ? next() : res.status(404).json({ message: "Not found" })));

  app.get("/api/agent/info", (_req, res) => res.json(agentInfo()));
  // Raw counters only (no state kept here): the hub computes the rates.
  app.get("/api/agent/sample", async (_req, res, next) => {
    try {
      res.json(await readCounters());
    } catch (err) {
      next(err);
    }
  });
  // The same handlers the hub serves locally (only the allowlisted paths reach them).
  app.use("/api", systemRouter, metricsRouter, networkRouter, dockerRouter, pm2Router);
  app.get("/api/metrics/nvme", nvmeRouter);
  app.get("/api/metrics/thermal-zones", thermalZonesRouter);
  app.get("/api/metrics/power-status", powerStatusRouter);
  app.get("/api/reboot-check", rebootCheckHandler);

  app.use((_req, res) => res.status(404).json({ message: "Not found" }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[agent]", err);
    res.status(500).json({ message: "Internal error" });
  });
  return app;
}

export function startAgent(cfg: { port: number; bind: string; tokenSha256: string }) {
  const app = createAgentApp({ tokenSha256: cfg.tokenSha256 });
  const server = app.listen(cfg.port, cfg.bind, () => {
    console.log(`[agent] PiDeck ${PIDECK_VERSION} agent (read-only) on ${cfg.bind}:${cfg.port}`);
  });
  server.on("error", (err) => {
    console.error("[agent] failed to listen:", err.message);
    process.exit(1);
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    });
  }
  return server;
}
