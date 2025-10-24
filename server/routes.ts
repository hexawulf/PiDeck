import type { Express } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import bcrypt from "bcrypt"; // Added bcrypt import
import MemoryStore from "memorystore";
import { AuthService } from "./services/auth";
import nvmeRouter from "./routes/nvme";
import systemRouter from "./routes/system";
import dockerRouter from "./routes/docker";
import pm2Router from "./routes/pm2";
import rasplogsRouter from "./routes/rasplogs";
import { SystemService } from "./services/system";

import { loginSchema, User } from "@shared/schema"; // Added User
import { storage } from "./storage"; // Added storage import
import { z } from "zod";
import { rateLimitLogin } from "./middleware/rateLimitLogin";


const MemStore = MemoryStore(session);

// Schema for password change
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(1, "New password is required"),
  confirmNewPassword: z.string().min(1, "Confirm new password is required"),
}).refine(data => data.newPassword === data.confirmNewPassword, {
  message: "New passwords do not match",
  path: ["confirmNewPassword"], // Path to field that should display error
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Trust proxy (behind Cloudflare/Nginx)
  app.set('trust proxy', 1);

  // Session configuration
  const isProd = process.env.NODE_ENV === 'production';
  const secret = process.env.SESSION_SECRET;
  if (isProd && !secret) {
    throw new Error('SESSION_SECRET must be set in production');
  }

  app.use(session({
    store: new MemStore({
      checkPeriod: 86400000 // 24 hours
    }),
    secret: secret || "pideck-secret-key",
    resave: false,
    saveUninitialized: false,
    rolling: true, // Extends session on each request
    cookie: {
      secure: isProd, // Set to true in production with HTTPS
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax', // Better cookie handling for same-site requests
      path: '/'
      // domain: OMITTED on purpose - keep cookie first-party scoped to current host
    }
  }));

  // Instance fingerprint header
  app.use((_req, res, next) => {
    res.setHeader('X-PiDeck-Instance', process.pid.toString());
    next();
  });

  // NVMe metrics route
  app.use(nvmeRouter);

  // Health check endpoint (accessible without authentication)
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // Auth routes (defined BEFORE any middleware to allow login)
  app.post("/api/auth/login", rateLimitLogin, async (req, res) => {
    try {
      const { password } = loginSchema.parse(req.body);
      
      const validationResult = await AuthService.validatePassword(password);

      if (!validationResult.isValid) {
        if (validationResult.error === "account_locked") {
          // Determine remaining lockout time for a more informative message
          let message = "Account is locked due to too many failed login attempts.";
          if (validationResult.user && validationResult.user.account_locked_until) {
            const remainingTime = new Date(validationResult.user.account_locked_until).getTime() - Date.now();
            if (remainingTime > 0) {
              message += ` Please try again in about ${Math.ceil(remainingTime / (60 * 1000))} minutes.`;
            }
          }
          return res.status(403).json({ message });
        }
        return res.status(401).json({ message: "Invalid username or password." }); // Generic message
      }

      // Successfully authenticated - set session data
      (req.session as any).authenticated = true;
      (req.session as any).userId = validationResult.user?.id;
      
      // Explicitly save the session before responding
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "Session save failed" });
        }
        
        // Session saved successfully, send response
        res.json({ 
          message: "Login successful",
          authenticated: true,
          userId: validationResult.user?.id 
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

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy error:", err);
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logout successful" });
    });
  });

  // CSRF token endpoint (accessible without authentication)
  app.get("/api/auth/csrf", (req, res) => {
    // Generate a simple CSRF token
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    res.json({ token });
  });

  app.get("/api/auth/me", (req, res) => {
    if ((req.session as any)?.authenticated) {
      res.json({ authenticated: true, userId: (req.session as any).userId });
    } else {
      res.json({ authenticated: false });
    }
  });

  // Auth middleware
  const requireAuth = (req: any, res: any, next: any) => {
    if (!(req.session as any)?.authenticated) {
      return res.status(401).json({ message: "Authentication required" });
    }
    next();
  };

  // Auth middleware wrapper that skips login route
  const requireAuthUnlessLogin = (req: any, res: any, next: any) => {
    const url = req.originalUrl || req.url || '';
    // Allow both /api/auth/login and /auth/login (handles different mounts)
    if (url.startsWith('/api/auth/login') || url.startsWith('/auth/login')) {
      return next();
    }
    return requireAuth(req, res, next);
  };

  // System routes
  app.use("/api", systemRouter);
  app.use("/api", dockerRouter);
  app.use("/api", pm2Router);
  app.use("/api", rasplogsRouter);

  app.get("/api/system/history", async (req, res) => {
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



  // Docker routes
  app.get("/api/docker/containers", async (req, res) => {
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
      const { id } = req.params;
      await SystemService.restartDockerContainer(id);
      res.json({ message: "Container restarted successfully" });
    } catch (error) {
      console.error("Restart container error:", error);
      res.status(500).json({ message: "Failed to restart container" });
    }
  });

  app.post("/api/docker/containers/:id/stop", async (req, res) => {
    try {
      const { id } = req.params;
      await SystemService.stopDockerContainer(id);
      res.json({ message: "Container stopped successfully" });
    } catch (error) {
      console.error("Stop container error:", error);
      res.status(500).json({ message: "Failed to stop container" });
    }
  });

  app.post("/api/docker/containers/:id/start", async (req, res) => {
    try {
      const { id } = req.params;
      await SystemService.startDockerContainer(id);
      res.json({ message: "Container started successfully" });
    } catch (error) {
      console.error("Start container error:", error);
      res.status(500).json({ message: "Failed to start container" });
    }
  });

  // PM2 routes
  app.get("/api/pm2/processes", async (req, res) => {
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
      const { name } = req.params;
      await SystemService.restartPM2Process(name);
      res.json({ message: "Process restarted successfully" });
    } catch (error) {
      console.error("Restart PM2 process error:", error);
      res.status(500).json({ message: "Failed to restart process" });
    }
  });

  app.post("/api/pm2/processes/:name/stop", async (req, res) => {
    try {
      const { name } = req.params;
      await SystemService.stopPM2Process(name);
      res.json({ message: "Process stopped successfully" });
    } catch (error) {
      console.error("Stop PM2 process error:", error);
      res.status(500).json({ message: "Failed to stop process" });
    }
  });

  // Cron routes
  app.get("/api/cron/jobs", async (req, res) => {
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

      // Get the list of existing cron jobs to validate against
      const existingJobs = await SystemService.getCronJobs();
      const isValidCommand = existingJobs.some(job => job.command === requestedCommand);

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

  // Health check endpoint (accessible without authentication)
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  const httpServer = createServer(app);
  return httpServer;
}
