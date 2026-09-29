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

/**
 * TRUST_PROXY → Express "trust proxy". Unset = 1 (one reverse proxy in front,
 * the documented setup). "false"/"0" = no proxy (plain --lan-http install:
 * X-Forwarded-* from clients must not be believed, or the login rate limit
 * could be dodged). A number = that many hops; anything else is passed through
 * (e.g. "loopback", a subnet list).
 */
export function trustProxy(env: NodeJS.ProcessEnv = process.env): boolean | number | string {
  const v = env.TRUST_PROXY?.trim();
  if (!v) return 1;
  if (/^(false|0|no|off)$/i.test(v)) return false;
  if (/^(true|yes|on)$/i.test(v)) return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

/**
 * PIDECK_CLOUDFLARE=1: PiDeck sits behind Cloudflare's proxy, so the client
 * address is in the CF-Connecting-IP header. Off by default: without
 * Cloudflare in front, any client could set that header to a new value on
 * every request and never hit the login rate limit.
 */
export function trustCloudflare(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PIDECK_CLOUDFLARE === "1";
}

// ── multi-host (docs/plans/multi-host.md) ───────────────────────────────

/** PIDECK_MODE=agent: the read-only agent (server/agent.ts); anything else is the hub. */
export const isAgentMode = (env: NodeJS.ProcessEnv = process.env) => env.PIDECK_MODE === "agent";

export type AgentConfig = { port: number; bind: string; tokenSha256: string };

/**
 * Agent settings. Returns an error string instead of a config when the agent
 * must not start (above all: no valid PIDECK_AGENT_TOKEN_SHA256).
 */
export function agentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig | { error: string } {
  const tokenSha256 = (env.PIDECK_AGENT_TOKEN_SHA256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(tokenSha256)) {
    return { error: "PIDECK_AGENT_TOKEN_SHA256 must be the 64-hex-digit SHA-256 of the agent token (scripts/install.sh --agent sets it)" };
  }
  const portRaw = (env.PIDECK_AGENT_PORT || "5016").trim();
  const port = Number(portRaw);
  if (!/^\d+$/.test(portRaw) || port < 1 || port > 65535) return { error: `PIDECK_AGENT_PORT must be 1-65535 (got "${portRaw}")` };
  const bind = (env.PIDECK_AGENT_BIND || "127.0.0.1").trim();
  if (!/^([0-9.]+|[0-9a-f:]+|localhost)$/i.test(bind)) return { error: `PIDECK_AGENT_BIND must be an IP address (got "${bind}")` };
  return { port, bind, tokenSha256 };
}

/** `timeoutMs`: PIDECK_HOST_TIMEOUT_<ID> (2.6.1), else the hub's default (5 s). */
export type HostEntry = { id: string; label: string; url: string; token: string; timeoutMs?: number };

/** PIDECK_HOST_TOKEN_<ID>: the id upper-cased, "-" → "_". */
export const hostTokenKey = (id: string) => `PIDECK_HOST_TOKEN_${id.toUpperCase().replace(/-/g, "_")}`;
/** PIDECK_HOST_TIMEOUT_<ID>: seconds (1–9, below the sampler's 10 s tick budget) for a slow host. */
export const hostTimeoutKey = (id: string) => `PIDECK_HOST_TIMEOUT_${id.toUpperCase().replace(/-/g, "_")}`;
export const HOST_TIMEOUT_MAX_S = 9;

const HOST_ID = /^[a-z0-9-]{1,32}$/;

function pairs(value: string | undefined, name: string, warn: (m: string) => void): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of (value || "").split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const eq = item.indexOf("=");
    if (eq <= 0) {
      warn(`[config] ${name}: ignoring "${item}" (expected id=value)`);
      continue;
    }
    out.push([item.slice(0, eq).trim(), item.slice(eq + 1).trim()]);
  }
  return out;
}

/**
 * The hub's remote hosts: PIDECK_HOSTS=id=url,… plus PIDECK_HOST_TOKEN_<ID>
 * and optional PIDECK_HOST_LABELS=id=Label,…. Strict: ids are
 * [a-z0-9-]{1,32} ("local" is the hub itself), URLs are plain
 * http(s)://host[:port] (no credentials, path, query or fragment), a host
 * without a usable token is skipped. Bad entries are skipped with a warning
 * that never includes a token.
 */
