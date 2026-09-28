import { describe, expect, it, vi } from "vitest";
import { buildActions, type PaletteContext } from "@/palette/actions";
import { fuzzyFilter, fuzzyScore } from "@/palette/fuzzy";

const ctx = (over: Partial<PaletteContext> = {}): PaletteContext => ({
  navigate: vi.fn(), path: "/dashboard", canEdit: true, editing: false, setEditing: vi.fn(),
  resolvedTheme: "light", toggleTheme: vi.fn(), density: "comfortable", setDensity: vi.fn(),
  paused: false, setPaused: vi.fn(), refresh: vi.fn(),
  logs: [{ id: "nginx_access", name: "access.log", label: "Nginx Access Log", path: "", size: 1, mtime: "", source: "nginx" }],
  pins: [], requestUpdate: vi.fn(), showHelp: vi.fn(), ...over,
});

describe("fuzzy", () => {
  it("matches in-order characters and ranks word starts / runs higher", () => {
    expect(fuzzyScore("gl", "Go to Logs")).not.toBeNull();
    expect(fuzzyScore("xyz", "Go to Logs")).toBeNull();
    expect(fuzzyScore("cron", "Go to Cron")!).toBeGreaterThan(fuzzyScore("cron", "Clear recent notifications")!); // run + word start beats scattered
  });
  it("filters and sorts; empty query keeps order", () => {
    const items = ["Go to Dashboard", "Go to Logs", "Pause auto-refresh"];
    expect(fuzzyFilter(items, "", (s) => [s])).toEqual(items);
    expect(fuzzyFilter(items, "paus", (s) => [s])).toEqual(["Pause auto-refresh"]);
    expect(fuzzyFilter(items, "log", (s) => [s])[0]).toBe("Go to Logs");
  });
});

describe("buildActions", () => {
  it("has navigation, view, refresh, logs, update and help actions", () => {
    const ids = buildActions(ctx()).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([
      "go-dashboard", "go-logs", "go-apps", "go-cron", "go-settings", "theme", "density", "edit",
      "pause", "refresh", "log:nginx_access", "update-system", "help",
    ]));
  });

  it("hides Edit layout where it can't work", () => {
    expect(buildActions(ctx({ canEdit: false })).some((a) => a.id === "edit")).toBe(false);
  });

  it("labels follow state", () => {
    const labels = buildActions(ctx({ paused: true, editing: true, resolvedTheme: "dark", density: "compact" })).map((a) => a.label);
    expect(labels).toEqual(expect.arrayContaining(["Resume auto-refresh", "Finish editing layout", "Switch to light theme", "Use comfortable density"]));
  });

  it("Update system only requests the confirm; logs and pins navigate with deep links", () => {
    const c = ctx({ pins: [{ logId: "gone", label: "Old", grep: "err", stale: true }] });
    const all = buildActions(c);
    all.find((a) => a.id === "update-system")!.perform();
    expect(c.requestUpdate).toHaveBeenCalledTimes(1);
    all.find((a) => a.id === "log:nginx_access")!.perform();
    expect(c.navigate).toHaveBeenCalledWith("/logs?log=nginx_access");
    const pin = all.find((a) => a.group === "Log pins")!;
    expect(pin).toMatchObject({ muted: true, hint: "file no longer available" });
    pin.perform();
    expect(c.navigate).toHaveBeenLastCalledWith("/logs?log=gone&grep=err");
  });
});
