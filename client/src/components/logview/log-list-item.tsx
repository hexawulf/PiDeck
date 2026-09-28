import { CheckCircle2 } from "lucide-react";
import type { LogEntry } from "@/hooks/use-host-logs";

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Sidebar log list button -------------------------------------------

export function LogListItem({
  log,
  selected,
  onClick,
  compact,
}: {
  log: LogEntry;
  selected: boolean;
  onClick: () => void | Promise<void>;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-colors ${
        selected
          ? "bg-pi-accent text-pi-on-accent"
          : "hover:bg-pi-card-hover text-pi-text"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <CheckCircle2
          className={`h-3 w-3 flex-shrink-0 ${
            selected ? "text-pi-on-accent" : "text-pi-success"
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">
            {log.label || log.name}
          </div>
          {!compact && (
            <div
              className={`text-[10px] mt-0.5 ${
                selected ? "text-pi-on-accent opacity-70" : "text-pi-text-muted"
              }`}
            >
              {relativeTime(log.mtime)} · {formatSize(log.size)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

