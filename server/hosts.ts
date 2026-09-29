// The hub side of multi-host (docs/plans/multi-host.md): host status for
// GET /api/hosts and the read-only proxy behind GET /api/hosts/:id/*.
//
//   browser ─► hub /api/hosts/piapps2/metrics/ram
//                │ host from the registry only (never a URL from the client)
//                │ path: exact allowlist match on the raw URL (agent-api.ts)
//                ▼
//              agent GET /api/metrics/ram   Authorization: Bearer <token>
//                │ no cookies, no client headers · 5 s · 1 MB · JSON only
//                ▼
//              200 JSON  |  502 {offline} {auth} {badResponse}  (never the agent's text)
import os from "node:os";
import { agentPathFromHubUrl } from "./agent-api";
import type { HostEntry } from "./config";
import { majorVersion, PIDECK_VERSION } from "./version";

export type HostStatus = "online" | "offline" | "auth-error" | "version-mismatch";
export type HostSummary = {
  id: string;
  label: string;
  local: boolean;
  status: HostStatus;
  version: string | null;
  lastSeen: string | null; // ISO time of the last good answer
  /** Can the hub record history for it? "unsupported" = agent < 2.5 (no /api/agent/sample): amber, update the agent. */
  history: HistorySupport;
};
export type HistorySupport = "ok" | "unsupported" | "unknown";

/** What one sampler poll of an agent got. "unsupported" = an agent < 2.5. */
export type SampleOutcome =
  | { kind: "ok"; body: unknown }
  | { kind: "offline" }
  | { kind: "auth" }
  | { kind: "bad" }
  | { kind: "unsupported" };

type Outcome =
  | { kind: "ok"; body: unknown }
  | { kind: "offline" }
  | { kind: "auth" }
  | { kind: "bad" };

type HostState = {
  lastSeen: number | null;
  version: string | null;
  status: HostStatus;
  history: HistorySupport;
  checkedAt: number;
  inflight?: Promise<void>;
};

