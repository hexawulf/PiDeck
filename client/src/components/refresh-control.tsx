import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Speed } from "@/prefs/prefs";
import { useUiPrefs, useUiPrefsDispatch } from "@/prefs/UiPrefsProvider";

const SPEEDS: { id: Speed; label: string; hint: string }[] = [
  { id: "live", label: "Live", hint: "Normal polling" },
  { id: "relaxed", label: "Relaxed", hint: "Poll half as often" },
  { id: "slow", label: "Slow", hint: "Poll a fifth as often" },
];

/**
 * Header refresh control (D5): polling speed (persisted) and Pause (this tab
 * only, never saved). While paused a "Paused" badge is always visible; the
 * manual refresh button next to it still works, and alert toasts keep coming.
 */
export function RefreshControl() {
  const { speed, paused } = useUiPrefs();
  const dispatch = useUiPrefsDispatch();
  return (
    <div className="flex items-center gap-2">
      {paused && (
        <span role="status" className="rounded-full border border-pi-warning px-2 py-0.5 text-xs font-semibold text-pi-warning" data-testid="paused-badge">
          Paused
        </span>
      )}
      <div role="group" aria-label="Refresh speed" className="hidden rounded-md border border-pi-border p-0.5 lg:flex">
        {SPEEDS.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.hint}
            aria-pressed={speed === s.id}
            onClick={() => dispatch({ type: "setSpeed", speed: s.id })}
            className={cn(
              "rounded px-2 py-1 text-xs",
              speed === s.id ? "bg-pi-accent text-pi-on-accent" : "text-pi-text-muted hover:bg-pi-card-hover hover:text-pi-text",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={paused}
        aria-label={paused ? "Resume auto-refresh" : "Pause auto-refresh"}
        title={paused ? "Resume auto-refresh" : "Pause auto-refresh"}
        onClick={() => dispatch({ type: "setPaused", paused: !paused })}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-pi-border hover:bg-pi-card-hover"
      >
        {paused ? <Play className="h-5 w-5" aria-hidden /> : <Pause className="h-5 w-5" aria-hidden />}
      </button>
    </div>
  );
}
