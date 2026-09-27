import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { thermalZonesSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";
import { KeyValueList } from "./KeyValueList";

export function ThermalZoneBox() {
  const query = useWidgetQuery("/api/metrics/thermal-zones", 10000, thermalZonesSchema);
  return (
    <QueryState query={query} isEmpty={(d) => d.length === 0} emptyText="No thermal sensors found">
      {(zones) => <KeyValueList rows={zones.map((z) => [`${z.label}`, z.temp] as [string, string])} />}
    </QueryState>
  );
}
