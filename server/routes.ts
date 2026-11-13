import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";

import { AuthService } from "./services/auth";
import { Pm2ActionError, SystemService } from "./services/system";

import nvmeRouter from "./routes/nvme";
import systemRouter, { rebootCheckHandler } from "./routes/system";
import metricsRouter from "./routes/metrics";
import networkRouter from "./routes/network";
import dockerRouter from "./routes/docker";
import pm2Router from "./routes/pm2";
import hostLogsRouter from "./routes/hostLogs";
import thermalZonesRouter from "./routes/thermalZones";
import powerStatusRouter from "./routes/powerStatus";
import { createSystemUpdateHandler, createSystemUpdateStatusHandler } from "./routes/system-update";
import { updateRunner } from "./services/system-update";
import { readCrontab, runCronEntry } from "./services/cron";
import { unavailable } from "./services/unavailable";

import { loginSchema } from "@shared/schema";
import { rateLimitLogin } from "./middleware/rateLimitLogin";
import { requireSameOrigin } from "./middleware/sameOrigin";
import { envPasswordMatches } from "./services/env-password";
import { cookieSecure, insecureHttp } from "./config";
import { hubRuntime } from "./runtime";
import { createRemoteLogAudit } from "./agent-api";
import { servicesHandler } from "./routes/services";
import { registerFleetRoutes } from "./routes/fleet";
import { schemaReady, schemaState } from "./db-schema";
import { adminPasswordIsDefault, pool } from "./storage";
import { createHealthHandler } from "./routes/health";
import { getFirebasePublicConfig, isFirebaseEnabled, verifyFirebaseLogin } from "./services/firebase-auth";

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(1, "New password is required"),
  confirmNewPassword: z.string().min(1, "Confirm new password is required"),
}).refine((data) => data.newPassword === data.confirmNewPassword, {
  message: "New passwords do not match",
  path: ["confirmNewPassword"],
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Instance fingerprint header
  app.use((_req, res, next) => {
    res.setHeader("X-PiDeck-Instance", process.pid.toString());
    next();
  });

  // Cache-Control headers for all API responses
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  // CSRF guard: every state-changing /api request must come from PiDeck's own
  // origin (see middleware/sameOrigin.ts). Before all routes, login included.
  app.use("/api", requireSameOrigin());

  // Health (public): database reachable and schema migrated (PD-21).
  app.get("/api/health", createHealthHandler({ ping: () => pool.query("SELECT 1"), schemaReady }));

  // --- Auth bypass marker (belt & suspenders) ---
  // Mark ONLY the login POST to bypass any stray guards mounted elsewhere.
  app.use((req, _res, next) => {
    const url = (req.originalUrl || req.url || "").toLowerCase();
    if (
      req.method === "POST" &&
      (url.startsWith("/api/auth/login") || url.startsWith("/auth/login") || url.startsWith("/api/auth/firebase-login"))
    ) {
      (req as any).__loginBypass = true;
    }
    next();
  });

  // --- Auth routes (OPEN): must be defined BEFORE protected mounts ---

  app.post("/api/auth/login", rateLimitLogin, async (req, res) => {
    try {
      const { password } = loginSchema.parse(req.body);

      // 1) Env/file bootstrap password first: a match must not touch the DB
      //    admin's failed-attempt counter (see services/env-password.ts).
      // 2) Otherwise validate via AuthService (DB/hashed, with lockout).
      const envMatch = envPasswordMatches(password);
      const validationResult = envMatch
        ? { isValid: true, user: undefined, error: undefined }
        : await AuthService.validatePassword(password);

      if (!validationResult.isValid) {
        if (validationResult.error === "account_locked") {
          let message = "Account is locked due to too many failed login attempts.";
          if (validationResult.user?.account_locked_until) {
            const ms = new Date(validationResult.user.account_locked_until).getTime() - Date.now();
            if (ms > 0) message += ` Please try again in about ${Math.ceil(ms / 60000)} minutes.`;
          }
          return res.status(403).json({ message });
        }
        return res.status(401).json({ message: "Invalid username or password." });
      }

      // Regenerate session to prevent session fixation attacks
      req.session.regenerate((err) => {
        if (err) {
          console.error("Session regenerate error:", err);
          return res.status(500).json({ message: "Session regeneration failed" });
        }

        // Set session data after regeneration
        (req.session as any).authenticated = true;
        (req.session as any).userId = validationResult.user?.id ?? 1;

        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            return res.status(500).json({ message: "Session save failed" });
          }
          res.json({
            message: "Login successful",
            authenticated: true,
            userId: (req.session as any).userId,
          });
        });
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.issues });
      }
      console.error("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Non-POST /api/auth/login → 405 (match with/without trailing slash)
  app.all(["/api/auth/login", "/api/auth/login/"], (_req, res) => res.sendStatus(405));

  app.post("/api/auth/firebase-login", rateLimitLogin, async (req, res) => {
    try {
      const { idToken } = z.object({ idToken: z.string().min(1) }).parse(req.body);
      const identity = await verifyFirebaseLogin(idToken);

      req.session.regenerate((err) => {
        if (err) {
          console.error("Session regenerate error:", err);
          return res.status(500).json({ message: "Session regeneration failed" });
        }

        (req.session as any).authenticated = true;
        (req.session as any).userId = 1;
        (req.session as any).authMethod = "google-firebase";
        (req.session as any).email = identity.email;

        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            return res.status(500).json({ message: "Session save failed" });
          }
          res.json({
            message: "Login successful",
            authenticated: true,
            userId: 1,
            email: identity.email,
          });
        });
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input: idToken is required" });
      }
      const status = typeof error?.status === "number" ? error.status : 401;
      return res.status(status).json({ message: error?.message || "Firebase login failed" });
    }
  });

  app.all(["/api/auth/firebase-login", "/api/auth/firebase-login/"], (_req, res) => res.sendStatus(405));

  // Optional: block non-GET verb misuse on /api/auth/me (helps avoid compat fallthrough)
  app.all("*", (req: any, res: any, next: any) => {
    const p = req.path;
    if (req.method !== "GET" && (p === "/api/auth/me" || p === "/api/auth/me/")) return res.sendStatus(405);
    return next();
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy error:", err);
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logout successful" });
    });
  });

  // `transport` lets the login page explain a cookie the browser will drop
  // (Secure cookie over plain HTTP) and warn in PIDECK_INSECURE_HTTP mode.
  app.get("/api/auth/me", (req, res) => {
    const transport = { secureCookie: cookieSecure(), insecureHttp: insecureHttp() };
    // Pending schema migrations (M0): a banner tells the operator to run --update.
    const maintenance = { dbMigrationsPending: schemaState().checked && !schemaReady() };
    const firebase = getFirebasePublicConfig();
    if ((req.session as any)?.authenticated) {
      // historyHours: how far back history goes (PIDECK_HISTORY_HOURS), so charts offer 3d/7d only when kept.
      res.json({
        authenticated: true,
        userId: (req.session as any).userId,
        email: (req.session as any).email,
        authMethod: (req.session as any).authMethod || "password",
        transport,
        maintenance,
        defaultPassword: adminPasswordIsDefault(),
        historyHours: runtime.historyHours,
        firebase,
      });
    } else {
      res.json({ authenticated: false, transport, maintenance, firebase });
    }
  });

  // --- Auth middleware & wrapper ---
  const requireAuth = (req: any, res: any, next: any) => {
    if (req.__loginBypass) return next(); // hard bypass for POST /api/auth/login or /api/auth/firebase-login
    if (!(req.session as any)?.authenticated) {
      return res.status(401).json({ message: "Authentication required" });
    }
    next();
  };

  const requireAuthUnlessLogin = (req: any, res: any, next: any) => {
    const url = (req.originalUrl || req.url || "").toLowerCase();
    if (
      url.startsWith("/api/auth/login") ||
      url.startsWith("/auth/login") ||
      url.startsWith("/api/auth/firebase-login")
    ) {
      return next();
    }
    return requireAuth(req, res, next);
  };

  // --- Protected mounts (USE the skip-wrapper) ---
  app.use("/api", requireAuthUnlessLogin, systemRouter);
  app.use("/api", requireAuthUnlessLogin, metricsRouter);
  app.use("/api", requireAuthUnlessLogin, networkRouter);
  app.use("/api", requireAuthUnlessLogin, dockerRouter);
  app.use("/api", requireAuthUnlessLogin, pm2Router);
  app.use("/api/hostlogs", requireAuthUnlessLogin, hostLogsRouter);
  // These two routers declare full /api/metrics/* paths; app.get keeps req.url intact.
  app.get("/api/metrics/thermal-zones", requireAuth, thermalZonesRouter);
  app.get("/api/metrics/power-status", requireAuth, powerStatusRouter);
  app.get("/api/metrics/nvme", requireAuth, nvmeRouter); // was mounted before auth (public)

  // --- Multi-host (hub): status of the configured agents + read-only proxy ---
  const runtime = hubRuntime();
  const hostHub = runtime.hostHub;
  // History, alerts and the overview for every host (hub DB + memory, not proxied).
  registerFleetRoutes(app, requireAuth, runtime);
  app.get("/api/hosts", requireAuth, async (_req, res) => {
    res.json(await hostHub.list());
  });
  const auditRemoteLogRead = createRemoteLogAudit();
  app.get("/api/hosts/:id/*", requireAuth, async (req, res) => {
    // originalUrl is the raw path as sent: the allowlist check must see any
    // %-encoding, not Express's decoded req.params.
    const { status, body, logSource } = await hostHub.proxy(req.params.id, req.originalUrl);
    // Audit remote log reads (host, source, user): the pattern H4 uses for remote actions.
    // Throttled per open log (first read, then every 10 min; errors always).
    const line = logSource ? auditRemoteLogRead({ host: req.params.id, source: logSource, user: (req.session as any)?.userId, ip: req.ip, status }) : null;
    if (line) console.log(line);
    res.status(status).json(body);
  });
  app.all("/api/hosts/*", requireAuth, (req, res) =>
    req.method === "GET"
      ? res.status(404).json({ message: "Not found" })
      : res.status(405).json({ message: "Remote hosts are read-only" }),
  );

  // These ad-hoc endpoints are also protected by the wrapper above
  // 409 without running anything when PIDECK_DISABLE_SYSTEM_UPDATE=1 (E2E builds).
  // POST starts the job and answers 202; GET reports how it is going.
  app.post("/api/system/update", createSystemUpdateHandler({ runner: updateRunner() }));
  app.get("/api/system/update", createSystemUpdateStatusHandler({ runner: updateRunner() }));

  app.get("/api/reboot-check", rebootCheckHandler);
  // Read-only systemd units on the hub itself (agents serve the same route).
  app.get("/api/services", requireAuth, servicesHandler);

  // Docker container actions (listing handled by dockerRouter via Dockerode)
  app.post("/api/docker/containers/:id/restart", async (req, res) => {
    try {
      await SystemService.restartDockerContainer(req.params.id);
      res.json({ message: "Container restarted successfully" });
    } catch (error) {
      console.error("Restart container error:", error);
      res.status(500).json({ message: "Failed to restart container" });
    }
  });

  app.post("/api/docker/containers/:id/stop", async (req, res) => {
    try {
      await SystemService.stopDockerContainer(req.params.id);
      res.json({ message: "Container stopped successfully" });
    } catch (error) {
      console.error("Stop container error:", error);
      res.status(500).json({ message: "Failed to stop container" });
    }
  });

  app.post("/api/docker/containers/:id/start", async (req, res) => {
    try {
      await SystemService.startDockerContainer(req.params.id);
      res.json({ message: "Container started successfully" });
    } catch (error) {
      console.error("Start container error:", error);
      res.status(500).json({ message: "Failed to start container" });
    }
  });

  // PM2 helpers (protected)
  app.get("/api/pm2/processes", async (_req, res) => {
    try {
      const processes = await SystemService.getPM2Processes();
      res.json(processes ?? unavailable("not-installed", "pm2 isn't installed on this host."));
    } catch (error) {
      console.error("Get PM2 processes error:", error);
      res.status(500).json({ message: "Failed to get PM2 processes" });
    }
  });

  // 400 bad name · 404 not a pm2 process · 409 PiDeck stopping itself (services/system.ts).
  for (const action of ["restart", "stop"] as const) {
    app.post(`/api/pm2/processes/:name/${action}`, async (req, res) => {
      try {
        await SystemService.pm2Action(action, req.params.name);
        res.json({ message: action === "stop" ? "Process stopped successfully" : "Process restarted successfully" });
      } catch (error) {
        if (error instanceof Pm2ActionError) return res.status(error.status).json({ message: error.message });
        console.error(`${action} PM2 process error:`, error);
        res.status(500).json({ message: `Failed to ${action} process` });
      }
    });
  }

  // Cron helpers (protected)
  app.get("/api/cron/jobs", async (_req, res) => {
    try {
      const jobs = await SystemService.getCronJobs();
      res.json(jobs);
    } catch (error) {
      console.error("Get cron jobs error:", error);
      res.status(500).json({ message: "Failed to get cron jobs" });
    }
  });

  // Runs one job of the crontab, as cron would (services/cron.ts). The command
  // must be one the crontab holds right now: nothing else can be run this way.
  //   200 finished with exit 0 · 500 finished with another exit code ·
  //   202 still running after 10 s (it keeps going; output in the named log)
  app.post("/api/cron/run", async (req, res) => {
    try {
      const requestedCommand = req.body?.command;
      if (typeof requestedCommand !== "string" || !requestedCommand) {
        return res.status(400).json({ message: "Command is required" });
      }
      const entry = (await readCrontab()).find((job) => job.command === requestedCommand);
      if (!entry) {
        return res.status(403).json({ message: "Invalid or not allowed cron command." });
      }
      const result = await runCronEntry(entry);
      if (result.state === "running") {
        return res.status(202).json({ message: "Cron job started; it is still running", ...result });
      }
      if (result.exitCode === 0) return res.json({ message: "Cron job executed successfully", ...result });
      res.status(500).json({ message: `Cron job failed (exit code ${result.exitCode ?? "none: killed"})`, ...result });
    } catch (error) {
      console.error("Run cron job error:", error);
      res.status(500).json({ message: "Failed to execute cron job" });
    }
  });

  // --- Password change (protected) ---
  app.post("/api/auth/change-password", requireAuth, async (req: any, res: any) => {
    try {
      const parsed = passwordChangeSchema.parse(req.body);

      const validation = await AuthService.validatePassword(parsed.currentPassword);
      if (!validation.isValid) {
        return res.status(401).json({ message: "Current password is incorrect." });
      }

      const strengthCheck = AuthService.validatePasswordStrength(parsed.newPassword);
      if (!strengthCheck.isValid) {
        return res.status(400).json({ message: strengthCheck.message });
      }

      const user = validation.user;
      if (!user) {
        return res.status(500).json({ message: "User not found." });
      }

      const newHash = await AuthService.hashPassword(parsed.newPassword);
      user.password_hash = newHash;
      user.last_password_change = new Date();
      const { storage, markAdminPasswordChanged } = await import("./storage");
      await storage.updateUser(user);
      markAdminPasswordChanged();

      res.json({ message: "Password changed successfully." });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.issues });
      }
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password." });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
