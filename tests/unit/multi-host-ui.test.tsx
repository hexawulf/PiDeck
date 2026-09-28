// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiPath, formatLastSeen, hostBase, hostHref, hostProblemOf } from "@/hosts/host-path";
import { HostProvider } from "@/hosts/HostProvider";
import {
  defaultPrefs, hostLayout, loadPrefs, parseImport, PREFS_KEY, PREFS_VERSION, remoteRegistry, serializePrefs, withHostLayout,
  type WidgetSizing,
} from "@/prefs/prefs";
import { UiPrefsProvider, useUiPrefs, useUiPrefsDispatch } from "@/prefs/UiPrefsProvider";
import { WIDGETS, widgetsFor } from "@/widgets/registry";
import { ENDPOINT_SCHEMAS } from "@/widgets/schemas";
import { useWidgetQuery, widgetQueryKey } from "@/widgets/useWidgetQuery";
import { QueryState } from "@/widgets/WidgetFrame";
import { buildActions, type PaletteContext } from "@/palette/actions";
import { tabOnHost } from "@/components/host-switcher";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("apiPath / hrefs", () => {
  it("leaves local paths alone and routes remote ones through the hub proxy", () => {
    expect(apiPath("local", "/api/metrics/ram")).toBe("/api/metrics/ram");
    expect(apiPath("piapps2", "/api/metrics/ram")).toBe("/api/hosts/piapps2/metrics/ram");
    expect(apiPath("piapps2", "/api/docker/containers")).toBe("/api/hosts/piapps2/docker/containers");
  });
  it("refuses non-API paths and bad host ids", () => {
    expect(() => apiPath("piapps2", "/healthz")).toThrow();
    expect(() => apiPath("../x", "/api/metrics/ram")).toThrow();
    expect(() => apiPath("PIAPPS2", "/api/metrics/ram")).toThrow();
  });
  it("builds page links", () => {
    expect(hostBase("local")).toBe("");
    expect(hostHref("local", "apps")).toBe("/apps");
    expect(hostHref("piapps2", "dashboard")).toBe("/h/piapps2/dashboard");
  });
  it("keeps the tab when switching hosts if the host has it", () => {
    expect(tabOnHost("apps", "piapps2")).toBe("apps");
    expect(tabOnHost("logs", "piapps2")).toBe("dashboard");
    expect(tabOnHost("logs", "local")).toBe("logs");
  });
});

describe("hostProblemOf", () => {
  it("reads the hub's 502 bodies", () => {
    expect(hostProblemOf(new Error('502: {"offline":true,"host":"p","lastSeen":"2026-09-28T10:00:00.000Z"}')))
      .toEqual({ kind: "offline", lastSeen: "2026-09-28T10:00:00.000Z" });
    expect(hostProblemOf(new Error('502: {"auth":true,"host":"p"}'))).toEqual({ kind: "auth", lastSeen: null });
    expect(hostProblemOf(new Error('502: {"badResponse":true}'))).toEqual({ kind: "bad", lastSeen: null });
  });
  it("ignores everything else", () => {
    for (const e of [new Error("500: {}"), new Error("502: <html>"), new Error('502: {"x":1}'), new TypeError("Failed"), null, "502"]) {
      expect(hostProblemOf(e)).toBeNull();
    }
  });
  it("formats last seen", () => {
    const now = Date.parse("2026-09-28T12:00:00Z");
    expect(formatLastSeen(null, now)).toBe("never");
    expect(formatLastSeen("2026-09-28T11:59:30Z", now)).toBe("just now");
    expect(formatLastSeen("2026-09-28T11:55:00Z", now)).toBe("5 min ago");
    expect(formatLastSeen("2026-09-28T09:00:00Z", now)).toBe("3 h ago");
    expect(formatLastSeen("2026-09-26T12:00:00Z", now)).toBe("2 d ago");
  });
});

describe("registry scope", () => {
  it("remote hosts get only 'any' widgets: no history charts, no Quick Actions", () => {
    const remote = widgetsFor(false).map((w) => w.id);
    expect(remote).not.toContain("disk-io");
    expect(remote).not.toContain("net-bandwidth");
    expect(remote).not.toContain("quick-actions");
    expect(remote).toContain("cpu");
    expect(widgetsFor(true)).toBe(WIDGETS);
    expect(WIDGETS.every((w) => w.hosts === "any" || w.hosts === "local")).toBe(true);
  });
});

// ── query-key isolation ──────────────────────────────────────────────
function Probe({ id }: { id: string }) {
  const q = useWidgetQuery("/api/metrics/ram", false, ENDPOINT_SCHEMAS["/api/metrics/ram"]);
  return <QueryState query={q}>{(d) => <p>{id}: {d.total}</p>}</QueryState>;
}
function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ui: <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
const ram = (total: number) => ({ total, used: 1, free: 1, available: 1, buffers: 0, cached: 0, usage: 50 });

