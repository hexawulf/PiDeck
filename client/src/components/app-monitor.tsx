import { useSystemData } from "@/hooks/use-system-data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { 
  Box, 
  Zap, 
  Square, 
  RotateCw, 
  Play,
  RefreshCw
} from "lucide-react";

export default function AppMonitor() {
  const { 
    dockerContainers, 
    pm2Processes, 
    restartContainer, 
    stopContainer, 
    startContainer,
    restartProcess,
    stopProcess,
    isContainerActionPending,
    isProcessActionPending
  } = useSystemData();
  
  const { toast } = useToast();

  const handleContainerAction = async (action: string, id: string, name: string) => {
    try {
      switch (action) {
        case 'restart':
          await restartContainer(id);
          break;
        case 'stop':
          await stopContainer(id);
          break;
        case 'start':
          await startContainer(id);
          break;
      }
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

  const handleProcessAction = async (action: string, name: string) => {
    try {
      switch (action) {
        case 'restart':
          await restartProcess(name);
          break;
        case 'stop':
          await stopProcess(name);
          break;
      }
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
       {/* Docker Containers - Only show if containers are available */}
       {dockerContainers.data && dockerContainers.data.length > 0 && (
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
             ) : dockerContainers.error ? (
               <p className="pi-error text-center py-4">Failed to load Docker containers</p>
             ) : (
               <div className="space-y-4">
                 {dockerContainers.data.map((container) => (
                   <div key={container.id} className="flex items-center justify-between p-4 bg-pi-darker rounded-lg">
                     <div className="flex items-center space-x-3">
                       <div className={`w-3 h-3 rounded-full ${getStatusColor(container.status)}`} />
                       <div>
                         <h4 className="font-medium pi-text">{container.name}</h4>
                         <p className="text-sm pi-text-muted">{container.image}</p>
                       </div>
                     </div>
                     <div className="flex items-center space-x-2">
                       <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadge(container.status)}`}>
                         {container.state}
                       </span>
                       {container.state === 'running' ? (
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
                             <Play className="w-4 h-4 text-green-400" />
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

      {/* PM2 Processes */}
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
          ) : pm2Processes.error ? (
            <p className="pi-error text-center py-4">Failed to load PM2 processes</p>
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
