import { lazy, Suspense } from "react";
import { useDocker, useContainerAction, type ContainerAction } from "@/hooks/use-docker";
import { usePm2, useProcessAction, type ProcessAction } from "@/hooks/use-pm2";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { isUnavailable } from "@/widgets/schemas";
import { HostProblemNotice, UnavailableNotice } from "@/widgets/WidgetFrame";
import { useHost } from "@/hosts/HostProvider";
import { hostProblemOf } from "@/hosts/host-path";
import { 
  Box, 
  Zap, 
  Square, 
  RotateCw, 
  Play,
  RefreshCw,
  Copy
} from "lucide-react";

// Services (systemd) is its own chunk: a table the Apps tab alone needs.
const ServicesCard = lazy(() => import("@/components/services-card"));

/** "No Docker on this host" in one line instead of an empty card (e.g. the VPSes). */
function AbsentNote({ icon: Icon, what, detail, testId }: { icon: React.ElementType; what: string; detail: string; testId: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 rounded-lg border border-pi-border bg-pi-card px-4 py-2 text-sm text-pi-text" data-testid={testId}>
      <Icon className="h-4 w-4 text-pi-text-muted" aria-hidden />
      <span>{what}</span>
      <span className="text-xs text-pi-text-muted">{detail}</span>
    </p>
  );
}

