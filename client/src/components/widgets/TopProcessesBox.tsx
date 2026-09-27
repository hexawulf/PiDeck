import { useSystemInfo } from "@/hooks/use-system-info";
import { QueryState } from "@/widgets/WidgetFrame";

// Top 5 by CPU, straight from /api/system/info (already polled for the header),
// instead of a second request to /api/metrics/top-processes.
export function TopProcessesBox() {
  const query = useSystemInfo();
  return (
    <QueryState query={query} isEmpty={(d) => !d.processes?.length} emptyText="No process data available">
      {(d) => (
        <table className="w-full table-fixed text-sm">
          <thead className="text-xs text-pi-text-muted">
            <tr>
              <th scope="col" className="w-20 py-1 text-left font-medium">PID</th>
              <th scope="col" className="py-1 text-left font-medium">Name</th>
              <th scope="col" className="w-16 py-1 text-right font-medium">CPU %</th>
              <th scope="col" className="w-16 py-1 text-right font-medium">Mem %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pi-border">
            {d.processes!.map((p) => (
              <tr key={p.pid}>
                <td className="py-1 font-mono text-xs">{p.pid}</td>
                <td className="truncate py-1" title={p.name}>{p.name}</td>
                <td className="py-1 text-right tabular-nums">{p.cpuUsage.toFixed(1)}</td>
                <td className="py-1 text-right tabular-nums">{p.memUsage.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </QueryState>
  );
}
