import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import type {
  SystemInfo,
  LogFile,
  DockerContainer,
  PM2Process,
  CronJob,
  DiskIO,
  NetworkBandwidth,
  ProcessInfo,
  InsertHistoricalMetric,
  HistoricalMetric,
} from "@shared/schema";
import { historicalMetrics } from "@shared/schema";
import { db } from '../db'; // Assuming db connection is exported from here
import { sql } from "drizzle-orm";


const execAsync = promisify(exec);

// To store the previous network stats for calculating bandwidth
let previousNetworkStats: { rx: number, tx: number, timestamp: number } | null = null;

// To store the previous disk stats for calculating I/O speed
let previousDiskStats: { read: number; write: number; timestamp: number } | null = null;

// In-memory store for active alerts
interface ActiveAlert {
  id: string;
  message: string;
  timestamp: Date;
  type: 'temperature'; // Can be expanded later
}
let activeAlerts: ActiveAlert[] = [];
const TEMPERATURE_THRESHOLD = 70; // Celsius

export class SystemService {
  static async getSystemInfo(): Promise<SystemInfo> {
    try {
      const [hostname, os, kernel, arch, uptime, cpu, memory, temp, ip, diskIO, networkBandwidth, processes] = await Promise.all([
        this.getHostname(),
        this.getOS(),
        this.getKernel(),
        this.getArchitecture(),
        this.getUptime(),
        this.getCPUUsage(),
        this.getMemoryUsage(),
        this.getTemperature(),
        this.getIPAddress(),
        this.getDiskIO(),
        this.getNetworkBandwidth(),
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

      // Log historical data asynchronously
      this.logHistoricalData(systemData).catch(err => console.error("Failed to log historical data:", err));

      // Check for temperature alerts
      this.checkTemperatureAlert(systemData.temperature);

      return systemData;
    } catch (error) {
      console.error("Error getting system info:", error);
      throw new Error("Failed to retrieve system information");
    }
  }

  private static checkTemperatureAlert(currentTemperature: number): void {
    const existingAlert = activeAlerts.find(alert => alert.type === 'temperature');
    if (currentTemperature > TEMPERATURE_THRESHOLD) {
      if (!existingAlert) {
        const newAlert: ActiveAlert = {
          id: `temp-${Date.now()}`,
          message: `Temperature exceeded ${TEMPERATURE_THRESHOLD}°C: Currently ${currentTemperature.toFixed(1)}°C`,
          timestamp: new Date(),
          type: 'temperature',
        };
        activeAlerts.push(newAlert);
        // Here you could also emit an event if using a more complex event system
      } else {
        // Optionally update the existing alert message or timestamp if it's still active
        existingAlert.message = `Temperature remains above ${TEMPERATURE_THRESHOLD}°C: Currently ${currentTemperature.toFixed(1)}°C`;
        existingAlert.timestamp = new Date();
      }
    } else {
      if (existingAlert) {
        // Temperature is back to normal, remove the alert
        activeAlerts = activeAlerts.filter(alert => alert.type !== 'temperature');
      }
    }
  }

  static getActiveAlerts(): ActiveAlert[] {
    return activeAlerts;
  }

private static async getDiskIO(): Promise<DiskIO> {
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
      previousDiskStats = { read: readSectors, write: writeSectors, timestamp: now };
      await new Promise(r => setTimeout(r, 500));
      return this.getDiskIO();
    }

    previousDiskStats = { read: readSectors, write: writeSectors, timestamp: now };

    const utilization = Math.min((readSpeed + writeSpeed) / 10, 100);
    const result: DiskIO = {
      readSpeed: Math.round(readSpeed),
      writeSpeed: Math.round(writeSpeed),
      utilization: Math.round(utilization),
    };
    console.log('Disk I/O:', result);
    return result;
  } catch (error) {
    console.error('Error getting disk I/O:', error);
    return { readSpeed: 0, writeSpeed: 0, utilization: 0 };
  }
}
private static async getNetworkBandwidth(): Promise<NetworkBandwidth> {
  try {
    const readStats = async () => {
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
          console.log(`Failed to read stats for interface ${iface}:`, err);
        }
      }
      return { rx, tx };
    };

    const first = await readStats();
    await new Promise(res => setTimeout(res, 500));
    const second = await readStats();

    const diffSec = 0.5;
    let rxSpeed = Math.max(0, (second.rx - first.rx) / 1024 / diffSec);
    let txSpeed = Math.max(0, (second.tx - first.tx) / 1024 / diffSec);

    if (!isFinite(rxSpeed) || !isFinite(txSpeed)) {
      rxSpeed = 0;
      txSpeed = 0;
    }

    previousNetworkStats = { rx: second.rx, tx: second.tx, timestamp: Date.now() };

    const result: NetworkBandwidth = {
      rx: Math.round(rxSpeed),
      tx: Math.round(txSpeed),
    };
    console.log('Network bandwidth:', result);
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

