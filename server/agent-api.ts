// The agent's read-only API (docs/plans/multi-host.md › Agent API) and the
// path checks both sides use. Pure module: no Express, no I/O.

/** Every GET the agent answers and the hub forwards. Nothing else, ever. */
export const AGENT_PATHS: readonly string[] = [
  "/api/agent/info",
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

/** The agent side: is this request one we answer? (method + exact path) */
export function agentAllows(method: string, path: string): boolean {
  return method === "GET" && ALLOWED.has(path);
}
