// @vitest-environment jsdom
// Services (2.8) in the UI: helpers, the Services card, collapsed Docker/pm2
// cards, the overview chip and the service alert texts.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import ServicesCard, { formatBytes, sortServices, stateText, type ServiceRow } from "@/components/services-card";
import AppMonitor from "@/components/app-monitor";
import { serviceChip } from "@/pages/hosts";
import { getQueryFn } from "@/lib/queryClient";
import { journalSourceId } from "@/hosts/host-path";
import { alertText, resolvedText, type AlertView } from "@/hooks/use-alerts";
import { HostProvider } from "@/hosts/HostProvider";
import { UiPrefsProvider } from "@/prefs/UiPrefsProvider";
import { journalSourceId as serverJournalSourceId } from "../../server/services/agent-logs/sources";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const row = (unit: string, health: ServiceRow["health"], over: Partial<ServiceRow> = {}): ServiceRow => ({
  unit, user: false, label: null, description: `${unit} daemon`, load: "loaded", active: health === "ok" ? "active" : health === "fail" ? "failed" : "inactive",
  sub: health === "ok" ? "running" : "dead", unitFileState: "enabled", type: "simple", result: "success", mainPid: null, restarts: 0, memory: 10 * 1024 * 1024,
  since: "2026-09-30T06:00:00.000Z", health, listed: true, ...over,
});

describe("helpers", () => {
  it("failed and not-found first, then down; listed before unlisted", () => {
    const sorted = sortServices([row("nginx", "ok"), row("x.service", "fail", { listed: false }), row("vnstat", "warn"), row("typo", "fail", { load: "not-found" })]);
    expect(sorted.map((r) => r.unit)).toEqual(["typo", "x.service", "vnstat", "nginx"]);
  });
  it("state text: active (exited), unit not found; memory", () => {
    expect(stateText(row("wg-quick@wg-pideck", "ok", { sub: "exited" }))).toBe("active (exited)");
    expect(stateText(row("typo", "fail", { load: "not-found" }))).toBe("unit not found");
    expect(stateText(row("x", "unknown"))).toBe("unknown");
    expect([formatBytes(null), formatBytes(512), formatBytes(10 * 1024 * 1024), formatBytes(3 * 1024 ** 3)]).toEqual(["—", "1 KB", "10 MB", "3.0 GB"]);
  });
  it("journal log source ids match the agent's", () => {
    for (const [u, user] of [["pideck-agent", false], ["openclaw-gateway", true], ["wg-quick@wg-pideck", false], ["postgresql@18-main.service", false]] as const) {
      expect(journalSourceId(u, user)).toBe(serverJournalSourceId(u, user));
    }
  });
  it("overview chip", () => {
    expect(serviceChip(null)).toBeNull();
    expect(serviceChip({ listed: 14, ok: 14, failed: [], down: [] })).toEqual({ text: "14/14 ok", tone: "ok" });
    expect(serviceChip({ listed: 6, ok: 6, failed: ["pkgctl-HyperBackup-ED.service"], down: [] })).toEqual({ text: "1 failed: pkgctl-HyperBackup-ED.service", tone: "fail" });
    expect(serviceChip({ listed: 9, ok: 7, failed: [], down: ["piapps4-mail-listener (user)", "vnstat"] })).toEqual({ text: "2 down: piapps4-mail-listener (user) +1", tone: "warn" });
    expect(serviceChip({ listed: 0, ok: 0, failed: [], down: [] })).toEqual({ text: "no services listed", tone: "none" });
  });
  it("alert toasts name host, unit and since; resolve says running again", () => {
    const a: AlertView = {
      id: 1, hostId: "piapps4", hostLabel: "piapps4", type: "service:user:piapps4-mail-listener", severity: "warning",
      message: "piapps4-mail-listener (user) is inactive", startedAt: "2026-09-30T08:26:00.000Z", resolvedAt: null,
    };
    expect(alertText(a)).toMatch(/^piapps4: piapps4-mail-listener \(user\) is inactive since \S.*\d/);
    expect(resolvedText(a)).toBe("piapps4: piapps4-mail-listener (user) is running again");
    expect(resolvedText({ ...a, type: "service:typo", message: "typo is not found" })).toBe("piapps4: typo is running again");
  });
});