  private static async logHistoricalData(data: SystemInfo): Promise<void> {
    try {
        const metricRecord: InsertHistoricalMetric = {
          timestamp: new Date(), // Drizzle handles defaultNow, but explicit is fine
          cpuUsage: Math.round(data.cpu ?? 0),
          memoryUsage: Math.round(data.memory?.percentage ?? 0),
          temperature: Math.round(data.temperature ?? 0),
          diskReadSpeed: Math.round(data.diskIO?.readSpeed ?? 0),
          diskWriteSpeed: Math.round(data.diskIO?.writeSpeed ?? 0),
          networkRx: Math.round(data.networkBandwidth?.rx ?? 0),
          networkTx: Math.round(data.networkBandwidth?.tx ?? 0),
        };
      await db.insert(historicalMetrics).values(metricRecord);

      // Prune old data (older than 24 hours)
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await db.delete(historicalMetrics).where(sql`${historicalMetrics.timestamp} < ${twentyFourHoursAgo}`);

    } catch (error) {
      console.error("Error logging historical data:", error);
    }
  }

  static async getHistoricalData(): Promise<HistoricalMetric[]> {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return await db.select().from(historicalMetrics)
        .where(sql`${historicalMetrics.timestamp} >= ${twentyFourHoursAgo}`)
        .orderBy(historicalMetrics.timestamp);
    } catch (error) {
      console.error("Error retrieving historical data:", error);
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
    try {
      const { stdout } = await execAsync("lsb_release -d | cut -f2");
      return stdout.trim();
    } catch {
      return "Unknown OS";
    }
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

  private static async getTemperature(): Promise<number> {
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
          console.log(`CPU temperature: ${temperatureC.toFixed(1)}°C (thermal zone)`);
          return Math.round(temperatureC * 10) / 10; // Round to 1 decimal place
        } else {
          console.warn(`Invalid temperature reading: ${temperatureC}°C`);
        }
      }
    } catch (error) {
      console.log('Thermal zone method failed:', error.message);
    }

    // Method 2: Fallback to vcgencmd if thermal zone fails
    try {
      const { stdout } = await execAsync("vcgencmd measure_temp | cut -d= -f2 | cut -d\\' -f1");
      const temp = parseFloat(stdout.trim());
      if (!isNaN(temp) && temp > 0) {
        console.log(`CPU temperature: ${temp.toFixed(1)}°C (vcgencmd)`);
        return temp;
      }
    } catch (error) {
      console.log('vcgencmd method failed:', error.message);
    }

    // Method 3: Fallback to sensors command
    try {
      const { stdout } = await execAsync("sensors | grep -E '(Core 0|Package id 0|Tctl)' | head -1 | awk '{print $3}' | cut -d+ -f2 | cut -d° -f1");
      const temp = parseFloat(stdout.trim());
      if (!isNaN(temp) && temp > 0) {
        console.log(`CPU temperature: ${temp.toFixed(1)}°C (sensors)`);
        return temp;
      }
    } catch (error) {
      console.log('sensors method failed:', error.message);
    }

    console.warn('All temperature reading methods failed, returning 0');
    return 0;
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
      const logDir = "/home/zk/logs";
      
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
      // Security check - ensure path is within logs directory
      const normalizedPath = path.normalize(filePath);
      if (!normalizedPath.includes("/home/zk/logs/")) {
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

  static async getDockerContainers(): Promise<DockerContainer[]> {
    try {
      const { stdout } = await execAsync("docker ps -a --format 'table {{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.State}}'");
      const lines = stdout.trim().split("\n").slice(1); // Remove header
      
      return lines.map(line => {
        const parts = line.split("\t");
        return {
          id: parts[0] || "",
          name: parts[1] || "",
          image: parts[2] || "",
          status: parts[3] || "",
          state: parts[3]?.includes("Up") ? "running" : "stopped"
        };
      });
    } catch (error) {
      console.error("Error getting Docker containers:", error);
      return [];
    }
  }

  static async getPM2Processes(): Promise<PM2Process[]> {
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

  static async restartDockerContainer(containerId: string): Promise<void> {
    try {
      await execAsync(`docker restart ${containerId}`);
    } catch (error) {
      console.error("Error restarting Docker container:", error);
      throw new Error("Failed to restart container");
    }
  }

  static async stopDockerContainer(containerId: string): Promise<void> {
    try {
      await execAsync(`docker stop ${containerId}`);
    } catch (error) {
      console.error("Error stopping Docker container:", error);
      throw new Error("Failed to stop container");
    }
  }

  static async startDockerContainer(containerId: string): Promise<void> {
    try {
      await execAsync(`docker start ${containerId}`);
    } catch (error) {
      console.error("Error starting Docker container:", error);
      throw new Error("Failed to start container");
    }
  }

  static async restartPM2Process(processName: string): Promise<void> {
    try {
      await execAsync(`pm2 restart ${processName}`);
    } catch (error) {
      console.error("Error restarting PM2 process:", error);
      throw new Error("Failed to restart process");
    }
  }

  static async stopPM2Process(processName: string): Promise<void> {
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
      const { stdout } = await execAsync("/home/zk/bin/check-reboot.sh");
      const result = JSON.parse(stdout.trim());
      return Boolean(result.reboot_required);
    } catch (error) {
      console.error("Error checking reboot requirement:", error);
      throw new Error("Failed to check reboot status");
    }
  }

  static async updateSystem(): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(
        "sudo apt-get update && sudo apt-get upgrade -y"
      );
      return stdout || stderr;
    } catch (error) {
      console.error("Error updating system:", error);
      throw new Error("System update failed");
    }
  }
}