describe("query keys per host", () => {
  it("puts the request path and the host id in the key", () => {
    expect(widgetQueryKey("local", "/api/metrics/ram")).toEqual(["/api/metrics/ram", "local"]);
    expect(widgetQueryKey("piapps2", "/api/metrics/ram")).toEqual(["/api/hosts/piapps2/metrics/ram", "piapps2"]);
  });
  it("never mixes hosts in the cache", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(ram(url.includes("/hosts/piapps2/") ? 222 : 111)), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { client, ui } = withClient(
      <>
        <Probe id="local" />
        <HostProvider hostId="piapps2"><Probe id="remote" /></HostProvider>
      </>,
    );
    render(ui);
    await waitFor(() => expect(screen.getByText("local: 111")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("remote: 222")).toBeTruthy());
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(["/api/hosts/piapps2/metrics/ram", "/api/metrics/ram"]);
    expect(client.getQueryCache().getAll().map((q) => q.queryKey[1]).sort()).toEqual(["local", "piapps2"]);
  });
  it("shows an offline host calmly, with the last-seen time, instead of an error card", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url === "/api/hosts"
        ? new Response(JSON.stringify([
            { id: "local", label: "piapps", local: true, status: "online", version: "2.4.0", lastSeen: new Date().toISOString() },
            { id: "piapps2", label: "piapps2", local: false, status: "offline", version: "2.4.0", lastSeen: null },
          ]))
        : new Response(JSON.stringify({ offline: true, host: "piapps2", lastSeen: new Date(Date.now() - 5 * 60_000).toISOString() }), { status: 502 })));
    const { ui } = withClient(<HostProvider hostId="piapps2"><Probe id="remote" /></HostProvider>);
    render(ui);
    await waitFor(() => expect(screen.getByText("piapps2 is offline (last seen 5 min ago)")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
  it("names an auth problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url === "/api/hosts" ? new Response("[]") : new Response('{"auth":true,"host":"piapps2"}', { status: 502 })));
    const { ui } = withClient(<HostProvider hostId="piapps2"><Probe id="remote" /></HostProvider>);
    render(ui);
    await waitFor(() => expect(screen.getByText("Can't authenticate to piapps2, check its token.")).toBeTruthy());
  });
});

