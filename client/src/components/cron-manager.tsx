import { useSystemData } from "@/hooks/use-system-data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { 
  Clock, 
  Play, 
  FileText, 
  RefreshCw 
} from "lucide-react";

export default function CronManager() {
  const { cronJobs, runCronJob, isCronJobPending } = useSystemData();
  const { toast } = useToast();

  const handleRunCronJob = async (command: string, description: string) => {
    try {
      await runCronJob(command);
      toast({
        title: "Success",
        description: `Cron job "${description}" executed successfully`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to execute cron job: ${description}`,
        variant: "destructive",
      });
    }
  };

  const formatSchedule = (schedule: string): string => {
    const parts = schedule.split(' ');
    if (parts.length !== 5) return schedule;
    
    const [minute, hour, day, month, dayOfWeek] = parts;
    
    // Common patterns
    if (schedule === '0 0 * * *') return 'Daily, midnight';
    if (schedule === '0 2 * * 0') return 'Weekly, Sundays 2AM';
    if (schedule === '*/15 * * * *') return 'Every 15 minutes';
    if (schedule === '0 */6 * * *') return 'Every 6 hours';
    if (schedule === '0 0 1 * *') return 'Monthly, 1st at midnight';
    
    return schedule;
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'success':
        return 'status-online';
      case 'warning':
        return 'status-restart';
      case 'error':
        return 'status-offline';
      default:
        return 'pi-text-muted';
    }
  };

  if (cronJobs.isLoading) {
    return (
      <Card className="bg-pi-card border-pi-border">
        <CardContent className="p-6">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-pi-card border-pi-border">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold pi-text flex items-center space-x-2">
            <Clock className="w-5 h-5" />
            <span>Scheduled Tasks</span>
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => cronJobs.refetch()}
            className="bg-pi-darker hover:bg-pi-card-hover border-pi-border"
            disabled={cronJobs.isLoading}
          >
            <RefreshCw className={`w-4 h-4 ${cronJobs.isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        
        {cronJobs.error ? (
          <p className="pi-error text-center py-4">Failed to load cron jobs</p>
        ) : !cronJobs.data?.length ? (
          <p className="pi-text-muted text-center py-4">No cron jobs found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-pi-border">
                  <th className="text-left py-3 px-4 pi-text-muted font-medium">Schedule</th>
                  <th className="text-left py-3 px-4 pi-text-muted font-medium">Command</th>
                  <th className="text-left py-3 px-4 pi-text-muted font-medium">Status</th>
                  <th className="text-right py-3 px-4 pi-text-muted font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cronJobs.data.map((job, index) => (
                  <tr key={index} className="border-b border-pi-border hover:bg-pi-darker transition-colors">
                    <td className="py-4 px-4">
                      <span className="font-mono text-sm pi-text">{job.schedule}</span>
                      <div className="text-xs pi-text-muted">{formatSchedule(job.schedule)}</div>
                    </td>
                    <td className="py-4 px-4">
                      <span className="font-mono text-sm pi-text">{job.command}</span>
                      <div className="text-xs pi-text-muted">{job.description}</div>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(job.status)}`}>
                        {job.status}
                      </span>
                      {job.lastRun && (
                        <div className="text-xs pi-text-muted mt-1">{job.lastRun}</div>
                      )}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRunCronJob(job.command, job.description)}
                          disabled={isCronJobPending}
                          className="p-2 h-auto bg-transparent hover:bg-pi-card-hover border-pi-border"
                          title="Run job manually"
                        >
                          <Play className="w-4 h-4 text-green-400" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled
                          className="p-2 h-auto bg-transparent hover:bg-pi-card-hover border-pi-border"
                          title="View job log"
                        >
                          <FileText className="w-4 h-4 pi-text-muted" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
