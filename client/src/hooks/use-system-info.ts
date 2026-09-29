import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { historySchema, systemInfoSchema } from "@/widgets/schemas";
import { useHost } from "@/hosts/HostProvider";

// /api/system/info is read-only: history rows and alerts come from the
// server's 60s sampler (server/services/sampler.ts), not from these polls.
export function useSystemInfo() {
  return useWidgetQuery("/api/system/info", 5000, systemInfoSchema);
}

/**
 * The hub records every host's history (docs/plans/multi-host-h2.md), so this
 * always asks the hub: /api/system/history for itself (the 2.4 path), else
 * /api/history?host=<id>. The host id is in the path, so caches never mix.
 */
export function useHistory(long?: "3d" | "7d") {
  const host = useHost();
  // Long ranges come bucket-averaged from the hub and change slowly: poll every 5 min.
  if (long) return useWidgetQuery(`/api/history?host=${encodeURIComponent(host.id)}&range=${long}`, 300_000, historySchema, { scope: "hub" });
  const url = host.isLocal ? "/api/system/history" : `/api/history?host=${encodeURIComponent(host.id)}&range=24h`;
  return useWidgetQuery(url, 60000, historySchema, { scope: "hub" });
}

export function useUpdateSystem() {
  return useMutation({
    mutationFn: () => apiRequest("POST", "/api/system/update"),
  });
}
