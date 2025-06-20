import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import type { SystemInfo, LogFile, DockerContainer, PM2Process, CronJob } from "@shared/schema";

const execAsync = promisify(exec);

export class SystemService {
  static async getSystemInfo(): Promise<SystemInfo> {
    try {
      const [hostname, os, kernel, arch, uptime, cpu, memory, temp, ip] = await Promise.all([
        this.getHostname(),
        this.getOS(),
        this.getKernel(),
        this.getArchitecture(),
        this.getUptime(),
        this.getCPUUsage(),
        this.getMemoryUsage(),
        this.getTemperature(),
        this.getIPAddress(),
      ]);

      return {
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
        }
      };
    } catch (error) {
      console.error("Error getting system info:", error);
      throw new Error("Failed to retrieve system information");
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
      const { stdout } = await execAsync("vcgencmd measure_temp | cut -d= -f2 | cut -d\\' -f1");
      return parseFloat(stdout.trim()) || 0;
    } catch {
      // Fallback for non-Pi systems
      try {
        const { stdout } = await execAsync("sensors | grep 'Core 0' | awk '{print $3}' | cut -d+ -f2 | cut -d° -f1");
        return parseFloat(stdout.trim()) || 0;
      } catch {
        return 0;
      }
    }
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
      
      const content = await fs.readFile(filePath, "utf-8");
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
}
