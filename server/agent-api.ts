// The agent's read-only API (docs/plans/multi-host.md › Agent API) and the
// path checks both sides use. Pure module: no Express, no I/O.

/** Every GET the agent answers and the hub forwards. Nothing else, ever. */
export const AGENT_PATHS: readonly string[] = [
  "/api/agent/info",
  "/api/agent/sample", // raw counters for the hub's sampler (2.5+)
  "/api/agent/logs", // log sources, when PIDECK_AGENT_LOGS=on (2.6+); a source: /api/agent/logs/<id>
  "/api/system/info",
  "/api/metrics/ram",
  "/api/metrics/swap",
  "/api/metrics/cpu-freq",
  "/api/metrics/top-processes",
  "/api/metrics/filesystems",
  "/api/metrics/mounts",
  "/api/metrics/nvme",
  "/api/metrics/power-status",
  "/api/metrics/thermal-zones",
  "/api/metrics/firewall-status",
  "/api/metrics/ip-config",
  "/api/metrics/listening-ports",
  "/api/reboot-check",
  "/api/docker/containers",
  "/api/pm2/processes",
  "/api/services", // read-only systemd units (2.8+)
];
const ALLOWED = new Set(AGENT_PATHS);

export const HOST_ID_RE = /^[a-z0-9-]{1,32}$/;

/**
 * The hub side of `/api/hosts/:id/<rest>`: take the *raw* request URL (as
 * sent, before Express decodes it), and return the agent path to request,
 * or null. Accepts only an exact allowlist match: no query string, no
 * percent-encoding at all (so no %2F / %2e tricks), no `..`, `//`, `\`,
 * or anything outside [a-z0-9/-]. One trailing slash is tolerated.
 */
export function agentPathFromHubUrl(rawUrl: string, hostId: string): string | null {
  const prefix = `/api/hosts/${hostId}/`;
  if (!HOST_ID_RE.test(hostId) || !rawUrl.startsWith(prefix)) return null;
  const rest = rawUrl.slice(prefix.length);
  if (!/^[a-z0-9/-]+$/.test(rest)) return null; // rejects ? # % . \ and uppercase
  if (rest.includes("//") || rest.startsWith("/")) return null;
  const path = `/api/${rest.replace(/\/$/, "")}`;
  return ALLOWED.has(path) ? path : null;
}

/** A log source id: what /api/agent/logs lists (file_…, journal_…, docker_…). */
export const LOG_SOURCE_ID_RE = /^[a-z0-9_-]{1,64}$/;
const LOG_SOURCE_PATH_RE = /^\/api\/agent\/logs\/([a-z0-9_-]{1,64})$/;
export const MAX_LOG_LINES = 2000;
export const MAX_LOG_FILTER = 200;

/** The agent side: is this request one we answer? (method + exact path, or one log source) */
export function agentAllows(method: string, path: string): boolean {
  return method === "GET" && (ALLOWED.has(path) || LOG_SOURCE_PATH_RE.test(path));
}

export type LogsRequest = { path: string; sourceId: string | null };

/**
 * The hub side for remote logs (2.6): `/api/hosts/<id>/agent/logs` and
 * `/api/hosts/<id>/agent/logs/<source>` with at most `lines` (integer
 * 1–2000) and `filter` (≤ 200 characters, no newline/NUL) as query
 * parameters. The path part is as strict as agentPathFromHubUrl (no %, no
 * dots); the query is decoded, validated and re-encoded, so the agent only
 * ever gets a canonical string. Returns null for "not a logs URL" and an
 * error message for a logs URL with a bad query.
 */
export function agentLogsPathFromHubUrl(rawUrl: string, hostId: string): LogsRequest | { error: string } | null {
  const prefix = `/api/hosts/${hostId}/agent/logs`;
  if (!HOST_ID_RE.test(hostId) || !rawUrl.startsWith(prefix)) return null;
  const q = rawUrl.indexOf("?");
  const pathPart = (q === -1 ? rawUrl : rawUrl.slice(0, q)).slice(prefix.length);
  const query = q === -1 ? "" : rawUrl.slice(q + 1);
  let sourceId: string | null = null;
  if (pathPart === "" || pathPart === "/") {
    if (query) return { error: "The source list takes no parameters" };
    return { path: "/api/agent/logs", sourceId: null };
  }
  const m = /^\/([a-z0-9_-]{1,64})$/.exec(pathPart);
  if (!m) return null;
  sourceId = m[1];
  if (query.includes("#")) return { error: "Bad query" };
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(query);
    decodeURIComponent(query.replace(/\+/g, " ")); // reject malformed %-escapes
  } catch {
    return { error: "Bad query" };
  }
  const out = new URLSearchParams();
  const seen = new Set<string>();
  for (const [k, v] of params) {
    if (seen.has(k)) return { error: `Repeated parameter: ${k.slice(0, 20)}` };
    seen.add(k);
    if (k === "lines") {
      if (!/^\d{1,4}$/.test(v) || Number(v) < 1 || Number(v) > MAX_LOG_LINES) return { error: `lines must be an integer 1–${MAX_LOG_LINES}` };
      out.set("lines", String(Number(v)));
    } else if (k === "filter") {
      if (v.length > MAX_LOG_FILTER || /[\n\r\0]/.test(v)) return { error: `filter must be at most ${MAX_LOG_FILTER} characters on one line` };
      if (v !== "") out.set("filter", v);
    } else {
      return { error: `Unknown parameter: ${k.slice(0, 20)}` };
    }
  }
  const qs = out.toString();
  return { path: `/api/agent/logs/${sourceId}${qs ? `?${qs}` : ""}`, sourceId };
}

type AuditRead = { host: string; source: string; user: unknown; ip?: string; status: number };
const auditUser = (u: unknown) => (typeof u === "number" || (typeof u === "string" && /^[\w.-]{1,64}$/.test(u)) ? String(u) : "?");
const auditIp = (ip?: string) => (ip && /^[0-9a-fA-F:.]{1,64}$/.test(ip) ? ip : "?");

/** The hub's audit line for one remote log read. Values are ids/numbers only, never log content. */
export function remoteLogAuditLine(r: AuditRead, polls = 0): string {
  const line = `[logs] remote read host=${r.host} source=${r.source} user=${auditUser(r.user)} ip=${auditIp(r.ip)} status=${r.status}`;
  return polls > 0 ? `${line} polls=${polls}` : line;
}

/**
 * Quieter audit (2.6.1): an open log polls every few seconds, so log a read
 * when a (host, source, user, ip) is first seen, then at most once per
 * `windowMs` while it keeps polling (`polls=N` = reads since the last line).
 * Anything but a 200 is always logged. Memory is bounded (`maxKeys`).
 */
export function createRemoteLogAudit({ windowMs = 10 * 60_000, maxKeys = 500, now = Date.now }: { windowMs?: number; maxKeys?: number; now?: () => number } = {}) {
  const seen = new Map<string, { at: number; polls: number }>();
  return (r: AuditRead): string | null => {
    const key = `${r.host}\0${r.source}\0${auditUser(r.user)}\0${auditIp(r.ip)}`;
    const t = now();
    const prev = seen.get(key);
    if (r.status === 200 && prev && t - prev.at < windowMs) {
      prev.polls++;
      return null;
    }
    const polls = prev?.polls ?? 0;
    seen.delete(key); // re-insert: Map order = oldest first
    seen.set(key, { at: t, polls: 0 });
    if (seen.size > maxKeys) seen.delete(seen.keys().next().value as string);
    return remoteLogAuditLine(r, polls);
  };
}
