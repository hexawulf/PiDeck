import type { Express } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import MemoryStore from "memorystore";
import { AuthService } from "./services/auth";
import { SystemService } from "./services/system";
import { loginSchema } from "@shared/schema";
import { z } from "zod";

const MemStore = MemoryStore(session);

export async function registerRoutes(app: Express): Promise<Server> {
  // Session configuration
  app.use(session({
    store: new MemStore({
      checkPeriod: 86400000 // 24 hours
    }),
    secret: process.env.SESSION_SECRET || "pideck-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set to true in production with HTTPS
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // Auth middleware
  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.session?.authenticated) {
      return res.status(401).json({ message: "Authentication required" });
    }
    next();
  };

  // Auth routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { password } = loginSchema.parse(req.body);
      
      const isValid = await AuthService.validatePassword(password);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid password" });
      }

      req.session.authenticated = true;
      res.json({ message: "Login successful" });
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
    if (req.session?.authenticated) {
      res.json({ authenticated: true });
    } else {
      res.json({ authenticated: false });
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
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ message: "Command is required" });
      }
      
      await SystemService.runCronJob(command);
      res.json({ message: "Cron job executed successfully" });
    } catch (error) {
      console.error("Run cron job error:", error);
      res.status(500).json({ message: "Failed to execute cron job" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
