// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast, useToast: () => ({ toast }) }));

import { UiPrefsProvider, useUiPrefs, useUiPrefsDispatch } from "@/prefs/UiPrefsProvider";
import { PREFS_BAD_KEY, PREFS_KEY, type Store } from "@/prefs/prefs";
import { refetchInterval, useRefetch } from "@/hooks/useRefetch";
import { ALERTS_INTERVAL_MS, useAlerts } from "@/hooks/use-alerts";

class MemStore implements Store {
  data = new Map<string, string>();
  failSet: Error | null = null;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.failSet) throw this.failSet; this.data.set(k, v); }
}

let store: MemStore;
beforeEach(() => { store = new MemStore(); toast.mockClear(); });
afterEach(cleanup);

const wrapper = ({ children }: { children: ReactNode }) => <UiPrefsProvider store={store}>{children}</UiPrefsProvider>;
const usePrefs = () => ({ state: useUiPrefs(), dispatch: useUiPrefsDispatch(), interval: useRefetch(5000) });

describe("UiPrefsProvider", () => {
  it("toasts once and backs up a corrupt value, then renders with defaults", () => {
    store.data.set(PREFS_KEY, "{oops");
    const { result } = renderHook(usePrefs, { wrapper });
    expect(result.current.state.speed).toBe("live");
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0].title).toBe("Saved layout was invalid – reset to default");
    expect(store.data.get(PREFS_BAD_KEY)).toBe("{oops");
  });

  it("names the bad section in the toast", () => {
    store.data.set(PREFS_KEY, JSON.stringify({ version: 1, density: "huge" }));
    renderHook(usePrefs, { wrapper });
    expect(toast.mock.calls[0][0].title).toBe("Saved density settings were invalid – reset to default");
  });

  it("toasts once when storage is blocked", () => {
    const blocked: Store = { getItem: () => { throw Object.assign(new Error(), { name: "SecurityError" }); }, setItem: () => { throw new Error(); } };
    const { result } = renderHook(usePrefs, { wrapper: ({ children }) => <UiPrefsProvider store={blocked}>{children}</UiPrefsProvider> });
    act(() => result.current.dispatch({ type: "setSpeed", speed: "slow" }));
    expect(result.current.state.speed).toBe("slow"); // still works in memory
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0].title).toBe("Layout can't be saved in this browser");
  });

  it("persists changes but never `paused`", () => {
    const { result } = renderHook(usePrefs, { wrapper });
    act(() => result.current.dispatch({ type: "setPaused", paused: true }));
    expect(store.data.has(PREFS_KEY)).toBe(false); // nothing persisted changed
    act(() => result.current.dispatch({ type: "setDensity", density: "compact" }));
    const saved = JSON.parse(store.data.get(PREFS_KEY)!);
    expect(saved.density).toBe("compact");
    expect(saved).not.toHaveProperty("paused");
    expect(document.documentElement.dataset.density).toBe("compact");
  });

  it("keeps prefs in memory and toasts once on quota exceeded", () => {
    const { result } = renderHook(usePrefs, { wrapper });
    store.failSet = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    act(() => result.current.dispatch({ type: "hide", id: "cpu" }));
    act(() => result.current.dispatch({ type: "hide", id: "memory" }));
    expect(result.current.state.hidden).toEqual(["cpu", "memory"]);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0].title).toBe("Couldn't save layout");
  });

  it("adopts prefs saved by another tab", () => {
    const { result } = renderHook(usePrefs, { wrapper });
    const other = JSON.stringify({ version: 1, speed: "relaxed", hidden: ["nvme"] });
    store.data.set(PREFS_KEY, other);
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: PREFS_KEY, newValue: other })); });
    expect(result.current.state.speed).toBe("relaxed");
    expect(result.current.state.hidden).toEqual(["nvme"]);
  });

  it("resetLayout restores the default layout and shows everything", () => {
    const { result } = renderHook(usePrefs, { wrapper });
    const initial = result.current.state.layout;
    act(() => result.current.dispatch({ type: "setLayout", layout: [] }));
    act(() => result.current.dispatch({ type: "hide", id: "cpu" }));
    act(() => result.current.dispatch({ type: "resetLayout" }));
    expect(result.current.state.layout).toEqual(initial);
    expect(result.current.state.hidden).toEqual([]);
  });
});

describe("useRefetch", () => {
  it.each([
    ["live", false, 5000], ["relaxed", false, 10000], ["slow", false, 25000],
    ["live", true, false], ["slow", true, false],
  ] as const)("%s paused=%s → %s", (speed, paused, out) => {
    expect(refetchInterval(5000, speed, paused)).toBe(out);
  });

  it("follows the provider's speed and pause", () => {
    const { result } = renderHook(usePrefs, { wrapper });
    expect(result.current.interval).toBe(5000);
    act(() => result.current.dispatch({ type: "setSpeed", speed: "slow" }));
    expect(result.current.interval).toBe(25000);
    act(() => result.current.dispatch({ type: "setPaused", paused: true }));
    expect(result.current.interval).toBe(false);
  });

  it("defaults to live outside the provider", () => {
    expect(renderHook(() => useRefetch(1000)).result.current).toBe(1000);
  });
});

describe("useAlerts (E1)", () => {
  it("keeps its fixed interval when paused or slow", () => {
    const client = new QueryClient({ defaultOptions: { queries: { queryFn: () => new Promise(() => {}) } } });
    let dispatch!: ReturnType<typeof useUiPrefsDispatch>;
    function Probe() { dispatch = useUiPrefsDispatch(); useAlerts(); return null; }
    render(<QueryClientProvider client={client}><UiPrefsProvider store={store}><Probe /></UiPrefsProvider></QueryClientProvider>);
    const interval = () => (client.getQueryCache().find({ queryKey: ["/api/system/alerts"] })!.observers[0].options.refetchInterval);
    act(() => dispatch({ type: "setSpeed", speed: "slow" }));
    act(() => dispatch({ type: "setPaused", paused: true }));
    expect(interval()).toBe(ALERTS_INTERVAL_MS);
  });
});
