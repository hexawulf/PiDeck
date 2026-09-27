import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity, Cpu, Gauge, HardDrive, Info, List, MemoryStick, Network, Plug, Server, Settings,
  Shield, Thermometer, Waves, Wifi, Zap, FolderTree, Radio, BatteryCharging,
} from "lucide-react";
import { CpuBox } from "@/components/widgets/CpuBox";
import { MemoryBox } from "@/components/widgets/MemoryBox";
import { TemperatureBox } from "@/components/widgets/TemperatureBox";
import { NetworkBox } from "@/components/widgets/NetworkBox";
import { SystemInfoBox } from "@/components/widgets/SystemInfoBox";
import { TopProcessesBox } from "@/components/widgets/TopProcessesBox";
import { DiskIoBox } from "@/components/widgets/DiskIoBox";
import { NetworkBandwidthBox } from "@/components/widgets/NetworkBandwidthBox";
import { CpuFreqBox } from "@/components/widgets/CpuFreqBox";
import { NvmeHealthBox } from "@/components/widgets/NvmeHealthBox";
import { ThermalZoneBox } from "@/components/widgets/ThermalZoneBox";
import { PowerStatusBox } from "@/components/widgets/PowerStatusBox";
import { RamStatsBox } from "@/components/widgets/RamStatsBox";
import { SwapUsageBox } from "@/components/widgets/SwapUsageBox";
import { QuickActionsBox } from "@/components/widgets/QuickActionsBox";
import { FilesystemUsageBox } from "@/components/widgets/FilesystemUsageBox";
import { MountInfoBox } from "@/components/widgets/MountInfoBox";
import { IpConfigWidget } from "@/components/widgets/network/IpConfigWidget";
import { ListeningPortsWidget } from "@/components/widgets/network/ListeningPortsWidget";
import { FirewallStatus } from "@/components/widgets/network/FirewallStatus";

/** Size on a 12-column grid; h is in grid rows (1 row ≈ a stat card). */
export type WidgetSize = { w: 3 | 4 | 6 | 8 | 12; h: 1 | 2 };

export type WidgetDef = {
  id: string;
  title: string;
  icon: LucideIcon;
  defaultSize: WidgetSize;
  component: ComponentType;
};

// Order here is the default dashboard order.
export const WIDGETS: readonly WidgetDef[] = [
  { id: "cpu", title: "CPU Usage", icon: Cpu, defaultSize: { w: 3, h: 1 }, component: CpuBox },
  { id: "memory", title: "Memory", icon: Zap, defaultSize: { w: 3, h: 1 }, component: MemoryBox },
  { id: "temperature", title: "Temperature", icon: Thermometer, defaultSize: { w: 3, h: 1 }, component: TemperatureBox },
  { id: "network", title: "Network", icon: Wifi, defaultSize: { w: 3, h: 1 }, component: NetworkBox },
  { id: "system-info", title: "System Information", icon: Info, defaultSize: { w: 6, h: 2 }, component: SystemInfoBox },
  { id: "top-processes", title: "Top Processes", icon: List, defaultSize: { w: 6, h: 2 }, component: TopProcessesBox },
  { id: "disk-io", title: "Disk I/O", icon: HardDrive, defaultSize: { w: 6, h: 2 }, component: DiskIoBox },
  { id: "net-bandwidth", title: "Network Bandwidth", icon: Activity, defaultSize: { w: 6, h: 2 }, component: NetworkBandwidthBox },
  { id: "cpu-freq", title: "CPU Frequency", icon: Gauge, defaultSize: { w: 3, h: 1 }, component: CpuFreqBox },
  { id: "nvme", title: "NVMe Health", icon: Server, defaultSize: { w: 3, h: 1 }, component: NvmeHealthBox },
  { id: "thermal-zones", title: "Thermal Sensors", icon: Waves, defaultSize: { w: 3, h: 1 }, component: ThermalZoneBox },
  { id: "power-status", title: "Power Status", icon: BatteryCharging, defaultSize: { w: 3, h: 1 }, component: PowerStatusBox },
  { id: "ram", title: "RAM", icon: MemoryStick, defaultSize: { w: 4, h: 1 }, component: RamStatsBox },
  { id: "swap", title: "Swap", icon: Plug, defaultSize: { w: 4, h: 1 }, component: SwapUsageBox },
  { id: "quick-actions", title: "Quick Actions", icon: Settings, defaultSize: { w: 4, h: 1 }, component: QuickActionsBox },
  { id: "filesystems", title: "Filesystem Usage", icon: HardDrive, defaultSize: { w: 6, h: 2 }, component: FilesystemUsageBox },
  { id: "mounts", title: "Mounts", icon: FolderTree, defaultSize: { w: 6, h: 2 }, component: MountInfoBox },
  { id: "ip-config", title: "IP Configuration", icon: Network, defaultSize: { w: 4, h: 2 }, component: IpConfigWidget },
  { id: "listening-ports", title: "Listening Ports", icon: Radio, defaultSize: { w: 4, h: 2 }, component: ListeningPortsWidget },
  { id: "firewall", title: "Firewall", icon: Shield, defaultSize: { w: 4, h: 2 }, component: FirewallStatus },
];