export default function AppMonitor() {
  // Remote hosts are read-only in H1: lists only, no action buttons.
  const host = useHost();
  const dockerContainers = useDocker();
  const pm2Processes = usePm2();
  const containerAction = useContainerAction();
  const processAction = useProcessAction();
  const isContainerActionPending = containerAction.isPending;
  const isProcessActionPending = processAction.isPending;
  
  const { toast } = useToast();

  const handleContainerAction = async (action: ContainerAction, id: string, name: string) => {
    try {
      await containerAction.mutateAsync({ id, action });
      toast({
        title: "Success",
        description: `Container ${name} ${action}ed successfully`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to ${action} container ${name}`,
        variant: "destructive",
      });
    }
  };

  const handleProcessAction = async (action: ProcessAction, name: string) => {
    try {
      await processAction.mutateAsync({ name, action });
      toast({
        title: "Success",
        description: `Process ${name} ${action}ed successfully`,
      });
    } catch (error) {
      toast({
        title: "Error", 
        description: `Failed to ${action} process ${name}`,
        variant: "destructive",
      });
    }
  };

  const getStatusColor = (status: string) => {
    const lower = status.toLowerCase();
    if (lower.includes('up') || lower.includes('online') || lower.includes('running')) {
      return 'status-running';
    }
    if (lower.includes('restart')) {
      return 'status-warning';
    }
    return 'status-stopped';
  };

  const getStatusBadge = (status: string) => {
    const lower = status.toLowerCase();
    if (lower.includes('up') || lower.includes('online') || lower.includes('running')) {
      return 'status-online';
    }
    if (lower.includes('restart')) {
      return 'status-restart';
    }
    return 'status-offline';
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied",
        description: "Container name copied to clipboard",
      });
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const formatPorts = (ports: any[]) => {
    if (!ports || ports.length === 0) return "—";
    return ports.map(p => `${p.private}${p.public ? `:${p.public}` : ""}`).join(", ");
  };

  // Absent = the host answered and has none (not an error, not still loading).
  const dockerAbsent = !dockerContainers.isLoading && !dockerContainers.error && !dockerContainers.data?.containers?.length && !!dockerContainers.data?.warning;
  const pm2Absent = !pm2Processes.isLoading && !pm2Processes.error && isUnavailable(pm2Processes.data);

  return (
    <div className="space-y-6">
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <ServicesCard />
    </Suspense>
    {(dockerAbsent || pm2Absent) && (
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {dockerAbsent && (
          <AbsentNote icon={Box} what="No Docker on this host" testId="docker-absent"
            detail={dockerContainers.data?.warning === "socket unavailable or permission denied" ? "(no socket, or this user isn't in the docker group)" : "(not installed or not responding)"} />
        )}
        {pm2Absent && <AbsentNote icon={Zap} what="No pm2 on this host" testId="pm2-absent" detail="(no pm2 daemon for this user)" />}
      </div>
    )}
    {!(dockerAbsent && pm2Absent) && (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
       {/* Docker Containers (collapsed to one line above when absent) */}
       {!dockerAbsent && (
       <Card className="bg-pi-card border-pi-border">
         <CardContent className="p-6">
           <div className="flex items-center justify-between mb-6">
             <h3 className="text-lg font-semibold pi-text flex items-center space-x-2">
               <Box className="w-5 h-5" />
               <span>Docker Containers</span>
             </h3>
             <Button
               variant="outline"
               size="sm"
               onClick={() => dockerContainers.refetch()}
               className="bg-pi-darker hover:bg-pi-card-hover border-pi-border"
               disabled={dockerContainers.isLoading}
             >
               <RefreshCw className={`w-4 h-4 ${dockerContainers.isLoading ? 'animate-spin' : ''}`} />
               Refresh
             </Button>
           </div>
           
           {dockerContainers.isLoading ? (
             <div className="space-y-4">
               {[...Array(3)].map((_, i) => (
                 <Skeleton key={i} className="h-16 w-full" />
               ))}
             </div>
           ) : hostProblemOf(dockerContainers.error) ? (
             <div className="py-4"><HostProblemNotice problem={hostProblemOf(dockerContainers.error)!} /></div>
           ) : dockerContainers.error ? (
             <div className="text-center py-4">
               <p className="pi-error mb-2">Failed to load Docker containers</p>
               <p className="text-xs pi-text-muted">
                 {dockerContainers.error.message?.substring(0, 160) || 'Docker service may be unavailable'}
               </p>
             </div>
            ) : !dockerContainers.data?.containers?.length ? (
              dockerContainers.data?.warning ? (
                <div className="py-4">
                  <UnavailableNotice
                    info={{
                      reason: "not-installed",
                      message:
                        dockerContainers.data.warning === "socket unavailable or permission denied"
                          ? "Docker isn't running here, or this user can't read /var/run/docker.sock (add it to the docker group)."
                          : "Docker isn't installed or isn't responding.",
                    }}
                  />
                </div>
              ) : (
                <p className="pi-text-muted text-center py-4">No Docker containers found</p>
              )
            ) : (
              <div className="space-y-4">
                {dockerContainers.data.containers.map((container) => (
                  <div key={container.id} className="flex items-center justify-between p-4 bg-pi-darker rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-2">
                        <div className={`w-3 h-3 rounded-full ${getStatusColor(container.status)}`} />
                        <div className="flex items-center space-x-2">
                          <h4 className="font-medium pi-text truncate">{container.name}</h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(container.name)}
                            className="p-1 h-auto opacity-50 hover:opacity-100"
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        <div className="pi-text-muted truncate">{container.image}</div>
                        <div className="pi-text-muted">Ports: {formatPorts(container.ports)}</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 ml-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadge(container.status)}`}>
                        {container.state}
                      </span>
                      {!host.isLocal ? null : container.state === 'running' ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleContainerAction('stop', container.id, container.name)}
                            disabled={isContainerActionPending}
                            className="p-2 h-auto bg-transparent hover:bg-pi-card-hover border-pi-border"
                          >
                            <Square className="w-4 h-4 text-pi-error" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleContainerAction('restart', container.id, container.name)}
                            disabled={isContainerActionPending}
                            className="p-2 h-auto bg-transparent hover:bg-pi-card-hover border-pi-border"
                          >
                            <RotateCw className="w-4 h-4 pi-text-muted" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleContainerAction('start', container.id, container.name)}
                            disabled={isContainerActionPending}
                            className="p-2 h-auto bg-transparent hover:bg-pi-card-hover border-pi-border"
                          >
                            <Play className="w-4 h-4 text-pi-success" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleContainerAction('restart', container.id, container.name)}
                            disabled={isContainerActionPending}
                            className="p-2 h-auto bg-transparent hover:bg-pi-card-hover border-pi-border"
                          >
                            <RotateCw className="w-4 h-4 pi-text-muted" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
             </div>
           )}
         </CardContent>
       </Card>

      )}

      {/* PM2 Processes (collapsed to one line above when absent) */}
      {!pm2Absent && (
      <Card className="bg-pi-card border-pi-border">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold pi-text flex items-center space-x-2">
              <Zap className="w-5 h-5" />
              <span>PM2 Processes</span>
            </h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pm2Processes.refetch()}
              className="bg-pi-darker hover:bg-pi-card-hover border-pi-border"
              disabled={pm2Processes.isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${pm2Processes.isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          
          {pm2Processes.isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : hostProblemOf(pm2Processes.error) ? (
            <div className="py-4"><HostProblemNotice problem={hostProblemOf(pm2Processes.error)!} /></div>
          ) : pm2Processes.error ? (
            <p className="pi-error text-center py-4">Failed to load PM2 processes</p>
          ) : isUnavailable(pm2Processes.data) ? (
            <div className="py-4"><UnavailableNotice info={pm2Processes.data} /></div>
          ) : !pm2Processes.data?.length ? (
            <p className="pi-text-muted text-center py-4">No PM2 processes found</p>
          ) : (
            <div className="space-y-4">
              {pm2Processes.data.map((process) => (
                <div key={process.id} className="flex items-center justify-between p-4 bg-pi-darker rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(process.status)}`} />
                    <div>
                      <h4 className="font-medium pi-text">{process.name}</h4>
                      <p className="text-sm pi-text-muted">
                        {process.cpu} CPU • {process.memory}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadge(process.status)}`}>
                      {process.status}
                    </span>
                    {host.isLocal && (<>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleProcessAction('stop', process.name)}
                      disabled={isProcessActionPending}
                      className="p-2 h-auto bg-transparent hover:bg-pi-card-hover border-pi-border"
                    >
                      <Square className="w-4 h-4 text-pi-error" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleProcessAction('restart', process.name)}
                      disabled={isProcessActionPending}
                      className="p-2 h-auto bg-transparent hover:bg-pi-card-hover border-pi-border"
                    >
                      <RotateCw className="w-4 h-4 pi-text-muted" />
                    </Button>
                    </>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </div>
    )}
    </div>
  );
}
