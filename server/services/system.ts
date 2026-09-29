import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { PIDECK_LOGS_DIR } from "../config";
import { classifyCommandFailure } from "./unavailable";
import { platform, readHwmonTemperature } from "./platform";
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

// Disk and network rates are deltas of kernel counters since the previous
// reading. Each caller keeps its own baseline: the 60s sampler gets per-minute
// averages for history, and browser polls of /api/system/info don't shrink or
// reorder the sampler's window (or vice versa).
export type RateBaseline = {
  disk: { read: number; write: number; timestamp: number } | null;
  net: { rx: number; tx: number; timestamp: number } | null;
};
export const createRateBaseline = (): RateBaseline => ({ disk: null, net: null });

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
      this.getCPUUsage(),
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
    const content = await fs.readFile('/proc/diskstats', 'utf8');
    let readSectors = 0;
    let writeSectors = 0;
    for (const line of content.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 14) continue;
      const name = parts[2];
      if (name.startsWith('loop') || name.startsWith('ram')) continue;
      readSectors += parseInt(parts[5]) || 0;
      writeSectors += parseInt(parts[9]) || 0;
    }

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
    const interfaces = (await fs.readdir('/sys/class/net')).filter(i => i !== 'lo');
    let rx = 0;
    let tx = 0;
    for (const iface of interfaces) {
      try {
        const rxPath = `/sys/class/net/${iface}/statistics/rx_bytes`;
        const txPath = `/sys/class/net/${iface}/statistics/tx_bytes`;
        rx += parseInt(await fs.readFile(rxPath, 'utf8'), 10) || 0;
        tx += parseInt(await fs.readFile(txPath, 'utf8'), 10) || 0;
      } catch (err) {
        // console.log(`Failed to read stats for interface ${iface}:`, err); // Potentially noisy if an interface is down
      }
    }

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
      // Using ps to get PID, command name, %CPU, %MEM
      // -eo pid,comm,%cpu,%mem: specify output format
      // --sort=-%cpu: sort by CPU usage in descending order
      // | head -n 6: take top 5 processes (plus header)
      // | tail -n 5: remove header
      const { stdout } = await execAsync("ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -n 6 | tail -n 5");
      const lines = stdout.trim().split("\n");
      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          pid: parseInt(parts[0]) || 0,
          name: parts[1] || "unknown",
          cpuUsage: parseFloat(parts[2]) || 0,
          memUsage: parseFloat(parts[3]) || 0,
        };
      }).filter(p => p.pid > 0);
    } catch (error) {
      console.error("Error getting process list:", error);
      return [];
    }
  }

  private static async getHostname(): Promise<string> {
    try {
      const { stdout } = await execAsync("hostname");
      return stdout.trim();
    } catch {
      return "unknown";
    }
  }

  private static async getOS(): Promise<string> {
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
    try {
      const { stdout } = await execAsync("uname -r");
      return stdout.trim();
    } catch {
      return "unknown";
    }
  }

  private static async getArchitecture(): Promise<string> {
    try {
      const { stdout } = await execAsync("uname -m");
      return stdout.trim();
    } catch {
      return "unknown";
    }
  }

  private static async getUptime(): Promise<string> {
    try {
      const { stdout } = await execAsync("uptime -p");
      return stdout.trim().replace("up ", "");
    } catch {
      return "unknown";
    }
  }

  private static async getCPUUsage(): Promise<number> {
    try {
      const { stdout } = await execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d% -f1");
      return parseFloat(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  }

  private static async getMemoryUsage(): Promise<{ used: number; total: number; percentage: number }> {
    try {
      const { stdout } = await execAsync("free -m | grep '^Mem:'");
      const parts = stdout.trim().split(/\s+/);
      const total = parseInt(parts[1]) || 0;
      const used = parseInt(parts[2]) || 0;
      const percentage = total > 0 ? Math.round((used / total) * 100) : 0;
      
      return { used, total, percentage };
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
    try {
      const { stdout } = await execAsync("hostname -I | awk '{print $1}'");
      return stdout.trim() || "127.0.0.1";
    } catch {
      return "127.0.0.1";
    }
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

  static async getCronJobs(): Promise<CronJob[]> {
    try {
      const { stdout } = await execAsync("crontab -l 2>/dev/null || echo ''");
      const lines = stdout.trim().split("\n").filter(line => line && !line.startsWith("#"));
      
      return lines.map(line => {
        const parts = line.split(" ");
        const schedule = parts.slice(0, 5).join(" ");
        const command = parts.slice(5).join(" ");
        
        return {
          schedule,
          command,
          description: this.getJobDescription(command),
          status: "Active"
        };
      });
    } catch (error) {
      console.error("Error getting cron jobs:", error);
      return [];
    }
  }

  private static getJobDescription(command: string): string {
    if (command.includes("update")) return "Update script";
    if (command.includes("backup")) return "Backup routine";
    if (command.includes("health")) return "Health check";
    if (command.includes("clean")) return "Cleanup task";
    return "Scheduled task";
  }

  private static isValidContainerId(id: string): boolean {
    return /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(id);
  }

  static async restartDockerContainer(containerId: string): Promise<void> {
    if (!this.isValidContainerId(containerId)) {
      throw new Error("Invalid container ID format");
    }
    try {
      await execAsync(`docker restart ${containerId}`);
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
      await execAsync(`docker stop ${containerId}`);
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
      await execAsync(`docker start ${containerId}`);
    } catch (error) {
      console.error("Error starting Docker container:", error);
      throw new Error("Failed to start container");
    }
  }

  private static isValidProcessNameOrId(nameOrId: string): boolean {
    // Allow alphanumeric, hyphens, underscores. Commonly used for names.
    // PM2 also allows numeric IDs.
    return /^[a-zA-Z0-9_.-]+$/.test(nameOrId);
  }

  static async restartPM2Process(processName: string): Promise<void> {
    if (!this.isValidProcessNameOrId(processName)) {
      console.error(`Invalid PM2 process name/ID for restart: ${processName}`);
      throw new Error("Invalid process name or ID format");
    }
    try {
      await execAsync(`pm2 restart ${processName}`);
    } catch (error) {
      console.error("Error restarting PM2 process:", error);
      throw new Error("Failed to restart process");
    }
  }

  static async stopPM2Process(processName: string): Promise<void> {
    if (!this.isValidProcessNameOrId(processName)) {
      console.error(`Invalid PM2 process name/ID for stop: ${processName}`);
      throw new Error("Invalid process name or ID format");
    }
    try {
      await execAsync(`pm2 stop ${processName}`);
    } catch (error) {
      console.error("Error stopping PM2 process:", error);
      throw new Error("Failed to stop process");
    }
  }

  static async runCronJob(command: string): Promise<void> {
    try {
      await execAsync(command);
    } catch (error) {
      console.error("Error running cron job:", error);
      throw new Error("Failed to execute cron job");
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
      const { stdout } = await execAsync("free -m | grep '^Mem:'");
      const parts = stdout.trim().split(/\s+/);
      const total = parseInt(parts[1]) || 0;
      const used = parseInt(parts[2]) || 0;
      const free = parseInt(parts[3]) || 0;
      const usage = total > 0 ? Math.round((used / total) * 100) : 0;
      
      return { total, used, free, usage };
    } catch (error) {
      console.error("Error getting memory stats:", error);
      return { total: 0, used: 0, free: 0, usage: 0 };
    }
  }

  static async getSwapStats(): Promise<{ total: number; used: number; free: number }> {
    try {
      const { stdout } = await execAsync("free -m | grep '^Swap:'");
      const parts = stdout.trim().split(/\s+/);
      const total = parseInt(parts[1]) || 0;
      const used = parseInt(parts[2]) || 0;
      const free = parseInt(parts[3]) || 0;
      
      return { total, used, free };
    } catch (error) {
      console.error("Error getting swap stats:", error);
      return { total: 0, used: 0, free: 0 };
    }
  }

  static async getTopProcesses(n: number = 10): Promise<any[]> {
    const count = Math.max(1, Math.min(Math.floor(n), 100));
    try {
      const { stdout } = await execAsync(`ps -eo pid,comm,%cpu,%mem --sort=-%cpu --no-headers | head -n ${count}`);
      const lines = stdout.trim().split('\n');
      
      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) return null;
        
        return {
          pid: parseInt(parts[0]) || 0,
          name: parts[1] || "unknown",
          cpu: parseFloat(parts[2]) || 0,
          mem: parseFloat(parts[3]) || 0
        };
      }).filter(proc => proc !== null);
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

  static async updateSystem(): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(
        "sudo -n apt-get update && sudo -n apt-get upgrade -y" // -n: fail fast without a sudoers rule
      );
      return stdout || stderr;
    } catch (error) {
      console.error("Error updating system:", error);
      throw new Error("System update failed");
    }
  }
}
