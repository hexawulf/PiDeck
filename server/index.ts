// server/index.ts — production-safe drop-in
import "./env";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import compatRouter from "./routes/compat";

// ---------- config ----------
const PORT = Number(process.env.PORT || 5006);

const SESSION_SECRET =
  process.env.SESSION_SECRET || "CHANGE_ME_SESSION_SECRET_LONG_RANDOM";

const PIDECK_PASSWORD =
  process.env.PIDECK_PASSWORD ||
  process.env.ADMIN_PASSWORD ||
  process.env.APP_PASSWORD ||
  "";

const ALLOWED_ORIGINS = new Set<string>([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  "https://pideck.piapps.dev",
]);

const app = express();

// behind Cloudflare/Nginx: allow Express to detect HTTPS via X-Forwarded-Proto
app.set("trust proxy", 1);

// hardening & parsers
app.disable("x-powered-by");
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ---------- lightweight origin/referrer allowlist ----------
// Skip static, health, root, and *POST /api/auth/login* so nothing blocks auth.
app.use((req, res, next) => {
  const u = (req.originalUrl || req.url || "").toLowerCase();

  if (
    (req.method === "GET" &&
      (u === "/" ||
        u === "/healthz" ||
        u.startsWith("/assets/") ||
        u.startsWith("/favicon"))) ||
    (req.method === "POST" && u.startsWith("/api/auth/login"))
  ) {
    return next();
  }

  const origin = (req.headers.origin as string | undefined) || "";
  const referer = (req.headers.referer as string | undefined) || "";
  const ok =
    (origin && ALLOWED_ORIGINS.has(origin)) ||
    (referer && Array.from(ALLOWED_ORIGINS).some((o) => referer.startsWith(o)));

  if (!ok) return res.status(401).json({ message: "Authentication required" });
  next();
});

// ---------- sessions (must be before any routes using req.session) ----------
app.use(
  session({
    name: "connect.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true, // respect X-Forwarded-* from Nginx/CF
    cookie: {
      httpOnly: true,
      secure: true, // only over HTTPS (works because trust proxy = 1)
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

// ---------- AUTH endpoints (mounted early; nothing should intercept) ----------
app.post("/api/auth/login", (req: Request, res: Response) => {
  const { password } = (req.body ?? {}) as { password?: string };

  if (!PIDECK_PASSWORD) {
    return res.status(500).json({ message: "Server misconfigured" });
  }
  if (!password || password !== PIDECK_PASSWORD) {
    return res.status(401).json({ message: "Authentication required" });
  }

  // Create a fresh SID and persist deterministically
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      return res.status(500).json({ message: "Session regenerate failed" });
    }
    (req.session as any).userId = 1;
    (req.session as any).authenticated = true;

    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ message: "Session save failed" });
      return res.json({ message: "Login successful", authenticated: true, userId: 1 });
    });
  });
});

app.get("/api/auth/me", (req: Request, res: Response) => {
  const sess: any = req.session ?? {};
  if (sess?.authenticated) {
    return res.json({ authenticated: true, userId: sess.userId || 1 });
  }
  return res.status(401).json({ message: "Authentication required" });
});

// handy probe (leave during bring-up; remove later if you want)
app.get("/whoami", (_req: Request, res: Response) => {
  return res.json({ app: "PiDeck", port: PORT });
});

// ---------- API access logger (after auth endpoints so we log results) ----------
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let captured: unknown;

  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    captured = body;
    return originalJson(body);
  }) as typeof res.json;

  res.on("finish", () => {
    if (!path.startsWith("/api")) return;
    const ms = Date.now() - start;
    let line = `${req.method} ${path} ${res.statusCode} in ${ms}ms`;
    if (captured !== undefined) {
      try {
        const s = JSON.stringify(captured);
        line += ` :: ${s}`;
      } catch {
        /* ignore */
      }
    }
    if (line.length > 80) line = line.slice(0, 79) + "…";
    log(line);
  });

  next();
});

// ---------- App wiring ----------
(async () => {
  // Mount the app’s real routes AFTER auth + session
  const server = await registerRoutes(app);

  // Compat router AFTER real routes; never intercept auth
  app.use((req, res, next) => {
    const u = (req.originalUrl || req.url || "").toLowerCase();
    if (u.startsWith("/api/auth/")) return next();
    return (compatRouter as any)(req, res, next);
  });

  // Error handler (JSON shape)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    const message = err?.message || "Internal Server Error";
    res.status(status).json({ message });
    // eslint-disable-next-line no-console
    console.error(err);
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  server.listen(
    { port: PORT, host: "0.0.0.0", reusePort: true },
    () => log(`serving on port ${PORT}`),
  );
})();
