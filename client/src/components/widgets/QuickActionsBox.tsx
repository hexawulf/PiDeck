import { useState } from "react";
import { Link } from "wouter";
import { BarChart3, Download, ListChecks, RefreshCw } from "lucide-react";
import { useRefreshAll } from "@/hooks/use-refresh-all";
import { UpdateSystemConfirm } from "@/components/update-system-confirm";

const tile =
  "flex h-full min-h-[3.5rem] flex-col items-center justify-center gap-1 rounded-md border border-pi-border bg-pi-darker p-2 text-xs hover:bg-pi-card-hover disabled:opacity-50";

export function QuickActionsBox() {
  const refreshAll = useRefreshAll();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="grid h-full grid-cols-2 gap-2">
      <button type="button" className={tile} onClick={() => void refreshAll()}>
        <RefreshCw className="h-5 w-5 text-pi-accent-text" aria-hidden />
        Refresh data
      </button>
      <button type="button" className={tile} onClick={() => setConfirming(true)} data-testid="update-system">
        <Download className="h-5 w-5 text-pi-success" aria-hidden />
        Update system
      </button>
      <UpdateSystemConfirm open={confirming} onOpenChange={setConfirming} />
      <Link href="/apps" className={tile}>
        <ListChecks className="h-5 w-5 text-pi-chart-1" aria-hidden />
        Manage apps
      </Link>
      <Link href="/logs" className={tile}>
        <BarChart3 className="h-5 w-5 text-pi-warning" aria-hidden />
        View logs
      </Link>
    </div>
  );
}
