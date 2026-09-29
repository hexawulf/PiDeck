// @vitest-environment jsdom
// H2 UI: host-named alert toasts, the /hosts overview tiles, g o, palette.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { alertText, ALERTS_URL, resolvedText, type AlertView } from "@/hooks/use-alerts";
import { AlertToasts } from "@/components/app-shell";
import HostsOverview from "@/pages/hosts";
import { hostStatusText, needsAgentUpdate, tabOnHost } from "@/components/host-switcher";
import { resolveKey } from "@/shortcuts/shortcuts";
import { buildActions, type PaletteContext } from "@/palette/actions";
import { UiPrefsProvider } from "@/prefs/UiPrefsProvider";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toast.mockReset();
  localStorage.clear();
});

const alert = (over: Partial<AlertView>): AlertView => ({
  id: 1, hostId: "piapps2", hostLabel: "piapps2", type: "temperature", severity: "warning",
  message: "Temperature above 70 °C (75.0 °C)", startedAt: "2026-09-29T00:12:00.000Z", resolvedAt: null, ...over,
});

describe("alert texts name the host", () => {
  it("temperature and offline", () => {
    expect(alertText(alert({}))).toBe("piapps2: temperature above 70 °C (75.0 °C)");
    const off = alertText(alert({ type: "offline", severity: "critical", message: "x" }));
    expect(off).toMatch(/^piapps2: offline since \d\d:\d\d/);
  });
  it("resolved", () => {
    expect(resolvedText(alert({ type: "offline" }))).toBe("piapps2: back online");
    expect(resolvedText(alert({}))).toBe("piapps2: temperature back to normal");
  });
});

describe("AlertToasts", () => {
  it("toasts a new alert once with the host's name, then once when it resolves", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { queryFn: () => new Promise(() => {}), retry: false } } });
    client.setQueryData([ALERTS_URL], [alert({})]);
    render(<QueryClientProvider client={client}><AlertToasts /></QueryClientProvider>);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][0].description).toBe("piapps2: temperature above 70 °C (75.0 °C)");
    act(() => client.setQueryData([ALERTS_URL], [alert({})]));
    expect(toast).toHaveBeenCalledTimes(1);
    act(() => client.setQueryData([ALERTS_URL], [alert({ resolvedAt: "2026-09-29T00:20:00.000Z" })]));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(toast.mock.calls[1][0].description).toBe("piapps2: temperature back to normal");
  });
  it("never toasts 'resolved' for an alert it didn't see open", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { queryFn: () => new Promise(() => {}) } } });
    client.setQueryData([ALERTS_URL], [alert({ resolvedAt: "2026-09-29T00:20:00.000Z" })]);
    render(<QueryClientProvider client={client}><AlertToasts /></QueryClientProvider>);
    await new Promise((r) => setTimeout(r, 20));
    expect(toast).not.toHaveBeenCalled();
  });
});

const summary = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, label: id, local: id === "local", status, version: "2.5.0", lastSeen: "2026-09-29T00:00:00.000Z", history: "ok", sample: null, alerts: [], ...over,
});

describe("/hosts overview", () => {
  it("one tile per host: online with numbers, wrong token, unreachable (grey, last seen), old agent (amber)", async () => {
    const body = {
      generatedAt: "2026-09-29T00:00:00.000Z",
      historyHours: 24,
      hosts: [
        summary("local", "online", { sample: { at: "x", cpu: 12.4, memory: 40, temperature: 51.2, diskUsage: 63, rxKBs: 1, txKBs: 2 } }),
        summary("badtoken", "auth-error", { lastSeen: null }),
        summary("gone", "offline", { alerts: [alert({ id: 9, hostId: "gone", hostLabel: "gone", type: "offline", severity: "critical" })] }),
        summary("old", "online", { history: "unsupported", version: "2.4.0" }),
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { hook } = memoryLocation({ path: "/hosts" });
    render(
      <QueryClientProvider client={client}>
        <UiPrefsProvider>
          <Router hook={hook}><HostsOverview /></Router>
        </UiPrefsProvider>
      </QueryClientProvider>,
    );
    const local = await screen.findByTestId("host-tile-local");
    expect(local.getAttribute("href")).toBe("/dashboard");
    expect(local.textContent).toContain("12%");
    expect(local.textContent).toContain("51°");
    expect(local.textContent).toContain("63%");
    expect(screen.getByTestId("host-tile-badtoken").textContent).toContain("can't authenticate");
    const gone = screen.getByTestId("host-tile-gone");
    expect(gone.getAttribute("href")).toBe("/h/gone/dashboard");
    expect(gone.textContent).toMatch(/offline, last seen/);
    expect(gone.textContent).toContain("1 alert");
    expect(gone.className).toContain("opacity-70");
    const old = screen.getByTestId("host-tile-old");
    expect(old.textContent).toContain("update the agent for history");
    expect(old.className).toContain("border-pi-warning");
  });
});

describe("navigation", () => {
  it("amber status for an old agent; wrong token is not offline", () => {
    const h = { id: "p", label: "p", local: false, status: "online" as const, version: "2.4.0", lastSeen: null, history: "unsupported" as const };
    expect(needsAgentUpdate(h)).toBe(true);
    expect(hostStatusText(h)).toBe("online — update the agent for history");
    expect(needsAgentUpdate({ ...h, status: "offline" })).toBe(false);
  });
  it("switching host from /hosts opens its dashboard", () => {
    expect(tabOnHost("hosts", "local")).toBe("dashboard");
    expect(tabOnHost("hosts", "piapps2")).toBe("dashboard");
  });
  it("g o goes to the overview", () => {
    expect(resolveKey({ key: "o", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, "g", { typing: false, dialogOpen: false }).action).toBe("go-overview");
  });
  it("the palette offers All hosts when there are remote hosts", () => {
    const navigate = vi.fn();
    const hosts = [{ id: "local", label: "piapps", status: "online" }, { id: "p2", label: "piapps2", status: "online" }];
    const actions = buildActions({
      navigate, path: "/hosts", canEdit: false, editing: false, setEditing: vi.fn(), resolvedTheme: "light", toggleTheme: vi.fn(),
      density: "comfortable", setDensity: vi.fn(), paused: false, setPaused: vi.fn(), refresh: vi.fn(), logs: [], pins: [],
      requestUpdate: vi.fn(), showHelp: vi.fn(), hosts, hostId: "local",
    } as PaletteContext);
    const a = actions.find((x) => x.id === "go-overview")!;
    expect(a.hint).toBe("current");
    a.perform();
    expect(navigate).toHaveBeenCalledWith("/hosts");
    actions.find((x) => x.id === "host:p2")!.perform();
    expect(navigate).toHaveBeenLastCalledWith("/h/p2/dashboard");
  });
});
