/*
 * Log pins + saved filters, stored in the reserved `pins` prefs section
 * (pinSchema: logId, optional label, optional grep; max 100). A pin is a log,
 * or a log + a filter: the same log can be pinned with different filters.
 *
 * Stale = the file is gone: it vanished from /api/hostlogs, or opening it
 * returned 404. Stale pins stay in the list, greyed ("file no longer
 * available"), until the user removes them.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toast } from "@/hooks/use-toast";
import { useHostLogs } from "@/hooks/use-host-logs";
import type { Pin } from "@/prefs/prefs";
import { useUiPrefs, useUiPrefsDispatch } from "@/prefs/UiPrefsProvider";

export const MAX_PINS = 100;

const norm = (grep?: string) => grep?.trim() || undefined;
export const samePin = (a: Pick<Pin, "logId" | "grep">, b: Pick<Pin, "logId" | "grep">) =>
  a.logId === b.logId && norm(a.grep) === norm(b.grep);

export type AddResult = "added" | "duplicate" | "full";

/** Newest first; duplicates (same log + filter) are refused, as is a 101st pin. */
export function addPin(pins: readonly Pin[], pin: Pin): { pins: Pin[]; result: AddResult } {
  const clean: Pin = { logId: pin.logId, ...(pin.label ? { label: pin.label } : {}), ...(norm(pin.grep) ? { grep: norm(pin.grep) } : {}) };
  if (pins.some((p) => samePin(p, clean))) return { pins: pins.slice(), result: "duplicate" };
  if (pins.length >= MAX_PINS) return { pins: pins.slice(), result: "full" };
  return { pins: [clean, ...pins], result: "added" };
}

export function removePin(pins: readonly Pin[], pin: Pick<Pin, "logId" | "grep">): Pin[] {
  return pins.filter((p) => !samePin(p, pin));
}

// ── stale ids seen this session (404 on open) ─────────────────────────
const stale404 = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
export function markLogMissing(logId: string) {
  if (!stale404.has(logId)) {
    stale404.add(logId);
    emit();
  }
}
export function markLogPresent(logId: string) {
  if (stale404.delete(logId)) emit();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Pure: is this pin's file gone? Remote pins ("h:<host>:<source>") are stale only after a 404. */
export function isPinStale(logId: string, known: ReadonlySet<string> | null, missing: ReadonlySet<string>): boolean {
  return missing.has(logId) || (known !== null && !logId.startsWith("h:") && !known.has(logId));
}

export function useLogPins() {
  const { pins } = useUiPrefs();
  const dispatch = useUiPrefsDispatch();
  const logs = useHostLogs(false); // read whatever the Logs tab / palette already fetched
  const missingVersion = useSyncExternalStore(subscribe, () => version);
  const known = useMemo(() => (logs.data ? new Set(logs.data.map((l) => l.id)) : null), [logs.data]);

  // missingVersion changes whenever stale404 does, so the callback re-creates.
  const isStale = useCallback((logId: string) => isPinStale(logId, known, stale404), [known, missingVersion]);
  const isPinned = useCallback((logId: string, grep?: string) => pins.some((p) => samePin(p, { logId, grep })), [pins]);

  const pin = useCallback(
    (p: Pin) => {
      const { pins: next, result } = addPin(pins, p);
      if (result === "full") toast({ title: `Pin limit reached (${MAX_PINS})`, description: "Unpin something first.", variant: "destructive" });
      if (result === "added") dispatch({ type: "setPins", pins: next });
      return result;
    },
    [pins, dispatch],
  );
  const unpin = useCallback((p: Pick<Pin, "logId" | "grep">) => dispatch({ type: "setPins", pins: removePin(pins, p) }), [pins, dispatch]);

  return { pins, isStale, isPinned, pin, unpin };
}
