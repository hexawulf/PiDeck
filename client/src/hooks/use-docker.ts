import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRefetch } from "./useRefetch";
import type { DockerContainersResponse } from "@shared/schema";

const KEY = ["/api/docker/containers"];

export type ContainerAction = "restart" | "stop" | "start";

export function useDocker() {
  return useQuery<DockerContainersResponse>({ queryKey: KEY, refetchInterval: useRefetch(10000) });
}

export function useContainerAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: ContainerAction }) =>
      apiRequest("POST", `/api/docker/containers/${id}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
