// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { classifyCommandFailure, hasTool, nvmeDevice, unavailable } from "../../server/services/unavailable";
import { ENDPOINT_SCHEMAS, isUnavailable, unavailableSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";
import { FIXTURES } from "./widget-fixtures";

afterEach(cleanup);

describe("classifyCommandFailure", () => {
  it("recognises a missing sudoers rule (sudo -n)", () => {
    for (const stderr of ["sudo: a password is required", "sudo: a terminal is required to read the password", "zk is not in the sudoers file"]) {
      expect(classifyCommandFailure({ code: 1 }, stderr)).toBe("needs-sudoers");
    }
  });
  it("recognises a missing tool", () => {
    expect(classifyCommandFailure({ code: 127 }, "/bin/sh: 1: pm2: not found")).toBe("not-installed");
    expect(classifyCommandFailure({ code: "ENOENT" })).toBe("not-installed");
  });
  it("leaves real failures alone", () => {
    expect(classifyCommandFailure({ code: 2 }, "Smartctl open device: /dev/nvme0 failed: Permission denied")).toBeNull();
    expect(classifyCommandFailure(null)).toBeNull();
  });
});

describe("tool and device discovery", () => {
  it("finds tools on the system paths only", () => {
    expect(hasTool("vcgencmd", (p) => p === "/usr/bin/vcgencmd")).toBe(true);
    expect(hasTool("vcgencmd", () => false)).toBe(false);
  });
  it("picks the first NVMe device, honours a valid PIDECK_NVME_DEVICE, rejects anything else", () => {
    const has = (...devs: string[]) => (p: string) => devs.includes(p);
    expect(nvmeDevice({}, has("/dev/nvme1"))).toBe("/dev/nvme1");
    expect(nvmeDevice({}, has())).toBeNull();
    expect(nvmeDevice({ PIDECK_NVME_DEVICE: "/dev/nvme0n1" }, has("/dev/nvme0n1"))).toBe("/dev/nvme0n1");
    expect(nvmeDevice({ PIDECK_NVME_DEVICE: "/dev/nvme0; rm -rf /" }, () => true)).toBeNull();
    expect(nvmeDevice({ PIDECK_NVME_DEVICE: "/dev/sda" }, () => true)).toBeNull();
  });
});

describe("schemas", () => {
  const u = unavailable("needs-sudoers", "Needs a sudoers rule");
  it.each(["/api/metrics/nvme", "/api/metrics/thermal-zones", "/api/metrics/power-status", "/api/metrics/firewall-status"] as const)(
    "%s accepts real data and the unavailable shape", (url) => {
      expect(ENDPOINT_SCHEMAS[url].safeParse(FIXTURES[url]).success).toBe(true);
      expect(ENDPOINT_SCHEMAS[url].safeParse(u).success).toBe(true);
    });
  it("the unavailable shape is strict", () => {
    expect(unavailableSchema.safeParse({ ...u, extra: 1 }).success).toBe(false);
    expect(unavailableSchema.safeParse({ ...u, reason: "whatever" }).success).toBe(false);
    expect(unavailableSchema.safeParse({ available: true, reason: "no-device", message: "" }).success).toBe(false);
  });
  it("widgets that can't be unavailable still reject it", () => {
    expect(ENDPOINT_SCHEMAS["/api/metrics/ram"].safeParse(u).success).toBe(false);
  });
  it("system info allows a missing CPU temperature (null)", () => {
    const info = { ...(FIXTURES["/api/system/info"] as object), temperature: null };
    expect(ENDPOINT_SCHEMAS["/api/system/info"].safeParse(info).success).toBe(true);
  });
  it("isUnavailable", () => {
    expect(isUnavailable(u)).toBe(true);
    expect(isUnavailable({ temperature: "40" })).toBe(false);
    expect(isUnavailable(null)).toBe(false);
  });
});

describe("QueryState", () => {
  it("renders the unavailable shape calmly, not as an error", () => {
    const query = { data: unavailable("not-supported", "Raspberry Pi only (vcgencmd not found)."), error: null, isPending: false, refetch: async () => ({}) } as never;
    render(<QueryState query={query}>{() => <p>data</p>}</QueryState>);
    expect(screen.getByText("Not available on this host")).toBeTruthy();
    expect(screen.getByText("Raspberry Pi only (vcgencmd not found).")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("data")).toBeNull();
  });
});
