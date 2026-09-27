import { useQuery } from "@tanstack/react-query";
import type { ActiveAlert } from "@shared/schema";

// Alerts are raised by the server's 60s sampler (server/services/sampler.ts).
// This poll only picks them up for the toast, so it keeps a fixed 7s and
// deliberately ignores the refresh speed and Pause (E1) — don't use useRefetch here.
export const ALERTS_INTERVAL_MS = 7000;

export function useAlerts() {
  return useQuery<ActiveAlert[]>({
    queryKey: ["/api/system/alerts"],
    refetchInterval: ALERTS_INTERVAL_MS,
  });
}
