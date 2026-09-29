// Hub-only APIs for every host (docs/plans/multi-host-h2.md › API), all
// served from the hub's database and memory, never proxied:
//   GET /api/history?host=<id>&range=15m|1h|6h|24h   (+ /api/system/history = local, full retention)
//   GET /api/alerts?host=<id|all>                    (+ /api/system/alerts  = local, 2.4 shape)
//   GET /api/overview                                (one request for the /hosts page)
import type { Express, RequestHandler } from "express";
import type { HubRuntime } from "../runtime";
import type { Alert } from "../services/alerts";
import { historyStore, isRangeId, RANGES_MS, utcCutoff, type HistoryStore } from "../services/history";

/** Resolved alerts stay listed this long (so the UI can toast "resolved"). */
export const RECENT_RESOLVED_MS = 60 * 60_000;

export type AlertView = {
  id: number;
  hostId: string;
  hostLabel: string;
  type: string;
  severity: string;
  message: string;
  startedAt: string;
  resolvedAt: string | null;
};

export function registerFleetRoutes(
  app: Express,
  requireAuth: RequestHandler,
  rt: Pick<HubRuntime, "hostHub" | "alerts" | "lastSample" | "historyHours">,
  { history = historyStore, now = Date.now }: { history?: Pick<HistoryStore, "range" | "latestPerHost">; now?: () => number } = {},
) {
  const known = (id: unknown): id is string => typeof id === "string" && (id === "local" || rt.hostHub.has(id));
  const view = (a: Alert): AlertView => ({
    id: a.id, hostId: a.hostId, hostLabel: rt.hostHub.label(a.hostId), type: a.type, severity: a.severity, message: a.message,
    startedAt: a.startedAt.toISOString(), resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
  });
  const keepMs = () => rt.historyHours * 3_600_000;

  app.get("/api/history", requireAuth, async (req, res) => {
    const host = req.query.host ?? "local";
    if (!known(host)) return res.status(404).json({ message: "No such host" });
    const range = req.query.range ?? "24h";
    if (!isRangeId(range)) return res.status(400).json({ message: "range must be 15m, 1h, 6h or 24h" });
    try {
      res.json(await history.range(host, utcCutoff(Math.min(RANGES_MS[range], keepMs()), now())));
    } catch (error) {
      console.error("[history]", error);
      res.status(500).json({ message: "Failed to read history" });
    }
  });

  // 2.4 alias: the hub's own history, everything kept.
  app.get("/api/system/history", requireAuth, async (_req, res) => {
    try {
      res.json(await history.range("local", utcCutoff(keepMs(), now())));
    } catch (error) {
      console.error("System history error:", error);
      res.status(500).json({ message: "Failed to get system historical data" });
    }
  });

  app.get("/api/alerts", requireAuth, async (req, res) => {
    const host = req.query.host ?? "all";
    if (host !== "all" && !known(host)) return res.status(404).json({ message: "No such host" });
    try {
      const recent = await rt.alerts.listRecent(new Date(now() - RECENT_RESOLVED_MS));
      res.json(recent.filter((a) => host === "all" || a.hostId === host).map(view));
    } catch (error) {
      console.error("[alerts]", error);
      res.status(500).json({ message: "Failed to read alerts" });
    }
  });

  // 2.4 alias: the hub's own open alerts in the old shape.
  app.get("/api/system/alerts", requireAuth, (_req, res) => {
    res.json(rt.alerts.openAlerts("local").map((a) => ({ id: String(a.id), message: a.message, timestamp: a.startedAt.toISOString(), type: a.type })));
  });

  app.get("/api/overview", requireAuth, async (_req, res) => {
    try {
      const hosts = await rt.hostHub.list();
      const needDb = hosts.some((h) => !rt.lastSample.has(h.id));
      const latest = needDb ? await history.latestPerHost().catch(() => new Map()) : new Map();
      res.json({
        generatedAt: new Date(now()).toISOString(),
        historyHours: rt.historyHours,
        hosts: hosts.map((h) => {
          const mem = rt.lastSample.get(h.id);
          const row = latest.get(h.id);
          const sample = mem
            ? { at: mem.at, cpu: mem.cpu, memory: mem.memory, temperature: mem.temperature, diskUsage: mem.diskUsage, rxKBs: mem.rxKBs, txKBs: mem.txKBs }
            : row
              ? { at: row.timestamp, cpu: row.cpuUsage, memory: row.memoryUsage, temperature: row.temperature, diskUsage: null, rxKBs: row.networkRx, txKBs: row.networkTx }
              : null;
          return { ...h, sample, alerts: rt.alerts.openAlerts(h.id).map(view) };
        }),
      });
    } catch (error) {
      console.error("[overview]", error);
      res.status(500).json({ message: "Failed to build the overview" });
    }
  });
}
