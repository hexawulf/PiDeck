// Read-only systemd services (docs/plans/services-2.8.0.md): config, the argv
// gate, the `show` parser across systemd 219 (DSM) … 259, health, "since",
// user-unit env, the cached collector and the compact sample form.
import { describe, expect, it, vi } from "vitest";
import {
  assertAllowedArgv, compactServices, createServiceCollector, failedArgv, healthOf, parseCompactServices, parseFailedList, parseShow,
  serviceConfig, showArgv, sinceIso, SystemctlRefused, toService, userEnv, VERSION_ARGV, type Exec, type ServiceConfig,
} from "../../server/services/systemd";
import { isUnitName, parseUnitRef } from "../../server/services/unit-name";
import { agentLogConfig, journalSourceId } from "../../server/services/agent-logs/sources";

const NOW = Date.parse("2026-09-30T08:00:00Z");
const UPTIME = 36_000; // 10 h

// systemd 259: properties in systemd's own order, NRestarts present.
const NGINX_259 = `Type=notify
Result=success
NRestarts=2
MainPID=812
MemoryCurrent=10485760
Id=nginx.service
Description=A high performance web server and a reverse proxy server
LoadState=loaded
ActiveState=active
SubState=running
StateChangeTimestampMonotonic=5000000
ActiveEnterTimestampMonotonic=5000000
UnitFileState=enabled`;
// systemd 219 (DSM): another order, no NRestarts, [not set] / max-uint64 values.
const SSHD_219 = `Id=sshd.service
LoadState=loaded
ActiveState=active
SubState=running
Description=OpenBSD Secure Shell server
UnitFileState=enabled
Type=forking
Result=success
MainPID=10233
MemoryCurrent=18446744073709551615
ActiveEnterTimestampMonotonic=33000000000
StateChangeTimestampMonotonic=33000000000`;
const WG_EXITED = `Id=wg-quick@wg-pideck.service
Description=WireGuard via wg-quick(8) for wg-pideck
LoadState=loaded
ActiveState=active
SubState=exited
UnitFileState=enabled
Type=oneshot
Result=success
MainPID=0
NRestarts=0
MemoryCurrent=[not set]
ActiveEnterTimestampMonotonic=4000000
StateChangeTimestampMonotonic=4000000`;
const MISSING = `Id=typo.service
Description=typo.service
LoadState=not-found
ActiveState=inactive
SubState=dead
UnitFileState=
Type=simple
Result=success
MainPID=0
NRestarts=0
MemoryCurrent=[not set]
ActiveEnterTimestampMonotonic=0
StateChangeTimestampMonotonic=0`;
const HYPERBACKUP_FAILED = `Id=pkgctl-HyperBackup-ED.service
LoadState=loaded
ActiveState=failed
SubState=failed
Result=exit-code
StateChangeTimestampMonotonic=30000000000
ActiveEnterTimestampMonotonic=0`;

describe("config: PIDECK_SERVICES", () => {
  it("units, user: units, labels; invalid names and duplicates skipped with a warning", () => {
    const warn = vi.fn();
    const cfg = serviceConfig({
      PIDECK_SERVICES: "nginx, Web DB=postgresql@18-main,user:syncthing, Mail=user:piapps4-mail-listener, bad unit, -rf, x;rm, nginx, =ssh, ssh",
    }, warn);
    expect(cfg.units).toEqual([
      { unit: "nginx", user: false, label: null },
      { unit: "postgresql@18-main", user: false, label: "Web DB" },
      { unit: "syncthing", user: true, label: null },
      { unit: "piapps4-mail-listener", user: true, label: "Mail" },
      { unit: "ssh", user: false, label: null },
    ]);
    expect(warn).toHaveBeenCalledTimes(5); // bad unit, -rf, x;rm, nginx (twice), =ssh
    expect(cfg).toMatchObject({ failed: true, alertMinutes: 3 });
  });
  it("PIDECK_SERVICES_FAILED=off, PIDECK_SERVICE_ALERT_MINUTES, empty config", () => {
    expect(serviceConfig({ PIDECK_SERVICES_FAILED: "off", PIDECK_SERVICE_ALERT_MINUTES: "10" }, () => {})).toEqual({ units: [], failed: false, alertMinutes: 10 });
    expect(serviceConfig({ PIDECK_SERVICE_ALERT_MINUTES: "abc" }, () => {}).alertMinutes).toBe(3);
  });
  it("the unit-name rule is the one journal log sources use", () => {
    expect(parseUnitRef("user:openclaw-gateway")).toEqual({ unit: "openclaw-gateway", user: true });
    for (const bad of ["-x", "a b", "a/b", "a;b", "$(x)", "", "x".repeat(121)]) expect(isUnitName(bad)).toBe(false);
    expect(agentLogConfig({ PIDECK_AGENT_JOURNAL_UNITS: "user:syncthing,-x" }, () => {}).journal.map((j) => j.id)).toEqual([journalSourceId("syncthing", true)]);
  });
});

