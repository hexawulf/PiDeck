import { useSystemInfo } from "@/hooks/use-system-info";
import { formatMB } from "@/lib/format";
import { QueryState } from "@/widgets/WidgetFrame";
import { Meter } from "./Meter";

export function MemoryBox() {
  const query = useSystemInfo();
  return (
    <QueryState query={query}>
      {({ memory }) => (
        <Meter
          label="Memory usage"
          value={`${memory.percentage}%`}
          percent={memory.percentage}
          barClassName="bg-pi-chart-2"
          caption={`${formatMB(memory.used)} / ${formatMB(memory.total)}`}
        />
      )}
    </QueryState>
  );
}
