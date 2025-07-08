import type { Express } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import bcrypt from "bcrypt"; // Added bcrypt import
import MemoryStore from "memorystore";
import { AuthService } from "./services/auth";
import nvmeRouter from "./routes/nvme";
import { SystemService } from "./services/system";
import { loginSchema, User } from "@shared/schema"; // Added User
import { storage } from "./storage"; // Added storage import
import { z } from "zod";

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
  // Session configuration
  app.use(session({
    store: new MemStore({
      checkPeriod: 86400000 // 24 hours
    }),
    secret: process.env.SESSION_SECRET || "pideck-secret-key",
    resave: false,
    saveUninitialized: false,
    rolling: true, // Extends session on each request
    cookie: {
      secure: false, // Set to true in production with HTTPS
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax' // Better cookie handling for same-site requests
    }
  }));

  // NVMe metrics route
  app.use(nvmeRouter);

  // Auth middleware
  const requireAuth = (req: any, res: any, next: any) => {
    if (!(req.session as any)?.authenticated) {
      return res.status(401).json({ message: "Authentication required" });
    }
    next();
  };

  // Auth routes
  app.post("/api/auth/login", async (req, res) => {
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

  app.get("/api/auth/me", (req, res) => {
    if ((req.session as any)?.authenticated) {
      res.json({ authenticated: true, userId: (req.session as any).userId });
    } else {
      res.json({ authenticated: false });
    }
  });

  // Password change route
  app.post("/api/auth/change-password", requireAuth, async (req: any, res: any) => {
    try {
      const { currentPassword, newPassword } = passwordChangeSchema.parse(req.body);
      const userId = req.session.userId;

      if (!userId) {
        // Should not happen if requireAuth is working, but good for safety
        return res.status(401).json({ message: "User not authenticated." });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      // 1. Validate current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({ message: "Incorrect current password." });
      }

      // 2. Validate new password strength
      const strengthValidation = AuthService.validatePasswordStrength(newPassword);
      if (!strengthValidation.isValid) {
        return res.status(400).json({ message: strengthValidation.message || "New password does not meet strength requirements." });
      }

      // 3. Hash new password and update user
      const newPasswordHash = await AuthService.hashPassword(newPassword);

      user.password_hash = newPasswordHash;
      user.last_password_change = new Date();
      user.failed_login_attempts = 0; // Reset failed attempts on successful password change
      user.account_locked_until = null; // Unlock account if it was locked

      await storage.updateUser(user);

      // Optional: Re-issue session or update session details if needed, though often not necessary for password change.
      // Forcing logout on other devices is a more advanced feature.

      console.log(`[API /auth/change-password] User ${user.username} (ID: ${userId}) changed their password successfully.`);
      res.json({ message: "Password changed successfully." });

    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error("Password change error:", error);
      res.status(500).json({ message: "Internal server error during password change." });
    }
  });


  // System routes
  app.get("/api/system/info", requireAuth, async (req, res) => {
    try {
      const systemInfo = await SystemService.getSystemInfo();
      res.json(systemInfo);
    } catch (error) {
      console.error("System info error:", error);
      res.status(500).json({ message: "Failed to get system information" });
    }
  });

  app.get("/api/system/history", requireAuth, async (req, res) => {
    try {
      const historicalData = await SystemService.getHistoricalData();
      res.json(historicalData);
    } catch (error) {
      console.error("System history error:", error);
      res.status(500).json({ message: "Failed to get system historical data" });
    }
  });

  app.get("/api/system/alerts", requireAuth, (req, res) => {
    try {
      const alerts = SystemService.getActiveAlerts();
      res.json(alerts);
    } catch (error) {
      console.error("System alerts error:", error);
      res.status(500).json({ message: "Failed to get system alerts" });
    }
  });

  app.post("/api/system/update", requireAuth, async (_req, res) => {
    try {
      const output = await SystemService.updateSystem();
      res.json({ message: "System updated", output });
    } catch (error) {
      console.error("System update error:", error);
      res.status(500).json({ message: "Failed to update system" });
    }
  });

  app.get("/api/reboot-check", requireAuth, async (_req, res) => {
    try {
      const rebootRequired = await SystemService.checkRebootRequired();
      res.json({ rebootRequired });
    } catch (error) {
      console.error("Reboot check error:", error);
      res.status(500).json({ message: "Failed to check reboot status" });
    }
  });

  // Log routes
  app.get("/api/logs", requireAuth, async (req, res) => {
    try {
      const logFiles = await SystemService.getLogFiles();
      res.json(logFiles);
    } catch (error) {
      console.error("Get logs error:", error);
      res.status(500).json({ message: "Failed to get log files" });
    }
  });

  app.get("/api/logs/:filename", requireAuth, async (req, res) => {
    try {
      const { filename } = req.params;
      const filePath = `/home/zk/logs/${filename}`;
      const content = await SystemService.getLogFileContent(filePath);
      res.json({ content });
    } catch (error) {
      console.error("Get log content error:", error);
      res.status(500).json({ message: "Failed to read log file" });
    }
  });

  // Docker routes
  app.get("/api/docker/containers", requireAuth, async (req, res) => {
    try {
      const containers = await SystemService.getDockerContainers();
      res.json(containers);
    } catch (error) {
      console.error("Get Docker containers error:", error);
      res.status(500).json({ message: "Failed to get Docker containers" });
    }
  });

  app.post("/api/docker/containers/:id/restart", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      await SystemService.restartDockerContainer(id);
      res.json({ message: "Container restarted successfully" });
    } catch (error) {
      console.error("Restart container error:", error);
      res.status(500).json({ message: "Failed to restart container" });
    }
  });

  app.post("/api/docker/containers/:id/stop", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      await SystemService.stopDockerContainer(id);
      res.json({ message: "Container stopped successfully" });
    } catch (error) {
      console.error("Stop container error:", error);
      res.status(500).json({ message: "Failed to stop container" });
    }
  });

  app.post("/api/docker/containers/:id/start", requireAuth, async (req, res) => {
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
  app.get("/api/pm2/processes", requireAuth, async (req, res) => {
    try {
      const processes = await SystemService.getPM2Processes();
      res.json(processes);
    } catch (error) {
      console.error("Get PM2 processes error:", error);
      res.status(500).json({ message: "Failed to get PM2 processes" });
    }
  });

  app.post("/api/pm2/processes/:name/restart", requireAuth, async (req, res) => {
    try {
      const { name } = req.params;
      await SystemService.restartPM2Process(name);
      res.json({ message: "Process restarted successfully" });
    } catch (error) {
      console.error("Restart PM2 process error:", error);
      res.status(500).json({ message: "Failed to restart process" });
    }
  });

  app.post("/api/pm2/processes/:name/stop", requireAuth, async (req, res) => {
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
  app.get("/api/cron/jobs", requireAuth, async (req, res) => {
    try {
      const jobs = await SystemService.getCronJobs();
      res.json(jobs);
    } catch (error) {
      console.error("Get cron jobs error:", error);
      res.status(500).json({ message: "Failed to get cron jobs" });
    }
  });

  app.post("/api/cron/run", requireAuth, async (req, res) => {
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

  const httpServer = createServer(app);
  return httpServer;
}
