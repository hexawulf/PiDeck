// @vitest-environment jsdom
// Log download (2.6.1): file names, file text and the button (saves exactly the lines shown).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logFileName, logFileText, slug } from "@/components/logview/download";
import { DownloadLogButton } from "@/components/logview/download-log-button";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("file names", () => {
  it("slug keeps [a-z0-9._-], lowercases, trims, never empty", () => {
    expect(slug("DS920+")).toBe("ds920");
    expect(slug("docker_plex")).toBe("docker_plex");
    expect(slug("  Auth log / 2026 ")).toBe("auth-log-2026");
    expect(slug("../../etc/passwd")).toBe("etc-passwd");
    expect(slug("🔥")).toBe("log");
    expect(slug("x".repeat(100))).toHaveLength(60);
  });
  it("host-source-YYYYMMDD-HHMM.log in local time", () => {
    expect(logFileName("ds920", "docker_plex", new Date(2026, 8, 29, 14, 5))).toBe("ds920-docker_plex-20260929-1405.log");
    expect(logFileName("piapps", "pitasker_out", new Date(2026, 0, 2, 3, 4))).toBe("piapps-pitasker_out-20260102-0304.log");
  });
  it("file text is newline-terminated, empty for no lines", () => {
    expect(logFileText(["a", "b"])).toBe("a\nb\n");
    expect(logFileText([])).toBe("");
  });
});

describe("DownloadLogButton", () => {
  it("saves exactly the lines shown under the host/source name", async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => (blobs.push(b as Blob), "blob:x"));
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    render(<DownloadLogButton lines={["one", "two [REDACTED]"]} host="ds920" source="docker_plex" />);
    const btn = screen.getByRole("button", { name: "Download the 2 lines shown" });
    fireEvent.click(btn);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toMatch(/^ds920-docker_plex-\d{8}-\d{4}\.log$/);
    expect(await blobs[0].text()).toBe("one\ntwo [REDACTED]\n");
  });
  it("is disabled with nothing to save", () => {
    render(<DownloadLogButton lines={[]} host="local" source="syslog" />);
    expect((screen.getByTestId("log-download") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("log-download").getAttribute("aria-label")).toBe("Nothing to download");
  });
});
