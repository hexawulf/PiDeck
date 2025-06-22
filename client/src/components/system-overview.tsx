import { useSystemData } from "@/hooks/use-system-data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Cpu, 
  Zap, 
  Thermometer, 
  Wifi, 
  Info, 
  Settings, 
  RefreshCw,
  Download,
  List,
  HardDrive,
  Activity,
  BarChart3,
  ListChecks
} from "lucide-react";
import { DiskIOGraph, NetworkBandwidthGraph } from "./resource-graphs";
import ProcessList from "./process-list";
import { NvmeHealthBox } from "./widgets/NvmeHealthBox";
import { CpuFreqBox } from "./widgets/CpuFreqBox";

interface OverviewProps {
  onOpenApps?: () => void;
  onOpenLogs?: () => void;
  onUpdateSystem?: () => void;
  isSystemUpdating?: boolean;
}

export default function SystemOverview({ onOpenApps, onOpenLogs, onUpdateSystem, isSystemUpdating }: OverviewProps) {
  const { systemInfo, refreshAll, historicalData } = useSystemData();

  if (systemInfo.isLoading || historicalData.isLoading) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="bg-pi-card border-pi-border">
              <CardContent className="p-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (systemInfo.error) {
    return (
      <div className="text-center py-8">
        <p className="pi-error">Failed to load system information</p>
        <Button onClick={refreshAll} className="mt-4">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const data = systemInfo.data;
  if (!data) return null;

  const getTemperatureColor = (temp: number) => {
    if (temp > 70) return "text-red-400";
    if (temp > 60) return "text-yellow-400";
    return "text-green-400";
  };

  return (
    <div className="space-y-8">
      {/* System Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {/* CPU Usage */}
        <Card className="bg-pi-card border-pi-border hover:border-pi-accent transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                  <Cpu className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-sm font-medium pi-text-muted">CPU Usage</h3>
                  <p className="text-2xl font-bold pi-text">{data.cpu.toFixed(1)}%</p>
                </div>
              </div>
            </div>
            <div className="w-full bg-pi-darker rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-500" 
                style={{ width: `${Math.min(data.cpu, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Memory Usage */}
        <Card className="bg-pi-card border-pi-border hover:border-pi-accent transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                  <Zap className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <h3 className="text-sm font-medium pi-text-muted">Memory</h3>
                  <p className="text-2xl font-bold pi-text">{data.memory.percentage}%</p>
                </div>
              </div>
            </div>
            <div className="w-full bg-pi-darker rounded-full h-2">
              <div 
                className="bg-green-500 h-2 rounded-full transition-all duration-500" 
                style={{ width: `${data.memory.percentage}%` }}
              />
            </div>
            <p className="text-xs pi-text-muted mt-2">
              {(data.memory.used / 1024).toFixed(1)}GB / {(data.memory.total / 1024).toFixed(1)}GB
            </p>
          </CardContent>
        </Card>

        {/* Temperature */}
        <Card className="bg-pi-card border-pi-border hover:border-pi-accent transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-orange-500/20 rounded-lg flex items-center justify-center">
                  <Thermometer className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-sm font-medium pi-text-muted">Temperature</h3>
                  <p className={`text-2xl font-bold ${getTemperatureColor(data.temperature)}`}>
                    {data.temperature.toFixed(1)}°C
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${data.temperature < 70 ? 'bg-green-500' : data.temperature < 80 ? 'bg-yellow-500' : 'bg-red-500'}`} />
              <span className="text-xs pi-text-muted">
                {data.temperature < 70 ? 'Normal' : data.temperature < 80 ? 'Warm' : 'Hot'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Network */}
        <Card className="bg-pi-card border-pi-border hover:border-pi-accent transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-sm font-medium pi-text-muted">Network</h3>
                  <p className="text-lg font-bold pi-text">{data.network.ip}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs pi-text-muted">{data.network.status}</span>
            </div>
          </CardContent>
        </Card>

        <NvmeHealthBox />
        <CpuFreqBox />
      </div>

      {/* Resource Graphs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DiskIOGraph />
        <NetworkBandwidthGraph />
      </div>

      {/* System Information & Processes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* System Details */}
        <Card className="bg-pi-card border-pi-border lg:col-span-2">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold pi-text mb-4 flex items-center space-x-2">
              <Info className="w-5 h-5" />
              <span>System Information</span>
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-pi-border last:border-b-0">
                <span className="pi-text-muted">Hostname</span>
                <span className="pi-text font-mono text-sm">{data.hostname}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-pi-border last:border-b-0">
                <span className="pi-text-muted">OS</span>
                <span className="pi-text font-mono text-sm">{data.os}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-pi-border last:border-b-0">
                <span className="pi-text-muted">Kernel</span>
                <span className="pi-text font-mono text-sm">{data.kernel}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-pi-border last:border-b-0">
                <span className="pi-text-muted">Architecture</span>
                <span className="pi-text font-mono text-sm">{data.architecture}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="pi-text-muted">Uptime</span>
                <span className="pi-text font-mono text-sm">{data.uptime}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Process List */}
        <div className="lg:col-span-1">
          <ProcessList />
        </div>
      </div>

      {/* Quick Actions - Kept for completeness, can be removed or repurposed */}
       <Card className="bg-pi-card border-pi-border">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold pi-text mb-4 flex items-center space-x-2">
              <Settings className="w-5 h-5" />
              <span>Quick Actions</span>
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Button
                variant="outline"
                className="flex flex-col items-center space-y-2 p-4 h-auto bg-pi-darker hover:bg-pi-card-hover border-pi-border"
                onClick={refreshAll}
              >
                <RefreshCw className="w-6 h-6 text-pi-accent" />
                <span className="text-sm pi-text">Refresh Data</span>
              </Button>
              <Button
                variant="outline"
                className="flex flex-col items-center space-y-2 p-4 h-auto bg-pi-darker hover:bg-pi-card-hover border-pi-border"
                onClick={onUpdateSystem}
                disabled={isSystemUpdating}
              >
                <Download className={`w-6 h-6 text-green-400 ${isSystemUpdating ? 'animate-spin' : ''}`} />
                <span className="text-sm pi-text">Update System</span>
              </Button>
              <Button
                variant="outline"
                className="flex flex-col items-center space-y-2 p-4 h-auto bg-pi-darker hover:bg-pi-card-hover border-pi-border"
                onClick={onOpenApps}
              >
                <ListChecks className="w-6 h-6 text-purple-400" />
                <span className="text-sm pi-text">Manage Apps</span>
              </Button>
              <Button
                variant="outline"
                className="flex flex-col items-center space-y-2 p-4 h-auto bg-pi-darker hover:bg-pi-card-hover border-pi-border"
                onClick={onOpenLogs}
              >
                <BarChart3 className="w-6 h-6 text-orange-400" />
                <span className="text-sm pi-text">View Logs</span>
              </Button>
            </div>
          </CardContent>
        </Card>
    </div>
  );
}
