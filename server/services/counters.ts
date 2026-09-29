// Raw counters and one-minute averages, the same way for every host
// (docs/plans/multi-host-h2.md › "Hub sampler for all hosts").
//
//   agent:  GET /api/agent/sample → readCounters()   (raw, no state, read-only)
//   hub:    readCounters() for itself, the agents' samples for them
//             → ratesBetween(previous, current) → one history row per host
//
// Counters only grow; a reboot (boot id changes), agent restart with a new
// boot, or a wrap makes one go backwards → that interval is dropped (no
// row), never a negative rate.
import fs from "node:fs/promises";
import os from "node:os";
import { SystemService } from "./system";

export type RawCounters = {
  /** When these were read (ISO, UTC). */
  sampledAt: string;
  /** /proc/sys/kernel/random/boot_id: changes on every boot. */
  bootId: string | null;
  hostname: string;
  /** Jiffies summed over all CPUs (/proc/stat). idle includes iowait. */
  cpu: { total: number; idle: number } | null;
  /** Sectors since boot, all block devices except loop/ram (/proc/diskstats). */
  disk: { readSectors: number; writeSectors: number } | null;
  /** Bytes since boot, all interfaces except lo (/sys/class/net). */
  net: { rxBytes: number; txBytes: number } | null;
  /** Instant values. */
  memory: { totalMb: number; usedMb: number; percentage: number } | null;
  temperature: number | null;
  /** Used share of the root filesystem, like df (%). */
  diskUsage: number | null;
};

async function readCpu(): Promise<RawCounters["cpu"]> {
  const line = (await fs.readFile("/proc/stat", "utf8")).split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  const v = line.trim().split(/\s+/).slice(1, 9).map((n) => Number(n) || 0); // user nice system idle iowait irq softirq steal
  return { total: v.reduce((a, b) => a + b, 0), idle: v[3] + v[4] };
}

async function readDisk(): Promise<RawCounters["disk"]> {
  let readSectors = 0;
  let writeSectors = 0;
  for (const line of (await fs.readFile("/proc/diskstats", "utf8")).trim().split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p.length < 14 || p[2].startsWith("loop") || p[2].startsWith("ram")) continue;
    readSectors += Number(p[5]) || 0;
    writeSectors += Number(p[9]) || 0;
  }
  return { readSectors, writeSectors };
}

async function readNet(): Promise<RawCounters["net"]> {
  let rxBytes = 0;
  let txBytes = 0;
  for (const iface of (await fs.readdir("/sys/class/net")).filter((i) => i !== "lo")) {
    try {
      rxBytes += Number(await fs.readFile(`/sys/class/net/${iface}/statistics/rx_bytes`, "utf8")) || 0;
      txBytes += Number(await fs.readFile(`/sys/class/net/${iface}/statistics/tx_bytes`, "utf8")) || 0;
    } catch {
      /* interface went away */
    }
  }
  return { rxBytes, txBytes };
}

async function readMemory(): Promise<RawCounters["memory"]> {
  const info = await fs.readFile("/proc/meminfo", "utf8");
  const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(info)?.[1] ?? NaN);
  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  if (!Number.isFinite(total) || !Number.isFinite(available) || total <= 0) return null;
  const totalMb = Math.round(total / 1024);
  const usedMb = Math.round((total - available) / 1024);
  return { totalMb, usedMb, percentage: Math.round(((total - available) / total) * 100) };
}

async function readDiskUsage(): Promise<number | null> {
  const s = await fs.statfs("/");
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
export async function readCounters(now: () => Date = () => new Date()): Promise<RawCounters> {
  const [bootId, cpu, disk, net, memory, temperature, diskUsage] = await Promise.all([
    soft(fs.readFile("/proc/sys/kernel/random/boot_id", "utf8").then((s) => s.trim())),
    soft(readCpu()),
    soft(readDisk()),
    soft(readNet()),
    soft(readMemory()),
    soft(SystemService.readTemperature()),
    soft(readDiskUsage()),
  ]);
  return { sampledAt: now().toISOString(), bootId, hostname: os.hostname(), cpu, disk, net, memory, temperature, diskUsage };
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
 * interval must be dropped: no previous sample, time not moving forward, too
 * long a gap, a different boot, or any counter going backwards (reset/wrap).
 */
export function ratesBetween(prev: RawCounters | null, cur: RawCounters): Rates | null {
  if (!prev) return null;
  const seconds = (Date.parse(cur.sampledAt) - Date.parse(prev.sampledAt)) / 1000;
  if (!(seconds > 0) || seconds > MAX_INTERVAL_S) return null;
  if (prev.bootId && cur.bootId && prev.bootId !== cur.bootId) return null;
  const d = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? null : b - a);
  const deltas = [
    d(prev.cpu?.total, cur.cpu?.total), d(prev.cpu?.idle, cur.cpu?.idle),
    d(prev.disk?.readSectors, cur.disk?.readSectors), d(prev.disk?.writeSectors, cur.disk?.writeSectors),
    d(prev.net?.rxBytes, cur.net?.rxBytes), d(prev.net?.txBytes, cur.net?.txBytes),
  ];
  if (deltas.some((x) => x !== null && x < 0)) return null; // a counter reset: drop the interval
  const [dTotal, dIdle, dRead, dWrite, dRx, dTx] = deltas;
  const per = (x: number | null, scale: number) => (x === null ? null : Math.round((x * scale) / seconds));
  return {
    cpu: dTotal !== null && dIdle !== null && dTotal > 0 ? Math.round(Math.min(100, Math.max(0, (1 - dIdle / dTotal) * 100)) * 10) / 10 : null,
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
