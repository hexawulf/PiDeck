import { useQuery } from "@tanstack/react-query";

export interface LogEntry {
  id: string;
  name: string;
  label: string;
  path: string;
  size: number;
  mtime: string;
  source: "home" | "nginx" | "pm2" | "project";
  large?: boolean;
}

/**
 * The log list (/api/hostlogs), shared by the Logs tab, the command palette
 * ("Open log …") and log pins. Not polled; fetched when first needed.
 */
export function useHostLogs(enabled = true) {
  return useQuery<LogEntry[]>({
    queryKey: ["/api/hostlogs"],
    select: (data) => (Array.isArray(data) ? data : []),
    enabled,
  });
}

/** Deep link that opens a log (optionally pre-filtered) in the Logs tab. */
export function logHref(logId: string, grep?: string): string {
  const q = new URLSearchParams({ log: logId });
  if (grep) q.set("grep", grep);
  return `/logs?${q.toString()}`;
}
