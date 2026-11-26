import type { Express, NextFunction, Request, Response } from "express";
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
import { CronRunConflictError, readCrontab, runCronEntry } from "./services/cron";

import { loginSchema } from "@shared/schema";
import { clientKey, rateLimitLogin } from "./middleware/rateLimitLogin";
import { authLogLine, loginLockout } from "./services/login-lockout";
import { checkSession } from "./session-policy";
import { requireSameOrigin } from "./middleware/sameOrigin";
import { envPasswordMatches, expectedEnvPassword } from "./services/env-password";
import { cookieSecure, insecureHttp } from "./config";
import { hubRuntime } from "./runtime";
import { createRemoteLogAudit } from "./agent-api";
import { servicesHandler } from "./routes/services";
import { registerFleetRoutes } from "./routes/fleet";
import { schemaReady, schemaState } from "./db-schema";
import { adminPasswordIsDefault, pool } from "./storage";
import { createHealthHandler } from "./routes/health";
import { getFirebasePublicConfig, verifyFirebaseLogin } from "./services/firebase-auth";
import { sanitizeLogValue } from "./services/log-sanitize";

type AuthSession = Request["session"] & {
  authenticated?: boolean;
  userId?: number;
  createdAt?: number;
  authMethod?: string;
  email?: string;
};

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(1, "New password is required"),
  confirmNewPassword: z.string().min(1, "Confirm new password is required"),
}).refine((data) => data.newPassword === data.confirmNewPassword, {
  message: "New passwords do not match",
  path: ["confirmNewPassword"],
});

export interface ChangePasswordDeps {
  lockout?: Pick<typeof loginLockout, "lockedFor" | "failure" | "success">;
  validatePassword?: typeof AuthService.validatePassword;
  validatePasswordStrength?: typeof AuthService.validatePasswordStrength;
  hashPassword?: typeof AuthService.hashPassword;
  updateUser?: (user: NonNullable<Awaited<ReturnType<typeof AuthService.validatePassword>>["user"]>) => Promise<unknown>;
  markPasswordChanged?: () => void;
  deleteOtherSessions?: (keepSid: string) => Promise<{ rowCount?: number | null }>;
}