type Routes = Record<string, unknown>;
function renderAt(hostId: string, routes: Routes, ui: React.ReactNode) {
  const seen: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    seen.push(url);
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(`${k}?`));
    if (!key) return new Response('{"message":"nope"}', { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(routes[key]), { headers: { "content-type": "application/json" } });
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } } });
  const { hook } = memoryLocation({ path: "/" });
  render(
    <QueryClientProvider client={client}>
      <HostProvider hostId={hostId}>
        <UiPrefsProvider>
          <Router hook={hook}>{ui}</Router>
        </UiPrefsProvider>
      </HostProvider>
    </QueryClientProvider>,
  );
  return seen;
}
const HOSTS = [
  { id: "local", label: "hub", local: true, status: "online", version: "2.8.0", lastSeen: null, logs: true, services: true },
  { id: "p2", label: "piapps2", local: false, status: "online", version: "2.8.0", lastSeen: null, logs: true, services: true },
  { id: "old", label: "old", local: false, status: "online", version: "2.7.1", lastSeen: null, logs: true, services: false },
];
const SERVICES = {
  available: true, systemd: "259",
  services: [row("nginx", "ok"), row("openclaw-gateway", "ok", { user: true, label: "OpenClaw" }), row("typo", "fail", { load: "not-found", active: "inactive" })],
  failedOnly: [row("pkgctl-HyperBackup-ED.service", "fail", { listed: false })],
  warnings: [],
};

describe("ServicesCard", () => {
  it("local: table with failed first, count, filter", async () => {
    renderAt("local", { "/api/hosts": HOSTS, "/api/services": SERVICES }, <ServicesCard />);
    const table = await screen.findByTestId("services-table");
    const units = Array.from(table.querySelectorAll("tr[data-unit]")).map((r) => r.getAttribute("data-unit"));
    expect(units).toEqual(["typo", "pkgctl-HyperBackup-ED.service", "nginx", "openclaw-gateway"]);
    expect(screen.getByTestId("services-count").textContent).toBe("2/3 ok");
    expect(within(table).getByText("unit not found")).toBeTruthy();
    expect(within(table).getByText("OpenClaw")).toBeTruthy();
    expect(within(table).getByText("not listed")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter services"), { target: { value: "open" } });
    expect(Array.from(table.querySelectorAll("tr[data-unit]")).map((r) => r.getAttribute("data-unit"))).toEqual(["openclaw-gateway"]);
  });
  it("remote with logs: a Logs link for units that have a journal source", async () => {
    renderAt("p2", {
      "/api/hosts": HOSTS,
      "/api/hosts/p2/services": SERVICES,
      "/api/hosts/p2/agent/logs": { sources: [{ id: "journal_user_openclaw_gateway", label: "x", kind: "journal", readable: true }], docker: { enabled: false, reachable: false } },
    }, <ServicesCard />);
    const link = await screen.findByRole("link", { name: "Logs of openclaw-gateway" });
    expect(link.getAttribute("href")).toBe("/h/p2/logs?log=journal_user_openclaw_gateway");
    expect(screen.queryByRole("link", { name: "Logs of nginx" })).toBeNull();
  });
  it("an agent older than 2.8 isn't asked; no systemd says so", async () => {
    const seen = renderAt("old", { "/api/hosts": HOSTS }, <ServicesCard />);
    expect((await screen.findByTestId("services-update-agent")).textContent).toMatch(/update the agent/);
    expect(seen.some((u) => u.includes("/services"))).toBe(false);
    cleanup();
    renderAt("local", { "/api/hosts": HOSTS, "/api/services": { available: false, systemd: null, services: [], failedOnly: [], warnings: ["systemd not available on this host"] } }, <ServicesCard />);
    expect(await screen.findByTestId("services-unavailable")).toBeTruthy();
  });
});

describe("Apps tab", () => {
  it("Docker and pm2 collapse to one line each when absent (a VPS)", async () => {
    renderAt("p2", {
      "/api/hosts": HOSTS,
      "/api/hosts/p2/services": SERVICES,
      "/api/hosts/p2/docker/containers": { containers: [], warning: "docker_unavailable" },
      "/api/hosts/p2/pm2/processes": { available: false, reason: "not-installed", message: "pm2 isn't running on this host." },
    }, <AppMonitor />);
    expect((await screen.findByTestId("docker-absent")).textContent).toContain("No Docker on this host");
    expect((await screen.findByTestId("pm2-absent")).textContent).toContain("No pm2 on this host");
    expect(screen.queryByText("Docker Containers")).toBeNull();
    expect(screen.queryByText("PM2 Processes")).toBeNull();
    expect(await screen.findByTestId("services-card")).toBeTruthy();
  });
  it("present ones stay full cards", async () => {
    renderAt("p2", {
      "/api/hosts": HOSTS,
      "/api/hosts/p2/services": SERVICES,
      "/api/hosts/p2/docker/containers": { containers: [{ id: "a", name: "web", image: "nginx", status: "Up 1 hour", state: "running", ports: [] }] },
      "/api/hosts/p2/pm2/processes": { available: false, reason: "not-installed", message: "x" },
    }, <AppMonitor />);
    expect(await screen.findByText("Docker Containers")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("pm2-absent")).toBeTruthy());
    expect(screen.queryByTestId("docker-absent")).toBeNull();
  });
});
