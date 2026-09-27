import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { powerStatusSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";
import { KeyValueList } from "./KeyValueList";

const STATUS_CLASS: Record<string, string> = {
  Normal: "text-pi-success",
  Throttled: "text-pi-warning",
  Throttling: "text-pi-error",
};

export function PowerStatusBox() {
  const query = useWidgetQuery("/api/metrics/power-status", 10000, powerStatusSchema);
  return (
    <QueryState query={query}>
      {(d) => (
        <div className="space-y-2">
          <p className={`text-lg font-semibold ${STATUS_CLASS[d.status] ?? "text-pi-text-muted"}`}>{d.status}</p>
          <KeyValueList rows={[["Core voltage", d.voltage === null ? null : `${d.voltage.toFixed(2)} V`]]} />
        </div>
      )}
    </QueryState>
  );
}
