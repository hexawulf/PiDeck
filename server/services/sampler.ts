/*
 * Hub sampler: one history row per host per minute, and per-host alerts,
 * whether or not a browser is open (docs/plans/multi-host-h2.md).
 * ────────────────────────────────────────────────────────────────────
 *  setInterval 60s ─► tick ─┬─ still running? → skip
 *                           ├─ schema not migrated? → skip (server/db-schema.ts)
 *                           ├─ first tick: load open alerts, seed "last seen" from history
 *                           ├─ poll in parallel, 5 s each, whole poll ≤ 10 s:
 *                           │    local  → readCounters()
 *                           │    agents → GET /api/agent/sample (raw counters)
 *                           │             offline/auth/bad/old agent → no row
 *                           ├─ rates = ratesBetween(previous, current)  (reset → no row)
 *                           └─ advisory lock ours? ─ no → skip writes (other instance)
 *                                 ├─ insert rows, prune rows + resolved alerts > PIDECK_HISTORY_HOURS
 *                                 └─ alerts per host: temperature (> 70 °C), offline (> PIDECK_OFFLINE_ALERT_MINUTES)
 *
 *  Off when NODE_ENV=test or PIDECK_SAMPLER=off (scripts/e2e-server.sh sets
 *  it: the E2E build shares the production database). A failing tick is
 *  logged once per distinct error and never stops the timer.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { schemaReady } from "../db-schema";
import { hubRuntime, type HubRuntime, type LastSample } from "../runtime";
import type { SampleOutcome } from "../hosts";
import { isRawCounters, ratesBetween, readCounters, type RawCounters } from "./counters";
import { historyStore, utcCutoff, type HistoryPoint, type HistoryStore } from "./history";
import { offlineMessage, serviceAlertType, serviceMessage, TEMPERATURE_THRESHOLD, temperatureMessage } from "./alerts";
import { parseCompactServices, type CompactService } from "./systemd";

export const SAMPLE_INTERVAL_MS = 60_000;
/** Arbitrary fixed key for pg_try_advisory_xact_lock ("PiDeck" in ASCII). */
export const SAMPLER_LOCK_KEY = 0x506944656b;
export const HOST_TIMEOUT_MS = 5_000;
export const TICK_BUDGET_MS = 10_000;
/** setInterval drifts: a tick "one minute" later can be a few ms short of it. */
export const OFFLINE_SLACK_MS = 5_000;

type Logger = Pick<Console, "info" | "warn" | "error">;
export type TickResult = "ran" | "busy" | "locked" | "failed";

export interface SamplerOptions {
  /** The work for one tick. Resolve false when it skipped its writes (lock held elsewhere). */
  tick: () => Promise<boolean | void>;
  intervalMs?: number;
  logger?: Logger;
}

export interface Sampler {
  start(): void;
  stop(): void;
  /** One tick now (also what the timer calls). Never rejects. */
  runOnce(): Promise<TickResult>;
  readonly started: boolean;
}

export function createSampler({
  tick,
  intervalMs = SAMPLE_INTERVAL_MS,
  logger = console,
}: SamplerOptions): Sampler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let lastError: string | null = null;

  async function runOnce(): Promise<TickResult> {
    if (running) return "busy";
    running = true;
    try {
      const ran = (await tick()) !== false;
      if (lastError !== null) {
        logger.info("[sampler] recovered");
        lastError = null;
      }
      return ran ? "ran" : "locked";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== lastError) logger.error("[sampler] tick failed:", msg);
      lastError = msg;
      return "failed";
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void runOnce(), intervalMs);
      timer.unref?.(); // never keeps the process alive on its own
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    runOnce,
    get started() {
      return timer !== null;
    },
  };
}

export function samplerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "test" && env.PIDECK_SAMPLER !== "off";
}

/**
 * Transaction-scoped advisory lock: released automatically at commit or
 * rollback, so a crashed tick can't leave it held. Only one instance writes.
 */
export async function withAdvisoryLock(fn: () => Promise<void>): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const rows = (await tx.execute(
      sql`select pg_try_advisory_xact_lock(${SAMPLER_LOCK_KEY}) as locked`,
    )) as unknown as { locked: boolean }[];
    if (!rows[0]?.locked) return false;
    await fn();
    return true;
  });
}

/** What one host's poll produced this tick. "timeout" = over the per-host budget. */
export type Poll = { id: string; outcome: SampleOutcome["kind"] | "timeout"; counters: RawCounters | null };

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => resolve(v), () => resolve(fallback)).finally(() => clearTimeout(t));
  });

