// "Update system" runs as a background job on the server (2.10): the POST
// answers at once, and this module follows the job until it ends.
//
//   POST → { state: "running", log } ─► toast "Update started"
//                                    └► watch: GET every 5 s ─┬─ running   → keep going
//                                                             ├─ succeeded → toast "System updated successfully"
//                                                             └─ failed    → toast with the log's name
//   POST → 200 without `state` (an older hub)  → treated as finished
import { toast } from "@/hooks/use-toast";

export type UpdateStatus = {
  state?: "idle" | "running" | "succeeded" | "failed";
  log?: string;
  exitCode?: number | null;
  message?: string;
};

export const WATCH_INTERVAL_MS = 5000;
const MAX_WATCH_MS = 3 * 60 * 60 * 1000;
const MAX_FAILED_READS = 6;

/** What to tell the user about the POST's answer. `watch` = follow the job. */
export function describeStart(body: UpdateStatus): { title: string; description: string; watch: boolean } {
  if (body.state === "running") {
    return { title: "Update started", description: `Running in the background. Output: ${body.log ?? "the update log"} on the Logs tab.`, watch: true };
  }
  return { title: "Success", description: "System updated successfully", watch: false };
}

/** What to tell the user when the job has ended; null while it is still running. */
export function describeEnd(s: UpdateStatus): { title: string; description: string; failed: boolean } | null {
  if (s.state === "running") return null;
  if (s.state === "succeeded") return { title: "Success", description: "System updated successfully", failed: false };
  if (s.state === "failed") {
    const why = s.exitCode === null || s.exitCode === undefined ? "was interrupted" : `failed (exit code ${s.exitCode})`;
    return { title: "Error", description: `System update ${why}. See ${s.log ?? "the update log"} on the Logs tab.`, failed: true };
  }
  return { title: "Update", description: "The update is no longer running.", failed: false };
}

let watching = false;

/** Follow the running job and toast once when it ends. One watcher at a time. */
export function watchSystemUpdate(
  fetchStatus: () => Promise<UpdateStatus> = async () => {
    const res = await fetch("/api/system/update", { credentials: "include" });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  },
  { intervalMs = WATCH_INTERVAL_MS, notify = toast }: { intervalMs?: number; notify?: typeof toast } = {},
): void {
  if (watching) return;
  watching = true;
  const started = Date.now();
  let failedReads = 0;
  const stop = () => {
    watching = false;
  };
  const tick = async () => {
    if (Date.now() - started > MAX_WATCH_MS) return stop();
    try {
      const end = describeEnd(await fetchStatus());
      failedReads = 0;
      if (end) {
        notify({ title: end.title, description: end.description, ...(end.failed ? { variant: "destructive" as const } : {}), duration: 15000 });
        return stop();
      }
    } catch {
      // PiDeck itself may restart during an upgrade: keep trying for a while.
      if (++failedReads >= MAX_FAILED_READS) return stop();
    }
    setTimeout(() => void tick(), intervalMs);
  };
  setTimeout(() => void tick(), intervalMs);
}

/** Tests only. */
export const resetUpdateWatch = () => {
  watching = false;
};
