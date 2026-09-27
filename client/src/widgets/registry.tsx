import { memo, type ComponentType } from "react";
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

/*
 * Sizes are react-grid-layout units: w of 12 columns, h in grid rows
 * (30px rows + 16px gaps in comfortable density: 4 rows ≈ a stat card,
 * 8 rows ≈ a chart). defaultSize × registry order = the default layout
 * (prefs.ts packs it left to right, like the P1 CSS grid did).
 */
export type WidgetSize = { w: number; h: number };

export type WidgetDef = {
  id: string;
  title: string;
  icon: LucideIcon;
  defaultSize: WidgetSize;
  minSize?: WidgetSize;
  maxSize?: WidgetSize;
  /** Memoized: bodies take no props, so grid re-renders (drag, edit) skip them (E21). */
  component: ComponentType;
};

const STAT = { defaultSize: { w: 3, h: 4 }, minSize: { w: 2, h: 3 }, maxSize: { w: 6, h: 8 } };
const SMALL = { defaultSize: { w: 3, h: 4 }, minSize: { w: 2, h: 3 } };
const THIRD = { defaultSize: { w: 4, h: 5 }, minSize: { w: 3, h: 3 } };
const HALF = { defaultSize: { w: 6, h: 8 }, minSize: { w: 3, h: 5 } };
const CHART = { defaultSize: { w: 6, h: 8 }, minSize: { w: 4, h: 7 } };
const TALL_THIRD = { defaultSize: { w: 4, h: 8 }, minSize: { w: 3, h: 5 } };

// Order here is the default dashboard order.
export const WIDGETS: readonly WidgetDef[] = [
  { id: "cpu", title: "CPU Usage", icon: Cpu, ...STAT, component: memo(CpuBox) },
  { id: "memory", title: "Memory", icon: Zap, ...STAT, component: memo(MemoryBox) },
  { id: "temperature", title: "Temperature", icon: Thermometer, ...STAT, component: memo(TemperatureBox) },
  { id: "network", title: "Network", icon: Wifi, ...STAT, component: memo(NetworkBox) },
  { id: "system-info", title: "System Information", icon: Info, ...HALF, component: memo(SystemInfoBox) },
  { id: "top-processes", title: "Top Processes", icon: List, ...HALF, component: memo(TopProcessesBox) },
  { id: "disk-io", title: "Disk I/O", icon: HardDrive, ...CHART, component: memo(DiskIoBox) },
  { id: "net-bandwidth", title: "Network Bandwidth", icon: Activity, ...CHART, component: memo(NetworkBandwidthBox) },
  { id: "cpu-freq", title: "CPU Frequency", icon: Gauge, ...SMALL, component: memo(CpuFreqBox) },
  { id: "nvme", title: "NVMe Health", icon: Server, ...SMALL, component: memo(NvmeHealthBox) },
  { id: "thermal-zones", title: "Thermal Sensors", icon: Waves, ...SMALL, component: memo(ThermalZoneBox) },
  { id: "power-status", title: "Power Status", icon: BatteryCharging, ...SMALL, component: memo(PowerStatusBox) },
  { id: "ram", title: "RAM", icon: MemoryStick, ...THIRD, component: memo(RamStatsBox) },
  { id: "swap", title: "Swap", icon: Plug, ...THIRD, component: memo(SwapUsageBox) },
  { id: "quick-actions", title: "Quick Actions", icon: Settings, ...THIRD, component: memo(QuickActionsBox) },
  { id: "filesystems", title: "Filesystem Usage", icon: HardDrive, ...HALF, component: memo(FilesystemUsageBox) },
  { id: "mounts", title: "Mounts", icon: FolderTree, ...HALF, component: memo(MountInfoBox) },
  { id: "ip-config", title: "IP Configuration", icon: Network, ...TALL_THIRD, component: memo(IpConfigWidget) },
  { id: "listening-ports", title: "Listening Ports", icon: Radio, ...TALL_THIRD, component: memo(ListeningPortsWidget) },
  { id: "firewall", title: "Firewall", icon: Shield, ...TALL_THIRD, component: memo(FirewallStatus) },
];
