// Multi-host paths (docs/plans/multi-host.md). Pure: no React.
//
//   host "local"   → /api/metrics/ram                    UI /dashboard
//   host "piapps2" → /api/hosts/piapps2/metrics/ram      UI /h/piapps2/dashboard

export const LOCAL_HOST = "local";
export const HOST_ID_RE = /^[a-z0-9-]{1,32}$/;

/** Tabs every remote host has (Cron and Settings are the hub's own). */
export const REMOTE_TABS = ["dashboard", "apps"] as const;
/** A remote host's tabs: + Logs when its agent serves remote logs (2.6, capabilities.logs). */
export const remoteTabs = (logs: boolean | undefined): readonly string[] => (logs ? [...REMOTE_TABS, "logs"] : REMOTE_TABS);

export const isLocalHost = (hostId: string) => hostId === LOCAL_HOST;

/** The request path for an API path on a host. */
export function apiPath(hostId: string, path: string): string {
  if (!path.startsWith("/api/")) throw new Error(`apiPath: not an API path: ${path}`);
  if (isLocalHost(hostId)) return path;
  if (!HOST_ID_RE.test(hostId)) throw new Error(`apiPath: bad host id: ${hostId}`);
  return `/api/hosts/${hostId}/${path.slice("/api/".length)}`;
}

/** The URL prefix of a host's pages: "" for local, "/h/<id>" otherwise. */
export const hostBase = (hostId: string) => (isLocalHost(hostId) ? "" : `/h/${hostId}`);

export const hostHref = (hostId: string, tab: string) => `${hostBase(hostId)}/${tab}`;

/** "just now", "5 min ago", "3 h ago", "2 d ago"; null → "never". */
export function formatLastSeen(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export type HostProblem ={ kind: "offline" | "auth" | "bad"; lastSeen: string | null };

/**
 * The hub answers 502 {offline|auth|badResponse} when it can't get a good
 * answer from an agent; getQueryFn turns that into Error("502: <body>").
 * Returns what went wrong, or null for any other error.
 */
export function hostProblemOf(error: unknown): HostProblem | null {
  const msg = error instanceof Error ? error.message : "";
  if (!msg.startsWith("502: ")) return null;
  let body: unknown;
  try {
    body = JSON.parse(msg.slice(5));
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const b = body as { offline?: unknown; auth?: unknown; badResponse?: unknown; lastSeen?: unknown };
  const lastSeen = typeof b.lastSeen === "string" ? b.lastSeen : null;
  if (b.offline === true) return { kind: "offline", lastSeen };
  if (b.auth === true) return { kind: "auth", lastSeen: null };
  if (b.badResponse === true) return { kind: "bad", lastSeen: null };
  return null;
}

// ── remote log pins (H3) ──────────────────────────────────────────────
// Pins live in the one `pins` prefs section; a remote source's pin id is
// "h:<host>:<source>" (local log ids never contain ":"), so pins are per host.
const SOURCE_ID_RE = /^[a-z0-9_-]{1,64}$/;
export const remotePinId = (hostId: string, sourceId: string) => `h:${hostId}:${sourceId}`;
export function parseRemotePinId(logId: string): { hostId: string; sourceId: string } | null {
  const m = /^h:([a-z0-9-]{1,32}):([a-z0-9_-]{1,64})$/.exec(logId);
  return m && HOST_ID_RE.test(m[1]) && SOURCE_ID_RE.test(m[2]) ? { hostId: m[1], sourceId: m[2] } : null;
}
/** Deep link to a remote log source (optionally filtered). */
export function remoteLogHref(hostId: string, sourceId: string, grep?: string): string {
  const q = new URLSearchParams({ log: sourceId });
  if (grep) q.set("grep", grep);
  return `${hostHref(hostId, "logs")}?${q.toString()}`;
}
