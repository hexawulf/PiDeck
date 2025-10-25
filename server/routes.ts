import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import fs from "node:fs";

import { AuthService } from "./services/auth";
import { SystemService } from "./services/system";

import nvmeRouter from "./routes/nvme";
import systemRouter from "./routes/system";
import dockerRouter from "./routes/docker";
import pm2Router from "./routes/pm2";
import rasplogsRouter from "./routes/rasplogs";
import hostLogsRouter from "./routes/hostLogs";

import { loginSchema } from "@shared/schema";
import { rateLimitLogin } from "./middleware/rateLimitLogin";

// (Optional) password change schema retained for future use
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(1, "New password is required"),
  confirmNewPassword: z.string().min(1, "Confirm new password is required"),
}).refine((data) => data.newPassword === data.confirmNewPassword, {
  message: "New passwords do not match",
  path: ["confirmNewPassword"],
});

export async function registerRoutes(app: Express): Promise<Server> {
  // --- Core hardening / prerequisites ---
  app.set("trust proxy", 1);

  // Ensure body parsers are available BEFORE routes (safe even if also in index.ts)
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Sessions are already configured in server/index.ts
  // Using the main session configuration from the parent app

  // Instance fingerprint header
  app.use((_req, res, next) => {
    res.setHeader("X-PiDeck-Instance", process.pid.toString());
    next();
  });

  // Health (public)
  app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // NVMe metrics (public or behind your network/firewall middlewares)
  app.use(nvmeRouter);

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

  // Public CSRF token (for clients that enforce CSRF)
  app.get("/api/auth/csrf", (_req, res) => {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    res.json({ token });
  });

  app.post("/api/auth/login", rateLimitLogin, async (req, res) => {
    try {
      const { password } = loginSchema.parse(req.body);

      // 1) Primary: validate via AuthService (DB/hashed)
      const validationResult = await AuthService.validatePassword(password);

      // 2) Fallback: also accept password from ENV or file (for bootstrap / no-DB admin)
      let expected = (process.env.APP_PASSWORD || "").trim();
      if (!expected && process.env.APP_PASSWORD_FILE) {
        try {
          expected = fs.readFileSync(process.env.APP_PASSWORD_FILE, "utf8").trim();
        } catch {
          // ignore file read errors; fallback stays empty
        }
      }
      const supplied = (password || "").trim();
      const envMatch = expected.length > 0 && supplied === expected;

      if (!validationResult.isValid && !envMatch) {
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

      // Session success (use DB user id if present; otherwise fallback to 1 for env login)
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

  app.get("/api/auth/me", (req, res) => {
    if ((req.session as any)?.authenticated) {
      res.json({ authenticated: true, userId: (req.session as any).userId });
    } else {
      res.json({ authenticated: false });
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
  app.use("/api", requireAuthUnlessLogin, dockerRouter);
  app.use("/api", requireAuthUnlessLogin, pm2Router);
  app.use("/api", requireAuthUnlessLogin, rasplogsRouter);
  app.use("/api/hostlogs", requireAuthUnlessLogin, hostLogsRouter);
  app.use("/api/rasplogs", requireAuthUnlessLogin, hostLogsRouter); // backward-compat alias

  // These ad-hoc endpoints are also protected by the wrapper above
  app.get("/api/system/history", async (_req, res) => {
    try {
      const historicalData = await SystemService.getHistoricalData();
      res.json(historicalData);
    } catch (error) {
      console.error("System history error:", error);
      res.status(500).json({ message: "Failed to get system historical data" });
    }
  });

  app.post("/api/system/update", async (_req, res) => {
    try {
      const output = await SystemService.updateSystem();
      res.json({ message: "System updated", output });
    } catch (error) {
      console.error("System update error:", error);
      res.status(500).json({ message: "Failed to update system" });
    }
  });

  app.get("/api/reboot-check", async (_req, res) => {
    try {
      const rebootRequired = await SystemService.checkRebootRequired();
      res.json({ rebootRequired });
    } catch (error) {
      console.error("Reboot check error:", error);
      res.status(500).json({ message: "Failed to check reboot status" });
    }
  });

  // Docker helpers (protected by wrapper)
  app.get("/api/docker/containers", async (_req, res) => {
    try {
      const containers = await SystemService.getDockerContainers();
      res.json(containers);
    } catch (error) {
      console.error("Get Docker containers error:", error);
      res.status(500).json({ message: "Failed to get Docker containers" });
    }
  });

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
      res.json(processes);
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

  // (Avoid duplicating /api/health; one public endpoint is enough)

  const httpServer = createServer(app);
  return httpServer;
}
