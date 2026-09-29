// The hub sampler for every host (docs/plans/multi-host-h2.md): one row per
// host per minute, per-host alerts incl. offline, restarts, slow hosts.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ getDb: () => { throw new Error("no DB in this test"); } }));

import { createHostHub } from "../../server/hosts";
import { createAlertManager, memoryAlertStore, type Alert } from "../../server/services/alerts";
import type { RawCounters } from "../../server/services/counters";
import type { HistoryPoint } from "../../server/services/history";
import { createSampleTick } from "../../server/services/sampler";
import type { LastSample } from "../../server/runtime";

const TOKEN = "0123456789abcdef0123456789abcdef";
const MIN = 60_000;
const T0 = Date.parse("2026-09-29T00:00:00Z");

const counters = (n: number, over: Partial<RawCounters> = {}): RawCounters => ({
  sampledAt: new Date(T0 + n * MIN).toISOString(),
  bootId: "boot",
  hostname: "h",
  cpu: { total: 100_000 + n * 6000, idle: 80_000 + n * 4500 }, // 25 % busy
  disk: { readSectors: n * 7200, writeSectors: n * 14400 }, // 60 / 120 KB/s
  net: { rxBytes: n * 61440, txBytes: n * 12288 }, // 1 / 0.2 KB/s
  memory: { totalMb: 8000, usedMb: 2000, percentage: 25 },
  temperature: 50,
  diskUsage: 40,
  ...over,
});

type Fleet = Record<string, "good" | "old" | "badtoken" | "down" | "slow">;

function setup(fleet: Fleet, { offlineMinutes = 5, store = memoryAlertStore(), latest = new Map<string, HistoryPoint>(), agentTimeoutMs = 40 } = {}) {
  let clock = T0;
  let tickNo = 0;
  const agentTemp: Record<string, number> = {};
  const agentBoot: Record<string, string> = {};
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const host = new URL(url).hostname;
    const kind = fleet[host];
    if (kind === "down") throw new TypeError("connect ECONNREFUSED");
    if (kind === "slow") return new Promise<Response>((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))));
    if (kind === "badtoken") return new Response('{"message":"Unauthorized"}', { status: 401 });
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/agent/info")) {
      return json({ version: kind === "old" ? "2.4.0" : "2.5.0", hostname: host, capabilities: kind === "old" ? { read: true } : { read: true, sample: true } });
    }
    if (url.endsWith("/api/agent/sample")) {
      return json(counters(tickNo, { temperature: agentTemp[host] ?? 50, bootId: agentBoot[host] ?? "boot" }));
    }
    return new Response("", { status: 404 });
  });
  const hosts = Object.keys(fleet).map((id) => ({ id, label: id.toUpperCase(), url: `http://${id}:5016`, token: TOKEN }));
  const hostHub = createHostHub({ hosts, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => clock, infoTimeoutMs: agentTimeoutMs, sampleTimeoutMs: agentTimeoutMs, cacheMs: 0 });
  const alerts = createAlertManager({ store, now: () => new Date(clock) });
  const rows: HistoryPoint[] = [];
  const history = {
    insert: vi.fn(async (p: HistoryPoint[]) => void rows.push(...p)),
    prune: vi.fn(async (_cutoff: string) => {}),
    latestPerHost: vi.fn(async () => latest),
  };
  const lastSample = new Map<string, LastSample>();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const lock = { held: true };
  const tick = createSampleTick({
    runtime: { hostHub, alerts, lastSample, historyHours: 24, offlineMinutes },
    history,
    readLocal: async () => counters(tickNo, { temperature: agentTemp.local ?? 45 }),
    withLock: async (fn) => (lock.held ? (await fn(), true) : false),
    isReady: () => true,
    now: () => clock,
    logger,
    hostTimeoutMs: 60,
    tickBudgetMs: 200,
  });
  const run = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      await tick();
      tickNo++;
      clock += MIN;
    }
  };
  const advance = (ms: number) => void (clock += ms);
  return { run, advance, tick, rows, history, alerts, store, hostHub, lastSample, logger, lock, agentTemp, agentBoot, fetchImpl, clock: () => clock };
}

