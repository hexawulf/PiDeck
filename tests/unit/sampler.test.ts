import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// sampler.ts imports the DB; never touch a real one here.
vi.mock("../../server/db", () => ({ db: { transaction: vi.fn(), insert: vi.fn(), delete: vi.fn() } }));

import { createSampler, createSampleTick, SAMPLE_INTERVAL_MS, samplerEnabled, startSampler } from "../../server/services/sampler";
import { SystemService } from "../../server/services/system";

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createSampler", () => {
  it("ticks every 60s and not before", async () => {
    const tick = vi.fn(async () => {});
    const s = createSampler({ tick, logger: quiet() });
    s.start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS - 1);
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * SAMPLE_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(3);
    s.stop();
  });

  it("never overlaps a slow tick", async () => {
    let active = 0;
    let maxActive = 0;
    const tick = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 150_000)); // 2.5 intervals
      active--;
    });
    const s = createSampler({ tick, logger: quiet() });
    s.start();
    await vi.advanceTimersByTimeAsync(4 * SAMPLE_INTERVAL_MS);
    expect(maxActive).toBe(1);
    expect(tick).toHaveBeenCalledTimes(2); // t=60 (runs to 210), t=120/180 skipped, t=240 runs
    expect(await s.runOnce()).toBe("busy");
    s.stop();
  });

  it("survives a throwing tick, logs each distinct error once, and reports recovery", async () => {
    const logger = quiet();
    let fail = true;
    const tick = vi.fn(async () => { if (fail) throw new Error("db down"); });
    const s = createSampler({ tick, logger });
    s.start();
    await vi.advanceTimersByTimeAsync(3 * SAMPLE_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("[sampler] tick failed:", "db down");
    fail = false;
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(4);
    expect(logger.info).toHaveBeenCalledWith("[sampler] recovered");
    s.stop();
  });

  it("reports a tick that skipped its writes as locked", async () => {
    const s = createSampler({ tick: async () => false, logger: quiet() });
    expect(await s.runOnce()).toBe("locked");
    expect(await createSampler({ tick: async () => {}, logger: quiet() }).runOnce()).toBe("ran");
  });

  it("stops cleanly and can be started only once", async () => {
    const tick = vi.fn(async () => {});
    const s = createSampler({ tick, logger: quiet() });
    s.start();
    s.start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(1);
    s.stop();
    expect(s.started).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5 * SAMPLE_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

describe("enable switch", () => {
  it.each([
    [{ NODE_ENV: "test" }, false],
    [{ NODE_ENV: "production", PIDECK_SAMPLER: "off" }, false],
    [{ NODE_ENV: "development", PIDECK_SAMPLER: "off" }, false],
    [{ NODE_ENV: "production" }, true],
    [{ NODE_ENV: "development", PIDECK_SAMPLER: "on" }, true],
  ])("%j → %s", (env, on) => expect(samplerEnabled(env as NodeJS.ProcessEnv)).toBe(on));

  it("startSampler starts no timer when off", () => {
    expect(startSampler({ NODE_ENV: "production", PIDECK_SAMPLER: "off" } as NodeJS.ProcessEnv, quiet())).toBeNull();
    expect(startSampler({ NODE_ENV: "test" } as NodeJS.ProcessEnv, quiet())).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("createSampleTick", () => {
  const info = { temperature: 42 } as Awaited<ReturnType<typeof SystemService.collectMetrics>>;

  it("checks alerts, then writes and prunes only when it holds the lock", async () => {
    vi.spyOn(SystemService, "collectMetrics").mockResolvedValue(info);
    const alert = vi.spyOn(SystemService, "checkTemperatureAlert").mockImplementation(() => {});
    const insert = vi.spyOn(SystemService, "logHistoricalData").mockResolvedValue();
    const prune = vi.spyOn(SystemService, "pruneHistory").mockResolvedValue();

    const held = createSampleTick(async (fn) => (await fn(), true));
    expect(await held()).toBe(true);
    expect(alert).toHaveBeenCalledWith(42);
    expect(insert).toHaveBeenCalledWith(info);
    expect(prune).toHaveBeenCalledTimes(1);

    const elsewhere = createSampleTick(async () => false);
    expect(await elsewhere()).toBe(false);
    expect(alert).toHaveBeenCalledTimes(2); // alerts are per process, still evaluated
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("evaluates alerts even when the DB lock/transaction fails", async () => {
    vi.spyOn(SystemService, "collectMetrics").mockResolvedValue(info);
    const alert = vi.spyOn(SystemService, "checkTemperatureAlert").mockImplementation(() => {});
    const tick = createSampleTick(async () => { throw new Error("connection refused"); });
    await expect(tick()).rejects.toThrow("connection refused");
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("measures rates against its own baseline, not the client's", async () => {
    const spy = vi.spyOn(SystemService, "collectMetrics").mockResolvedValue(info);
    vi.spyOn(SystemService, "checkTemperatureAlert").mockImplementation(() => {});
    const tick = createSampleTick(async () => true);
    await tick();
    await tick();
    const [a] = spy.mock.calls[0];
    const [b] = spy.mock.calls[1];
    expect(a).toBe(b); // same baseline object across this sampler's ticks
    expect(a).toEqual({ disk: null, net: null });
  });
});