describe("argv: only read-only systemctl calls", () => {
  it("builds the three shapes", () => {
    const show = showArgv(["nginx", "ssh"], false);
    expect(show.slice(0, 3)).toEqual(["show", "--no-pager", "-p"]);
    expect(show.slice(-3)).toEqual(["--", "nginx", "ssh"]);
    expect(showArgv(["syncthing"], true)[0]).toBe("--user");
    expect(failedArgv(false)).toEqual(["list-units", "--state=failed", "--plain", "--no-legend", "--no-pager"]);
    expect(failedArgv(true)).toEqual(["--user", "list-units", "--state=failed", "--plain", "--no-legend", "--no-pager"]);
    expect(VERSION_ARGV).toEqual(["show", "--no-pager", "-p", "Version"]);
    for (const a of [show, showArgv(["syncthing"], true), failedArgv(false), failedArgv(true), [...VERSION_ARGV]]) expect(() => assertAllowedArgv(a)).not.toThrow();
  });
  it.each([
    [["start", "nginx"]],
    [["stop", "--", "nginx"]],
    [["restart", "nginx"]],
    [["enable", "nginx"]],
    [["kill", "nginx"]],
    [["set-property", "nginx", "CPUQuota=1%"]],
    [["edit", "nginx"]],
    [["daemon-reload"]],
    [["show", "--no-pager", "-p", "Id", "--", "nginx"]], // not our property list
    [[...showArgv(["nginx"], false).slice(0, -1), "-H", "root@host"]],
    [[...showArgv(["nginx"], false).slice(0, -2), "nginx"]], // no "--"
    [[...showArgv(["x"], false).slice(0, -1), "--now"]],
    [[...showArgv(["x"], false).slice(0, -1), "a b"]],
    [showArgv([], false)],
    [["--user", ...VERSION_ARGV]],
    [["list-units", "--state=failed"]],
    [["--system", ...failedArgv(false)]],
  ])("refuses %j", (argv) => expect(() => assertAllowedArgv(argv)).toThrow(SystemctlRefused));
  it("user units run with the user manager's bus in the env", () => {
    expect(userEnv({ PATH: "/usr/bin" }, 1000)).toEqual({ PATH: "/usr/bin", XDG_RUNTIME_DIR: "/run/user/1000", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" });
    expect(userEnv({ XDG_RUNTIME_DIR: "/run/user/7", DBUS_SESSION_BUS_ADDRESS: "unix:path=/x" }, 1000)).toMatchObject({ XDG_RUNTIME_DIR: "/run/user/7", DBUS_SESSION_BUS_ADDRESS: "unix:path=/x" });
  });
});

describe("parsing systemctl output", () => {
  it("one record per unit, key=value in any order (259 and 219)", () => {
    const recs = parseShow(`${NGINX_259}\n\n${SSHD_219}\n\n${WG_EXITED}\n`);
    expect(recs.map((r) => r.Id)).toEqual(["nginx.service", "sshd.service", "wg-quick@wg-pideck.service"]);
    expect(recs[1].NRestarts).toBeUndefined();
  });
  it("maps a record: nulls for [not set] / max-uint64 / missing NRestarts, health, since from monotonic + uptime", () => {
    const [nginx, sshd, wg, missing] = parseShow([NGINX_259, SSHD_219, WG_EXITED, MISSING].join("\n\n"));
    const n = toService(nginx, { unit: "nginx", user: false, label: "Web" }, true, UPTIME, NOW);
    expect(n).toMatchObject({ unit: "nginx", label: "Web", health: "ok", sub: "running", restarts: 2, memory: 10485760, mainPid: 812, listed: true });
    expect(n.since).toBe(new Date(NOW - UPTIME * 1000 + 5_000).toISOString()); // 5 s after boot
    expect(toService(sshd, { unit: "sshd", user: false, label: null }, true, UPTIME, NOW)).toMatchObject({ health: "ok", restarts: null, memory: null });
    expect(toService(wg, { unit: "wg-quick@wg-pideck", user: false, label: null }, true, UPTIME, NOW)).toMatchObject({ health: "ok", sub: "exited", mainPid: null, memory: null });
    expect(toService(missing, { unit: "typo", user: false, label: null }, true, UPTIME, NOW)).toMatchObject({ health: "fail", load: "not-found", since: null, unitFileState: null });
    expect(toService(undefined, { unit: "x", user: true, label: null }, true, UPTIME, NOW).health).toBe("unknown");
  });
  it("health: active (any sub-state) ok; transitions and inactive warn; failed / not-found fail", () => {
    expect(healthOf("loaded", "active")).toBe("ok");
    for (const a of ["activating", "deactivating", "reloading", "inactive"]) expect(healthOf("loaded", a)).toBe("warn");
    expect(healthOf("loaded", "failed")).toBe("fail");
    expect(healthOf("not-found", "inactive")).toBe("fail");
    expect(healthOf("masked", "inactive")).toBe("warn");
    expect(healthOf(null, null)).toBe("unknown");
  });
  it("since: µs since boot → ISO; unknowns → null; never in the future", () => {
    expect(sinceIso(60_000_000, 120, NOW)).toBe(new Date(NOW - 60_000).toISOString());
    expect(sinceIso(0, 120, NOW)).toBeNull();
    expect(sinceIso(60_000_000, null, NOW)).toBeNull();
    expect(sinceIso(999_000_000_000, 120, NOW)).toBeNull();
  });
  it("failed list: first column, bullets stripped, validated, deduplicated", () => {
    expect(parseFailedList("pkgctl-HyperBackup-ED.service loaded failed failed HyperBackup\n● x.mount loaded failed failed X\nbad;name loaded failed\n\npkgctl-HyperBackup-ED.service dup\n"))
      .toEqual(["pkgctl-HyperBackup-ED.service", "x.mount"]);
  });
});

/** A fake systemctl: answers by argv shape; records every call. */
function fakeExec(opts: { failed?: string; userFailed?: string; userDown?: boolean; noSystemd?: boolean; records?: Record<string, string> } = {}) {
  const calls: { argv: string[]; env: NodeJS.ProcessEnv }[] = [];
  const records: Record<string, string> = { nginx: NGINX_259, sshd: SSHD_219, "wg-quick@wg-pideck": WG_EXITED, typo: MISSING, "pkgctl-HyperBackup-ED.service": HYPERBACKUP_FAILED, ...opts.records };
  const exec: Exec = async (argv, env) => {
    calls.push({ argv, env });
    if (opts.noSystemd) throw Object.assign(new Error("Command failed"), { stderr: "System has not been booted with systemd as init system (PID 1). Can't operate.\n" });
    const user = argv[0] === "--user";
    if (user && opts.userDown) throw Object.assign(new Error("Command failed"), { stderr: "Failed to connect to bus: No medium found\n" });
    const a = user ? argv.slice(1) : argv;
    if (a[0] === "list-units") return { stdout: (user ? opts.userFailed : opts.failed) ?? "", stderr: "" };
    if (a.join(" ") === VERSION_ARGV.join(" ")) return { stdout: "Version=259.1-1\n", stderr: "" };
    const units = a.slice(a.indexOf("--") + 1);
    return { stdout: units.map((u) => records[u] ?? `Id=${u}.service\nLoadState=loaded\nActiveState=active\nSubState=running`).join("\n\n") + "\n", stderr: "" };
  };
  return { exec, calls };
}

const cfg = (over: Partial<ServiceConfig> = {}): ServiceConfig => ({
  units: [{ unit: "nginx", user: false, label: null }, { unit: "typo", user: false, label: null }, { unit: "syncthing", user: true, label: "Sync" }],
  failed: true, alertMinutes: 3, ...over,
});

describe("collector", () => {
  it("one show per manager (listed + failed), user units with the bus env; every call through the gate", async () => {
    const f = fakeExec({ failed: "pkgctl-HyperBackup-ED.service loaded failed failed HyperBackup\nnginx.service loaded failed failed dup\n" });
    const c = createServiceCollector(cfg(), { exec: f.exec, now: () => NOW, uptime: async () => UPTIME, env: { PATH: "/usr/bin" } });
    const r = await c.get();
    expect(r).toMatchObject({ available: true, systemd: "259" });
    expect(r.services.map((s) => `${s.unit}:${s.health}`)).toEqual(["nginx:ok", "typo:fail", "syncthing:ok"]);
    expect(r.services[2]).toMatchObject({ user: true, label: "Sync" });
    expect(r.failedOnly.map((s) => [s.unit, s.health, s.listed])).toEqual([["pkgctl-HyperBackup-ED.service", "fail", false]]); // nginx.service = listed nginx
    for (const { argv } of f.calls) expect(() => assertAllowedArgv(argv)).not.toThrow();
    expect(f.calls.map((c) => c.argv[0] === "--user" ? `user ${c.argv[1]}` : c.argv[0])).toEqual(["show", "list-units", "show", "user list-units", "user show"]);
    const userCall = f.calls.find((c) => c.argv[0] === "--user")!;
    expect(userCall.env.XDG_RUNTIME_DIR).toMatch(/^\/run\/user\/\d+$/);
    expect(f.calls.find((c) => c.argv[0] !== "--user")!.env.XDG_RUNTIME_DIR).toBeUndefined();
  });
  it("caches for 10 s and shares one run between concurrent callers", async () => {
    let t = NOW;
    const f = fakeExec();
    const c = createServiceCollector(cfg({ units: [{ unit: "nginx", user: false, label: null }] }), { exec: f.exec, now: () => t, uptime: async () => UPTIME });
    await Promise.all([c.get(), c.get(), c.get()]);
    const n = f.calls.length;
    t += 5_000;
    await c.get();
    expect(f.calls.length).toBe(n);
    t += 6_000;
    await c.get();
    expect(f.calls.length).toBeGreaterThan(n);
  });
  it("user manager not reachable (no linger): a warning, listed user units 'unknown', system units fine", async () => {
    const f = fakeExec({ userDown: true });
    const r = await createServiceCollector(cfg(), { exec: f.exec, now: () => NOW, uptime: async () => UPTIME }).get();
    expect(r.services.find((s) => s.unit === "syncthing")?.health).toBe("unknown");
    expect(r.services.find((s) => s.unit === "nginx")?.health).toBe("ok");
    expect(r.warnings.join(" ")).toMatch(/linger/);
  });
  it("no systemd (container, other init) → not available, nothing else", async () => {
    const r = await createServiceCollector(cfg(), { exec: fakeExec({ noSystemd: true }).exec }).get();
    expect(r).toEqual({ available: false, systemd: null, services: [], failedOnly: [], warnings: ["systemd not available on this host"] });
    const enoent: Exec = async () => { throw Object.assign(new Error("spawn systemctl ENOENT"), { code: "ENOENT" }); };
    expect((await createServiceCollector(cfg(), { exec: enoent }).get()).available).toBe(false);
    expect(compactServices(r)).toBeUndefined();
  });
  it("nothing listed: only failed units, and a hint", async () => {
    const r = await createServiceCollector(cfg({ units: [] }), { exec: fakeExec({ failed: "pkgctl-HyperBackup-ED.service loaded failed failed X\n" }).exec, now: () => NOW, uptime: async () => UPTIME }).get();
    expect(r.services).toEqual([]);
    expect(r.failedOnly.map((s) => s.unit)).toEqual(["pkgctl-HyperBackup-ED.service"]);
    expect(r.warnings.join(" ")).toMatch(/PIDECK_SERVICES/);
  });
  it("a failed unit name that isn't a valid unit never reaches argv", async () => {
    const f = fakeExec({ failed: "--now x\n$(reboot) y\nok.service loaded failed failed z\n" });
    await createServiceCollector(cfg({ units: [] }), { exec: f.exec, now: () => NOW, uptime: async () => UPTIME }).get();
    const show = f.calls.filter((c) => c.argv[0] === "show" && c.argv.includes("--"));
    expect(show.map((c) => c.argv.slice(c.argv.indexOf("--") + 1))).toEqual([["ok.service"]]);
  });
});

describe("compact form (sample)", () => {
  it("round-trips; the hub drops anything malformed", async () => {
    const r = await createServiceCollector(cfg(), { exec: fakeExec({ failed: "pkgctl-HyperBackup-ED.service loaded failed failed X\n" }).exec, now: () => NOW, uptime: async () => UPTIME }).get();
    const c = compactServices(r)!;
    expect(c.map((s) => [s.unit, s.user, s.health, s.listed, s.state])).toEqual([
      ["nginx", false, "ok", true, "active"], ["typo", false, "fail", true, "not-found"], ["syncthing", true, "ok", true, "active"],
      ["pkgctl-HyperBackup-ED.service", false, "fail", false, "failed"],
    ]);
    expect(parseCompactServices(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(parseCompactServices([{ unit: "a b", health: "ok" }, { unit: "x", health: "weird" }, null, { unit: "ok", health: "warn", since: "nope" }]))
      .toEqual([{ unit: "ok", user: false, health: "warn", listed: false, state: null, since: null }]);
    expect(parseCompactServices(undefined)).toBeNull();
  });
});
