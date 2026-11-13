import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearDeviceCache, cpuPercentBetween, formatUptime, meminfoMb, parseCpuStat, parseMeminfo,
  physicalDisks, physicalInterfaces, readDisk, readNet, sumDiskstats,
} from "../../server/services/proc";
import { parsePsLine } from "../../server/services/system";

let root: string;
const mk = (rel: string, content?: string) => {
  const p = path.join(root, rel);
  fs.mkdirSync(content === undefined ? p : path.dirname(p), { recursive: true });
  if (content !== undefined) fs.writeFileSync(p, content);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-proc-"));
  clearDeviceCache();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

// The layout seen on piapps: an NVMe disk with one partition, an SD card with two, zram.
const DISKSTATS = `
 259       0 nvme0n1 100 0 28000 0 200 0 42000 0 0 0 0 0 0 0 0 0 0
 259       1 nvme0n1p1 90 0 28000 0 190 0 42000 0 0 0 0 0 0 0 0 0 0
 179       0 mmcblk0 10 0 480 0 1 0 13 0 0 0 0 0 0 0 0 0 0
 179       1 mmcblk0p1 5 0 390 0 1 0 13 0 0 0 0 0 0 0 0 0 0
 179       2 mmcblk0p2 5 0 66 0 0 0 0 0 0 0 0 0 0 0 0 0 0
 251       0 zram0 4 0 42 0 1 0 8 0 0 0 0 0 0 0 0 0 0
   7       0 loop0 1 0 2 0 0 0 0 0 0 0 0 0 0 0 0 0 0
`;

function piappsTree() {
  for (const d of ["nvme0n1", "mmcblk0"]) mk(`sys/block/${d}/device`);
  for (const d of ["zram0", "loop0", "dm-0", "md0"]) mk(`sys/block/${d}`);
  mk("proc/diskstats", DISKSTATS);
  const nic = (name: string, rx: number, tx: number, physical: boolean) => {
    if (physical) mk(`sys/class/net/${name}/device`);
    mk(`sys/class/net/${name}/statistics/rx_bytes`, `${rx}\n`);
    mk(`sys/class/net/${name}/statistics/tx_bytes`, `${tx}\n`);
  };
  nic("eth0", 1000, 2000, true);
  nic("lo", 5, 5, false);
  nic("docker0", 300, 400, false);
  nic("br-062a351f4b17", 300, 400, false);
  nic("veth7756bea", 300, 400, false);
  nic("wg-pideck", 50, 60, false);
}
const roots = () => ({ proc: path.join(root, "proc"), sys: path.join(root, "sys") });

describe("disk counters", () => {
  it("counts whole physical disks only: no partitions, zram, loop, dm or md", async () => {
    piappsTree();
    expect([...(await physicalDisks(roots()))].sort()).toEqual(["mmcblk0", "nvme0n1"]);
    // nvme0n1 28000/42000 + mmcblk0 480/13 — the partitions would have doubled it
    expect(await readDisk(roots())).toEqual({ readSectors: 28_480, writeSectors: 42_013 });
  });

  it("without any device link, falls back to whole non-virtual devices", async () => {
    for (const d of ["vda", "loop0", "zram0", "dm-0"]) mk(`sys/block/${d}`);
    expect([...(await physicalDisks(roots()))]).toEqual(["vda"]);
  });

  it("sums only the named devices and ignores short lines", () => {
    expect(sumDiskstats(`${DISKSTATS}\n 8 0 sda 1 2\n`, new Set(["nvme0n1"]))).toEqual({ readSectors: 28_000, writeSectors: 42_000 });
    expect(sumDiskstats("", new Set(["sda"]))).toEqual({ readSectors: 0, writeSectors: 0 });
  });
});

describe("network counters", () => {
  it("counts physical interfaces only: no bridges, veths, docker0, WireGuard or lo", async () => {
    piappsTree();
    expect([...(await physicalInterfaces(roots()))]).toEqual(["eth0"]);
    expect(await readNet(roots())).toEqual({ rxBytes: 1000, txBytes: 2000 });
  });

  it("a veth going away does not change the sum", async () => {
    piappsTree();
    const before = await readNet(roots());
    fs.rmSync(path.join(root, "sys/class/net/veth7756bea"), { recursive: true });
    clearDeviceCache();
    expect(await readNet(roots())).toEqual(before);
  });

  it("with no physical interface at all (a container), counts everything but lo", async () => {
    mk("sys/class/net/eth0/statistics/rx_bytes", "7\n");
    mk("sys/class/net/eth0/statistics/tx_bytes", "9\n");
    mk("sys/class/net/lo/statistics/rx_bytes", "100\n");
    mk("sys/class/net/lo/statistics/tx_bytes", "100\n");
    expect(await readNet(roots())).toEqual({ rxBytes: 7, txBytes: 9 });
  });
});

describe("CPU", () => {
  const stat = (user: number, sys: number, idle: number, iowait: number) => `cpu  ${user} 0 ${sys} ${idle} ${iowait} 0 0 0 0 0\ncpu0 1 2 3 4\n`;

  it("busy = everything but idle and iowait", () => {
    expect(parseCpuStat(stat(100, 50, 800, 50))).toEqual({ total: 1000, idle: 850 });
    expect(parseCpuStat("intr 1 2 3")).toBeNull();
  });

  it("counts system time, which a user-only reading misses", () => {
    const a = parseCpuStat(stat(0, 0, 1000, 0))!;
    const b = parseCpuStat(stat(100, 300, 1600, 0))!; // 1000 jiffies: 100 user, 300 system
    expect(cpuPercentBetween(a, b)).toBe(40);
  });

  it("reaches 100 and never goes outside 0–100", () => {
    const a = { total: 1000, idle: 500 };
    expect(cpuPercentBetween(a, { total: 2000, idle: 500 })).toBe(100);
    expect(cpuPercentBetween(a, { total: 2000, idle: 1500 })).toBe(0);
  });

  it("is null when no time passed or a counter went back", () => {
    const a = { total: 1000, idle: 500 };
    expect(cpuPercentBetween(a, a)).toBeNull();
    expect(cpuPercentBetween(a, { total: 900, idle: 400 })).toBeNull();
    expect(cpuPercentBetween(a, { total: 1100, idle: 400 })).toBeNull();
  });
});

describe("memory and uptime", () => {
  const MEMINFO = "MemTotal:       16350208 kB\nMemFree:         3710976 kB\nMemAvailable:   13117440 kB\nSwapTotal:       2097152 kB\nSwapFree:        1048576 kB\n";

  it("used = total − available", () => {
    expect(parseMeminfo(MEMINFO)).toEqual({ totalMb: 15967, usedMb: 3157, percentage: 20 });
    expect(parseMeminfo("MemTotal: 100 kB\n")).toBeNull();
  });

  it("reads single values in MiB, 0 when absent", () => {
    expect(meminfoMb(MEMINFO, "SwapTotal")).toBe(2048);
    expect(meminfoMb(MEMINFO, "SwapFree")).toBe(1024);
    expect(meminfoMb(MEMINFO, "Nope")).toBe(0);
  });

  it("formats uptime like `uptime -p`", () => {
    expect(formatUptime(0)).toBe("0 minutes");
    expect(formatUptime(61)).toBe("1 minute");
    expect(formatUptime(3600 * 20 + 48 * 60 + 86400)).toBe("1 day, 20 hours, 48 minutes");
    expect(formatUptime(86400 * 15 + 3600)).toBe("2 weeks, 1 day, 1 hour");
  });
});

describe("ps lines", () => {
  it("takes the numbers from the right, so names with spaces survive", () => {
    expect(parsePsLine("   1234 node             12.5  1.2")).toEqual({ pid: 1234, name: "node", cpu: 12.5, mem: 1.2 });
    expect(parsePsLine("1564877 npm run build     104  0.9")).toEqual({ pid: 1564877, name: "npm run build", cpu: 104, mem: 0.9 });
    expect(parsePsLine("  77 Web Content 0.0 3.4")).toEqual({ pid: 77, name: "Web Content", cpu: 0, mem: 3.4 });
  });

  it("rejects headers, blanks and junk", () => {
    expect(parsePsLine("    PID COMMAND         %CPU %MEM")).toBeNull();
    expect(parsePsLine("")).toBeNull();
    expect(parsePsLine("0 swapper 0.0 0.0")).toBeNull();
  });
});
