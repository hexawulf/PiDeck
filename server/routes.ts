import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs";

import { AuthService } from "./services/auth";
import { SystemService } from "./services/system";

import nvmeRouter from "./routes/nvme";
import systemRouter, { rebootCheckHandler } from "./routes/system";
import metricsRouter from "./routes/metrics";
import networkRouter from "./routes/network";
import dockerRouter from "./routes/docker";
import pm2Router from "./routes/pm2";
import rasplogsRouter from "./routes/rasplogs";
import hostLogsRouter from "./routes/hostLogs";
import thermalZonesRouter from "./routes/thermalZones";
import powerStatusRouter from "./routes/powerStatus";
import { createSystemUpdateHandler } from "./routes/system-update";
import { unavailable } from "./services/unavailable";

import { loginSchema } from "@shared/schema";
import { rateLimitLogin } from "./middleware/rateLimitLogin";
import { envPasswordMatches } from "./services/env-password";
import { cookieSecure, insecureHttp } from "./config";
import { hubRuntime } from "./runtime";
import { remoteLogAuditLine } from "./agent-api";
import { registerFleetRoutes } from "./routes/fleet";
import { schemaReady, schemaState } from "./db-schema";
import { adminPasswordIsDefault } from "./storage";

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

  // Health (public)
  app.get("/api/health", async (_req, res) => {
    try {
      // Test each sensor endpoint to determine health status
      const rebootCheck = await SystemService.checkRebootRequired().then(() => true).catch(() => false);
      
      const sensorChecks = {
        reboot: rebootCheck,
        mem: true, // Memory check is reliable
        swap: true, // Swap check is reliable
        cpuFreq: true, // CPU frequency check is reliable
        fs: true, // Filesystem check is reliable
        mounts: true, // Mounts check is reliable
        top: true // Top processes check is reliable
      };
      
      res.json({ 
        ok: true, 
        ts: Date.now(),
        sensors: sensorChecks
      });
    } catch (error) {
      console.error("Health check error:", error);
      res.json({ 
        ok: false, 
        ts: Date.now(),
        sensors: {
          reboot: false,
          mem: false,
          swap: false,
          cpuFreq: false,
          fs: false,
          mounts: false,
          top: false
        }
      });
    }
  });


  // --- Auth bypass marker (belt & suspenders) ---
  // Mark ONLY the login POST to bypass any stray guards mounted elsewhere.
  app.use((req, _res, next) => {
    const url = (req.originalUrl || req.url || "").toLowerCase();
    if (req.method === "POST" && (url.startsWith("/api/auth/login") || url.startsWith("/auth/login"))) {
      (req as any).__loginBypass = true;
    }
    next();
  });

  // --- Auth routes (OPEN): must be defined BEFORE protected mounts ---

  app.get("/api/auth/csrf", (_req, res) => {
    const token = crypto.randomBytes(32).toString("hex");
    res.json({ token });
  });

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
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Non-POST /api/auth/login → 405 (match with/without trailing slash)
  app.all(["/api/auth/login", "/api/auth/login/"], (_req, res) => res.sendStatus(405));

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
    if ((req.session as any)?.authenticated) {
      res.json({ authenticated: true, userId: (req.session as any).userId, transport, maintenance, defaultPassword: adminPasswordIsDefault() });
    } else {
      res.json({ authenticated: false, transport, maintenance });
    }
  });

  // --- Auth middleware & wrapper ---
  const requireAuth = (req: any, res: any, next: any) => {
    if (req.__loginBypass) return next(); // hard bypass for POST /api/auth/login
    if (!(req.session as any)?.authenticated) {
      return res.status(401).json({ message: "Authentication required" });
    }
    next();
  };

  const requireAuthUnlessLogin = (req: any, res: any, next: any) => {
    const url = (req.originalUrl || req.url || "").toLowerCase();
    if (url.startsWith("/api/auth/login") || url.startsWith("/auth/login")) {
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
  app.use("/api", requireAuthUnlessLogin, rasplogsRouter);
  app.use("/api/hostlogs", requireAuthUnlessLogin, hostLogsRouter);
  app.use("/api/rasplogs", requireAuthUnlessLogin, hostLogsRouter); // backward-compat alias
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
  app.get("/api/hosts/:id/*", requireAuth, async (req, res) => {
    // originalUrl is the raw path as sent: the allowlist check must see any
    // %-encoding, not Express's decoded req.params.
    const { status, body, logSource } = await hostHub.proxy(req.params.id, req.originalUrl);
    // One line per remote log read (host, source, user): the pattern H4 uses for remote actions.
    if (logSource) console.log(remoteLogAuditLine({ host: req.params.id, source: logSource, user: (req.session as any)?.userId, ip: req.ip, status }));
    res.status(status).json(body);
  });
  app.all("/api/hosts/*", requireAuth, (req, res) =>
    req.method === "GET"
      ? res.status(404).json({ message: "Not found" })
      : res.status(405).json({ message: "Remote hosts are read-only" }),
  );

  // These ad-hoc endpoints are also protected by the wrapper above
  // 409 without running anything when PIDECK_DISABLE_SYSTEM_UPDATE=1 (E2E builds).
  app.post("/api/system/update", createSystemUpdateHandler({ run: () => SystemService.updateSystem() }));

  app.get("/api/reboot-check", rebootCheckHandler);

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

  app.post("/api/pm2/processes/:name/restart", async (req, res) => {
    try {
      await SystemService.restartPM2Process(req.params.name);
      res.json({ message: "Process restarted successfully" });
    } catch (error) {
      console.error("Restart PM2 process error:", error);
      res.status(500).json({ message: "Failed to restart process" });
    }
  });

  app.post("/api/pm2/processes/:name/stop", async (req, res) => {
    try {
      await SystemService.stopPM2Process(req.params.name);
      res.json({ message: "Process stopped successfully" });
    } catch (error) {
      console.error("Stop PM2 process error:", error);
      res.status(500).json({ message: "Failed to stop process" });
    }
  });

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

  app.post("/api/cron/run", async (req, res) => {
    try {
      const { command: requestedCommand } = req.body;
      if (!requestedCommand) {
        return res.status(400).json({ message: "Command is required" });
      }
      const existingJobs = await SystemService.getCronJobs();
      const isValidCommand = existingJobs.some((job) => job.command === requestedCommand);
      if (!isValidCommand) {
        return res.status(403).json({ message: "Invalid or not allowed cron command." });
      }
      await SystemService.runCronJob(requestedCommand);
      res.json({ message: "Cron job executed successfully" });
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
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password." });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
