// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));

import { diagnosticsLine } from "@/lib/diagnostics";
import { PREFS_KEY, type Store } from "@/prefs/prefs";
import { loadResetReason, UiPrefsProvider, useUiPrefs, useUiPrefsDispatch } from "@/prefs/UiPrefsProvider";

afterEach(cleanup);

describe("diagnosticsLine", () => {
  const base = { version: "2.1.1", prefsVersion: 1, visible: 18, total: 20, speed: "live", paused: false, density: "comfortable", lastReset: null } as const;

  it("lists version, prefs version, widgets, refresh, density, last reset", () => {
    expect(diagnosticsLine(base)).toBe(
      "PiDeck v2.1.1 · prefs v1 · widgets 18/20 visible · refresh live · density comfortable · last prefs reset: none",
    );
  });

  it("shows paused and the last reset", () => {
    const line = diagnosticsLine({ ...base, speed: "slow", paused: true, lastReset: { reason: "Reset layout", at: "2026-09-28T01:02:03.000Z" } });
    expect(line).toContain("refresh slow (paused)");
    expect(line).toContain("last prefs reset: Reset layout at 2026-09-28T01:02:03.000Z");
  });
});

describe("last prefs reset reason", () => {
  const withStored = (raw: string | null) => {
    const store: Store = { getItem: (k) => (k === PREFS_KEY ? raw : null), setItem: () => {} };
    return ({ children }: { children: ReactNode }) => <UiPrefsProvider store={store}>{children}</UiPrefsProvider>;
  };
  const use = () => ({ s: useUiPrefs(), d: useUiPrefsDispatch() });

  it("is recorded when loading fell back to defaults", () => {
    expect(renderHook(use, { wrapper: withStored("{bad") }).result.current.s.lastReset?.reason).toBe("Saved prefs were invalid (all sections)");
    cleanup();
    expect(renderHook(use, { wrapper: withStored(JSON.stringify({ version: 1, speed: "warp" })) }).result.current.s.lastReset?.reason)
      .toBe("Saved refresh speed invalid");
    cleanup();
    expect(renderHook(use, { wrapper: withStored(null) }).result.current.s.lastReset).toBeNull();
  });

  it("is recorded for Reset layout and Reset all, not for a plain import", () => {
    const { result } = renderHook(use, { wrapper: withStored(null) });
    act(() => result.current.d({ type: "resetLayout" }));
    expect(result.current.s.lastReset?.reason).toBe("Reset layout");
    act(() => result.current.d({ type: "replace", prefs: { ...result.current.s }, reason: "Reset all (Settings)" }));
    expect(result.current.s.lastReset?.reason).toBe("Reset all (Settings)");
    act(() => result.current.d({ type: "replace", prefs: { ...result.current.s } }));
    expect(result.current.s.lastReset?.reason).toBe("Reset all (Settings)");
  });

  it("blocked storage is not a reset", () => {
    expect(loadResetReason({ kind: "blocked" })).toBeNull();
  });
});
