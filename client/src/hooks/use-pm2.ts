import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { PM2Process } from "@shared/schema";

const KEY = ["/api/pm2/processes"];

export type ProcessAction = "restart" | "stop";

export function usePm2() {
  return useQuery<PM2Process[]>({ queryKey: KEY, refetchInterval: 10000 });
}

export function useProcessAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, action }: { name: string; action: ProcessAction }) =>
      apiRequest("POST", `/api/pm2/processes/${name}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
