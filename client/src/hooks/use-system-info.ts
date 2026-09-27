import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { historySchema, systemInfoSchema } from "@/widgets/schemas";

// Polling /api/system/info also drives server-side alert checks and history
// rows (server/services/system.ts) until the server gets its own sampler.
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
