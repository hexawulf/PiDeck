/*
 * Polling interval for one query, from its base interval and the header
 * refresh control (D5).
 * ────────────────────────────────────────────────────────────────────
 *   useRefetch(baseMs) ─┬─ paused            → false (no polling; manual refresh still works)
 *                       ├─ Live    (×1)      → baseMs
 *                       ├─ Relaxed (×2)      → baseMs × 2
 *                       └─ Slow    (×5)      → baseMs × 5
 *
 *   Used by useWidgetQuery, useDocker, usePm2. NOT by useAlerts: alert
 *   toasts must keep arriving while paused or slow (what is left of E1;
 *   the server's 60s sampler raises the alerts themselves).
 */
import type { Speed } from "@/prefs/prefs";
import { useRefreshPrefs } from "@/prefs/refresh-context";

export const SPEED_FACTOR: Record<Speed, number> = { live: 1, relaxed: 2, slow: 5 };

export function refetchInterval(baseMs: number | false, speed: Speed, paused: boolean): number | false {
  if (baseMs === false || paused) return false;
  return baseMs * SPEED_FACTOR[speed];
}

export function useRefetch(baseMs: number | false): number | false {
  const { speed, paused } = useRefreshPrefs();
  return refetchInterval(baseMs, speed, paused);
}