// ── prefs v2: layoutByHost ───────────────────────────────────────────
const REG: WidgetSizing[] = [
  { id: "a", defaultSize: { w: 3, h: 4 }, hosts: "any" },
  { id: "hist", defaultSize: { w: 6, h: 8 }, hosts: "local" },
  { id: "b", defaultSize: { w: 3, h: 4 }, hosts: "any" },
];
class MemStore {
  data = new Map<string, string>();
  constructor(init: Record<string, string> = {}) { for (const [k, v] of Object.entries(init)) this.data.set(k, v); }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe("prefs v2 (layoutByHost)", () => {
  it("is version 2", () => expect(PREFS_VERSION).toBe(2));

  it("migrates a v1 value: local layout kept, no host layouts yet", () => {
    const v1 = { version: 1, layout: [{ i: "b", x: 0, y: 0, w: 3, h: 4 }, { i: "a", x: 3, y: 0, w: 3, h: 4 }], hidden: ["hist"], density: "compact", speed: "slow", pins: [] };
    const r = loadPrefs(new MemStore({ [PREFS_KEY]: JSON.stringify(v1) }), REG);
    expect(r.issue).toBeNull();
    expect(r.prefs.density).toBe("compact");
    expect(r.prefs.layoutByHost).toEqual({});
    expect(r.prefs.layout.map((l) => l.i)).toEqual(["b", "a", "hist"]);
  });

  it("a remote host falls back to the local layout minus local-only widgets", () => {
    const prefs = { ...defaultPrefs(REG), hidden: ["b"] };
    const l = hostLayout(prefs, "piapps2", REG);
    expect(l.layout.map((x) => x.i)).toEqual(["a", "b"]);
    expect(l.hidden).toEqual(["b"]);
    expect(hostLayout(prefs, "local", REG)).toEqual({ layout: prefs.layout, hidden: prefs.hidden });
  });

  it("changes to a remote host's layout don't touch the local one", () => {
    const prefs = defaultPrefs(REG);
    const next = withHostLayout(prefs, "piapps2", { hidden: ["a"] }, REG);
    expect(next.hidden).toEqual([]);
    expect(next.layoutByHost.piapps2.hidden).toEqual(["a"]);
    expect(next.layoutByHost.piapps2.layout.map((x) => x.i)).toEqual(["a", "b"]);
  });

  it("reconciles saved host layouts against the remote registry", () => {
    const saved = {
      ...JSON.parse(serializePrefs(defaultPrefs(REG))),
      layoutByHost: { piapps2: { layout: [{ i: "hist", x: 0, y: 0, w: 6, h: 8 }, { i: "a", x: 0, y: 8, w: 3, h: 4 }], hidden: ["hist"] } },
    };
    const r = loadPrefs(new MemStore({ [PREFS_KEY]: JSON.stringify(saved) }), REG);
    expect(r.prefs.layoutByHost.piapps2.layout.map((l) => l.i)).toEqual(["a", "b"]);
    expect(r.prefs.layoutByHost.piapps2.hidden).toEqual([]);
    expect(remoteRegistry(REG).map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("a bad layoutByHost section falls back alone", () => {
    const saved = { ...JSON.parse(serializePrefs(defaultPrefs(REG))), density: "compact", layoutByHost: { "BAD ID": { layout: [], hidden: [] } } };
    const r = loadPrefs(new MemStore({ [PREFS_KEY]: JSON.stringify(saved) }), REG);
    expect(r.issue).toEqual({ kind: "sections", sections: ["layoutByHost"] });
    expect(r.prefs.density).toBe("compact");
    expect(r.prefs.layoutByHost).toEqual({});
  });

  it("export → import round-trips, host layouts included", () => {
    const prefs = withHostLayout({ ...defaultPrefs(REG), speed: "relaxed" as const }, "piapps2", { hidden: ["a"] }, REG);
    const r = parseImport(serializePrefs(prefs), REG);
    expect(r).toEqual({ ok: true, prefs });
  });

  it("still imports a v1 export", () => {
    const v1 = { version: 1, layout: [], hidden: [], density: "comfortable", speed: "live", pins: [] };
    const r = parseImport(JSON.stringify(v1), REG);
    expect(r.ok && r.prefs.layoutByHost).toEqual({});
    expect(parseImport(JSON.stringify({ ...v1, layoutByHost: {} }), REG)).toMatchObject({ ok: false }); // v1 has no such key
  });
});

describe("UiPrefsProvider per host", () => {
  const usePrefs = () => ({ prefs: useUiPrefs(), dispatch: useUiPrefsDispatch() });
  const wrap = (hostId: string, store: MemStore) => ({ children }: { children: ReactNode }) => (
    <HostProvider hostId={hostId}><UiPrefsProvider store={store}>{children}</UiPrefsProvider></HostProvider>
  );

  it("a remote host sees and edits its own layout; the local one is untouched and both persist", () => {
    const store = new MemStore();
    const remote = renderHook(usePrefs, { wrapper: wrap("piapps2", store) });
    expect(remote.result.current.prefs.layout.map((l) => l.i)).not.toContain("quick-actions");
    act(() => remote.result.current.dispatch({ type: "hide", id: "cpu" }));
    expect(remote.result.current.prefs.hidden).toEqual(["cpu"]);
    const saved = JSON.parse(store.data.get(PREFS_KEY)!);
    expect(saved.version).toBe(2);
    expect(saved.hidden).toEqual([]);
    expect(saved.layoutByHost.piapps2.hidden).toEqual(["cpu"]);
    remote.unmount();

    const local = renderHook(usePrefs, { wrapper: wrap("local", store) });
    expect(local.result.current.prefs.hidden).toEqual([]);
    expect(local.result.current.prefs.layout.map((l) => l.i)).toContain("quick-actions");
    act(() => local.result.current.dispatch({ type: "resetLayout" }));
    expect(JSON.parse(store.data.get(PREFS_KEY)!).layoutByHost.piapps2.hidden).toEqual(["cpu"]);
  });
});

describe("palette hosts", () => {
  const ctx = (over: Partial<PaletteContext> = {}): PaletteContext => ({
    navigate: vi.fn(), path: "/h/piapps2/apps", canEdit: false, editing: false, setEditing: vi.fn(),
    resolvedTheme: "light", toggleTheme: vi.fn(), density: "comfortable", setDensity: vi.fn(),
    paused: false, setPaused: vi.fn(), refresh: vi.fn(), logs: [], pins: [], requestUpdate: vi.fn(), showHelp: vi.fn(),
    hostId: "piapps2",
    hosts: [{ id: "local", label: "piapps", status: "online" }, { id: "piapps2", label: "piapps2", status: "offline" }],
    ...over,
  });
  it("offers 'Switch to <host>' keeping the tab", () => {
    const c = ctx();
    const actions = buildActions(c);
    const toHub = actions.find((a) => a.label === "Switch to piapps")!;
    expect(actions.find((a) => a.label === "Switch to piapps2")!.hint).toBe("current");
    toHub.perform();
    expect(c.navigate).toHaveBeenCalledWith("/apps");
  });
  it("keeps Dashboard/Apps on the current host, hides Update System on a remote host", () => {
    const c = ctx();
    const actions = buildActions(c);
    actions.find((a) => a.id === "go-dashboard")!.perform();
    expect(c.navigate).toHaveBeenCalledWith("/h/piapps2/dashboard");
    expect(actions.find((a) => a.id === "go-apps")!.hint).toBe("current");
    expect(actions.some((a) => a.id === "update-system")).toBe(false);
  });
  it("no host actions with a single host", () => {
    expect(buildActions(ctx({ hosts: [{ id: "local", label: "piapps", status: "online" }], hostId: "local", path: "/dashboard" }))
      .some((a) => a.group === "Hosts")).toBe(false);
  });
});
