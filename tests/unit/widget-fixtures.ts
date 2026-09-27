// Realistic responses, shaped after the server handlers in server/routes/*.
export const FIXTURES: Record<string, unknown> = {
  "/api/system/info": {
    hostname: "piapps", os: "Ubuntu 26.04 LTS", kernel: "6.8.0-1010-raspi", architecture: "aarch64",
    uptime: "3 days, 2 hours", cpu: 12.5, memory: { used: 2048, total: 8192, percentage: 25 },
    temperature: 51.2, network: { ip: "192.168.50.10", status: "Connected" },
    diskIO: { readSpeed: 12, writeSpeed: 340, utilization: 3 }, networkBandwidth: { rx: 80, tx: 12 },
    processes: [{ pid: 1234, name: "node", cpuUsage: 7.1, memUsage: 3.2 }],
  },
  "/api/system/history": [
    { id: 1, timestamp: "2026-09-22 06:52:00.123", cpuUsage: 10, memoryUsage: 25, temperature: 50,
      diskReadSpeed: 1, diskWriteSpeed: 2, networkRx: 3, networkTx: null },
  ],
  "/api/metrics/cpu-freq": [{ core: "cpu0", freq: "1800 MHz" }, { core: "cpu1", freq: "N/A" }],
  "/api/metrics/filesystems": [{ device: "/dev/nvme0n1p2", mount: "/", type: "ext4", size: 468000, used: 120000, avail: 330000, pcent: 27 }],
  "/api/metrics/mounts": [{ device: "/dev/nvme0n1p2", mountpoint: "/", fstype: "ext4", options: "rw,relatime" }],
  "/api/metrics/ram": { total: 8192, used: 2048, free: 4096, usage: 25 },
  "/api/metrics/swap": { total: 0, used: 0, free: 0 },
  "/api/metrics/nvme": { temperature: "41", power_on_hours: "1,204", wear_leveling_count: null, media_errors: "0" },
  "/api/metrics/thermal-zones": [{ zone: "thermal_zone0", label: "cpu-thermal", temp: "51.2°C" }],
  "/api/metrics/power-status": { voltage: 0.88, current: null, status: "Normal" },
  "/api/metrics/ip-config": { interfaces: [{ ifname: "eth0", addr: ["192.168.50.10"], ipv6: [], mac: "dc:a6:32:00:00:01" }] },
  "/api/metrics/listening-ports": { listening: [{ proto: "tcp", port: 22, ip: "0.0.0.0", desc: "SSH" }] },
  "/api/metrics/firewall-status": { engine: "ufw", enabled: true, rules: [{ to: "22/tcp", action: "ALLOW IN", from: "Anywhere" }] },
};
