// Track A step 3 (docs/plans/multi-host-h3.md): hwmon CPU temperature, DSM
// detection, PIDECK_DISK_MOUNT, and the calm "Not available on DSM" answers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { detectPlatform, notOnDsm, parseDsmVersion, readHwmonTemperature, setPlatformForTests } from "../../server/services/platform";
import { diskMount } from "../../server/config";
import { readDiskUsage } from "../../server/services/counters";
import { createSystemUpdateHandler } from "../../server/routes/system-update";
import nvmeRouter from "../../server/routes/nvme";
import powerRouter from "../../server/routes/powerStatus";
import networkRouter from "../../server/routes/network";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-hwmon-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
afterEach(() => setPlatformForTests(null));

let n = 0;
/** A /sys/class/hwmon-like tree: { hwmon0: { name: "coretemp", temp1_input: "56000", … } }. */
function tree(devices: Record<string, Record<string, string>>): string {
  const root = path.join(tmp, `t${n++}`);
  for (const [dev, files] of Object.entries(devices)) {
    fs.mkdirSync(path.join(root, dev), { recursive: true });
    for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(root, dev, f), `${v}\n`);
  }
  fs.mkdirSync(root, { recursive: true });
  return root;
}

// The DS920+ (J4125): coretemp, temp1 = "Physical id 0", temp2..5 = cores.
const DS920 = {
  hwmon0: {
    name: "coretemp",
    temp1_label: "Physical id 0", temp1_input: "56000",
    temp2_label: "Core 0", temp2_input: "54000",
    temp3_label: "Core 1", temp3_input: "58000",
    temp4_label: "Core 2", temp4_input: "53000",
    temp5_label: "Core 3", temp5_input: "55000",
  },
};

describe("hwmon CPU temperature", () => {
  it("DS920+ coretemp: the package sensor ('Physical id 0'), not the hottest core", async () => {
    expect(await readHwmonTemperature(tree(DS920))).toBe(56);
  });
  it("Intel 'Package id 0' and AMD k10temp 'Tctl'", async () => {
    expect(await readHwmonTemperature(tree({ hwmon1: { name: "coretemp", temp1_label: "Package id 0", temp1_input: "61500", temp2_label: "Core 0", temp2_input: "70000" } }))).toBe(61.5);
    expect(await readHwmonTemperature(tree({ hwmon0: { name: "k10temp", temp1_label: "Tctl", temp1_input: "48250", temp3_label: "Tccd1", temp3_input: "52000" } }))).toBe(48.3);
  });
  it("no package label → the hottest core", async () => {
    expect(await readHwmonTemperature(tree({ hwmon0: { name: "coretemp", temp2_label: "Core 0", temp2_input: "50000", temp3_label: "Core 1", temp3_input: "57125" } }))).toBe(57.1);
  });
  it("skips non-CPU devices (nvme, acpitz, drivetemp) and picks the CPU one", async () => {
    const root = tree({
      hwmon0: { name: "nvme", temp1_label: "Composite", temp1_input: "40000" },
      hwmon1: { name: "acpitz", temp1_input: "30000" },
      hwmon2: { name: "cpu_thermal", temp1_input: "47000" },
    });
    expect(await readHwmonTemperature(root)).toBe(47);
  });
  it("missing or partial files: no labels, junk values, unreadable inputs, no CPU device, no hwmon dir", async () => {
    expect(await readHwmonTemperature(tree({ hwmon0: { name: "zenpower", temp1_input: "44000" } }))).toBe(44);
    expect(await readHwmonTemperature(tree({ hwmon0: { name: "coretemp", temp1_label: "Physical id 0", temp1_input: "garbage", temp2_input: "-1000" } }))).toBeNull();
    expect(await readHwmonTemperature(tree({ hwmon0: { name: "coretemp" } }))).toBeNull();
    expect(await readHwmonTemperature(tree({ hwmon0: { name: "nvme", temp1_input: "40000" } }))).toBeNull();
    expect(await readHwmonTemperature(tree({ hwmon0: { temp1_input: "40000" } }))).toBeNull(); // no name file
    expect(await readHwmonTemperature(path.join(tmp, "does-not-exist"))).toBeNull();
  });
});

const VERSION_7_4_1 = `majorversion="7"
minorversion="4"
major="7"
minor="4"
micro="1"
buildphase="GM"
buildnumber="90080"
smallfixnumber="0"
nano="0"
base="90080"
productversion="7.4.1"
os_name="DSM"
builddate="2025/09/01"
buildtime="10:00:00"
`;

describe("DSM detection (/etc.defaults/VERSION)", () => {
  it("DSM 7.4.1 from productversion", () => {
    expect(parseDsmVersion(VERSION_7_4_1)).toBe("DSM 7.4.1");
    expect(detectPlatform(() => VERSION_7_4_1)).toEqual({ kind: "dsm", os: "DSM 7.4.1" });
  });
  it("falls back to major/minor/micro without productversion", () => {
    expect(parseDsmVersion('majorversion="7"\nminorversion="2"\nmicro="2"\n')).toBe("DSM 7.2.2");
  });
  it("anything else is plain Linux", () => {
    expect(detectPlatform(() => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); })).toEqual({ kind: "linux" });
    expect(detectPlatform(() => "NAME=Ubuntu\n")).toEqual({ kind: "linux" });
    expect(detectPlatform(() => 'productversion="$(rm -rf /)"\n')).toEqual({ kind: "linux" });
  });
  it("the not-available answer names DSM", () => {
    expect(notOnDsm("x")).toEqual({ available: false, reason: "not-supported", message: "Not available on DSM (x)." });
  });
});

describe("DSM widgets answer 'Not available on DSM', never 'needs sudoers'", () => {
  it("NVMe/SMART, power status, firewall", async () => {
    setPlatformForTests({ kind: "dsm", os: "DSM 7.4.1" });
    const app = express();
    app.use(nvmeRouter);
    app.use(powerRouter);
    app.use("/api", networkRouter);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const p of ["/api/metrics/nvme", "/api/metrics/power-status", "/api/metrics/firewall-status"]) {
        const body = await (await fetch(base + p)).json();
        expect(body, p).toMatchObject({ available: false, reason: "not-supported" });
        expect(body.message, p).toMatch(/^Not available on DSM/);
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
  it("apt system update is a 409 on DSM and runs nothing", async () => {
    const run = vi.fn(async () => "ran");
    const handler = createSystemUpdateHandler({ run, env: {}, dsm: () => true });
    const res = { status: vi.fn(() => res), json: vi.fn() } as unknown as import("express").Response;
    await handler({} as never, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("PIDECK_DISK_MOUNT", () => {
  it("defaults to /, takes an absolute path, rejects the rest", () => {
    const warn = vi.fn();
    expect(diskMount({}, warn)).toBe("/");
    expect(diskMount({ PIDECK_DISK_MOUNT: "/volume1" }, warn)).toBe("/volume1");
    expect(warn).not.toHaveBeenCalled();
    for (const bad of ["volume1", "/volume1/../etc", "../x"]) expect(diskMount({ PIDECK_DISK_MOUNT: bad }, warn)).toBe("/");
    expect(warn).toHaveBeenCalledTimes(3);
  });
  it("the sample's diskUsage reads that mount", async () => {
    const pct = await readDiskUsage(tmp);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
    await expect(readDiskUsage("/no/such/mount")).rejects.toThrow();
  });
});
