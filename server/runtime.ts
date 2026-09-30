// The hub's shared state: host registry/status, alerts, and the sampler's
// newest sample per host. Hub only: the agent never imports this (it pulls in
// the database-backed alert store).
import { createHostHub, type HostHub } from "./hosts";
import { historyHours, offlineAlertMinutes, parseHosts, serviceAlertMinutes } from "./config";
import type { CompactService } from "./services/systemd";
import { createAlertManager, type AlertManager } from "./services/alerts";

/** What the sampler last computed for a host (the overview's numbers). */
export type LastSample = {
  at: string; // ISO
  cpu: number | null;
  memory: number | null;
  temperature: number | null;
  diskUsage: number | null;
  diskReadKBs: number | null;
  diskWriteKBs: number | null;
  rxKBs: number | null;
  txKBs: number | null;
};

export type HubRuntime = {
  hostHub: HostHub;
  alerts: AlertManager;
  lastSample: Map<string, LastSample>;
  historyHours: number;
  offlineMinutes: number;
  /** PIDECK_SERVICE_ALERT_MINUTES (2.8). */
  serviceMinutes: number;
  /** Each host's systemd units from its latest sample (overview chip). */
  lastServices: Map<string, CompactService[]>;
};

let runtime: HubRuntime | null = null;

export function hubRuntime(): HubRuntime {
  runtime ??= {
    hostHub: createHostHub({ hosts: parseHosts() }),
    alerts: createAlertManager(),
    lastSample: new Map(),
    historyHours: historyHours(),
    offlineMinutes: offlineAlertMinutes(),
    serviceMinutes: serviceAlertMinutes(),
    lastServices: new Map(),
  };
  return runtime;
}
