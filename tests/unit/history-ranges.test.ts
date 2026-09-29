// 3d/7d history ranges (H3 Track D): hub-side bucket averages, the API, and
// which ranges the chart offers for a given PIDECK_HISTORY_HOURS.
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";

vi.mock("../../server/db", () => ({ getDb: () => { throw new Error("no DB in this test"); } }));

import { downsampleRows, RANGE_BUCKET_MS, type HistoryRow } from "../../server/services/history";
import { registerFleetRoutes } from "../../server/routes/fleet";
import { createHostHub } from "../../server/hosts";
import { createAlertManager, memoryAlertStore } from "../../server/services/alerts";
import { rangesFor } from "@/components/widgets/HistoryChart";

const MIN = 60_000;
const T0 = Date.parse("2026-09-29T00:00:00Z");
const row = (i: number, t: number, cpu: number | null): HistoryRow => ({
  id: i, timestamp: new Date(t).toISOString().replace("T", " ").replace(/\.\d+Z$/, ""), // as the column returns it (UTC, no zone)
  cpuUsage: cpu, memoryUsage: 50, temperature: 40, diskReadSpeed: 1, diskWriteSpeed: 2, networkRx: 3, networkTx: 4,
});

describe("downsampleRows", () => {
  it("averages per UTC bucket, skips nulls, keeps gaps as missing buckets", () => {
    const rows = [row(1, T0, 10), row(2, T0 + MIN, 20), row(3, T0 + 2 * MIN, null), row(4, T0 + 5 * MIN, 40), row(5, T0 + 20 * MIN, 60)];
    const out = downsampleRows(rows, 5 * MIN);
    expect(out.map((r) => [r.timestamp, r.cpuUsage])).toEqual([
      ["2026-09-29T00:00:00.000Z", 15],
      ["2026-09-29T00:05:00.000Z", 40],
      ["2026-09-29T00:20:00.000Z", 60], // 00:10 and 00:15 are gaps
    ]);
    expect(out[0]).toMatchObject({ id: 1, memoryUsage: 50, networkTx: 4 });
  });
  it("7 days of minute rows → ≤ 672 points", () => {
    const rows = Array.from({ length: 7 * 1440 }, (_, i) => row(i, T0 + i * MIN, i % 100));
    expect(downsampleRows(rows, RANGE_BUCKET_MS["7d"]!).length).toBe(672);
    expect(downsampleRows(rows.slice(0, 3 * 1440), RANGE_BUCKET_MS["3d"]!).length).toBe(864);
  });
});

describe("GET /api/history 3d/7d", () => {
  it("accepts 3d/7d, caps them at the retention and returns bucket averages", async () => {
    const now = T0 + 3 * 24 * 60 * MIN;
    const rows = Array.from({ length: 60 }, (_, i) => row(i, now - (60 - i) * MIN, 10));
    const range = vi.fn(async () => rows);
    const app = express();
    const pass: RequestHandler = (_q, _s, next) => next();
    const hostHub = createHostHub({ hosts: [] });
    registerFleetRoutes(app, pass, { hostHub, alerts: createAlertManager({ store: memoryAlertStore() }), lastSample: new Map(), historyHours: 48 }, { history: { range, latestPerHost: async () => new Map() } as never, now: () => now });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const body = await (await fetch(`${base}/api/history?host=local&range=7d`)).json();
      expect(range).toHaveBeenLastCalledWith("local", new Date(now - 48 * 60 * MIN).toISOString()); // retention wins
      expect(body.length).toBeLessThanOrEqual(5); // 60 minute rows → 15-min buckets
      expect((await fetch(`${base}/api/history?host=local&range=3d`)).status).toBe(200);
      const short = await (await fetch(`${base}/api/history?host=local&range=1h`)).json();
      expect(short).toHaveLength(60); // short ranges are not bucketed
      expect((await fetch(`${base}/api/history?host=local&range=30d`)).status).toBe(400);
      expect((await fetch(`${base}/api/history?host=local&range=constructor`)).status).toBe(400);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("chart ranges offered", () => {
  it("3d/7d only when PIDECK_HISTORY_HOURS keeps that much", () => {
    const ids = (h?: number) => rangesFor(h).map((r) => r.id);
    expect(ids(undefined)).toEqual(["15m", "1h", "6h", "24h"]);
    expect(ids(24)).toEqual(["15m", "1h", "6h", "24h"]);
    expect(ids(72)).toEqual(["15m", "1h", "6h", "24h", "3d"]);
    expect(ids(168)).toEqual(["15m", "1h", "6h", "24h", "3d", "7d"]);
  });
});
