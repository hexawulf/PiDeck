import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { mountsSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";

export function MountInfoBox() {
  const query = useWidgetQuery("/api/metrics/mounts", 15000, mountsSchema);
  return (
    <QueryState query={query} isEmpty={(d) => d.length === 0} emptyText="No mount information available">
      {(mounts) => (
        <div className="custom-scrollbar max-h-64 overflow-y-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 bg-pi-card text-xs text-pi-text-muted">
              <tr>
                <th scope="col" className="w-1/4 py-1 text-left font-medium">Mount</th>
                <th scope="col" className="w-1/6 py-1 text-left font-medium">Type</th>
                <th scope="col" className="py-1 text-left font-medium">Flags</th>
                <th scope="col" className="w-1/4 py-1 text-left font-medium">Device</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pi-border">
              {mounts.map((m, i) => (
                <tr key={`${m.mountpoint}-${i}`}>
                  <td className="truncate py-1 pr-2 font-mono text-xs" title={m.mountpoint}>{m.mountpoint}</td>
                  <td className="truncate py-1 pr-2">{m.fstype}</td>
                  <td className="truncate py-1 pr-2 text-xs" title={m.options}>{m.options}</td>
                  <td className="truncate py-1 font-mono text-xs" title={m.device}>{m.device}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </QueryState>
  );
}