export function parseHosts(
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string) => void = (m) => console.warn(m),
): HostEntry[] {
  const hosts: HostEntry[] = [];
  for (const [id, rawUrl] of pairs(env.PIDECK_HOSTS, "PIDECK_HOSTS", warn)) {
    if (!HOST_ID.test(id) || id === "local") {
      warn(`[config] PIDECK_HOSTS: ignoring host "${id.slice(0, 40)}" (id must be [a-z0-9-]{1,32}, not "local")`);
      continue;
    }
    if (hosts.some((h) => h.id === id)) {
      warn(`[config] PIDECK_HOSTS: ignoring duplicate host "${id}"`);
      continue;
    }
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      warn(`[config] PIDECK_HOSTS: ignoring host "${id}" (not a URL)`);
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/?$/.test(url.pathname) || rawUrl.includes("#") || rawUrl.includes("?")) {
      warn(`[config] PIDECK_HOSTS: ignoring host "${id}" (URL must be http(s)://host[:port] with no path, credentials or query)`);
      continue;
    }
    const token = (env[hostTokenKey(id)] || "").trim();
    if (!/^[\x21-\x7e]{16,512}$/.test(token)) {
      warn(`[config] PIDECK_HOSTS: ignoring host "${id}" (${hostTokenKey(id)} is missing or not a valid token)`);
      continue;
    }
    const entry: HostEntry = { id, label: id, url: url.origin, token };
    const rawTimeout = env[hostTimeoutKey(id)]?.trim();
    if (rawTimeout) {
      const s = Number(rawTimeout);
      if (/^\d+$/.test(rawTimeout) && s >= 1 && s <= HOST_TIMEOUT_MAX_S) entry.timeoutMs = s * 1000;
      else warn(`[config] ${hostTimeoutKey(id)}="${rawTimeout.slice(0, 20)}" must be 1–${HOST_TIMEOUT_MAX_S} seconds; using the default`);
    }
    hosts.push(entry);
  }
  for (const [id, label] of pairs(env.PIDECK_HOST_LABELS, "PIDECK_HOST_LABELS", warn)) {
    const host = hosts.find((h) => h.id === id);
    if (!host) warn(`[config] PIDECK_HOST_LABELS: no host "${id.slice(0, 40)}"`);
    else if (label) host.label = label.slice(0, 64);
  }
  return hosts;
}

/** An integer env value clamped to [min, max]; invalid → fallback with a warning. */
function intSetting(
  env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number, warn: (m: string) => void,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    warn(`[config] ${key}="${raw.slice(0, 20)}" is not a whole number; using ${fallback}`);
    return fallback;
  }
  const n = Number(raw);
  if (n < min || n > max) {
    const c = Math.min(Math.max(n, min), max);
    warn(`[config] ${key}=${n} is outside ${min}–${max}; using ${c}`);
    return c;
  }
  return n;
}

/** PIDECK_HISTORY_HOURS: how long history (and resolved alerts) are kept, per host. Default 24, 1–168. */
export function historyHours(env: NodeJS.ProcessEnv = process.env, warn: (m: string) => void = (m) => console.warn(m)): number {
  return intSetting(env, "PIDECK_HISTORY_HOURS", 24, 1, 168, warn);
}

/** PIDECK_OFFLINE_ALERT_MINUTES: an unreachable agent raises an "offline" alert after this long. Default 5, 1–1440. */
export function offlineAlertMinutes(env: NodeJS.ProcessEnv = process.env, warn: (m: string) => void = (m) => console.warn(m)): number {
  return intSetting(env, "PIDECK_OFFLINE_ALERT_MINUTES", 5, 1, 1440, warn);
}

/**
 * PIDECK_DISK_MOUNT: the mount point whose usage the sample (overview tile,
 * history) reports. Default "/". A Synology keeps its data on /volume1 while
 * "/" is DSM's small system partition. Must be an absolute path without "..".
 */
export function diskMount(env: NodeJS.ProcessEnv = process.env, warn: (m: string) => void = (m) => console.warn(m)): string {
  const raw = env.PIDECK_DISK_MOUNT?.trim();
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.split("/").includes("..") || /[\0\n]/.test(raw)) {
    warn(`[config] PIDECK_DISK_MOUNT=${JSON.stringify(raw.slice(0, 80))} is not an absolute path; using /`);
    return "/";
  }
  return raw;
}
