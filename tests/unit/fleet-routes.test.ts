// Hub APIs for every host: /api/history, /api/alerts, /api/overview and the
// 2.4 local aliases (docs/plans/multi-host-h2.md › API).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../server/db", () => ({ getDb: () => { throw new Error("no DB in this test"); } }));

import { createHostHub } from "../../server/hosts";
import { createAlertManager, memoryAlertStore } from "../../server/services/alerts";
import type { HistoryPoint } from "../../server/services/history";
import { registerFleetRoutes } from "../../server/routes/fleet";
import type { LastSample } from "../../server/runtime";

const TOKEN = "0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-09-29T04:00:00Z");
const MIN = 60_000;

const fetchImpl = vi.fn(async (url: string) => {
  const host = new URL(url).hostname;
  if (host === "down") throw new TypeError("connect ECONNREFUSED");
  if (host === "badtoken") return new Response('{"message":"Unauthorized"}', { status: 401 });
  const old = host === "old";
  return new Response(JSON.stringify({ version: old ? "2.4.0" : "2.5.0", hostname: host, capabilities: old ? { read: true } : { read: true, sample: true } }), {
    headers: { "content-type": "application/json" },
  });
});
const hostHub = createHostHub({
  hosts: ["p2", "down", "badtoken", "old"].map((id) => ({ id, label: id === "p2" ? "piapps2" : id, url: `http://${id}:5016`, token: TOKEN })),
  fetchImpl: fetchImpl as unknown as typeof fetch,
  now: () => NOW,
  cacheMs: 0,
});
const store = memoryAlertStore();
const alerts = createAlertManager({ store, now: () => new Date(NOW) });
const lastSample = new Map<string, LastSample>([
  ["p2", { at: new Date(NOW).toISOString(), cpu: 12, memory: 34, temperature: 56, diskUsage: 78, diskReadKBs: 1, diskWriteKBs: 2, rxKBs: 3, txKBs: 4 }],
]);
const range = vi.fn(async (_host: string, _since: string) => [{ id: 1, timestamp: "2026-09-29 03:59:00", cpuUsage: 5 }]);
const latestPerHost = vi.fn(async () => new Map<string, HistoryPoint>([
  ["local", { hostId: "local", timestamp: new Date(NOW - MIN).toISOString(), cpuUsage: 9, memoryUsage: 8, temperature: 47, diskReadSpeed: 0, diskWriteSpeed: 0, networkRx: 1, networkTx: 2 }],
]));

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  const requireAuth: RequestHandler = (req, res, next) => (req.headers["x-auth"] === "yes" ? next() : res.status(401).json({ message: "Authentication required" }));
  registerFleetRoutes(app, requireAuth, { hostHub, alerts, lastSample, historyHours: 6 }, { history: { range, latestPerHost } as never, now: () => NOW });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await alerts.load();
  await alerts.evaluate("p2", "temperature", true, { severity: "warning", message: "Temperature above 70 °C (75.0 °C)" });
  await alerts.evaluate("local", "temperature", true, { severity: "warning", message: "Temperature above 70 °C (71.0 °C)" });
  await alerts.evaluate("down", "offline", true, { severity: "critical", message: "gone", startedAt: new Date(NOW - 9 * MIN) });
});
afterAll(() => new Promise((r) => server.close(r)));

const get = async (path: string, auth = true) => {
  const res = await fetch(base + path, { headers: auth ? { "x-auth": "yes" } : {} });
  return { status: res.status, body: await res.json() };
};

describe("fleet APIs", () => {
  it("all need a session", async () => {
    for (const p of ["/api/history?host=p2", "/api/system/history", "/api/alerts", "/api/system/alerts", "/api/overview"]) {
      expect((await get(p, false)).status).toBe(401);
    }
  });

  it("/api/history: per host, cutoff = min(range, retention) as a UTC ISO string", async () => {
    expect(await get("/api/history?host=p2&range=1h")).toMatchObject({ status: 200, body: [{ id: 1, cpuUsage: 5 }] });
    expect(range).toHaveBeenLastCalledWith("p2", new Date(NOW - 60 * MIN).toISOString());
    await get("/api/history?host=p2&range=24h"); // retention is 6 h here
    expect(range).toHaveBeenLastCalledWith("p2", new Date(NOW - 6 * 60 * MIN).toISOString());
    await get("/api/history");
    expect(range.mock.lastCall![0]).toBe("local");
  });

  it("/api/history: 404 unknown host, 400 bad range", async () => {
    expect((await get("/api/history?host=nope")).status).toBe(404);
    expect((await get("/api/history?host=p2&range=7d")).status).toBe(400);
    expect((await get("/api/history?host=p2&host=x")).status).toBe(404); // repeated param is not a string
  });

  it("/api/system/history: the hub's own rows, full retention (2.4 alias)", async () => {
    expect((await get("/api/system/history")).status).toBe(200);
    expect(range).toHaveBeenLastCalledWith("local", new Date(NOW - 6 * 60 * MIN).toISOString());
  });

  it("/api/alerts?host=all names every host", async () => {
    const { status, body } = await get("/api/alerts?host=all");
    expect(status).toBe(200);
    expect(body.map((a: { hostId: string; hostLabel: string }) => [a.hostId, a.hostLabel]).sort()).toEqual([
      ["down", "down"], ["local", expect.any(String)], ["p2", "piapps2"],
    ]);
    expect(body.find((a: { hostId: string }) => a.hostId === "down")).toMatchObject({ type: "offline", severity: "critical", startedAt: new Date(NOW - 9 * MIN).toISOString(), resolvedAt: null });
  });

  it("/api/alerts?host=<id> filters; unknown host → 404; recently resolved ones are listed", async () => {
    expect((await get("/api/alerts?host=p2")).body).toHaveLength(1);
    expect((await get("/api/alerts?host=zzz")).status).toBe(404);
    await alerts.evaluate("p2", "temperature", false, { severity: "warning", message: "" });
    const { body } = await get("/api/alerts?host=p2");
    expect(body).toEqual([expect.objectContaining({ hostLabel: "piapps2", resolvedAt: new Date(NOW).toISOString() })]);
  });

  it("/api/system/alerts: local open alerts in the 2.4 shape", async () => {
    const { body } = await get("/api/system/alerts");
    expect(body).toEqual([{ id: expect.any(String), message: "Temperature above 70 °C (71.0 °C)", timestamp: new Date(NOW).toISOString(), type: "temperature" }]);
  });

  it("/api/overview: every host with status, history support, sample and open alerts", async () => {
    const { status, body } = await get("/api/overview");
    expect(status).toBe(200);
    expect(body.historyHours).toBe(6);
    const by = Object.fromEntries(body.hosts.map((h: { id: string }) => [h.id, h]));
    expect(Object.keys(by)).toEqual(["local", "p2", "down", "badtoken", "old"]);
    expect(by.p2).toMatchObject({ label: "piapps2", status: "online", history: "ok", sample: { cpu: 12, temperature: 56, diskUsage: 78 } });
    expect(by.local).toMatchObject({ local: true, sample: { cpu: 9, temperature: 47, diskUsage: null } }); // from the DB when not sampled yet
    expect(by.down).toMatchObject({ status: "offline", sample: null, alerts: [expect.objectContaining({ type: "offline" })] });
    expect(by.badtoken).toMatchObject({ status: "auth-error", alerts: [] });
    expect(by.old).toMatchObject({ status: "online", history: "unsupported" });
  });
});
