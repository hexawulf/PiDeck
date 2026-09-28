/*
 * Server-side sampler: one history row + temperature-alert check per minute,
 * whether or not a browser is open.
 * ────────────────────────────────────────────────────────────────────
 *  setInterval 60s ─► tick ─┬─ still running? → skip
 *                           └─ collectMetrics(own rate baseline)
 *                                ├─ checkTemperatureAlert   (per process, no DB)
 *                                └─ advisory lock ours? ─ no → skip writes (other instance)
 *                                      ├─ insert history row
 *                                      └─ prune rows > 24h
 *
 *  Off when NODE_ENV=test or PIDECK_SAMPLER=off (scripts/e2e-server.sh sets
 *  it: the E2E build shares the production database). A failing tick is
 *  logged once per distinct error and never stops the timer.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { createRateBaseline, SystemService } from "./system";

export const SAMPLE_INTERVAL_MS = 60_000;
/** Arbitrary fixed key for pg_try_advisory_xact_lock ("PiDeck" in ASCII). */
export const SAMPLER_LOCK_KEY = 0x506944656b;

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
 * rollback, so a crashed tick can't leave it held. Only one instance samples.
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

/**
 * The production tick. Own rate baseline, so client polls don't skew it.
 * Alerts live in each process's memory, so every instance evaluates them,
 * before any DB work (they keep working if Postgres is down); only the
 * history writes are behind the lock.
 */
export function createSampleTick(withLock: (fn: () => Promise<void>) => Promise<boolean> = withAdvisoryLock) {
  const baseline = createRateBaseline();
  return async (): Promise<boolean> => {
    const info = await SystemService.collectMetrics(baseline);
    SystemService.checkTemperatureAlert(info.temperature);
    return withLock(async () => {
      await SystemService.logHistoricalData(info);
      await SystemService.pruneHistory();
    });
  };
}

/** Start the production sampler unless disabled. Returns null when off. */
export function startSampler(env: NodeJS.ProcessEnv = process.env, logger: Logger = console): Sampler | null {
  if (!samplerEnabled(env)) {
    logger.info("[sampler] disabled (NODE_ENV=test or PIDECK_SAMPLER=off)");
    return null;
  }
  const sampler = createSampler({ tick: createSampleTick(), logger });
  sampler.start();
  logger.info(`[sampler] sampling every ${SAMPLE_INTERVAL_MS / 1000}s`);
  return sampler;
}
