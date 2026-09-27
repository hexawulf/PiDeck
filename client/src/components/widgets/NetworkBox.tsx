import { useSystemInfo } from "@/hooks/use-system-info";
import { formatRate } from "@/lib/format";
import { QueryState } from "@/widgets/WidgetFrame";
import { Meter } from "./Meter";

export function NetworkBox() {
  const query = useSystemInfo();
  return (
    <QueryState query={query}>
      {({ network, networkBandwidth }) => (
        <Meter
          label="Network"
          value={network.ip || "N/A"}
          valueClassName="font-mono text-lg"
          caption={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-pi-success" aria-hidden />
                {network.status}
              </span>
              <span className="tabular-nums">
                ↓ {formatRate(networkBandwidth.rx)} · ↑ {formatRate(networkBandwidth.tx)}
              </span>
            </span>
          }
        />
      )}
    </QueryState>
  );
}
