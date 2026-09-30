import { useSystemInfo } from "@/hooks/use-system-info";
import { QueryState } from "@/widgets/WidgetFrame";
import { Meter } from "./Meter";

export function CpuBox() {
  const query = useSystemInfo();
  return (
    <QueryState query={query}>
      {(d) => <Meter label="CPU usage" value={`${d.cpu.toFixed(1)}%`} percent={d.cpu} barClassName="bg-pi-accent" />}
    </QueryState>
  );
}
