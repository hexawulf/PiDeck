// server/hub.ts — the full PiDeck (UI, login, DB, sampler); loaded by
// server/index.ts unless PIDECK_MODE=agent. SPA public, /api protected.
import "./env";
import path from "path";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cors from "cors";
import { fileURLToPath } from "url";

// Your existing helpers (unchanged)
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import compatRouter from "./routes/compat";
import { startSampler } from "./services/sampler";
import { initializeStorage, pool } from "./storage";
import { checkSchema, schemaReady, schemaState } from "./db-schema";
import { installCsp } from "./security";
import { cookieSecure, corsOrigins, insecureHttp, trustProxy } from "./config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- config ----------
const PORT = Number(process.env.PORT || 5006);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET || "CHANGE_ME_SESSION_SECRET_LONG_RANDOM";
const SESSION_COOKIE_DOMAIN =
  process.env.SESSION_COOKIE_DOMAIN || process.env.COOKIE_DOMAIN || undefined;
const TRUST_PROXY = trustProxy();

// ---------- app ----------
const app = express();
const PgStore = connectPgSimple(session);

// Behind Cloudflare/Nginx (needed for secure cookies & proto detection)
app.set("trust proxy", TRUST_PROXY);

// Parsers & hardening
app.disable("x-powered-by");
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ---------- sessions (before anything that uses req.session) ----------
app.use(
  session({
    name: "pideck.sid",
    secret: SESSION_SECRET,
    store: new PgStore({
      pool,
      createTableIfMissing: true,
      tableName: "user_sessions",
      ttl: 24 * 60 * 60,
      pruneSessionInterval: 15 * 60,
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    cookie: {
      httpOnly: true,
      // Secure in production; PIDECK_INSECURE_HTTP=1 lets a plain-HTTP LAN install log in.
      secure: cookieSecure(),
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      path: "/",
      ...(SESSION_COOKIE_DOMAIN ? { domain: SESSION_COOKIE_DOMAIN } : {}),
    },
  }),
);

// ---------- CORS ----------
// Same-origin by default (no CORS headers); PIDECK_CORS_ORIGIN lists extra origins.
const CORS_ORIGINS = corsOrigins();
if (CORS_ORIGINS) app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
if (IS_PRODUCTION && insecureHttp()) {
  console.warn("[security] PIDECK_INSECURE_HTTP=1: session cookie is sent over plain HTTP. Use only on a trusted LAN.");
}

// ---------- STATIC & SPA: PUBLIC (no auth) ----------
// Resolve next to the running bundle (dist/index.js → dist/public), same as
// serveStatic() in ./vite, so an alternate build dir serves its own assets.
const staticDir = path.resolve(__dirname, "public");
if (IS_PRODUCTION) installCsp(app, staticDir); // before static so index.html gets the header
app.use(express.static(staticDir));

// Health is public
app.get("/healthz", (_req, res) => res.sendStatus(204));

// ---------- AUTH ENDPOINTS (public) ----------
// Auth endpoints are handled by the routes system in server/routes.ts
// The routes system provides DB-backed authentication with proper session management

// ---------- API protection ----------
// API protection is now handled by the routes system in server/routes.ts
// The routes system provides proper authentication and authorization

// ---------- Mount real API routes ----------
(async () => {
  if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set in production.");
  }

  // Schema migrations are applied by `npm run db:migrate` (the installer runs
  // it), never here. With work pending: log, keep serving, banner, re-check
  // every minute; the sampler skips its writes until then (no crash loop).
  await checkSchema(pool);
  if (!schemaReady() && !schemaState().error) {
    const recheck = setInterval(() => void checkSchema(pool).then(() => schemaReady() && clearInterval(recheck)), 60_000);
    recheck.unref();
  }
  try {
    await initializeStorage();
  } catch (error) {
    // Unreachable database: fail as before. Unmigrated schema: keep serving.
    if (schemaReady() || schemaState().error) throw error;
    console.error("[bootstrap] storage init failed because the schema isn't migrated yet:", (error as Error).message);
  }

  // History rows + temperature alerts every 60s (off with PIDECK_SAMPLER=off).
  const sampler = startSampler();

  // Back-compat router BEFORE API routes; never intercept /api/*
  app.use((req, res, next) => {
    const u = (req.originalUrl || req.url || "").toLowerCase();
    if (u.startsWith("/api/")) return next();
    return (compatRouter as any)(req, res, next);
  });

  // Register your API routes (includes auth endpoints and protected routes)
  const server = await registerRoutes(app);

  // Dev: Vite; Prod: static already above
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    // serveStatic contains any extra prod wiring (no-op if you want)
    serveStatic(app);
  }

  // ---------- SPA fallback (public) ----------
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(staticDir, "index.html"));
  });

  // ---------- Error handler ----------
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    const message = err?.message || "Internal Server Error";
    if (req.path.startsWith("/api")) {
      res.status(status).json({ message });
    } else {
      res.status(status).send("Internal error");
    }
    // eslint-disable-next-line no-console
    console.error(err);
  });

  server.listen({ port: PORT, host: "0.0.0.0" }, () => log(`serving on port ${PORT}`));

  // Graceful stop for pm2 reload / Ctrl-C: stop sampling, stop accepting
  // connections, exit. Open SSE log streams would hold server.close(), so
  // exit anyway after 1.5s (pm2's kill_timeout default is 1.6s).
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      log(`${signal} received, shutting down`);
      sampler?.stop();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    });
  }
})().catch((error) => {
  console.error("[bootstrap] Failed to start PiDeck:", error);
  process.exit(1);
});
