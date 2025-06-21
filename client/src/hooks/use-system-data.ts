import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { SystemInfo, LogFile, DockerContainer, PM2Process, CronJob } from "@shared/schema";

export function useSystemData() {
  const queryClient = useQueryClient();

  const systemInfo = useQuery<SystemInfo>({
    queryKey: ["/api/system/info"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const logFiles = useQuery<LogFile[]>({
    queryKey: ["/api/logs"],
  });

  const dockerContainers = useQuery<DockerContainer[]>({
    queryKey: ["/api/docker/containers"],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const pm2Processes = useQuery<PM2Process[]>({
    queryKey: ["/api/pm2/processes"],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const cronJobs = useQuery<CronJob[]>({
    queryKey: ["/api/cron/jobs"],
  });

  // Mutations for Docker containers
  const restartContainerMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/docker/containers/${id}/restart`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/docker/containers"] });
    },
  });

  const stopContainerMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/docker/containers/${id}/stop`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/docker/containers"] });
    },
  });

  const startContainerMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/docker/containers/${id}/start`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/docker/containers"] });
    },
  });

  // Mutations for PM2 processes
  const restartProcessMutation = useMutation({
    mutationFn: async (name: string) => {
      return apiRequest("POST", `/api/pm2/processes/${name}/restart`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pm2/processes"] });
    },
  });

  const stopProcessMutation = useMutation({
    mutationFn: async (name: string) => {
      return apiRequest("POST", `/api/pm2/processes/${name}/stop`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pm2/processes"] });
    },
  });

  // Mutation for running cron jobs
  const runCronJobMutation = useMutation({
    mutationFn: async (command: string) => {
      return apiRequest("POST", "/api/cron/run", { command });
    },
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/system/info"] });
    queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/docker/containers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/pm2/processes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cron/jobs"] });
  };

  return {
    systemInfo,
    logFiles,
    dockerContainers,
    pm2Processes,
    cronJobs,
    restartContainer: restartContainerMutation.mutateAsync,
    stopContainer: stopContainerMutation.mutateAsync,
    startContainer: startContainerMutation.mutateAsync,
    restartProcess: restartProcessMutation.mutateAsync,
    stopProcess: stopProcessMutation.mutateAsync,
    runCronJob: runCronJobMutation.mutateAsync,
    refreshAll,
    isContainerActionPending: restartContainerMutation.isPending || stopContainerMutation.isPending || startContainerMutation.isPending,
    isProcessActionPending: restartProcessMutation.isPending || stopProcessMutation.isPending,
    isCronJobPending: runCronJobMutation.isPending,
  };
}

export function useLogContent(filename: string) {
  return useQuery<{ content: string }>({
    queryKey: ["/api/logs", filename],
    queryFn: async ({ queryKey }) => {
      const [, file] = queryKey;
      if (!file) return { content: "" }; // Or throw an error, or handle as needed
      // Assuming the API endpoint for specific log content is /api/logs/content/:filename or similar
      // Adjust the URL construction as per the actual API endpoint structure
      // For now, let's assume it's /api/logs/{filename} which might be a common REST pattern
      // Or if it's a query param: /api/logs/content?file=${file}

      // Based on the problem description, the backend returns {content: "..."}
      // The default getQueryFn already does res.json(), so that part is fine.
      // We just need to make sure the URL is correct.
      // Let's assume the API endpoint is /api/logs/content/{filename} for fetching content
      // If the actual API endpoint is different, this will need to be adjusted.
      // A common pattern is to have a dedicated endpoint for content.
      // Let's try with /api/logs/content/${file} - this is a guess.
      // Or, if the existing /api/logs endpoint can take a filename query parameter.
      // The problem states "API call succeeds and returns log content", implying the call is made.
      // This suggests the current fetch to "/api/logs" might be returning something, but not file-specific.

      // Let's assume the API endpoint for fetching specific log content is `/api/logs/${filename_url_encoded}`
      // This is a common pattern. If the API is different, this needs to be changed.
      // The default queryFn uses queryKey[0] as the URL. We need to pass the specific file URL.
      const res = await fetch(`/api/logs/${encodeURIComponent(file as string)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`Failed to fetch log content: ${res.status} ${text}`);
      }
      return res.json();
    },
    enabled: !!filename,
    refetchInterval: (data, query) => {
      // Access autoRefresh from queryKey or pass it differently.
      // For simplicity, let's assume autoRefresh is passed as part of the queryKey if we want to make it dynamic like this.
      // queryKey: ["/api/logs", filename, autoRefresh]
      // const autoRefresh = query.queryKey[2];
      // However, react-query typically doesn't re-evaluate refetchInterval fn based on queryKey changes in this way for an active query.
      // A more standard way is to pass autoRefresh as a variable to the hook and use it in options.
      // This example will assume autoRefresh is passed into the hook.
      // This part needs to be connected to the autoRefresh state from the component.
// The hook itself needs to accept 'autoRefresh' as an argument.
// The previous approach for refetchInterval was not ideal.
// Let's simplify and make the hook accept autoRefreshEnabled directly.

export function useLogContent(filename: string, autoRefreshEnabled: boolean) {
  return useQuery<{ content: string }>({
    queryKey: ["/api/logs", filename], // autoRefreshEnabled does not need to be in the queryKey if it only affects refetchInterval
    queryFn: async ({ queryKey }) => {
      const [, file] = queryKey;
      if (!file) return { content: "" }; // Should ideally not happen if enabled is false
      const res = await fetch(`/api/logs/${encodeURIComponent(file as string)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`Failed to fetch log content: ${res.status} ${text}`);
      }
      return res.json();
    },
    enabled: !!filename,
    refetchInterval: autoRefreshEnabled ? 5000 : false, // Set interval if autoRefresh is enabled
  });
}
