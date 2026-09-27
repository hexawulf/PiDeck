import { Link } from "wouter";
import { BarChart3, Download, ListChecks, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRefreshAll } from "@/hooks/use-refresh-all";
import { useUpdateSystem } from "@/hooks/use-system-info";

const tile =
  "flex h-full min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-md border border-pi-border bg-pi-darker p-2 text-xs hover:bg-pi-card-hover disabled:opacity-50";

export function QuickActionsBox() {
  const refreshAll = useRefreshAll();
  const update = useUpdateSystem();
  const { toast } = useToast();

  const onUpdate = async () => {
    try {
      await update.mutateAsync();
      toast({ title: "Success", description: "System updated successfully" });
    } catch {
      toast({ title: "Error", description: "Failed to update system", variant: "destructive" });
    }
  };

  return (
    <div className="grid h-full grid-cols-2 gap-2">
      <button type="button" className={tile} onClick={() => void refreshAll()}>
        <RefreshCw className="h-5 w-5 text-pi-accent-text" aria-hidden />
        Refresh data
      </button>
      <button type="button" className={tile} onClick={onUpdate} disabled={update.isPending} data-testid="update-system">
        <Download className={`h-5 w-5 text-pi-success ${update.isPending ? "animate-spin" : ""}`} aria-hidden />
        Update system
      </button>
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