export function createChangePasswordHandler(deps: ChangePasswordDeps = {}) {
  const lockout = deps.lockout ?? loginLockout;
  const validatePassword = deps.validatePassword ?? AuthService.validatePassword.bind(AuthService);
  const validatePasswordStrength =
    deps.validatePasswordStrength ?? AuthService.validatePasswordStrength.bind(AuthService);
  const hashPassword = deps.hashPassword ?? AuthService.hashPassword.bind(AuthService);

  return async (req: Request, res: Response) => {
    try {
      const ip = clientKey(req);
      const lockedMs = lockout.lockedFor(ip);
      if (lockedMs > 0) {
        console.warn(authLogLine({ method: "password", result: "change-locked", ip }));
        return res.status(403).json({
          message: `Too many failed attempts from this address. Please try again in about ${Math.ceil(lockedMs / 60000)} minutes.`,
        });
      }

      const parsed = passwordChangeSchema.parse(req.body);

      const validation = await validatePassword(parsed.currentPassword);
      if (!validation.isValid) {
        const nowLocked = validation.error === "invalid_password" && lockout.failure(ip);
        console.warn(
          authLogLine({
            method: "password",
            result: nowLocked ? "change-bad-password-locked" : "change-bad-password",
            ip,
          }),
        );
        return res.status(401).json({ message: "Current password is incorrect." });
      }
      lockout.success(ip);

      const strengthCheck = validatePasswordStrength(parsed.newPassword);
      if (!strengthCheck.isValid) {
        console.warn(authLogLine({ method: "password", result: "change-weak-password", ip }));
        return res.status(400).json({ message: strengthCheck.message });
      }

      const user = validation.user;
      if (!user) {
        return res.status(500).json({ message: "User not found." });
      }

      const newHash = await hashPassword(parsed.newPassword);
      user.password_hash = newHash;
      user.last_password_change = new Date();
      if (deps.updateUser) {
        await deps.updateUser(user);
        deps.markPasswordChanged?.();
      } else {
        const { storage, markAdminPasswordChanged } = await import("./storage");
        await storage.updateUser(user);
        markAdminPasswordChanged();
      }

      // Regenerate caller's session ID so pre-change session IDs cannot be reused.
      const prevSession = req.session as AuthSession;
      const preserved = {
        userId: prevSession.userId ?? user.id,
        createdAt: Date.now(),
        authMethod: prevSession.authMethod,
        email: prevSession.email,
      };
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => {
          if (err) return reject(err);
          const nextSession = req.session as AuthSession;
          nextSession.authenticated = true;
          nextSession.userId = preserved.userId;
          nextSession.createdAt = preserved.createdAt;
          if (preserved.authMethod) nextSession.authMethod = preserved.authMethod;
          if (preserved.email) nextSession.email = preserved.email;
          req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
        });
      });

      // Every other session ends with the old password (PD-18); this regenerated one stays.
      const { rowCount } = deps.deleteOtherSessions
        ? await deps.deleteOtherSessions(req.sessionID)
        : await pool.query("DELETE FROM user_sessions WHERE sid <> $1", [req.sessionID]);
      console.log(`[auth] password changed; ended ${rowCount ?? 0} other session(s) ip=${sanitizeLogValue(ip, 120)}`);

      res.json({ message: "Password changed successfully." });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.issues });
      }
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password." });
    }
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
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

  // --- Auth routes (OPEN): must be defined BEFORE protected mounts ---

  app.post("/api/auth/login", rateLimitLogin, async (req, res) => {
    try {
      const { password } = loginSchema.parse(req.body);
      const ip = clientKey(req);

      // Lockout is per client address (PD-17), checked before any comparison.
      const lockedMs = loginLockout.lockedFor(ip);
      if (lockedMs > 0) {
        console.warn(authLogLine({ method: "password", result: "locked", ip }));
        return res.status(403).json({
          message: `Too many failed sign-in attempts from this address. Please try again in about ${Math.ceil(lockedMs / 60000)} minutes.`,
        });
      }

      // 1) Env/file bootstrap password first, 2) otherwise the DB admin's hash.
      const envMatch = envPasswordMatches(password);
      const validationResult = envMatch
        ? { isValid: true, user: undefined, error: undefined }
        : await AuthService.validatePassword(password);

      if (!validationResult.isValid) {
        const shouldCountFailure =
          validationResult.error === "invalid_password" || expectedEnvPassword() !== "";
        const nowLocked = shouldCountFailure && loginLockout.failure(ip);
        console.warn(authLogLine({ method: "password", result: nowLocked ? "bad-password-locked" : validationResult.error ?? "failed", ip }));
        return res.status(401).json({ message: "Invalid username or password." });
      }
      loginLockout.success(ip);

      // Regenerate session to prevent session fixation attacks
      req.session.regenerate((err) => {
        if (err) {
          console.error("Session regenerate error:", err);
          return res.status(500).json({ message: "Session regeneration failed" });
        }

        // Set session data after regeneration
        const session = req.session as AuthSession;
        session.authenticated = true;
        session.userId = validationResult.user?.id ?? 1;
        session.createdAt = Date.now(); // absolute lifetime (PD-18)

        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            return res.status(500).json({ message: "Session save failed" });
          }
          console.log(authLogLine({ method: "password", result: "ok", ip, detail: envMatch ? "bootstrap password" : undefined }));
          res.json({
            message: "Login successful",
            authenticated: true,
            userId: session.userId,
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
      let identity: Awaited<ReturnType<typeof verifyFirebaseLogin>>;
      try {
        identity = await verifyFirebaseLogin(idToken);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : undefined;
        console.warn(authLogLine({ method: "google", result: "rejected", ip: clientKey(req), detail }));
        throw error;
      }

      req.session.regenerate((err) => {
        if (err) {
          console.error("Session regenerate error:", err);
          return res.status(500).json({ message: "Session regeneration failed" });
        }

        const session = req.session as AuthSession;
        session.authenticated = true;
        session.userId = 1;
        session.createdAt = Date.now(); // absolute lifetime (PD-18)
        session.authMethod = "google-firebase";
        session.email = identity.email;

        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            return res.status(500).json({ message: "Session save failed" });
          }
          console.log(authLogLine({ method: "google", result: "ok", ip: clientKey(req), email: identity.email }));
          res.json({
            message: "Login successful",
            authenticated: true,
            userId: 1,
            email: identity.email,
          });
        });
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input: idToken is required" });
      }
      const errObj = error as { status?: number; message?: string } | null;
      const status = typeof errObj?.status === "number" ? errObj.status : 401;
      return res.status(status).json({ message: errObj?.message || "Firebase login failed" });
    }
  });

  app.all(["/api/auth/firebase-login", "/api/auth/firebase-login/"], (_req, res) => res.sendStatus(405));

  // Optional: block non-GET verb misuse on /api/auth/me (helps avoid compat fallthrough)
  app.all("/{*splat}", (req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (req.method !== "GET" && (p === "/api/auth/me" || p === "/api/auth/me/")) return res.sendStatus(405);
    return next();
  });

  /**
   * PD-18: a session past its absolute lifetime, or a Google session whose
   * email left the allowlist, is ended here. Returns true if it still counts.
   */
  const sessionStillValid = (req: Request): boolean => {
    const s = req.session as AuthSession | undefined;
    const v = checkSession(s);
    if (v.ok) return true;
    console.warn(`[auth] session ended reason=${sanitizeLogValue(v.reason, 64)}${s?.email ? ` email=${sanitizeLogValue(s.email, 120)}` : ""} ip=${sanitizeLogValue(clientKey(req), 120)}`);
    if (s) {
      s.authenticated = false;
      s.destroy?.(() => {});
    }
    return false;
  };

  app.post("/api/auth/logout", (req, res) => {
    const s = req.session as AuthSession | undefined;
    const actor = s?.userId ?? "?";
    const ip = sanitizeLogValue(clientKey(req), 64);
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy error:", err);
        console.warn(`[audit] auth action=logout result=error user=${actor} ip=${ip}`);
        return res.status(500).json({ message: "Logout failed" });
      }
      console.log(`[audit] auth action=logout result=ok user=${actor} ip=${ip}`);
      res.json({ message: "Logout successful" });
    });
  });

  // `transport` lets the login page explain a cookie the browser will drop
  // (Secure cookie over plain HTTP) and warn in PIDECK_INSECURE_HTTP mode.
  app.get("/api/auth/me", (req, res) => {
    const transport = { secureCookie: cookieSecure(), insecureHttp: insecureHttp() };
    const firebase = getFirebasePublicConfig();
    const session = req.session as AuthSession | undefined;
    if (session?.authenticated && sessionStillValid(req)) {
      // Pending schema migrations (M0): a banner tells the operator to run --update.
      const maintenance = { dbMigrationsPending: schemaState().checked && !schemaReady() };
      // historyHours: how far back history goes (PIDECK_HISTORY_HOURS), so charts offer 3d/7d only when kept.
      res.json({
        authenticated: true,
        userId: session.userId,
        email: session.email,
        authMethod: session.authMethod || "password",
        transport,
        maintenance,
        defaultPassword: adminPasswordIsDefault(),
        historyHours: runtime.historyHours,
        firebase,
      });
    } else {
      res.json({ authenticated: false, transport, firebase });
    }
  });

  // --- Auth middleware & fail-closed /api barrier (AUTHZ-001) ---
  const DEFAULT_PW_ALLOWED = new Set(["/api/auth/me", "/api/auth/logout", "/api/auth/change-password"]);
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!(req.session as AuthSession | undefined)?.authenticated || !sessionStillValid(req)) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (process.env.NODE_ENV === "production" && adminPasswordIsDefault()) {
      const pathOnly = (req.originalUrl || req.url || "").split("?")[0].toLowerCase().replace(/\/+$/, "");
      if (!DEFAULT_PW_ALLOWED.has(pathOnly)) {
        return res.status(403).json({
          message: "Default admin password must be changed before accessing this endpoint.",
        });
      }
    }
    next();
  };

  // Single fail-closed barrier for all /api/* routes mounted below public auth/health routes.
  app.use("/api", requireAuth);

  // --- Protected mounts ---
  app.use("/api", requireAuth, systemRouter);
  app.use("/api", requireAuth, metricsRouter);
  app.use("/api", requireAuth, networkRouter);
  app.use("/api", requireAuth, dockerRouter);
  app.use("/api", requireAuth, pm2Router);
  app.use("/api/hostlogs", requireAuth, hostLogsRouter);
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
  app.get<{ id: string; rest?: string[] }>("/api/hosts/:id/{*rest}", requireAuth, async (req, res) => {
    // originalUrl is the raw path as sent: the allowlist check must see any
    // %-encoding, not Express's decoded req.params.
    const { status, body, logSource } = await hostHub.proxy(req.params.id, req.originalUrl);
    // Audit remote log reads (host, source, user): the pattern H4 uses for remote actions.
    // Throttled per open log (first read, then every 10 min; errors always).
    const line = logSource ? auditRemoteLogRead({ host: req.params.id, source: logSource, user: (req.session as AuthSession | undefined)?.userId, ip: req.ip, status }) : null;
    if (line) console.log(line);
    res.status(status).json(body);
  });
  app.all("/api/hosts/{*rest}", requireAuth, (req, res) =>
    req.method === "GET"
      ? res.status(404).json({ message: "Not found" })
      : res.status(405).json({ message: "Remote hosts are read-only" }),
  );

  // Explicit requireAuth on every privileged ad-hoc route (defense-in-depth, AUTHZ-002).
  // 409 without running anything when PIDECK_DISABLE_SYSTEM_UPDATE=1 (E2E builds).
  // POST starts the job and answers 202; GET reports how it is going.
  app.post("/api/system/update", requireAuth, createSystemUpdateHandler({ runner: updateRunner() }));
  app.get("/api/system/update", requireAuth, createSystemUpdateStatusHandler({ runner: updateRunner() }));

  app.get("/api/reboot-check", requireAuth, rebootCheckHandler);
  // Read-only systemd units on the hub itself (agents serve the same route).
  app.get("/api/services", requireAuth, servicesHandler);

  // Docker container actions (listing handled by dockerRouter via Dockerode)
  const auditActor = (req: Request) => {
    const s = req.session as AuthSession | undefined;
    return `user=${s?.userId ?? "?"} ip=${sanitizeLogValue(clientKey(req), 64)}`;
  };

  app.post("/api/docker/containers/:id/restart", requireAuth, async (req, res) => {
    const target = sanitizeLogValue(req.params.id, 80);
    try {
      await SystemService.restartDockerContainer(req.params.id);
      console.log(`[audit] docker action=restart container=${target} result=ok ${auditActor(req)}`);
      res.json({ message: "Container restarted successfully" });
    } catch (error) {
      console.error("Restart container error:", error);
      console.warn(`[audit] docker action=restart container=${target} result=error ${auditActor(req)}`);
      res.status(500).json({ message: "Failed to restart container" });
    }
  });

  app.post("/api/docker/containers/:id/stop", requireAuth, async (req, res) => {
    const target = sanitizeLogValue(req.params.id, 80);
    try {
      await SystemService.stopDockerContainer(req.params.id);
      console.log(`[audit] docker action=stop container=${target} result=ok ${auditActor(req)}`);
      res.json({ message: "Container stopped successfully" });
    } catch (error) {
      console.error("Stop container error:", error);
      console.warn(`[audit] docker action=stop container=${target} result=error ${auditActor(req)}`);
      res.status(500).json({ message: "Failed to stop container" });
    }
  });

  app.post("/api/docker/containers/:id/start", requireAuth, async (req, res) => {
    const target = sanitizeLogValue(req.params.id, 80);
    try {
      await SystemService.startDockerContainer(req.params.id);
      console.log(`[audit] docker action=start container=${target} result=ok ${auditActor(req)}`);
      res.json({ message: "Container started successfully" });
    } catch (error) {
      console.error("Start container error:", error);
      console.warn(`[audit] docker action=start container=${target} result=error ${auditActor(req)}`);
      res.status(500).json({ message: "Failed to start container" });
    }
  });

  // PM2 actions (GET /api/pm2/processes is served by pm2Router mounted above).
  // 400 bad name · 404 not a pm2 process · 409 PiDeck stopping itself (services/system.ts).
  for (const action of ["restart", "stop"] as const) {
    app.post(`/api/pm2/processes/:name/${action}`, requireAuth, async (req, res) => {
      const target = sanitizeLogValue(req.params.name, 80);
      try {
        await SystemService.pm2Action(action, req.params.name);
        console.log(`[audit] pm2 action=${action} name=${target} result=ok ${auditActor(req)}`);
        res.json({ message: action === "stop" ? "Process stopped successfully" : "Process restarted successfully" });
      } catch (error) {
        if (error instanceof Pm2ActionError) {
          console.warn(`[audit] pm2 action=${action} name=${target} result=${error.status} ${auditActor(req)}`);
          return res.status(error.status).json({ message: error.message });
        }
        console.error(`${action} PM2 process error:`, error);
        console.warn(`[audit] pm2 action=${action} name=${target} result=error ${auditActor(req)}`);
        res.status(500).json({ message: `Failed to ${action} process` });
      }
    });
  }

  // Cron helpers (protected)
  app.get("/api/cron/jobs", requireAuth, async (_req, res) => {
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
  app.post("/api/cron/run", requireAuth, async (req, res) => {
    try {
      const requestedCommand = req.body?.command;
      if (typeof requestedCommand !== "string" || !requestedCommand) {
        return res.status(400).json({ message: "Command is required" });
      }
      const cmdLabel = sanitizeLogValue(requestedCommand, 120);
      const entry = (await readCrontab()).find((job) => job.command === requestedCommand);
      if (!entry) {
        console.warn(`[audit] cron action=run command="${cmdLabel}" result=rejected ${auditActor(req)}`);
        return res.status(403).json({ message: "Invalid or not allowed cron command." });
      }
      const result = await runCronEntry(entry);
      if (result.state === "running") {
        console.log(`[audit] cron action=run command="${cmdLabel}" result=running ${auditActor(req)}`);
        return res.status(202).json({ message: "Cron job started; it is still running", ...result });
      }
      console.log(`[audit] cron action=run command="${cmdLabel}" result=exit:${result.exitCode ?? "killed"} ${auditActor(req)}`);
      if (result.exitCode === 0) return res.json({ message: "Cron job executed successfully", ...result });
      res.status(500).json({ message: `Cron job failed (exit code ${result.exitCode ?? "none: killed"})`, ...result });
    } catch (error) {
      if (error instanceof CronRunConflictError) {
        console.warn(`[audit] cron action=run result=conflict ${auditActor(req)}`);
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Run cron job error:", error);
      console.warn(`[audit] cron action=run result=error ${auditActor(req)}`);
      res.status(500).json({ message: "Failed to execute cron job" });
    }
  });

  // --- Password change (protected) ---
  app.post("/api/auth/change-password", requireAuth, rateLimitLogin, createChangePasswordHandler());

  const httpServer = createServer(app);
  return httpServer;
}
