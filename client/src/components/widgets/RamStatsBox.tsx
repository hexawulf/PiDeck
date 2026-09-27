import { formatMB } from "@/lib/format";
import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { ramSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";
import { KeyValueList } from "./KeyValueList";

export function RamStatsBox() {
  const query = useWidgetQuery("/api/metrics/ram", 10000, ramSchema);
  return (
    <QueryState query={query}>
      {(d) => (
        <KeyValueList
          rows={[
            ["Total", formatMB(d.total)],
            ["Used", formatMB(d.used)],
            ["Free", formatMB(d.free)],
            ["Usage", `${d.usage}%${d.usage > 90 ? " ⚠️" : ""}`],
          ]}
        />
      )}
    </QueryState>
  );
}
