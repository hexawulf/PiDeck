// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast, useToast: () => ({ toast }) }));

import { addPin, isPinStale, markLogMissing, markLogPresent, MAX_PINS, removePin, useLogPins } from "@/hooks/use-log-pins";
import { defaultPrefs, loadPrefs, parseImport, PREFS_KEY, serializePrefs, type Pin, type Store } from "@/prefs/prefs";
import { UiPrefsProvider } from "@/prefs/UiPrefsProvider";
import { WIDGETS } from "@/widgets/registry";

afterEach(cleanup);

const many = (n: number): Pin[] => Array.from({ length: n }, (_, i) => ({ logId: `log${i}` }));

describe("addPin / removePin", () => {
  it("adds newest first and normalises empty filters away", () => {
    const { pins, result } = addPin([{ logId: "a" }], { logId: "b", label: "B", grep: "  " });
    expect(result).toBe("added");
    expect(pins).toEqual([{ logId: "b", label: "B" }, { logId: "a" }]);
  });

  it("dedupes the same log + filter, but allows the same log with another filter", () => {
    const base: Pin[] = [{ logId: "a" }, { logId: "a", grep: "error" }];
    expect(addPin(base, { logId: "a" }).result).toBe("duplicate");
    expect(addPin(base, { logId: "a", grep: " error " }).result).toBe("duplicate");
    expect(addPin(base, { logId: "a", grep: "warn" }).result).toBe("added");
  });

  it(`refuses a pin beyond ${MAX_PINS}`, () => {
    expect(addPin(many(MAX_PINS - 1), { logId: "x" }).result).toBe("added");
    const full = addPin(many(MAX_PINS), { logId: "x" });
    expect(full.result).toBe("full");
    expect(full.pins).toHaveLength(MAX_PINS);
  });

  it("removes only the matching log + filter", () => {
    const base: Pin[] = [{ logId: "a" }, { logId: "a", grep: "error" }];
    expect(removePin(base, { logId: "a", grep: "error" })).toEqual([{ logId: "a" }]);
    expect(removePin(base, { logId: "a" })).toEqual([{ logId: "a", grep: "error" }]);
  });
});

describe("stale marking", () => {
  it("is stale when missing from the list or 404'd", () => {
    expect(isPinStale("a", null, new Set())).toBe(false); // list not loaded yet → unknown, not stale
    expect(isPinStale("a", new Set(["a"]), new Set())).toBe(false);
    expect(isPinStale("gone", new Set(["a"]), new Set())).toBe(true);
    expect(isPinStale("a", new Set(["a"]), new Set(["a"]))).toBe(true);
  });
});

describe("pins in prefs", () => {
  it("schema limits stay compatible: 100 pins load, 101 invalidate only the pins section", () => {
    const store = (pins: Pin[]): Store => ({ getItem: () => JSON.stringify({ version: 1, pins, speed: "slow" }), setItem: () => {} });
    expect(loadPrefs(store(many(100)), WIDGETS).prefs.pins).toHaveLength(100);
    const r = loadPrefs(store(many(101)), WIDGETS);
    expect(r.issue).toEqual({ kind: "sections", sections: ["pins"] });
    expect(r.prefs.speed).toBe("slow");
  });

  it("round-trips through Export → Import", () => {
    const pins: Pin[] = [{ logId: "home_x_log", label: "X", grep: "error" }, { logId: "nginx_access" }];
    const r = parseImport(serializePrefs({ ...defaultPrefs(WIDGETS), pins }), WIDGETS);
    expect(r.ok && r.prefs.pins).toEqual(pins);
  });
});

describe("useLogPins", () => {
  const setup = () => {
    const data = new Map<string, string>();
    const store: Store = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    const client = new QueryClient();
    client.setQueryData(["/api/hostlogs"], [{ id: "a", name: "a.log", label: "A", path: "", size: 1, mtime: "", source: "home" }]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}><UiPrefsProvider store={store}>{children}</UiPrefsProvider></QueryClientProvider>
    );
    return { data, ...renderHook(() => useLogPins(), { wrapper }) };
  };

  it("pins, persists, unpins", () => {
    const { result, data } = setup();
    act(() => { result.current.pin({ logId: "a", label: "A" }); });
    expect(result.current.isPinned("a")).toBe(true);
    expect(JSON.parse(data.get(PREFS_KEY)!).pins).toEqual([{ logId: "a", label: "A" }]);
    act(() => { result.current.unpin({ logId: "a" }); });
    expect(result.current.pins).toEqual([]);
  });

  it("marks stale from the log list and from a 404, and un-marks when it opens again", () => {
    const { result } = setup();
    expect(result.current.isStale("a")).toBe(false);
    expect(result.current.isStale("gone")).toBe(true);
    act(() => markLogMissing("a"));
    expect(result.current.isStale("a")).toBe(true);
    act(() => markLogPresent("a"));
    expect(result.current.isStale("a")).toBe(false);
  });

  it("toasts at the limit", () => {
    const { result } = setup();
    for (let i = 0; i < MAX_PINS; i++) act(() => { result.current.pin({ logId: `l${i}` }); });
    let r: string | undefined;
    act(() => { r = result.current.pin({ logId: "one-more" }); });
    expect(r).toBe("full");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: `Pin limit reached (${MAX_PINS})` }));
  });
});
