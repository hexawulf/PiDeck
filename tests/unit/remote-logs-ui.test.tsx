// @vitest-environment jsdom
// Remote Logs tab (H3 Track B): helpers, per-host pins, tab gating, rendering.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import RemoteLogs, { problemMessage, RedactedLine, tailUrl } from "@/components/remote-logs";
import { parseRemotePinId, remoteLogHref, remotePinId, remoteTabs } from "@/hosts/host-path";
import { tabOnHost } from "@/components/host-switcher";
import { isPinStale } from "@/hooks/use-log-pins";
import { HostProvider } from "@/hosts/HostProvider";
import { UiPrefsProvider } from "@/prefs/UiPrefsProvider";
import { buildActions, type PaletteContext } from "@/palette/actions";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("helpers", () => {
  it("tab gating: Logs only for agents with the capability", () => {
    expect(remoteTabs(false)).toEqual(["dashboard", "apps"]);
    expect(remoteTabs(undefined)).toEqual(["dashboard", "apps"]);
    expect(remoteTabs(true)).toEqual(["dashboard", "apps", "logs"]);
    expect(tabOnHost("logs", "p2")).toBe("dashboard");
    expect(tabOnHost("logs", "p2", true)).toBe("logs");
    expect(tabOnHost("cron", "p2", true)).toBe("dashboard");
  });
  it("remote pin ids are per host and never collide with local ids", () => {
    expect(remotePinId("piapps2", "docker_plex")).toBe("h:piapps2:docker_plex");
    expect(parseRemotePinId("h:piapps2:docker_plex")).toEqual({ hostId: "piapps2", sourceId: "docker_plex" });
    for (const bad of ["home_x", "h:PIAPPS:x", "h:p2:../x", "h:p2", "h::x"]) expect(parseRemotePinId(bad)).toBeNull();
    expect(remoteLogHref("piapps2", "file_syslog", "sshd")).toBe("/h/piapps2/logs?log=file_syslog&grep=sshd");
    expect(isPinStale("h:p2:x", new Set(["home_a"]), new Set())).toBe(false); // not in the local list ≠ stale
    expect(isPinStale("h:p2:x", null, new Set(["h:p2:x"]))).toBe(true);
    expect(isPinStale("home_b", new Set(["home_a"]), new Set())).toBe(true);
  });
  it("tail URLs and error messages", () => {
    expect(tailUrl("docker_plex", 500, "  err ")).toBe("/api/agent/logs/docker_plex?lines=500&filter=err");
    expect(tailUrl("x", 200, "")).toBe("/api/agent/logs/x?lines=200");
    expect(problemMessage(new Error('404: {"message":"container no longer exists","host":"p2"}'))).toEqual({ status: 404, message: "container no longer exists" });
    expect(problemMessage(new Error("boom"))).toEqual({ status: null, message: "boom" });
  });
  it("marks redacted spans", () => {
    render(<div data-testid="l"><RedactedLine line="a password=[REDACTED] b [REDACTED]" /></div>);
    expect(screen.getByTestId("l").querySelectorAll("mark[data-redacted]")).toHaveLength(2);
    expect(screen.getByTestId("l").textContent).toBe("a password=[REDACTED] b [REDACTED]");
  });
  it("palette: g l / Logs go to the remote host's logs when it has them; remote pins open there", () => {
    const navigate = vi.fn();
    const base = {
      navigate, canEdit: false, editing: false, setEditing: vi.fn(), resolvedTheme: "light", toggleTheme: vi.fn(), density: "comfortable", setDensity: vi.fn(),
      paused: false, setPaused: vi.fn(), refresh: vi.fn(), logs: [], requestUpdate: vi.fn(), showHelp: vi.fn(),
      hosts: [{ id: "local", label: "hub", status: "online" }, { id: "p2", label: "piapps2", status: "online", logs: true }, { id: "p3", label: "old", status: "online" }],
    };
    const on = buildActions({ ...base, path: "/h/p2/dashboard", hostId: "p2", pins: [{ logId: "h:p2:file_syslog", grep: "sshd", label: "piapps2: Syslog" }] } as unknown as PaletteContext);
    on.find((a) => a.id === "go-logs")!.perform();
    expect(navigate).toHaveBeenLastCalledWith("/h/p2/logs");
    on.find((a) => a.id.startsWith("pin:h:p2"))!.perform();
    expect(navigate).toHaveBeenLastCalledWith("/h/p2/logs?log=file_syslog&grep=sshd");
    buildActions({ ...base, path: "/h/p3/dashboard", hostId: "p3", pins: [] } as unknown as PaletteContext).find((a) => a.id === "go-logs")!.perform();
    expect(navigate).toHaveBeenLastCalledWith("/logs");
  });
});

describe("RemoteLogs", () => {
  const LIST = {
    sources: [
      { id: "file_syslog", label: "Syslog", kind: "file", readable: true, size: 10, mtime: "2026-09-29T00:00:00.000Z" },
      { id: "file_auth", label: "Auth", kind: "file", readable: false, hint: "No permission: add the agent user to the file's group (adm on Ubuntu, log on DSM), then restart the agent." },
      { id: "docker_plex", label: "plex", kind: "docker", readable: true, state: "running" },
    ],
    docker: { enabled: true, reachable: true },
  };
  it("lists sources by kind, greys unreadable ones with their hint, tails with marked redactions and pins per host", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      const body = url.includes("/api/hosts?") || url === "/api/hosts"
        ? [{ id: "local", label: "hub", local: true, status: "online", version: "2.6.0", lastSeen: null }, { id: "p2", label: "piapps2", local: false, status: "online", version: "2.6.0", lastSeen: null, logs: true }]
        : url.startsWith("/api/hosts/p2/agent/logs/file_syslog")
          ? { id: "file_syslog", label: "Syslog", lines: ["boot ok", "curl -H Authorization: [REDACTED]"], truncated: true, redacted: 1, redactedLines: [1] }
          : LIST;
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { hook } = memoryLocation({ path: "/h/p2/logs" });
    render(
      <QueryClientProvider client={client}>
        <HostProvider hostId="p2">
          <UiPrefsProvider>
            <Router hook={hook}><RemoteLogs /></Router>
          </UiPrefsProvider>
        </HostProvider>
      </QueryClientProvider>,
    );
    const auth = await screen.findByRole("button", { name: /Auth/ });
    expect(auth.getAttribute("data-readable")).toBe("false");
    expect(auth.textContent).toContain("adm on Ubuntu");
    fireEvent.click(screen.getByRole("button", { name: /Syslog/ }));
    await waitFor(() => expect(screen.getByTestId("remote-log-lines").querySelectorAll("mark[data-redacted]")).toHaveLength(1));
    expect(screen.getByTestId("redacted-count").textContent).toContain("1 redacted");
    expect(screen.getByTestId("truncated")).toBeTruthy();
    expect(seen).toContain("/api/hosts/p2/agent/logs/file_syslog?lines=200");
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(screen.getByTestId("remote-pins").textContent).toContain("piapps2: Syslog"));
    fireEvent.click(auth);
    expect((await screen.findByTestId("unreadable")).textContent).toContain("adm on Ubuntu");
  });
});
