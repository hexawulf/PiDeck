// Host configuration from the environment (.env). Pure parsers are exported
// for tests; the constants below are what the server uses.
import os from "os";
import path from "path";

const HOME = process.env.HOME || os.homedir();

export const PIDECK_LOGS_DIR = process.env.PIDECK_LOGS_DIR || path.join(HOME, "logs");
export const PM2_LOGS_DIR = process.env.PM2_LOGS_DIR || path.join(HOME, ".pm2/logs");

export type HostLogSource = "nginx" | "pm2" | "project";
export type HostLogEntry = { id: string; label: string; path: string; name: string; source: HostLogSource };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function sourceFor(p: string, pm2Dir: string): HostLogSource {
  if (p.startsWith("/var/log/nginx/")) return "nginx";
  if (p.startsWith(pm2Dir.endsWith("/") ? pm2Dir : `${pm2Dir}/`)) return "pm2";
  return "project";
}

/**
 * PIDECK_HOST_LOGS: extra log files for the Logs tab, comma-separated
 * `[id:]Label=/absolute/path` entries. The optional `id:` keeps ids stable
 * (pins and the last-opened log refer to them); without it the id is the
 * label slugified. Relative paths and malformed entries are skipped with a
 * warning. Files that don't exist are hidden later, not errors.
 */
export function parseHostLogs(
  value: string | undefined,
  pm2Dir: string = PM2_LOGS_DIR,
  warn: (msg: string) => void = (m) => console.warn(m),
): HostLogEntry[] {
  if (!value?.trim()) return [];
  const out: HostLogEntry[] = [];
  for (const raw of value.split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const eq = item.indexOf("=");
    if (eq <= 0) {
      warn(`[config] PIDECK_HOST_LOGS: ignoring "${item}" (expected Label=/path)`);
      continue;
    }
    let label = item.slice(0, eq).trim();
    const p = item.slice(eq + 1).trim();
    let id = "";
    const colon = label.indexOf(":");
    if (colon > 0) {
      id = slug(label.slice(0, colon));
      label = label.slice(colon + 1).trim();
    }
    if (!path.isAbsolute(p) || !label) {
      warn(`[config] PIDECK_HOST_LOGS: ignoring "${item}" (path must be absolute, label non-empty)`);
      continue;
    }
    id ||= slug(label);
    if (!id || out.some((e) => e.id === id)) {
      warn(`[config] PIDECK_HOST_LOGS: ignoring "${item}" (empty or duplicate id "${id}")`);
      continue;
    }
    out.push({ id, label, path: path.normalize(p), name: path.basename(p), source: sourceFor(p, pm2Dir) });
  }
  return out;
}

/** Logs every host gets (hidden when missing): standard nginx paths and PiDeck's own pm2 logs. */
export function defaultHostLogs(pm2Dir: string = PM2_LOGS_DIR): HostLogEntry[] {
  return [
    { id: "nginx_access", label: "Nginx Access Log", path: "/var/log/nginx/access.log", name: "access.log", source: "nginx" },
    { id: "nginx_error", label: "Nginx Error Log", path: "/var/log/nginx/error.log", name: "error.log", source: "nginx" },
    { id: "pm2_pideck_out", label: "PM2 PiDeck Output", path: path.join(pm2Dir, "pideck-out.log"), name: "pideck-out.log", source: "pm2" },
    { id: "pm2_pideck_err", label: "PM2 PiDeck Error", path: path.join(pm2Dir, "pideck-error.log"), name: "pideck-error.log", source: "pm2" },
  ];
}

/** Defaults + PIDECK_HOST_LOGS; a configured entry with a default's id replaces it. */
export function hostLogs(env: NodeJS.ProcessEnv = process.env, pm2Dir: string = PM2_LOGS_DIR): HostLogEntry[] {
  const extra = parseHostLogs(env.PIDECK_HOST_LOGS, pm2Dir);
  const ids = new Set(extra.map((e) => e.id));
  return [...defaultHostLogs(pm2Dir).filter((d) => !ids.has(d.id)), ...extra];
}

/**
 * CORS: the SPA is served same-origin, so no CORS headers are needed by
 * default. PIDECK_CORS_ORIGIN (comma-separated origins) allows others, with
 * credentials. Returns false = CORS disabled.
 */
export function corsOrigins(env: NodeJS.ProcessEnv = process.env): string[] | false {
  const list = (env.PIDECK_CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter((s) => /^https?:\/\/[^/\s]+$/.test(s));
  return list.length ? list : false;
}

/**
 * PIDECK_INSECURE_HTTP=1: serve the session cookie without `Secure` so a
 * plain-HTTP LAN install (http://<ip>:5006) can log in. Only for trusted
 * networks — the session cookie then travels unencrypted.
 */
export function insecureHttp(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PIDECK_INSECURE_HTTP === "1";
}

/** Session cookie `secure` flag: on in production, unless the LAN-HTTP switch is set. */
export function cookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" && !insecureHttp(env);
}
