import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRefetch } from "./useRefetch";
import { useHost } from "@/hosts/HostProvider";
import { LOCAL_HOST } from "@/hosts/host-path";
import { widgetQueryKey } from "@/widgets/useWidgetQuery";
import type { PM2Process } from "@shared/schema";
import type { Unavailable } from "@/widgets/schemas";

const URL = "/api/pm2/processes";

export type ProcessAction = "restart" | "stop";

export function usePm2() {
  const host = useHost();
  // An Unavailable object instead of the list when pm2 isn't installed (e.g. a systemd install).
  return useQuery<PM2Process[] | Unavailable>({ queryKey: widgetQueryKey(host.id, URL), refetchInterval: useRefetch(10000) });
}

/** Local host only: agents have no mutating routes. */
export function useProcessAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, action }: { name: string; action: ProcessAction }) =>
      apiRequest("POST", `/api/pm2/processes/${name}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: widgetQueryKey(LOCAL_HOST, URL) }),
  });
}
