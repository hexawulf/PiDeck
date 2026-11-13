import { exec, execFile } from "child_process";
import os from "os";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { PIDECK_LOGS_DIR } from "../config";
import { classifyCommandFailure } from "./unavailable";
import { readCrontab, toCronJob } from "./cron";
import { platform, readHwmonTemperature } from "./platform";
import { cpuPercentBetween, formatUptime, meminfoMb, parseMeminfo, readCpu, readDisk, readMemory, readNet, type CpuJiffies } from "./proc";
import type {
  SystemInfo,
  LogFile,
  PM2Process,
  CronJob,
  DiskIO,
  NetworkBandwidth,
  ProcessInfo,
} from "@shared/schema";



const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** A refused pm2 action: 400 bad name, 404 unknown process, 409 PiDeck stopping itself. */
export class Pm2ActionError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}
const PM2_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
/** pm2 reads "all" as every process on the host. */
const PM2_RESERVED = new Set(["all"]);
/** This process's pm2 name (pm2 exports `name` and `pm_id` to its apps), if it runs under pm2. */
export const pm2SelfName = (env: NodeJS.ProcessEnv = process.env) => (env.pm_id !== undefined && env.name ? env.name : undefined);

// Disk and network rates are deltas of kernel counters since the previous
// reading. Each caller keeps its own baseline: the 60s sampler gets per-minute
// averages for history, and browser polls of /api/system/info don't shrink or
// reorder the sampler's window (or vice versa).
export type RateBaseline = {
  disk: { read: number; write: number; timestamp: number } | null;
  net: { rx: number; tx: number; timestamp: number } | null;
  cpu: CpuJiffies | null;
};
export const createRateBaseline = (): RateBaseline => ({ disk: null, net: null, cpu: null });

export type PsRow = { pid: number; name: string; cpu: number; mem: number };
/**
 * One line of `ps -eo pid,comm,%cpu,%mem`. The command name may contain
 * spaces ("npm run build", "Web Content"), so the two numbers are taken
 * from the right, not by position.
 */
