import { Pin as PinIcon, X } from "lucide-react";
import { useLogPins } from "@/hooks/use-log-pins";
import type { Pin } from "@/prefs/prefs";
import { cn } from "@/lib/utils";

/** Pinned logs / saved filters at the top of the log picker. */
export function PinnedLogs({ activeId, onOpen }: { activeId?: string; onOpen: (pin: Pin) => void }) {
  const { pins: all, isStale, unpin } = useLogPins();
  const pins = all.filter((p) => !p.logId.startsWith("h:")); // remote hosts' pins show in their own Logs tab
  if (!pins.length) return null;
  return (
    <section aria-label="Pinned logs" className="border-b border-pi-border px-3 py-2">
      <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-pi-text-muted">
        <PinIcon className="h-3 w-3" aria-hidden /> Pinned
      </h3>
      <ul className="space-y-0.5" data-testid="pinned-logs">
        {pins.map((p) => {
          const stale = isStale(p.logId);
          const name = p.label ?? p.logId;
          return (
            <li key={`${p.logId}:${p.grep ?? ""}`} className="flex items-center gap-1" data-stale={stale || undefined}>
              <button
                type="button"
                onClick={() => onOpen(p)}
                className={cn(
                  "min-w-0 flex-1 rounded-md px-2 py-1 text-left text-xs hover:bg-pi-card-hover",
                  stale ? "text-pi-text-muted" : "text-pi-text",
                  activeId === p.logId && !p.grep && "font-semibold",
                )}
              >
                <span className={cn("block truncate", stale && "line-through")}>
                  {name}
                  {p.grep && <span className="text-pi-text-muted"> — “{p.grep}”</span>}
                </span>
                {stale && <span className="block text-[11px] text-pi-text-muted">file no longer available</span>}
              </button>
              <button
                type="button"
                onClick={() => unpin(p)}
                aria-label={`Unpin ${name}${p.grep ? ` (filter “${p.grep}”)` : ""}`}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-pi-text-muted hover:bg-pi-card-hover hover:text-pi-text"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
