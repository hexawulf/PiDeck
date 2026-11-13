// Raw counters and one-minute averages, the same way for every host
// (docs/plans/multi-host-h2.md › "Hub sampler for all hosts").
//
//   agent:  GET /api/agent/sample → readCounters()   (raw, no state, read-only)
//   hub:    readCounters() for itself, the agents' samples for them
//             → ratesBetween(previous, current) → one history row per host
//
// Counters only grow. A reboot (boot id changes) drops the interval (no row);
// a single counter going backwards drops only that metric, never a negative rate.
import fs from "node:fs/promises";
import os from "node:os";
import { SystemService } from "./system";
import { diskMount } from "../config";
import { compactServices, localServices, type CompactService } from "./systemd";
import { cpuPercentBetween, readCpu, readDisk, readMemory, readNet } from "./proc";

export type RawCounters = {
  /** When these were read (ISO, UTC). */
  sampledAt: string;
  /** /proc/sys/kernel/random/boot_id: changes on every boot. */
  bootId: string | null;
  hostname: string;
  /** Jiffies summed over all CPUs (/proc/stat). idle includes iowait. */
  cpu: { total: number; idle: number } | null;
  /** Sectors since boot, whole physical disks only (services/proc.ts). */
  disk: { readSectors: number; writeSectors: number } | null;
  /** Bytes since boot, physical interfaces only (services/proc.ts). */
  net: { rxBytes: number; txBytes: number } | null;
  /** Instant values. */
  memory: { totalMb: number; usedMb: number; percentage: number } | null;
  temperature: number | null;
  /** Used share of the root filesystem, like df (%). */
  diskUsage: number | null;
  /** systemd units (2.8+): listed + failed, compact; absent without systemd or on older agents. */
  services?: CompactService[];
};

let mount: string | null = null;
/** Usage % of PIDECK_DISK_MOUNT (default "/"). */
export async function readDiskUsage(at: string = (mount ??= diskMount())): Promise<number | null> {
  const s = await fs.statfs(at);
  const used = s.blocks - s.bfree;
  const denom = used + s.bavail;
  return denom > 0 ? Math.round((used / denom) * 100) : null;
}

const soft = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null;
  }
};

/** Read everything; a part that can't be read is null (the rest still counts). */
export async function readCounters(now: () => Date = () => new Date(), services: () => Promise<CompactService[] | undefined> = async () => compactServices(await localServices().get())): Promise<RawCounters> {
  const [bootId, cpu, disk, net, memory, temperature, diskUsage, svc] = await Promise.all([
    soft(fs.readFile("/proc/sys/kernel/random/boot_id", "utf8").then((s) => s.trim())),
    soft(readCpu()),
    soft(readDisk()),
    soft(readNet()),
    soft(readMemory()),
    soft(SystemService.readTemperature()),
    soft(readDiskUsage()),
    soft(services()),
  ]);
  const out: RawCounters = { sampledAt: now().toISOString(), bootId, hostname: os.hostname(), cpu, disk, net, memory, temperature, diskUsage };
  if (svc) out.services = svc;
  return out;
}

export type Rates = {
  /** Averages over the interval. */
  cpu: number | null; // %
  diskReadKBs: number | null;
  diskWriteKBs: number | null;
  rxKBs: number | null;
  txKBs: number | null;
  /** Instant values from the newer sample. */
  memory: number | null; // %
  temperature: number | null;
  seconds: number;
};

/** Longest interval still averaged (a missed tick or two is fine; hours are not). */
export const MAX_INTERVAL_S = 15 * 60;

/**
 * One-minute averages between two samples of the same host, or null when the
 * whole interval must be dropped: no previous sample, time not moving
 * forward, too long a gap, or a different boot.
 *
 * A counter that went backwards (a wrap, a disk or interface that went away)
 * drops only its own metric — CPU, disk or network becomes null for this
 * interval — and never a negative rate. The row is still written, so one
 * odd counter no longer punches a hole into every chart.
 */
export function ratesBetween(prev: RawCounters | null, cur: RawCounters): Rates | null {
  if (!prev) return null;
  const seconds = (Date.parse(cur.sampledAt) - Date.parse(prev.sampledAt)) / 1000;
  if (!(seconds > 0) || seconds > MAX_INTERVAL_S) return null;
  if (prev.bootId && cur.bootId && prev.bootId !== cur.bootId) return null;
  const d = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? null : b - a);
  /** Both deltas of a pair, or nulls when either is missing or went backwards. */
  const pair = (x: number | null, y: number | null): [number | null, number | null] =>
    x === null || y === null || x < 0 || y < 0 ? [null, null] : [x, y];
  const [dRead, dWrite] = pair(d(prev.disk?.readSectors, cur.disk?.readSectors), d(prev.disk?.writeSectors, cur.disk?.writeSectors));
  const [dRx, dTx] = pair(d(prev.net?.rxBytes, cur.net?.rxBytes), d(prev.net?.txBytes, cur.net?.txBytes));
  const per = (x: number | null, scale: number) => (x === null ? null : Math.round((x * scale) / seconds));
  return {
    cpu: prev.cpu && cur.cpu ? cpuPercentBetween(prev.cpu, cur.cpu) : null,
    diskReadKBs: per(dRead, 512 / 1024),
    diskWriteKBs: per(dWrite, 512 / 1024),
    rxKBs: per(dRx, 1 / 1024),
    txKBs: per(dTx, 1 / 1024),
    memory: cur.memory?.percentage ?? null,
    temperature: cur.temperature,
    seconds,
  };
}

/** Structural check for an agent's sample (the hub trusts nothing it receives). */
export function isRawCounters(x: unknown): x is RawCounters {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const pair = (v: unknown, a: string, b: string) =>
    v === null || (typeof v === "object" && v !== null && num((v as Record<string, unknown>)[a]) && num((v as Record<string, unknown>)[b]));
  return (
    typeof o.sampledAt === "string" && Number.isFinite(Date.parse(o.sampledAt)) &&
    (o.bootId === null || typeof o.bootId === "string") &&
    pair(o.cpu, "total", "idle") && pair(o.disk, "readSectors", "writeSectors") && pair(o.net, "rxBytes", "txBytes") &&
    (o.memory === null || (typeof o.memory === "object" && num((o.memory as Record<string, unknown>).percentage))) &&
    (o.temperature === null || typeof o.temperature === "number") &&
    (o.diskUsage === null || num(o.diskUsage))
  );
}