export function parsePsLine(line: string): PsRow | null {
  const m = /^\s*(\d+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/.exec(line);
  if (!m) return null;
  const pid = Number(m[1]);
  return pid > 0 ? { pid, name: m[2], cpu: Number(m[3]), mem: Number(m[4]) } : null;
}

/** Values that can't change while the process runs (OS name) or change rarely (primary IP). */
let cachedOs: string | null = null;
let cachedIp: { value: string; at: number } | null = null;
const IP_TTL_MS = 60_000;

const clientBaseline = createRateBaseline();

let temperatureWarned = false;

export class SystemService {
  /**
   * Read-only snapshot for /api/system/info. History rows and alerts are
   * written by the server-side sampler (services/sampler.ts), not by polls.
   */
  static async getSystemInfo(): Promise<SystemInfo> {
    try {
      return await this.collectMetrics(clientBaseline);
    } catch (error) {
      console.error("Error getting system info:", error);
      throw new Error("Failed to retrieve system information");
    }
  }

  /** Gather all metrics; rates are measured against `baseline`. No side effects beyond it. */
  static async collectMetrics(baseline: RateBaseline): Promise<SystemInfo> {
    const [hostname, os, kernel, arch, uptime, cpu, memory, temp, ip, diskIO, networkBandwidth, processes] = await Promise.all([
      this.getHostname(),
      this.getOS(),
      this.getKernel(),
      this.getArchitecture(),
      this.getUptime(),
      this.getCPUUsage(baseline),
      this.getMemoryUsage(),
      this.readTemperature(),
      this.getIPAddress(),
      this.getDiskIO(baseline),
      this.getNetworkBandwidth(baseline),
      this.getProcessList(),
    ]);

    const systemData: SystemInfo = {
      hostname,
      os,
      kernel,
      architecture: arch,
      uptime,
      cpu,
      memory,
      temperature: temp,
      network: {
        ip,
        status: "Connected"
      },
      diskIO,
      networkBandwidth,
      processes
    };

    return systemData;
  }

private static async getDiskIO(baseline: RateBaseline): Promise<DiskIO> {
  try {
    // Whole physical disks only (services/proc.ts): partitions would count twice.
    const { readSectors, writeSectors } = await readDisk();

    const now = Date.now();
    let readSpeed = 0;
    let writeSpeed = 0;

    const previousDiskStats = baseline.disk;
    if (previousDiskStats) {
      const diffSec = (now - previousDiskStats.timestamp) / 1000;
      if (diffSec > 0) {
        const readDiff = readSectors - previousDiskStats.read;
        const writeDiff = writeSectors - previousDiskStats.write;
        readSpeed = Math.max(0, (readDiff * 512) / 1024 / diffSec);
        writeSpeed = Math.max(0, (writeDiff * 512) / 1024 / diffSec);
      }
    } else {
      // First call - sample again after a short delay for immediate data
      baseline.disk = { read: readSectors, write: writeSectors, timestamp: now };
      await new Promise(r => setTimeout(r, 500));
      return this.getDiskIO(baseline);
    }

    baseline.disk = { read: readSectors, write: writeSectors, timestamp: now };

    const utilization = Math.min((readSpeed + writeSpeed) / 10, 100);
    const result: DiskIO = {
      readSpeed: Math.round(readSpeed),
      writeSpeed: Math.round(writeSpeed),
      utilization: Math.round(utilization),
    };
    // console.log('Disk I/O:', result);
    return result;
  } catch (error) {
    console.error('Error getting disk I/O:', error);
    return { readSpeed: 0, writeSpeed: 0, utilization: 0 };
  }
}
private static async getNetworkBandwidth(baseline: RateBaseline): Promise<NetworkBandwidth> {
  try {
    // Physical interfaces only (services/proc.ts): bridges, veths and tunnels repeat the same traffic.
    const { rxBytes: rx, txBytes: tx } = await readNet();

    const now = Date.now();
    let rxSpeed = 0;
    let txSpeed = 0;

    const previousNetworkStats = baseline.net;
    if (previousNetworkStats) {
      const diffSec = (now - previousNetworkStats.timestamp) / 1000;
      if (diffSec > 0) {
        const rxDiff = rx - previousNetworkStats.rx;
        const txDiff = tx - previousNetworkStats.tx;
        rxSpeed = Math.max(0, rxDiff / 1024 / diffSec);
        txSpeed = Math.max(0, txDiff / 1024 / diffSec);
      }
    } else {
      // First call - sample again after a short delay for immediate data
      baseline.net = { rx, tx, timestamp: now };
      await new Promise(res => setTimeout(res, 500));
      return this.getNetworkBandwidth(baseline);
    }

    baseline.net = { rx, tx, timestamp: now };

    const result: NetworkBandwidth = {
      rx: Math.round(rxSpeed),
      tx: Math.round(txSpeed),
    };
    // console.log('Network bandwidth:', result);
    return result;
  } catch (error) {
    console.error('Error getting network bandwidth:', error);
    return { rx: 0, tx: 0 };
  }
}

  private static async getProcessList(): Promise<ProcessInfo[]> {
    try {
      return (await this.topByCpu(5)).map((p) => ({ pid: p.pid, name: p.name, cpuUsage: p.cpu, memUsage: p.mem }));
    } catch (error) {
      console.error("Error getting process list:", error);
      return [];
    }
  }

  /** The `n` busiest processes: one `ps` (no shell pipeline), parsed by parsePsLine. */
  private static async topByCpu(n: number): Promise<PsRow[]> {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid,comm,%cpu,%mem", "--sort=-%cpu", "--no-headers"], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    const rows: PsRow[] = [];
    for (const line of stdout.split("\n")) {
      const row = parsePsLine(line);
      if (row) rows.push(row);
      if (rows.length >= n) break;
    }
    return rows;
  }

  private static async getHostname(): Promise<string> {
    return os.hostname() || "unknown";
  }

  private static async getOS(): Promise<string> {
    return (cachedOs ??= await this.detectOS());
  }

  private static async detectOS(): Promise<string> {
    const p = platform();
    if (p.kind === "dsm") return p.os; // Synology: no lsb_release, no /etc/os-release
    try {
      const { stdout } = await execAsync("lsb_release -d | cut -f2");
      if (stdout.trim()) return stdout.trim();
    } catch {
      // try os-release
    }
    try {
      const m = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(await fs.readFile("/etc/os-release", "utf8"));
      if (m) return m[1];
    } catch {
      // nothing else to try
    }
    return "Unknown OS";
  }

  private static async getKernel(): Promise<string> {
    return os.release() || "unknown";
  }

  private static async getArchitecture(): Promise<string> {
    return os.machine() || "unknown"; // what `uname -m` prints (aarch64, x86_64)
  }

  private static async getUptime(): Promise<string> {
    return formatUptime(os.uptime());
  }

  /**
   * Busy CPU (%) since this caller's previous reading — everything but idle
   * and iowait, from /proc/stat, the same measure the history chart uses.
   * The first call samples twice, 500 ms apart, to have something to show.
   */
  private static async getCPUUsage(baseline: RateBaseline): Promise<number> {
    try {
      let prev = baseline.cpu;
      if (!prev) {
        prev = await readCpu();
        await new Promise((r) => setTimeout(r, 500));
      }
      const cur = await readCpu();
      if (!prev || !cur) return 0;
      const pct = cpuPercentBetween(prev, cur);
      if (pct === null) return 0; // polled twice within one tick: keep the baseline, show nothing new
      baseline.cpu = cur;
      return pct;
    } catch {
      return 0;
    }
  }

  private static async getMemoryUsage(): Promise<{ used: number; total: number; percentage: number }> {
    try {
      const m = await readMemory(); // used = total − available, as `free` and the history chart count it
      return m ? { used: m.usedMb, total: m.totalMb, percentage: m.percentage } : { used: 0, total: 0, percentage: 0 };
    } catch {
      return { used: 0, total: 0, percentage: 0 };
    }
  }

  /** CPU temperature in °C, or null when this host has no sensor. */
  static async readTemperature(): Promise<number | null> {
    try {
      // Method 1: Linux thermal zone (most reliable on all Linux distros)
      // fs is already imported at the top of the file
      const thermalPath = '/sys/class/thermal/thermal_zone0/temp';

      const tempData = await fs.readFile(thermalPath, 'utf8');
      const temperatureMilliC = parseInt(tempData.trim(), 10);

      if (!isNaN(temperatureMilliC)) {
        const temperatureC = temperatureMilliC / 1000.0;

        // Validate temperature reading (should be between 0-100°C for Raspberry Pi)
        if (temperatureC > 0 && temperatureC < 100) {
          // console.log(`CPU temperature: ${temperatureC.toFixed(1)}°C (thermal zone)`);
          return Math.round(temperatureC * 10) / 10; // Round to 1 decimal place
        } else {
          console.warn(`Invalid temperature reading from thermal_zone0: ${temperatureC}°C`);
        }
      }
    } catch (error) {
      // Silently try next method, or log minimally if desired for debugging
      // console.log('Thermal zone method failed:', error instanceof Error ? error.message : String(error));
    }

    // Method 2: Fallback to vcgencmd if thermal zone fails
    try {
      const { stdout } = await execAsync("vcgencmd measure_temp | cut -d= -f2 | cut -d\\' -f1");
      const temp = parseFloat(stdout.trim());
      if (!isNaN(temp) && temp > 0 && temp < 100) { // Added validation
        // console.log(`CPU temperature: ${temp.toFixed(1)}°C (vcgencmd)`);
        return temp;
      } else if (!isNaN(temp)) {
        console.warn(`Invalid temperature reading from vcgencmd: ${temp}°C`);
      }
    } catch (error) {
      // Silently try next method
      // console.log('vcgencmd method failed:', error instanceof Error ? error.message : String(error));
    }

    // Method 3: hwmon (x86 without thermal_zone0, e.g. a Synology: coretemp "Physical id 0")
    const hwmon = await readHwmonTemperature().catch(() => null);
    if (hwmon !== null) return hwmon;

    // Method 4: Fallback to sensors command
    try {
      const { stdout } = await execAsync("sensors | grep -E '(Core 0|Package id 0|Tctl)' | head -1 | awk '{print $3}' | cut -d+ -f2 | cut -d° -f1");
      const temp = parseFloat(stdout.trim());
      if (!isNaN(temp) && temp > 0 && temp < 100) { // Added validation
        // console.log(`CPU temperature: ${temp.toFixed(1)}°C (sensors)`);
        return temp;
      } else if (!isNaN(temp)) {
        console.warn(`Invalid temperature reading from sensors: ${temp}°C`);
      }
    } catch (error) {
      // Silently try next method
      // console.log('sensors method failed:', error instanceof Error ? error.message : String(error));
    }

    // No thermal zone, vcgencmd or lm-sensors reading on this host: report "unavailable" (null), warn once.
    if (!temperatureWarned) {
      temperatureWarned = true;
      console.warn('[system] No CPU temperature source (thermal_zone0, vcgencmd, hwmon, sensors); reporting it as unavailable');
    }
    return null;
  }

  private static async getIPAddress(): Promise<string> {
    const now = Date.now();
    if (cachedIp && now - cachedIp.at < IP_TTL_MS) return cachedIp.value;
    const value = await this.detectIPAddress();
    cachedIp = { value, at: now };
    return value;
  }

  private static async detectIPAddress(): Promise<string> {
    // 1. Kernel routing table for primary outbound route (picks primary NIC on multi-NIC hosts like DS920+)
    try {
      const { stdout } = await execAsync("ip route get 1.1.1.1 2>/dev/null");
      const m = stdout.match(/\bsrc\s+(\d+\.\d+\.\d+\.\d+)\b/);
      if (m && m[1] !== "127.0.0.1") return m[1];
    } catch {
      // ignore and try next
    }

    // 2. Inspect Node network interfaces (prioritizing primary/physical NICs)
    try {
      const ifaces = os.networkInterfaces();
      const names = Object.keys(ifaces).sort((a, b) => {
        if (a === "eth0") return -1;
        if (b === "eth0") return 1;
        return a.localeCompare(b);
      });
      for (const name of names) {
        if (/^(lo|docker|br-|veth|tun|tap)/i.test(name)) continue;
        for (const addr of ifaces[name] || []) {
          if (addr.family === "IPv4" && !addr.internal && addr.address !== "127.0.0.1") {
            return addr.address;
          }
        }
      }
    } catch {
      // ignore and try next
    }

    // 3. Fallback: hostname -I (standard Debian/Ubuntu)
    try {
      const { stdout } = await execAsync("hostname -I 2>/dev/null");
      const m = stdout.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (m && m[1] !== "127.0.0.1") return m[1];
    } catch {
      // ignore
    }

    return "127.0.0.1";
  }

  static async getLogFiles(): Promise<LogFile[]> {
    try {
      const logDir = PIDECK_LOGS_DIR;
      
      try {
        await fs.access(logDir);
      } catch {
        // Create directory if it doesn't exist
        await fs.mkdir(logDir, { recursive: true });
        return [];
      }

      const files = await fs.readdir(logDir);
      const logFiles = files.filter(file => file.endsWith(".log"));
      
      const logFileInfos: LogFile[] = [];
      
      for (const file of logFiles) {
        const filePath = path.join(logDir, file);
        try {
          const stats = await fs.stat(filePath);
          const sizeKB = Math.round(stats.size / 1024 * 10) / 10;
          logFileInfos.push({
            name: file,
            path: filePath,
            size: `${sizeKB} KB`
          });
        } catch {
          // Skip files we can't read
        }
      }
      
      return logFileInfos;
    } catch (error) {
      console.error("Error getting log files:", error);
      return [];
    }
  }

  static async getLogFileContent(filePath: string): Promise<string> {
    try {
      const normalizedPath = path.resolve(filePath);
      if (!normalizedPath.startsWith(PIDECK_LOGS_DIR + "/")) {
        throw new Error("Access denied");
      }
      
      const content = await fs.readFile(filePath, "utf8");
      // Return last 1000 lines
      const lines = content.split("\n");
      return lines.slice(-1000).join("\n");
    } catch (error) {
      console.error("Error reading log file:", error);
      throw new Error("Failed to read log file");
    }
  }

  /** null = pm2 isn't installed on this host (e.g. a systemd install). */
  static async getPM2Processes(): Promise<PM2Process[] | null> {
    try {
      const { stdout } = await execAsync("pm2 jlist");
      const processes = JSON.parse(stdout || "[]");
      
      return processes.map((proc: any) => ({
        id: proc.pid || 0,
        name: proc.name || "",
        status: proc.pm2_env?.status || "unknown",
        cpu: `${proc.monit?.cpu || 0}%`,
        memory: `${Math.round((proc.monit?.memory || 0) / 1024 / 1024)}MB`,
        uptime: this.formatUptime(proc.pm2_env?.pm_uptime)
      }));
    } catch (error) {
      if (classifyCommandFailure(error as { code?: unknown; message?: string }) === "not-installed") return null;
      console.error("Error getting PM2 processes:", error);
      return [];
    }
  }

  private static formatUptime(uptime?: number): string {
    if (!uptime) return "0s";
    const seconds = Math.floor((Date.now() - uptime) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /** The user's crontab as the Cron tab lists it (services/cron.ts parses it). */
  static async getCronJobs(): Promise<CronJob[]> {
    return (await readCrontab()).map(toCronJob);
  }

  private static isValidContainerId(id: string): boolean {
    return /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(id);
  }

  static async restartDockerContainer(containerId: string): Promise<void> {
    if (!this.isValidContainerId(containerId)) {
      throw new Error("Invalid container ID format");
    }
    try {
      await execFileAsync("docker", ["restart", containerId], { timeout: 60_000 });
    } catch (error) {
      console.error("Error restarting Docker container:", error);
      throw new Error("Failed to restart container");
    }
  }

  static async stopDockerContainer(containerId: string): Promise<void> {
    if (!this.isValidContainerId(containerId)) {
      throw new Error("Invalid container ID format");
    }
    try {
      await execFileAsync("docker", ["stop", containerId], { timeout: 60_000 });
    } catch (error) {
      console.error("Error stopping Docker container:", error);
      throw new Error("Failed to stop container");
    }
  }

  static async startDockerContainer(containerId: string): Promise<void> {
    if (!this.isValidContainerId(containerId)) {
      throw new Error("Invalid container ID format");
    }
    try {
      await execFileAsync("docker", ["start", containerId], { timeout: 60_000 });
    } catch (error) {
      console.error("Error starting Docker container:", error);
      throw new Error("Failed to start container");
    }
  }

  /**
   * `pm2 restart|stop <name>` for one process the daemon actually runs.
   * Refused: anything that isn't a current process name ("all" above all,
   * which pm2 reads as every app on the host), and stopping PiDeck itself
   * (the dashboard would be gone until someone uses ssh).
   */
  static async pm2Action(
    action: "restart" | "stop",
    name: string,
    deps: { list?: () => Promise<string[]>; run?: (args: string[]) => Promise<unknown>; self?: string | undefined } = {},
  ): Promise<void> {
    const list = deps.list ?? (async () => {
      const { stdout } = await execFileAsync("pm2", ["jlist"], { maxBuffer: 16 * 1024 * 1024 });
      return (JSON.parse(stdout || "[]") as { name?: unknown }[]).map((p) => String(p.name ?? "")).filter(Boolean);
    });
    const run = deps.run ?? ((args: string[]) => execFileAsync("pm2", args, { timeout: 30_000 }));
    const self = "self" in deps ? deps.self : pm2SelfName();
    if (!PM2_NAME_RE.test(name) || PM2_RESERVED.has(name.toLowerCase())) {
      throw new Pm2ActionError(400, "Invalid process name");
    }
    let names: string[];
    try {
      names = await list();
    } catch (error) {
      console.error("Error listing PM2 processes:", error);
      throw new Error("Failed to list processes");
    }
    if (!names.includes(name)) throw new Pm2ActionError(404, "No such pm2 process");
    if (action === "stop" && self && name === self) {
      throw new Pm2ActionError(409, "PiDeck can't stop itself (use pm2 on the host)");
    }
    try {
      await run([action, name]);
    } catch (error) {
      console.error(`Error running pm2 ${action}:`, error);
      throw new Error(`Failed to ${action} process`);
    }
  }

  static async checkRebootRequired(): Promise<boolean> {
    try {
      await fs.access('/var/run/reboot-required');
      return true;
    } catch {
      return false;
    }
  }

  static async getFilesystemUsage(): Promise<any[]> {
    try {
      const { stdout } = await execAsync("df -PT --block-size=1 | grep -v '^Filesystem' | grep -v '^tmpfs\|proc\|sysfs\|cgroup\|overlay\|devtmpfs'");
      const lines = stdout.trim().split('\n');
      
      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 7) return null;
        
        const device = parts[0];
        const fstype = parts[1];
        const size = parseInt(parts[2]) || 0;
        const used = parseInt(parts[3]) || 0;
        const avail = parseInt(parts[4]) || 0;
        const pcent = parseInt(parts[5]) || 0;
        const mount = parts[6];
        
        return {
          device,
          mount,
          type: fstype,
          size: Math.round(size / 1024 / 1024), // Convert to MB
          used: Math.round(used / 1024 / 1024),
          avail: Math.round(avail / 1024 / 1024),
          pcent
        };
      }).filter(fs => fs !== null);
    } catch (error) {
      console.error("Error getting filesystem usage:", error);
      return [];
    }
  }

  static async getMountInfo(): Promise<any[]> {
    try {
      const { stdout } = await execAsync("mount | grep -v snap");
      const lines = stdout.trim().split('\n');
      
      return lines.map(line => {
        // Parse mount line: device on mountpoint type fstype (options)
        const match = line.match(/^(.+?) on (.+?) type (.+?) \((.+?)\)$/);
        if (!match) return null;
        
        return {
          device: match[1],
          mountpoint: match[2],
          fstype: match[3],
          options: match[4]
        };
      }).filter(mount => mount !== null);
    } catch (error) {
      console.error("Error getting mount info:", error);
      return [];
    }
  }

  static async getMemoryStats(): Promise<{ total: number; used: number; free: number; usage: number }> {
    try {
      const info = await fs.readFile("/proc/meminfo", "utf8");
      const m = parseMeminfo(info);
      if (!m) return { total: 0, used: 0, free: 0, usage: 0 };
      return { total: m.totalMb, used: m.usedMb, free: meminfoMb(info, "MemFree"), usage: m.percentage };
    } catch (error) {
      console.error("Error getting memory stats:", error);
      return { total: 0, used: 0, free: 0, usage: 0 };
    }
  }

  static async getSwapStats(): Promise<{ total: number; used: number; free: number }> {
    try {
      const info = await fs.readFile("/proc/meminfo", "utf8");
      const total = meminfoMb(info, "SwapTotal");
      const free = meminfoMb(info, "SwapFree");
      return { total, used: Math.max(0, total - free), free };
    } catch (error) {
      console.error("Error getting swap stats:", error);
      return { total: 0, used: 0, free: 0 };
    }
  }

  static async getTopProcesses(n: number = 10): Promise<any[]> {
    const count = Math.max(1, Math.min(Math.floor(n), 100));
    try {
      return await this.topByCpu(count);
    } catch (error) {
      console.error("Error getting top processes:", error);
      return [];
    }
  }

  static async getCpuFrequency(): Promise<{ core: string; freq: string }[]> {
    try {
      const cpus = await fs.readdir('/sys/devices/system/cpu/');
      const cpuCores = cpus.filter(cpu => cpu.match(/^cpu[0-9]+$/));
      
      const frequencies = await Promise.all(
        cpuCores.map(async (core) => {
          try {
            const freqPath = `/sys/devices/system/cpu/${core}/cpufreq/scaling_cur_freq`;
            const freq = await fs.readFile(freqPath, 'utf8');
            const freqMHz = (parseInt(freq.trim()) / 1000).toFixed(0);
            return { core, freq: `${freqMHz} MHz` };
          } catch {
            return { core, freq: "N/A" };
          }
        })
      );
      
      return frequencies;
    } catch (error) {
      console.error("Error getting CPU frequency:", error);
      return [{ core: "cpu0", freq: "N/A" }];
    }
  }
}
