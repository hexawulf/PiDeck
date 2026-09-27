import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { CronJob } from "@shared/schema";

export function useCron() {
  return useQuery<CronJob[]>({ queryKey: ["/api/cron/jobs"] });
}

export function useRunCronJob() {
  return useMutation({
    mutationFn: (command: string) => apiRequest("POST", "/api/cron/run", { command }),
  });
}
