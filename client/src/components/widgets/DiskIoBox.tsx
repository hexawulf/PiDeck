import { useSystemInfo } from "@/hooks/use-system-info";
import { formatRate } from "@/lib/format";
import { HistoryChart, type Series } from "./HistoryChart";

const SERIES: Series[] = [
  { key: "read", name: "Read", field: "diskReadSpeed", color: "var(--pi-chart-1)" },
  { key: "write", name: "Write", field: "diskWriteSpeed", color: "var(--pi-chart-2)" },
];

export function DiskIoBox() {
  const now = useSystemInfo().data?.diskIO;
  return (
    <HistoryChart
      id="disk-io"
      label="Disk I/O"
      series={SERIES}
      current={now && `Now: read ${formatRate(now.readSpeed)} · write ${formatRate(now.writeSpeed)} · util ${now.utilization}%`}
    />
  );
}
