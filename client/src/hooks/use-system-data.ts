import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { SystemInfo, LogFile, DockerContainer, DockerContainersResponse, PM2Process, CronJob, HistoricalMetric, ActiveAlert, HostLog, RpiLog } from "@shared/schema";

export function useSystemData() {
  const queryClient = useQueryClient();

  const systemInfo = useQuery<SystemInfo>({
    queryKey: ["/api/system/info"],
    refetchInterval: 5000, // Refresh every 5 seconds. This also triggers alert checks on backend.
  });

  const historicalData = useQuery<HistoricalMetric[]>({
    queryKey: ["/api/system/history"],
    refetchInterval: 60000, // Refresh every 60 seconds
  });

  const systemAlerts = useQuery<ActiveAlert[]>({
    queryKey: ["/api/system/alerts"],
    refetchInterval: 7000, // Poll slightly offset from systemInfo to catch updates
  });

  const dockerContainers = useQuery<DockerContainersResponse>({
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

  const updateSystemMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/system/update");
    },
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/system/info"] });
    queryClient.invalidateQueries({ queryKey: ["/api/system/history"] });
    queryClient.invalidateQueries({ queryKey: ["/api/system/alerts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/docker/containers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/pm2/processes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cron/jobs"] });
  };

  return {
    systemInfo,
    historicalData,
    systemAlerts,
    dockerContainers,
    pm2Processes,
    cronJobs,
    restartContainer: restartContainerMutation.mutateAsync,
    stopContainer: stopContainerMutation.mutateAsync,
    startContainer: startContainerMutation.mutateAsync,
    restartProcess: restartProcessMutation.mutateAsync,
    stopProcess: stopProcessMutation.mutateAsync,
    runCronJob: runCronJobMutation.mutateAsync,
    updateSystem: updateSystemMutation.mutateAsync,
    refreshAll,
    isContainerActionPending: restartContainerMutation.isPending || stopContainerMutation.isPending || startContainerMutation.isPending,
    isProcessActionPending: restartProcessMutation.isPending || stopProcessMutation.isPending,
    isCronJobPending: runCronJobMutation.isPending,
    isSystemUpdating: updateSystemMutation.isPending,
  };
}