const open = (s: { store: { rows: Alert[] } }, type?: string) => s.store.rows.filter((a) => !a.resolvedAt && (!type || a.type === type));

describe("hub sampler: history for every host", () => {
  it("writes one row per reachable host per minute, from the second tick on", async () => {
    const s = setup({ good: "good" });
    await s.run(1);
    expect(s.rows).toEqual([]); // first counters only
    await s.run(2);
    expect(s.rows.map((r) => r.hostId)).toEqual(["local", "good", "local", "good"]);
    expect(s.rows[0]).toMatchObject({ cpuUsage: 25, diskReadSpeed: 60, diskWriteSpeed: 120, networkRx: 1, memoryUsage: 25 });
    expect(s.rows[0].timestamp).toMatch(/Z$/); // UTC ISO, never local time
    expect(s.lastSample.get("good")).toMatchObject({ cpu: 25, diskUsage: 40 });
    expect(s.history.prune).toHaveBeenLastCalledWith(new Date(s.clock() - MIN - 24 * 3_600_000).toISOString());
  });

  it("an agent < 2.5 is skipped (history unsupported), never sampled, and not offline", async () => {
    const s = setup({ old: "old" }, { offlineMinutes: 1 });
    await s.run(4);
    expect(s.rows.every((r) => r.hostId === "local")).toBe(true);
    expect(s.fetchImpl.mock.calls.some(([u]) => String(u).endsWith("/api/agent/sample"))).toBe(false);
    expect((await s.hostHub.list()).find((h) => h.id === "old")).toMatchObject({ status: "online", history: "unsupported" });
    expect(open(s)).toEqual([]);
  });

  it("a wrong token is not offline: no rows, no offline alert, however long", async () => {
    const s = setup({ badtoken: "badtoken" }, { offlineMinutes: 1 });
    await s.run(10);
    expect(s.rows.some((r) => r.hostId === "badtoken")).toBe(false);
    expect(open(s, "offline")).toEqual([]);
    expect((await s.hostHub.list()).find((h) => h.id === "badtoken")?.status).toBe("auth-error");
  });

  it("drops the interval when an agent reboots (boot id changes)", async () => {
    const s = setup({ good: "good" });
    await s.run(2);
    s.agentBoot.good = "boot-2";
    await s.run(1);
    await s.run(1);
    expect(s.rows.filter((r) => r.hostId === "good")).toHaveLength(2); // tick 2 and 4, not 3
  });

  it("one slow host never delays the others; it is logged as skipped", async () => {
    // The agent's own timeouts are longer than the sampler's per-host budget,
    // so the sampler gives up first ("timeout", not "offline").
    const s = setup({ good: "good", slow: "slow" }, { agentTimeoutMs: 500 });
    const started = Date.now();
    await s.run(2);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(s.rows.map((r) => r.hostId)).toEqual(["local", "good"]);
    expect(s.logger.warn).toHaveBeenCalledWith(expect.stringMatching(/skipped .*: slow/));
  });

  it("no lock → no writes and no alert changes (another instance does them)", async () => {
    const s = setup({ good: "good" });
    s.lock.held = false;
    s.agentTemp.good = 90;
    await s.run(3);
    expect(s.history.insert).not.toHaveBeenCalled();
    expect(s.store.rows).toEqual([]);
  });
});

