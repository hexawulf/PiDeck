// server/index.ts — production-safe, SPA public, /api protected
import "./env";
import path from "path";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import { fileURLToPath } from "url";

// Your existing helpers (unchanged)
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import compatRouter from "./routes/compat";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- config ----------
const PORT = Number(process.env.PORT || 5006);
const SESSION_SECRET =
  process.env.SESSION_SECRET || "CHANGE_ME_SESSION_SECRET_LONG_RANDOM";
const PIDECK_PASSWORD =
  process.env.PIDECK_PASSWORD ||
  process.env.ADMIN_PASSWORD ||
  process.env.APP_PASSWORD ||
  "";

// Public origins we might want to echo in CORS later (not required for SPA)
const PUBLIC_ORIGINS = new Set<string>([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  "https://pideck.piapps.dev",
]);

// ---------- app ----------
const app = express();

// Behind Cloudflare/Nginx (needed for secure cookies & proto detection)
app.set("trust proxy", 1);

// Parsers & hardening
app.disable("x-powered-by");
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ---------- sessions (before anything that uses req.session) ----------
app.use(
  session({
    name: "connect.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: true, // ok because trust proxy = 1 and we're behind TLS at CF+Nginx
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

// ---------- STATIC & SPA: PUBLIC (no auth) ----------
const staticDir = path.resolve(__dirname, "../dist/public");
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

  server.listen(
    { port: PORT, host: "0.0.0.0", reusePort: true },
    () => log(`serving on port ${PORT}`),
  );
})();
