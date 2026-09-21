// Controllable window.matchMedia for "(prefers-color-scheme: dark)".
import { vi } from "vitest";

export function installMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    get matches() { return dark; },
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb)),
  };
  window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);
  return {
    mql,
    listenerCount: () => listeners.size,
    setDark(next: boolean) {
      dark = next;
      listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent));
    },
  };
}