export type HubOptions = {
  hosts: HostEntry[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  hubVersion?: string;
  localLabel?: string;
  cacheMs?: number;
  infoTimeoutMs?: number;
  proxyTimeoutMs?: number;
  sampleTimeoutMs?: number;
  maxBytes?: number;
};

export function createHostHub({
  hosts,
  fetchImpl = fetch,
  now = Date.now,
  hubVersion = PIDECK_VERSION,
  localLabel = os.hostname(),
  cacheMs = 15_000,
  infoTimeoutMs = 3_000,
  proxyTimeoutMs = 5_000,
  sampleTimeoutMs = 5_000,
  maxBytes = 1024 * 1024,
}: HubOptions) {
  const byId = new Map(hosts.map((h) => [h.id, h]));
  const state = new Map<string, HostState>(
    hosts.map((h) => [h.id, { lastSeen: null, version: null, status: "offline", history: "unknown", checkedAt: -Infinity }]),
  );
  const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

  /** One GET to an agent. Every failure becomes a kind; nothing throws. */
  async function agentGet(host: HostEntry, path: string, timeoutMs: number): Promise<Outcome> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs); // covers the body too
    try {
      const res = await fetchImpl(host.url + path, {
        method: "GET",
        headers: { authorization: `Bearer ${host.token}`, accept: "application/json" },
        signal: ctrl.signal,
        redirect: "error",
      });
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        await res.body?.cancel().catch(() => {});
        return { kind: "auth" };
      }
      const type = res.headers.get("content-type") || "";
      const length = Number(res.headers.get("content-length") || 0);
      if (!res.ok || !/^application\/json\b/i.test(type) || length > maxBytes || !res.body) {
        await res.body?.cancel().catch(() => {});
        return { kind: "bad" };
      }
      const reader = res.body.getReader();
      // Don't rely on the stream honouring the abort: race every read against it.
      const aborted = new Promise<never>((_r, reject) => {
        if (ctrl.signal.aborted) reject(new Error("timeout"));
        ctrl.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
      });
      aborted.catch(() => {});
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted]).catch(async (e) => {
          await reader.cancel().catch(() => {});
          throw e;
        });
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return { kind: "bad" };
        }
        chunks.push(value);
      }
      try {
        return { kind: "ok", body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
      } catch {
        return { kind: "bad" };
      }
    } catch {
      return { kind: "offline" }; // refused, DNS, reset, timeout (abort), redirect
    } finally {
      clearTimeout(timer);
    }
  }

  function seen(id: string, version?: string | null) {
    const s = state.get(id)!;
    s.lastSeen = now();
    if (version !== undefined) s.version = version;
    s.status = versionStatus(s.version);
  }

  const versionStatus = (v: string | null): HostStatus => {
    const a = majorVersion(v);
    const b = majorVersion(hubVersion);
    return a !== null && b !== null && a !== b ? "version-mismatch" : "online";
  };

  async function check(host: HostEntry) {
    const s = state.get(host.id)!;
    const out = await agentGet(host, "/api/agent/info", infoTimeoutMs);
    s.checkedAt = now();
    if (out.kind === "ok") {
      const body = out.body as { version?: unknown; capabilities?: { sample?: unknown } };
      seen(host.id, typeof body?.version === "string" ? body.version.slice(0, 32) : null);
      s.history = body?.capabilities?.sample === true ? "ok" : "unsupported";
    } else {
      s.status = out.kind === "auth" ? "auth-error" : "offline";
    }
  }

  function refresh(host: HostEntry): Promise<void> {
    const s = state.get(host.id)!;
    if (now() - s.checkedAt < cacheMs) return Promise.resolve();
    s.inflight ??= check(host).finally(() => (s.inflight = undefined));
    return s.inflight;
  }

  function summary(h: HostEntry): HostSummary {
    const s = state.get(h.id)!;
    return { id: h.id, label: h.label, local: false, status: s.status, version: s.version, lastSeen: iso(s.lastSeen), history: s.history };
  }

  return {
    has: (id: string) => byId.has(id),

    /** The hub (`local`) plus every configured host, each checked at most every cacheMs. */
    async list(): Promise<HostSummary[]> {
      await Promise.all(hosts.map(refresh)); // in parallel; each has its own timeout
      const local: HostSummary = {
        id: "local", label: localLabel, local: true, status: "online", version: hubVersion, lastSeen: iso(now()), history: "ok",
      };
      return [local, ...hosts.map(summary)];
    },

    /** Configured hosts (not the hub itself), in PIDECK_HOSTS order. */
    entries: (): readonly HostEntry[] => hosts,

    /** A label for any id ("local" = the hub's hostname). */
    label: (id: string) => (id === "local" ? localLabel : byId.get(id)?.label ?? id),

    /** Last good contact (ms) or null. */
    lastSeenAt: (id: string) => state.get(id)?.lastSeen ?? null,

    /** After a restart: the newest history row is the best "last seen" we have. Never moves it backwards. */
    seedLastSeen(id: string, at: number) {
      const s = state.get(id);
      if (s && (s.lastSeen === null || at > s.lastSeen)) s.lastSeen = at;
    },

    /**
     * One sampler poll: raw counters from /api/agent/sample. Checks the
     * agent's capabilities first (cached like /api/hosts); an agent < 2.5 is
     * "unsupported" and not contacted further. Updates the host's status.
     */
    async sample(id: string): Promise<SampleOutcome> {
      const host = byId.get(id);
      if (!host) return { kind: "bad" };
      await refresh(host);
      const s = state.get(id)!;
      if (s.status === "offline" && now() - s.checkedAt < 1_000) return { kind: "offline" }; // info just failed
      if (s.status === "auth-error" && now() - s.checkedAt < 1_000) return { kind: "auth" };
      if (s.history === "unsupported") return { kind: "unsupported" };
      const out = await agentGet(host, "/api/agent/sample", sampleTimeoutMs);
      if (out.kind === "ok") seen(id);
      else if (out.kind === "offline") s.status = "offline";
      else if (out.kind === "auth") s.status = "auth-error";
      return out;
    },

    /** Forward one allowlisted GET. `rawUrl` is req.originalUrl, before any decoding. */
    async proxy(id: string, rawUrl: string): Promise<{ status: number; body: unknown }> {
      const host = byId.get(id);
      if (!host) return { status: 404, body: { message: "No such host" } };
      const path = agentPathFromHubUrl(rawUrl, id);
      if (!path) return { status: 400, body: { message: "Not an allowed agent path" } };
      const out = await agentGet(host, path, proxyTimeoutMs);
      const s = state.get(id)!;
      switch (out.kind) {
        case "ok":
          seen(id);
          return { status: 200, body: out.body };
        case "auth":
          s.status = "auth-error";
          return { status: 502, body: { auth: true, host: id } };
        case "offline":
          s.status = "offline";
          return { status: 502, body: { offline: true, host: id, lastSeen: iso(s.lastSeen) } };
        default:
          return { status: 502, body: { badResponse: true, host: id } };
      }
    },
  };
}

export type HostHub = ReturnType<typeof createHostHub>;
