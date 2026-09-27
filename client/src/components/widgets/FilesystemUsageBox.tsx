import { formatMB } from "@/lib/format";
import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { filesystemsSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";

export function FilesystemUsageBox() {
  const query = useWidgetQuery("/api/metrics/filesystems", 10000, filesystemsSchema);
  return (
    <QueryState query={query} isEmpty={(d) => d.length === 0} emptyText="No filesystem data available">
      {(filesystems) => (
        <div>
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 bg-pi-card text-xs text-pi-text-muted">
              <tr>
                <th scope="col" className="py-1 text-left font-medium">Mount</th>
                <th scope="col" className="w-20 py-1 text-right font-medium">Used</th>
                <th scope="col" className="w-20 py-1 text-right font-medium">Free</th>
                <th scope="col" className="w-20 py-1 text-right font-medium">Size</th>
                <th scope="col" className="w-24 py-1 pl-3 text-left font-medium">Use</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pi-border">
              {filesystems.map((fs) => (
                <tr key={`${fs.device ?? ""}:${fs.mount}`}>
                  <td className="truncate py-1 font-mono text-xs" title={fs.mount}>{fs.mount}</td>
                  <td className="py-1 text-right tabular-nums">{formatMB(fs.used)}</td>
                  <td className="py-1 text-right tabular-nums">{formatMB(fs.avail)}</td>
                  <td className="py-1 text-right tabular-nums">{formatMB(fs.size)}</td>
                  <td className="py-1 pl-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-pi-darker" aria-hidden>
                        <div
                          className={`h-1.5 rounded-full ${fs.pcent >= 90 ? "bg-pi-error" : fs.pcent >= 75 ? "bg-pi-warning" : "bg-pi-chart-3"}`}
                          style={{ width: `${Math.min(100, fs.pcent)}%` }}
                        />
                      </div>
                      <span className="w-9 text-right text-xs tabular-nums">{fs.pcent}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </QueryState>
  );
}
