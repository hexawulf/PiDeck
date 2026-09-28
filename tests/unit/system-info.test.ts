import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ insert: vi.fn(), delete: vi.fn(), select: vi.fn(), transaction: vi.fn() }));
vi.mock("../../server/db", () => ({ getDb: () => db }));

import { createRateBaseline, SystemService } from "../../server/services/system";

// Replace every collector so no shell commands run.
function stubCollectors(temperature: number) {
  const S = SystemService as any;
  const stubs: Record<string, unknown> = {
    getHostname: "pi", getOS: "Ubuntu", getKernel: "6.8", getArchitecture: "aarch64", getUptime: "1 day",
    getCPUUsage: 12, getMemoryUsage: { used: 1, total: 2, percentage: 50 }, getTemperature: temperature,
    getIPAddress: "10.0.0.2", getDiskIO: { readSpeed: 1, writeSpeed: 2, utilization: 0 },
    getNetworkBandwidth: { rx: 3, tx: 4 }, getProcessList: [],
  };
  for (const [name, value] of Object.entries(stubs)) vi.spyOn(S, name).mockResolvedValue(value);
}

afterEach(() => {
  SystemService.checkTemperatureAlert(0); // clear alert state
  vi.clearAllMocks();
});

describe("getSystemInfo is read-only", () => {
  it("does not write history or raise alerts, even when hot", async () => {
    stubCollectors(95);
    const info = await SystemService.getSystemInfo();
    await new Promise((r) => setTimeout(r, 0)); // the old code wrote history un-awaited
    expect(info.temperature).toBe(95);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(SystemService.getActiveAlerts()).toEqual([]);
  });
});

describe("sampler building blocks", () => {
  it("checkTemperatureAlert raises above 70°C and clears below", () => {
    SystemService.checkTemperatureAlert(75);
    expect(SystemService.getActiveAlerts()).toHaveLength(1);
    SystemService.checkTemperatureAlert(60);
    expect(SystemService.getActiveAlerts()).toEqual([]);
  });

  it("logHistoricalData inserts one rounded row and propagates DB errors", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    db.insert.mockReturnValue({ values });
    stubCollectors(51.6);
    const info = await SystemService.collectMetrics(createRateBaseline());
    await SystemService.logHistoricalData(info);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ temperature: 52, cpuUsage: 12, networkTx: 4 }));

    values.mockRejectedValueOnce(new Error("db down"));
    await expect(SystemService.logHistoricalData(info)).rejects.toThrow("db down");
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
