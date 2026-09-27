import { useQuery } from "@tanstack/react-query";
import type { ActiveAlert } from "@shared/schema";

export function useAlerts() {
  return useQuery<ActiveAlert[]>({
    queryKey: ["/api/system/alerts"],
    refetchInterval: 7000, // offset from systemInfo (5s), which is what raises alerts
  });
}
