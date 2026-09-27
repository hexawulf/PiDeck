import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { listeningPortsSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";

export function ListeningPortsWidget() {
  const query = useWidgetQuery("/api/metrics/listening-ports", 30000, listeningPortsSchema);
  return (
    <QueryState query={query} isEmpty={(d) => d.listening.length === 0} emptyText="No listening ports">
      {({ listening }) => (
        <div>
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 bg-pi-card text-xs text-pi-text-muted">
              <tr>
                <th scope="col" className="w-16 py-1 text-left font-medium">Port</th>
                <th scope="col" className="w-14 py-1 text-left font-medium">Proto</th>
                <th scope="col" className="py-1 text-left font-medium">IP</th>
                <th scope="col" className="py-1 text-left font-medium">Service</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pi-border">
              {listening.map((p) => (
                <tr key={`${p.proto}-${p.port}-${p.ip}`}>
                  <td className="py-1 font-mono">{p.port}</td>
                  <td className="py-1 text-xs">{p.proto}</td>
                  <td className="truncate py-1 font-mono text-xs" title={p.ip}>{p.ip === "0.0.0.0" ? "*" : p.ip}</td>
                  <td className="truncate py-1 text-xs">{p.desc || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </QueryState>
  );
}