export type TickDeps = {
  runtime?: Pick<HubRuntime, "hostHub" | "alerts" | "lastSample" | "historyHours" | "offlineMinutes"> & Partial<Pick<HubRuntime, "serviceMinutes" | "lastServices">>;
  history?: Pick<HistoryStore, "insert" | "prune" | "latestPerHost">;
  readLocal?: () => Promise<RawCounters>;
  withLock?: (fn: () => Promise<void>) => Promise<boolean>;
  isReady?: () => boolean;
  now?: () => number;
  logger?: Logger;
  hostTimeoutMs?: number;
  tickBudgetMs?: number;
};

/** The production tick for every host. Each host keeps its own previous counters. */
export function createSampleTick({
  runtime = hubRuntime(),
  history = historyStore,
  readLocal = () => readCounters(),
  withLock = withAdvisoryLock,
  isReady = schemaReady,
  now = Date.now,
  logger = console,
  hostTimeoutMs = HOST_TIMEOUT_MS,
  tickBudgetMs = TICK_BUDGET_MS,
}: TickDeps = {}) {
  const { hostHub, alerts, lastSample } = runtime;
  const prev = new Map<string, RawCounters>();
  const failingSince = new Map<string, number>(); // first failed poll of the current streak
  const serviceDownSince = new Map<string, number>(); // host \0 alert type → first non-ok sample of the streak
  const serviceMinutes = runtime.serviceMinutes ?? 3;
  const lastServices = runtime.lastServices ?? new Map<string, CompactService[]>();
  let seeded = false;

  async function pollOne(id: string): Promise<Poll> {
    if (id === "local") return { id, outcome: "ok", counters: await readLocal() };
    const out = await hostHub.sample(id);
    if (out.kind !== "ok") return { id, outcome: out.kind, counters: null };
    return isRawCounters(out.body) ? { id, outcome: "ok", counters: out.body } : { id, outcome: "bad", counters: null };
  }

  async function evaluateAlerts(p: Poll, t: number) {
    // Temperature: only when this tick read the host; otherwise unknown (no change).
    const temp = p.counters?.temperature;
    await alerts.evaluate(p.id, "temperature", p.counters ? typeof temp === "number" && temp > TEMPERATURE_THRESHOLD : null, {
      severity: "warning",
      message: typeof temp === "number" ? temperatureMessage(temp) : "",
    });
    await evaluateServiceAlerts(p, t);
    if (p.id === "local") return;
    // Offline: unreachable for longer than PIDECK_OFFLINE_ALERT_MINUTES. A wrong
    // token, a bad answer or an old agent is *not* offline (it has its own
    // status). After a restart nothing is known about the past, so the clock
    // starts at the first failed poll: no alert before a full N minutes.
    if (p.outcome === "offline" || p.outcome === "timeout") {
      const since = failingSince.get(p.id) ?? t;
      failingSince.set(p.id, since);
      const overdue = t - since >= runtime.offlineMinutes * 60_000 - OFFLINE_SLACK_MS;
      const lastSeen = hostHub.lastSeenAt(p.id);
      const from = new Date(lastSeen !== null && lastSeen < since ? lastSeen : since);
      await alerts.evaluate(p.id, "offline", overdue ? true : null, { severity: "critical", message: offlineMessage(from), startedAt: from });
    } else {
      failingSince.delete(p.id);
      await alerts.evaluate(p.id, "offline", false, { severity: "critical", message: "" });
    }
  }

  /**
   * service:<unit> alerts (2.8): only units the host lists in PIDECK_SERVICES.
   * Opens after PIDECK_SERVICE_ALERT_MINUTES of consecutive non-ok samples,
   * resolves on the first ok one. No sample (offline host) or no `services`
   * in it (agent < 2.8, no systemd) → nothing changes: offline covers the
   * first, and the second simply has no service alerts.
   */
  async function evaluateServiceAlerts(p: Poll, t: number) {
    const services = p.counters ? parseCompactServices(p.counters.services) : null;
    if (!services) return;
    const listedTypes = new Set<string>();
    for (const s of services) {
      if (!s.listed) continue;
      const type = serviceAlertType(s.unit, s.user);
      listedTypes.add(type);
      const key = `${p.id}\u0000${type}`;
      if (s.health === "ok") {
        serviceDownSince.delete(key);
        await alerts.evaluate(p.id, type, false, { severity: "warning", message: "" });
        continue;
      }
      if (s.health === "unknown") continue; // e.g. the user manager isn't reachable: no change
      const since = serviceDownSince.get(key) ?? t;
      serviceDownSince.set(key, since);
      const overdue = t - since >= serviceMinutes * 60_000 - OFFLINE_SLACK_MS;
      const startedAt = s.since && Date.parse(s.since) <= since ? new Date(s.since) : new Date(since);
      await alerts.evaluate(p.id, type, overdue ? true : null, { severity: s.health === "fail" ? "critical" : "warning", message: serviceMessage(s), startedAt });
    }
    // A unit taken off the list: its open alert resolves.
    for (const a of alerts.openAlerts(p.id)) {
      if (a.type.startsWith("service:") && !listedTypes.has(a.type)) {
        serviceDownSince.delete(`${p.id}\u0000${a.type}`);
        await alerts.evaluate(p.id, a.type, false, { severity: a.severity, message: "" });
      }
    }
  }

  return async (): Promise<boolean> => {
    if (!isReady()) return false; // pending migrations: no DB work (see server/db-schema.ts)
    if (!seeded) {
      await alerts.load(); // open alerts survive a restart
      for (const [id, p] of await history.latestPerHost()) hostHub.seedLastSeen(id, Date.parse(p.timestamp));
      seeded = true;
    }

    // Poll everyone in parallel; one slow host never delays the others.
    const ids = ["local", ...hostHub.entries().map((h) => h.id)];
    const timeoutOf = (id: string) => hostHub.entries().find((h) => h.id === id)?.timeoutMs ?? hostTimeoutMs; // PIDECK_HOST_TIMEOUT_<ID>
    const settled = new Map<string, Poll>();
    await withTimeout(
      Promise.all(ids.map((id) =>
        withTimeout(pollOne(id), timeoutOf(id), { id, outcome: "timeout", counters: null } as Poll).then((p) => settled.set(id, p)),
      )),
      tickBudgetMs,
      undefined,
    );
    const polls = ids.map((id) => settled.get(id) ?? ({ id, outcome: "timeout", counters: null } as Poll));
    const slow = polls.filter((p) => p.outcome === "timeout").map((p) => p.id);
    if (slow.length) logger.warn(`[sampler] skipped (no answer in time): ${slow.map((id) => `${id} (${timeoutOf(id) / 1000} s)`).join(", ")}`);

    const t = now();
    const at = new Date(t).toISOString();
    const points: HistoryPoint[] = [];
    for (const p of polls) {
      if (!p.counters) continue;
      const svc = parseCompactServices(p.counters.services);
      if (svc) lastServices.set(p.id, svc);
      else lastServices.delete(p.id); // agent < 2.8 or no systemd
      const rates = ratesBetween(prev.get(p.id) ?? null, p.counters);
      prev.set(p.id, p.counters);
      if (!rates) continue; // first sample, reboot or counter reset: this interval is dropped
      points.push({
        hostId: p.id, timestamp: at, cpuUsage: rates.cpu, memoryUsage: rates.memory, temperature: rates.temperature,
        diskReadSpeed: rates.diskReadKBs, diskWriteSpeed: rates.diskWriteKBs, networkRx: rates.rxKBs, networkTx: rates.txKBs,
      });
      const last: LastSample = {
        at, cpu: rates.cpu, memory: rates.memory, temperature: rates.temperature, diskUsage: p.counters.diskUsage,
        diskReadKBs: rates.diskReadKBs, diskWriteKBs: rates.diskWriteKBs, rxKBs: rates.rxKBs, txKBs: rates.txKBs,
      };
      lastSample.set(p.id, last);
    }

    return withLock(async () => {
      await history.insert(points);
      const keepMs = runtime.historyHours * 3_600_000;
      await history.prune(utcCutoff(keepMs, t)); // UTC ISO cutoff computed here, never now() in SQL
      await alerts.pruneResolved(new Date(t - keepMs));
      for (const p of polls) await evaluateAlerts(p, t);
    });
  };
}

/** Start the production sampler unless disabled. Returns null when off. */
export function startSampler(env: NodeJS.ProcessEnv = process.env, logger: Logger = console): Sampler | null {
  if (!samplerEnabled(env)) {
    logger.info("[sampler] disabled (NODE_ENV=test or PIDECK_SAMPLER=off)");
    return null;
  }
  const rt = hubRuntime();
  const sampler = createSampler({ tick: createSampleTick({ runtime: rt, logger }), logger });
  sampler.start();
  void sampler.runOnce(); // first counters now, so the first rows land one minute after start
  logger.info(`[sampler] sampling every ${SAMPLE_INTERVAL_MS / 1000}s: local + ${rt.hostHub.entries().length} agent(s); history kept ${rt.historyHours} h`);
  return sampler;
}
