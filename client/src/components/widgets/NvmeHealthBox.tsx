import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { nvmeSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";
import { KeyValueList } from "./KeyValueList";

export function NvmeHealthBox() {
  const query = useWidgetQuery("/api/metrics/nvme", 10000, nvmeSchema);
  return (
    <QueryState query={query}>
      {(d) => (
        <KeyValueList
          rows={[
            ["Temperature", d.temperature === null ? null : `${d.temperature}°C`],
            ["Power-on hours", d.power_on_hours],
            ["Wear leveling", d.wear_leveling_count],
            ["Media errors", d.media_errors],
          ]}
        />
      )}
    </QueryState>
  );
}
