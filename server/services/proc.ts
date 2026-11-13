// Kernel counters read straight from /proc and /sys, shared by the live
// tiles (services/system.ts) and the sampler (services/counters.ts) so both
// measure the same things the same way. No shell, no child processes.
//
//   CPU      /proc/stat "cpu" line: busy = everything but idle and iowait
//   disk     /proc/diskstats, whole physical disks only
//   network  /sys/class/net/<if>/statistics, physical interfaces only
//   memory   /proc/meminfo: used = MemTotal − MemAvailable
//
// "Physical" = the device has a `device` link in sysfs. That leaves out
// partitions (they would count a disk's I/O twice), loop/ram/zram, md and dm
// (stacked on the disks below them), and bridges, veths, docker0, WireGuard
// and tun (their traffic already passes a physical interface). Summing those
// too is what made the numbers about double on a Docker host, and made the
// network counter go *down* whenever a container's veth disappeared.
import fs from "node:fs/promises";

export type CpuJiffies = { total: number; idle: number };
export type DiskSectors = { readSectors: number; writeSectors: number };
export type NetBytes = { rxBytes: number; txBytes: number };
export type Memory = { totalMb: number; usedMb: number; percentage: number };

export type Roots = { proc?: string; sys?: string };
const PROC = "/proc";
const SYS = "/sys";

/** Parse the aggregate "cpu" line of /proc/stat. idle includes iowait. */
export function parseCpuStat(text: string): CpuJiffies | null {
  const line = text.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  const v = line.trim().split(/\s+/).slice(1, 9).map((n) => Number(n) || 0); // user nice system idle iowait irq softirq steal
  return { total: v.reduce((a, b) => a + b, 0), idle: v[3] + v[4] };
}

export async function readCpu({ proc = PROC }: Roots = {}): Promise<CpuJiffies | null> {
  return parseCpuStat(await fs.readFile(`${proc}/stat`, "utf8"));
}

/** Busy share (0–100, one decimal) between two readings; null when no time passed or a counter went back. */
export function cpuPercentBetween(prev: CpuJiffies, cur: CpuJiffies): number | null {
  const dTotal = cur.total - prev.total;
  const dIdle = cur.idle - prev.idle;
  if (!(dTotal > 0) || dIdle < 0) return null;
  return Math.round(Math.min(100, Math.max(0, (1 - dIdle / dTotal) * 100)) * 10) / 10;
}

const VIRTUAL_DISK = /^(loop|ram|zram|dm-|md|sr|fd|nbd)/;
const exists = (p: string) => fs.access(p).then(() => true, () => false);

// The set of devices changes rarely (a USB disk, a new NIC): look once a minute.
const LIST_TTL_MS = 60_000;
type Cached = { at: number; names: Set<string> };
const listCache = new Map<string, Cached>();
async function cachedList(key: string, load: () => Promise<Set<string>>, now = Date.now()): Promise<Set<string>> {
  const hit = listCache.get(key);
  if (hit && now - hit.at < LIST_TTL_MS) return hit.names;
  const names = await load();
  listCache.set(key, { at: now, names });
  return names;
}
/** Tests only. */
export const clearDeviceCache = () => listCache.clear();

/**
 * Whole physical disks: entries of /sys/block with a `device` link. When a
 * host shows none (unusual virtual setups), every /sys/block entry that isn't
 * a known virtual kind — still whole devices, never partitions.
 */
export async function physicalDisks({ sys = SYS }: Roots = {}): Promise<Set<string>> {
  return cachedList(`disk:${sys}`, async () => {
    const all = await fs.readdir(`${sys}/block`);
    const physical: string[] = [];
    for (const name of all) if (await exists(`${sys}/block/${name}/device`)) physical.push(name);
    return new Set(physical.length ? physical : all.filter((n) => !VIRTUAL_DISK.test(n)));
  });
}

/** Sum the sectors of the given devices from /proc/diskstats text. */
export function sumDiskstats(text: string, disks: ReadonlySet<string>): DiskSectors {
  let readSectors = 0;
  let writeSectors = 0;
  for (const line of text.trim().split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p.length < 14 || !disks.has(p[2])) continue;
    readSectors += Number(p[5]) || 0;
    writeSectors += Number(p[9]) || 0;
  }
  return { readSectors, writeSectors };
}

export async function readDisk(roots: Roots = {}): Promise<DiskSectors> {
  const disks = await physicalDisks(roots);
  return sumDiskstats(await fs.readFile(`${roots.proc ?? PROC}/diskstats`, "utf8"), disks);
}

/**
 * Physical network interfaces: those with a `device` link. A bond has none,
 * but its member interfaces do and carry the bytes. When a host shows none
 * (a container), every interface except lo, as before.
 */
export async function physicalInterfaces({ sys = SYS }: Roots = {}): Promise<Set<string>> {
  return cachedList(`net:${sys}`, async () => {
    const all = (await fs.readdir(`${sys}/class/net`)).filter((i) => i !== "lo");
    const physical: string[] = [];
    for (const name of all) if (await exists(`${sys}/class/net/${name}/device`)) physical.push(name);
    return new Set(physical.length ? physical : all);
  });
}

export async function readNet(roots: Roots = {}): Promise<NetBytes> {
  const sys = roots.sys ?? SYS;
  let rxBytes = 0;
  let txBytes = 0;
  for (const iface of await physicalInterfaces(roots)) {
    try {
      rxBytes += Number(await fs.readFile(`${sys}/class/net/${iface}/statistics/rx_bytes`, "utf8")) || 0;
      txBytes += Number(await fs.readFile(`${sys}/class/net/${iface}/statistics/tx_bytes`, "utf8")) || 0;
    } catch {
      /* interface went away */
    }
  }
  return { rxBytes, txBytes };
}

export function parseMeminfo(text: string): Memory | null {
  const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? NaN);
  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  if (!Number.isFinite(total) || !Number.isFinite(available) || total <= 0) return null;
  return {
    totalMb: Math.round(total / 1024),
    usedMb: Math.round((total - available) / 1024),
    percentage: Math.round(((total - available) / total) * 100),
  };
}

/** One /proc/meminfo value in MiB (0 when absent). */
export function meminfoMb(text: string, key: string): number {
  const kb = Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? NaN);
  return Number.isFinite(kb) ? Math.round(kb / 1024) : 0;
}

export async function readMemory({ proc = PROC }: Roots = {}): Promise<Memory | null> {
  return parseMeminfo(await fs.readFile(`${proc}/meminfo`, "utf8"));
}

/** "1 day, 20 hours, 48 minutes" — the format of `uptime -p` without "up ". */
export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60));
  const units: [number, string][] = [
    [Math.floor(total / (60 * 24 * 7)), "week"],
    [Math.floor(total / (60 * 24)) % 7, "day"],
    [Math.floor(total / 60) % 24, "hour"],
    [total % 60, "minute"],
  ];
  const parts = units.filter(([n]) => n > 0).map(([n, u]) => `${n} ${u}${n === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "0 minutes";
}
