import { formatMB } from "@/lib/format";
import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { swapSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";
import { KeyValueList } from "./KeyValueList";

export function SwapUsageBox() {
  const query = useWidgetQuery("/api/metrics/swap", 10000, swapSchema);
  return (
    <QueryState query={query}>
      {(d) =>
        d.total === 0 ? (
          <p className="text-pi-text-muted">No swap configured</p>
        ) : (
          <KeyValueList
            rows={[
              ["Total", formatMB(d.total)],
              ["Used", formatMB(d.used)],
              ["Free", formatMB(d.free)],
              ["Usage", `${Math.round((d.used / d.total) * 100)}%`],
            ]}
          />
        )
      }
    </QueryState>
  );
}
