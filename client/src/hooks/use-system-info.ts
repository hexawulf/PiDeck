import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { historySchema, systemInfoSchema } from "@/widgets/schemas";

// /api/system/info is read-only: history rows and alerts come from the
// server's 60s sampler (server/services/sampler.ts), not from these polls.
export function useSystemInfo() {
  return useWidgetQuery("/api/system/info", 5000, systemInfoSchema);
}

export function useHistory() {
  return useWidgetQuery("/api/system/history", 60000, historySchema);
}

export function useUpdateSystem() {
  return useMutation({
    mutationFn: () => apiRequest("POST", "/api/system/update"),
  });
}