describe("hub sampler: alerts per host", () => {
  it("temperature alert opens for the hot host only (named by host), updates, resolves", async () => {
    const s = setup({ good: "good" });
    await s.run(1);
    s.agentTemp.good = 75;
    await s.run(1);
    expect(open(s)).toEqual([expect.objectContaining({ hostId: "good", type: "temperature", severity: "warning", message: "Temperature above 70 °C (75.0 °C)" })]);
    s.agentTemp.good = 78;
    await s.run(1);
    expect(open(s)[0].message).toBe("Temperature above 70 °C (78.0 °C)");
    s.agentTemp.good = 60;
    await s.run(1);
    expect(open(s)).toEqual([]);
    expect(s.store.rows[0].resolvedAt).not.toBeNull();
  });

  it("offline alert after N minutes of continuous failure, since the last seen time; resolves when back", async () => {
    const fleet: Fleet = { flaky: "good" };
    const s = setup(fleet, { offlineMinutes: 5 });
    await s.run(2); // seen at T0+1min
    const lastSeen = s.hostHub.lastSeenAt("flaky")!;
    fleet.flaky = "down";
    await s.run(5); // failing 0..4 minutes
    expect(open(s, "offline")).toEqual([]);
    await s.run(1); // 5 minutes of failures
    expect(open(s, "offline")).toEqual([expect.objectContaining({ hostId: "flaky", severity: "critical", startedAt: new Date(lastSeen) })]);
    await s.run(3);
    expect(s.store.rows.filter((a) => a.type === "offline")).toHaveLength(1); // no duplicates
    fleet.flaky = "good";
    await s.run(1);
    expect(open(s, "offline")).toEqual([]);
  });

  it("offline fires on the tick N minutes after the first failure even when the timer runs a little early", async () => {
    const s = setup({ gone: "down" }, { offlineMinutes: 1 });
    await s.tick(); // first failed poll
    s.advance(MIN - 40); // setInterval drift
    await s.tick();
    expect(open(s, "offline")).toEqual([expect.objectContaining({ hostId: "gone" })]);
  });

  it("after a hub restart: no offline alert for a host it hasn't polled for N minutes yet", async () => {
    const s = setup({ gone: "down" }, { offlineMinutes: 5 });
    await s.run(4);
    expect(open(s)).toEqual([]);
  });

  it("after a hub restart: an open alert from before is loaded, kept while still offline, resolved when back", async () => {
    const fleet: Fleet = { gone: "down" };
    const before: Alert = {
      id: 7, hostId: "gone", type: "offline", severity: "critical", message: "Not answering since …",
      startedAt: new Date(T0 - 60 * MIN), resolvedAt: null,
    };
    const store = memoryAlertStore([before]);
    const s = setup(fleet, { store, latest: new Map([["gone", { hostId: "gone", timestamp: new Date(T0 - 61 * MIN).toISOString() } as HistoryPoint]]) });
    await s.run(2);
    expect(s.alerts.openAlerts("gone")).toEqual([expect.objectContaining({ id: 7 })]); // survived the restart
    expect(store.rows).toHaveLength(1);
    expect(s.hostHub.lastSeenAt("gone")).toBe(T0 - 61 * MIN); // seeded from history
    fleet.gone = "good";
    await s.run(1);
    expect(open(s)).toEqual([]);
  });

  it("local host: temperature only (never 'offline')", async () => {
    const s = setup({});
    s.agentTemp.local = 72;
    await s.run(2);
    expect(open(s)).toEqual([expect.objectContaining({ hostId: "local", type: "temperature" })]);
  });
});

describe("alert manager", () => {
  it("open → update → resolve; unknown changes nothing; state survives a new manager (restart)", async () => {
    const store = memoryAlertStore();
    let t = T0;
    const m1 = createAlertManager({ store, now: () => new Date(t) });
    await m1.load();
    expect(await m1.evaluate("p2", "temperature", true, { severity: "warning", message: "a" })).toBe("opened");
    expect(await m1.evaluate("p2", "temperature", true, { severity: "warning", message: "a" })).toBe("none");
    expect(await m1.evaluate("p2", "temperature", true, { severity: "warning", message: "b" })).toBe("updated");
    expect(await m1.evaluate("p2", "temperature", null, { severity: "warning", message: "c" })).toBe("none");
    const m2 = createAlertManager({ store, now: () => new Date(t) }); // the hub restarted
    await m2.load();
    expect(m2.openAlerts()).toEqual([expect.objectContaining({ hostId: "p2", message: "b" })]);
    t += MIN;
    expect(await m2.evaluate("p2", "temperature", false, { severity: "warning", message: "" })).toBe("resolved");
    expect(store.rows[0].resolvedAt).toEqual(new Date(T0 + MIN));
    await m2.pruneResolved(new Date(T0 + 2 * MIN));
    expect(store.rows).toEqual([]);
  });
});
