import type { RefObject } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useUpdateSystem } from "@/hooks/use-system-info";
import { toast } from "@/hooks/use-toast";
import { describeStart, watchSystemUpdate, type UpdateStatus } from "@/lib/system-update";

/**
 * Update System always goes through this confirm (E7) — Quick Actions and the
 * command palette both render it. The server starts `apt-get update && upgrade -y`
 * as a background job (lib/system-update.ts follows it).
 */
export function UpdateSystemConfirm({
  open,
  onOpenChange,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const update = useUpdateSystem();
  const onConfirm = async () => {
    try {
      // 202 { state: "running", log }: the job runs in the background and is followed until it ends.
      const res = await update.mutateAsync();
      const body = (await res.json().catch(() => ({}))) as UpdateStatus;
      const start = describeStart(body);
      toast({ title: start.title, description: start.description });
      if (start.watch) watchSystemUpdate();
    } catch (error) {
      if (error instanceof Error && /already running/i.test(error.message)) {
        toast({ title: "Update already running", description: "A system update is in progress; its output is on the Logs tab." });
        watchSystemUpdate();
      } else {
        // Network error, cross-origin/auth failure, 409 (disabled here) or 500: same toast as before (error registry).
        toast({ title: "Error", description: "Failed to update system", variant: "destructive" });
      }
    } finally {
      onOpenChange(false);
    }
  };
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Update system?"
      description="Runs apt-get update and apt-get upgrade -y on this host, in the background. It can take several minutes and may restart services; the output goes to a log on the Logs tab."
      confirmLabel="Update system"
      pendingLabel="Starting…"
      destructive
      pending={update.isPending}
      onConfirm={() => void onConfirm()}
      returnFocusRef={returnFocusRef}
    />
  );
}
