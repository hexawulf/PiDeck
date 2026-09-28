import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRefetch } from "./useRefetch";
import { useHost } from "@/hosts/HostProvider";
import { LOCAL_HOST } from "@/hosts/host-path";
import { widgetQueryKey } from "@/widgets/useWidgetQuery";
import type { DockerContainersResponse } from "@shared/schema";

const URL = "/api/docker/containers";

export type ContainerAction = "restart" | "stop" | "start";

/** Containers on the current host (read-only on remote hosts in H1). */
export function useDocker() {
  const host = useHost();
  return useQuery<DockerContainersResponse>({ queryKey: widgetQueryKey(host.id, URL), refetchInterval: useRefetch(10000) });
}

/** Local host only: agents have no mutating routes. */
export function useContainerAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: ContainerAction }) =>
      apiRequest("POST", `/api/docker/containers/${id}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: widgetQueryKey(LOCAL_HOST, URL) }),
  });
}
