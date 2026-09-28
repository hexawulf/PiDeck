import type { Density, Speed } from "@/prefs/prefs";

export type DiagnosticsInput = {
  version: string;
  prefsVersion: number;
  visible: number;
  total: number;
  speed: Speed;
  paused: boolean;
  density: Density;
  lastReset: { reason: string; at: string } | null;
};

/** One line for bug reports (About › Diagnostics, with a copy button). */
export function diagnosticsLine(d: DiagnosticsInput): string {
  return [
    `PiDeck v${d.version}`,
    `prefs v${d.prefsVersion}`,
    `widgets ${d.visible}/${d.total} visible`,
    `refresh ${d.speed}${d.paused ? " (paused)" : ""}`,
    `density ${d.density}`,
    `last prefs reset: ${d.lastReset ? `${d.lastReset.reason} at ${d.lastReset.at}` : "none"}`,
  ].join(" · ");
}
