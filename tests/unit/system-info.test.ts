import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ insert: vi.fn(), delete: vi.fn(), select: vi.fn(), transaction: vi.fn() }));
vi.mock("../../server/db", () => ({ getDb: () => db }));

import { createRateBaseline, SystemService } from "../../server/services/system";

// Replace every collector so no shell commands run.
function stubCollectors(temperature: number) {
  const S = SystemService as any;
  const stubs: Record<string, unknown> = {
    getHostname: "pi", getOS: "Ubuntu", getKernel: "6.8", getArchitecture: "aarch64", getUptime: "1 day",
    getCPUUsage: 12, getMemoryUsage: { used: 1, total: 2, percentage: 50 }, readTemperature: temperature,
    getIPAddress: "10.0.0.2", getDiskIO: { readSpeed: 1, writeSpeed: 2, utilization: 0 },
    getNetworkBandwidth: { rx: 3, tx: 4 }, getProcessList: [],
  };
  for (const [name, value] of Object.entries(stubs)) vi.spyOn(S, name).mockResolvedValue(value);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("getSystemInfo is read-only", () => {
  // Alerts and history are the hub sampler's job now (tests/unit/hub-sampler.test.ts).
  it("does not write history, even when hot", async () => {
    stubCollectors(95);
    const info = await SystemService.getSystemInfo();
    await new Promise((r) => setTimeout(r, 0)); // the old code wrote history un-awaited
    expect(info.temperature).toBe(95);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });
});

describe("rate baselines", () => {
  it("are independent per caller", async () => {
    const S = SystemService as any;
    const a = createRateBaseline();
    const b = createRateBaseline();
    await S.getNetworkBandwidth(a); // first call primes, waits 500ms, re-reads (real /sys or /proc)
    expect(a.net).not.toBeNull();
    expect(b.net).toBeNull();
    await S.getNetworkBandwidth(b);
    expect(b.net).not.toBe(a.net);
  });
});
