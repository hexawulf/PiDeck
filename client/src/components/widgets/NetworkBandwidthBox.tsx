import { useSystemInfo } from "@/hooks/use-system-info";
import { formatRate } from "@/lib/format";
import { HistoryChart, type Series } from "./HistoryChart";

const SERIES: Series[] = [
  { key: "received", name: "Received", field: "networkRx", color: "var(--pi-chart-3)" },
  { key: "sent", name: "Sent", field: "networkTx", color: "var(--pi-chart-4)" },
];

export function NetworkBandwidthBox() {
  const now = useSystemInfo().data?.networkBandwidth;
  return (
    <HistoryChart
      id="net-bw"
      label="Network bandwidth"
      series={SERIES}
      current={now && `Now: ↓ ${formatRate(now.rx)} · ↑ ${formatRate(now.tx)}`}
    />
  );
}
