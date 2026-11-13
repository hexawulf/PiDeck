import { useState } from "react";
import { useCron, useRunCronJob } from "@/hooks/use-cron";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  const cronJobs = useCron();
  const runCron = useRunCronJob();
  const runCronJob = runCron.mutateAsync;
  const isCronJobPending = runCron.isPending;
  const { toast } = useToast();

  // Run always asks first: one click must not start a backup or a cleaner.
  const [runTarget, setRunTarget] = useState<{ command: string; description: string } | null>(null);

  /** The server's own words for a failed run ("Cron job failed (exit code 3)"), if it sent any. */
  const serverMessage = (error: unknown): string | null => {
    const text = error instanceof Error ? error.message : "";
    try {
      const body = JSON.parse(text.replace(/^\d{3}:\s*/, ""));
      return typeof body?.message === "string" ? `${body.message}${body.log ? ` — output in ${body.log} (Logs tab)` : ""}` : null;
    } catch {
      return null;
    }
  };

  const confirmRun = async () => {
    if (!runTarget) return;
    const { command, description } = runTarget;
    try {
      const res = await runCronJob(command);
      const body = (await res.json().catch(() => ({}))) as { state?: string; log?: string | null };
      if (res.status === 202 || body.state === "running") {
        toast({
          title: "Still running",
          description: `"${description}" was started and is still running. Output: ${body.log ?? "its own log"} (Logs tab).`,
        });
      } else {
        toast({
          title: "Success",
          description: `Cron job "${description}" executed successfully`,
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: serverMessage(error) ?? `Failed to execute cron job: ${description}`,
        variant: "destructive",
      });
    } finally {
      setRunTarget(null);
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
    <>
      <ConfirmDialog
        open={runTarget !== null}
        onOpenChange={(open) => { if (!open) setRunTarget(null); }}
        title="Run this job now?"
        description={
          <>
            Runs the command once, as cron would, on this host:
            <code className="mt-2 block max-h-32 overflow-auto break-all rounded bg-pi-darker px-2 py-1 font-mono text-xs text-pi-text">{runTarget?.command}</code>
          </>
        }
        confirmLabel="Run now"
        pendingLabel="Running…"
        pending={isCronJobPending}
        onConfirm={() => void confirmRun()}
      />
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
                          onClick={() => setRunTarget({ command: job.command, description: job.description })}
                          aria-label={`Run now: ${job.command.slice(0, 80)}`}
                          disabled={isCronJobPending}
                          className="p-2 h-auto bg-transparent hover:bg-pi-card-hover border-pi-border"
                          title="Run job manually"
                        >
                          <Play className="w-4 h-4 text-pi-success" />
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
    </>
  );
}
