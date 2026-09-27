import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { ipConfigSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";

export function IpConfigWidget() {
  const query = useWidgetQuery("/api/metrics/ip-config", 30000, ipConfigSchema);
  return (
    <QueryState query={query} isEmpty={(d) => d.interfaces.length === 0} emptyText="No active interfaces">
      {({ interfaces }) => (
        <div className="custom-scrollbar max-h-64 space-y-3 overflow-y-auto">
          {interfaces.map((iface) => (
            <div key={iface.ifname} className="border-b border-pi-border pb-2 last:border-0">
              <p className="font-semibold text-pi-accent">{iface.ifname}</p>
              {iface.addr.length > 0 && (
                <p className="text-xs text-pi-text-muted">
                  IPv4: <span className="font-mono">{iface.addr.join(", ")}</span>
                </p>
              )}
              {iface.ipv6.length > 0 && (
                <p className="truncate text-xs text-pi-text-muted" title={iface.ipv6.join(", ")}>
                  IPv6: <span className="font-mono">{iface.ipv6.join(", ")}</span>
                </p>
              )}
              {iface.mac && (
                <p className="text-xs text-pi-text-muted">
                  MAC: <span className="font-mono">{iface.mac}</span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </QueryState>
  );
}
