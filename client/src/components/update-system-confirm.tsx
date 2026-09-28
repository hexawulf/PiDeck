import type { RefObject } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useUpdateSystem } from "@/hooks/use-system-info";
import { toast } from "@/hooks/use-toast";

/**
 * Update System always goes through this confirm (E7) — Quick Actions and the
 * command palette both render it. The server runs `apt-get update && upgrade -y`.
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
      await update.mutateAsync();
      toast({ title: "Success", description: "System updated successfully" });
    } catch {
      // Network error, CSRF/auth failure, 409 (disabled here) or 500: same toast as before (error registry).
      toast({ title: "Error", description: "Failed to update system", variant: "destructive" });
    } finally {
      onOpenChange(false);
    }
  };
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Update system?"
      description="Runs apt-get update and apt-get upgrade -y on this host. It can take several minutes and may restart services."
      confirmLabel="Update system"
      pendingLabel="Updating…"
      destructive
      pending={update.isPending}
      onConfirm={() => void onConfirm()}
      returnFocusRef={returnFocusRef}
    />
  );
}
