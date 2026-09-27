import { Badge } from "@/components/ui/badge";
import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { firewallStatusSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";

const MAX_DISPLAY = 20;

function actionColor(action: string) {
  const a = action.toUpperCase();
  if (a.startsWith("ALLOW")) return "text-pi-success";
  if (a.startsWith("LIMIT")) return "text-pi-warning";
  return "text-pi-error";
}

export function FirewallStatus() {
  const query = useWidgetQuery("/api/metrics/firewall-status", 30000, firewallStatusSchema);
  return (
    <QueryState query={query}>
      {(d) => (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={d.enabled ? "border-pi-success text-pi-success" : "border-pi-error text-pi-error"}>
              {d.enabled ? "Active" : "Disabled"}
            </Badge>
            <span className="text-xs text-pi-text-muted">
              Engine: <span className="font-mono">{d.engine}</span>
            </span>
          </div>
          {d.note && <p className="text-xs italic text-pi-text-muted">{d.note}</p>}
          {d.rules.length === 0 ? (
            <p className="text-pi-text-muted">No firewall rules configured</p>
          ) : (
            <>
              {d.rules.length > MAX_DISPLAY && (
                <p className="text-xs text-pi-text-muted">
                  Showing {MAX_DISPLAY} of {d.rules.length} rules
                </p>
              )}
              <div className="custom-scrollbar max-h-56 overflow-y-auto">
                <table className="w-full table-fixed text-sm">
                  <thead className="sticky top-0 bg-pi-card text-xs text-pi-text-muted">
                    <tr>
                      <th scope="col" className="py-1 text-left font-medium">To</th>
                      <th scope="col" className="w-24 py-1 text-left font-medium">Action</th>
                      <th scope="col" className="py-1 text-left font-medium">From</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-pi-border">
                    {d.rules.slice(0, MAX_DISPLAY).map((r, i) => (
                      <tr key={i} title={r.comment}>
                        <td className="truncate py-1 pr-2 font-mono text-xs">{r.to ?? (r.port ? `${r.port}/${r.proto ?? "tcp"}` : "—")}</td>
                        <td className={`whitespace-nowrap py-1 pr-2 text-xs ${actionColor(r.action)}`}>{r.action}</td>
                        <td className="truncate py-1 font-mono text-xs">{r.from ?? "Anywhere"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </QueryState>
  );
}
