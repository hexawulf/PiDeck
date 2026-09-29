import { describe, expect, it } from "vitest";
import { isRawCounters, MAX_INTERVAL_S, ratesBetween, readCounters, type RawCounters } from "../../server/services/counters";

const base: RawCounters = {
  sampledAt: "2026-09-29T00:00:00.000Z",
  bootId: "boot-a",
  hostname: "piapps2",
  cpu: { total: 100_000, idle: 80_000 },
  disk: { readSectors: 1_000, writeSectors: 2_000 },
  net: { rxBytes: 1_000_000, txBytes: 500_000 },
  memory: { totalMb: 8000, usedMb: 2000, percentage: 25 },
  temperature: 51.5,
  diskUsage: 40,
};
const later = (over: Partial<RawCounters>, seconds = 60): RawCounters => ({
  ...base,
  sampledAt: new Date(Date.parse(base.sampledAt) + seconds * 1000).toISOString(),
  ...over,
});

describe("ratesBetween (one-minute averages from raw counters)", () => {
  it("computes CPU %, disk and network KB/s over the interval", () => {
    const r = ratesBetween(base, later({
      cpu: { total: 106_000, idle: 84_500 }, // 6000 jiffies, 4500 idle → 25 %
      disk: { readSectors: 1_000 + 120 * 60, writeSectors: 2_000 + 240 * 60 }, // 120/240 sectors/s = 60/120 KB/s
      net: { rxBytes: 1_000_000 + 1024 * 10 * 60, txBytes: 500_000 + 1024 * 2 * 60 }, // 10 / 2 KB/s
      memory: { totalMb: 8000, usedMb: 4000, percentage: 50 },
      temperature: 60,
    }));
    expect(r).toEqual({ cpu: 25, diskReadKBs: 60, diskWriteKBs: 120, rxKBs: 10, txKBs: 2, memory: 50, temperature: 60, seconds: 60 });
  });

  it("drops the interval on a counter reset or wrap (never a negative rate)", () => {
    expect(ratesBetween(base, later({ net: { rxBytes: 10, txBytes: 600_000 } }))).toBeNull();
    expect(ratesBetween(base, later({ disk: { readSectors: 0, writeSectors: 5_000 } }))).toBeNull();
    expect(ratesBetween(base, later({ cpu: { total: 50, idle: 10 } }))).toBeNull();
  });

  it("drops the interval across a reboot (boot id changes) even if counters happen to be higher", () => {
    expect(ratesBetween(base, later({ bootId: "boot-b", cpu: { total: 999_999, idle: 1 } }))).toBeNull();
  });

  it("needs a previous sample, forward time and a sane gap", () => {
    expect(ratesBetween(null, base)).toBeNull();
    expect(ratesBetween(base, later({}, 0))).toBeNull();
    expect(ratesBetween(base, later({}, -60))).toBeNull();
    expect(ratesBetween(base, later({}, MAX_INTERVAL_S + 1))).toBeNull();
    expect(ratesBetween(base, later({}, 120))?.seconds).toBe(120); // a missed tick still averages
  });

  it("a part that couldn't be read is null, the rest still counts", () => {
    const r = ratesBetween({ ...base, disk: null }, later({ disk: null, net: { rxBytes: 1_000_000 + 60 * 1024, txBytes: 500_000 } }));
    expect(r).toMatchObject({ diskReadKBs: null, diskWriteKBs: null, rxKBs: 1, txKBs: 0 });
  });
});

describe("isRawCounters (the hub trusts nothing an agent sends)", () => {
  it("accepts a real sample", () => expect(isRawCounters(base)).toBe(true));
  it.each([
    ["null", null],
    ["no time", { ...base, sampledAt: "yesterday" }],
    ["negative counter", { ...base, net: { rxBytes: -1, txBytes: 0 } }],
    ["string counter", { ...base, cpu: { total: "1", idle: 0 } }],
    ["bad memory", { ...base, memory: { percentage: "x" } }],
    ["bad boot id", { ...base, bootId: 42 }],
  ])("rejects %s", (_n, x) => expect(isRawCounters(x)).toBe(false));
});

describe("readCounters on this machine", () => {
  it("reads plausible counters from /proc and /sys", async () => {
    const c = await readCounters();
    expect(isRawCounters(c)).toBe(true);
    expect(c.cpu!.total).toBeGreaterThan(c.cpu!.idle);
    expect(c.memory!.percentage).toBeGreaterThanOrEqual(0);
    expect(c.diskUsage).toBeGreaterThanOrEqual(0);
    const again = await readCounters();
    expect(ratesBetween(c, { ...again, sampledAt: new Date(Date.parse(c.sampledAt) + 1000).toISOString() })).not.toBeNull();
  });
});
