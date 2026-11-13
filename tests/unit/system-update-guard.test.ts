import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSystemUpdateHandler, createSystemUpdateStatusHandler, SYSTEM_UPDATE_DISABLED_MESSAGE, systemUpdateDisabled } from "../../server/routes/system-update";
import { createUpdateRunner, parseUpdateLog, UPDATE_SCRIPT, UpdateAlreadyRunning, type UpdateStatus } from "../../server/services/system-update";

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown };
  return Object.assign(res, {
    status: vi.fn((c: number) => { res.statusCode = c; return res; }),
    json: vi.fn((b: unknown) => { res.body = b; return res; }),
  });
}
const running: UpdateStatus = { state: "running", startedAt: "2026-11-13T04:00:00.000Z", log: "pideck-system-update-20261113-040000.log" };
const call = (env: NodeJS.ProcessEnv, start: () => UpdateStatus, dsm = () => false) => {
  const res = fakeRes();
  createSystemUpdateHandler({ runner: { start, status: () => running }, env, dsm })({} as never, res as never);
  return res;
};

describe("PIDECK_DISABLE_SYSTEM_UPDATE guard", () => {
  it("answers 409 and starts nothing when set to 1", () => {
    const start = vi.fn(() => running);
    const res = call({ PIDECK_DISABLE_SYSTEM_UPDATE: "1" }, start);
    expect(start).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ message: SYSTEM_UPDATE_DISABLED_MESSAGE });
  });

  it.each([undefined, "", "0", "true", "yes"])("starts the update when the env is %j, answering 202 at once", (v) => {
    const start = vi.fn(() => running);
    const res = call(v === undefined ? {} : { PIDECK_DISABLE_SYSTEM_UPDATE: v }, start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ message: "System update started", ...running });
  });

  it("answers 409 with the current status while one is running", () => {
    const res = call({}, () => { throw new UpdateAlreadyRunning(); });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ message: "A system update is already running", state: "running" });
  });

  it("answers 409 on DSM without starting", () => {
    const start = vi.fn(() => running);
    expect(call({}, start, () => true).statusCode).toBe(409);
    expect(start).not.toHaveBeenCalled();
  });

  it("keeps the 500 path when the job can't be started", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = call({}, () => { throw new Error("EACCES"); });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ message: "Failed to start the system update" });
  });

  it("only exactly '1' disables", () => {
    expect(systemUpdateDisabled({ PIDECK_DISABLE_SYSTEM_UPDATE: "1" })).toBe(true);
    expect(systemUpdateDisabled({ PIDECK_DISABLE_SYSTEM_UPDATE: "true" })).toBe(false);
  });

  it("GET reports the runner's status", () => {
    const res = fakeRes();
    createSystemUpdateStatusHandler({ runner: { status: () => running } as never })({} as never, res as never);
    expect(res.body).toEqual(running);
  });
});

describe("update job", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-update-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const fakeSpawn = () => {
    const calls: { cmd: string; args: string[]; opts: any }[] = [];
    const spawn = (cmd: string, args: string[], opts: any) => {
      calls.push({ cmd, args, opts });
      return { on: () => undefined, unref: () => undefined };
    };
    return { calls, spawn };
  };
  const logOf = (s: UpdateStatus) => path.join(dir, (s as { log: string }).log);

  it("the script runs exactly the two sudoers-approved commands, non-interactively", () => {
    expect(UPDATE_SCRIPT).toContain("sudo -n apt-get update && sudo -n apt-get upgrade -y;");
    expect(UPDATE_SCRIPT).not.toMatch(/apt-get (?!update|upgrade -y)/);
  });

  it("starts one detached job with stdin closed and output to a log in the logs directory", () => {
    const { calls, spawn } = fakeSpawn();
    const runner = createUpdateRunner({ logsDir: dir, spawn, now: () => new Date("2026-11-13T04:05:06Z"), alive: () => false });
    const s = runner.start();
    expect(s).toEqual({ state: "running", startedAt: "2026-11-13T04:05:06.000Z", log: "pideck-system-update-20261113-040506.log" });
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("setsid");
    expect(calls[0].args).toEqual(["--fork", "sh", "-c", UPDATE_SCRIPT]);
    expect(calls[0].opts.detached).toBe(true);
    expect(calls[0].opts.stdio[0]).toBe("ignore");
    expect(fs.existsSync(logOf(s))).toBe(true);
  });

  it("refuses a second start while the first is running", () => {
    const { calls, spawn } = fakeSpawn();
    const runner = createUpdateRunner({ logsDir: dir, spawn, now: () => new Date("2026-11-13T04:05:06Z"), alive: () => true });
    const s = runner.start();
    fs.writeFileSync(logOf(s), "[pideck] pid 4242 started 2026-11-13T04:05:06Z\nReading package lists...\n");
    expect(runner.status()).toEqual({ state: "running", startedAt: "2026-11-13T04:05:06Z", log: (s as { log: string }).log });
    expect(() => runner.start()).toThrow(UpdateAlreadyRunning);
    expect(calls).toHaveLength(1);
  });

  it("reports success, failure and an interrupted run from the log alone (also after a restart)", () => {
    const write = (name: string, text: string) => fs.writeFileSync(path.join(dir, name), text);
    const fresh = (alive = false) => createUpdateRunner({ logsDir: dir, spawn: fakeSpawn().spawn, alive: () => alive });
    expect(fresh().status()).toEqual({ state: "idle" });

    write("pideck-system-update-20261113-010000.log", "[pideck] pid 10 started 2026-11-13T01:00:00Z\nReading package lists...\n0 upgraded, 0 newly installed\n[pideck] exit 0\n");
    expect(fresh().status()).toMatchObject({ state: "succeeded", exitCode: 0, startedAt: "2026-11-13T01:00:00Z", tail: ["Reading package lists...", "0 upgraded, 0 newly installed"] });

    write("pideck-system-update-20261113-020000.log", "[pideck] pid 11 started 2026-11-13T02:00:00Z\nE: Could not get lock /var/lib/dpkg/lock-frontend\n[pideck] exit 100\n");
    expect(fresh().status()).toMatchObject({ state: "failed", exitCode: 100, log: "pideck-system-update-20261113-020000.log" });

    write("pideck-system-update-20261113-030000.log", "[pideck] pid 12 started 2026-11-13T03:00:00Z\nUnpacking libfoo...\n");
    expect(fresh(true).status()).toMatchObject({ state: "running" });
    expect(fresh(false).status()).toMatchObject({ state: "failed", exitCode: null }); // no exit line, no process
  });

  it("a new start is allowed once the last run has finished", () => {
    fs.writeFileSync(path.join(dir, "pideck-system-update-20261113-010000.log"), "[pideck] pid 10 started x\n[pideck] exit 0\n");
    const { calls, spawn } = fakeSpawn();
    createUpdateRunner({ logsDir: dir, spawn, now: () => new Date("2026-11-13T04:05:06Z"), alive: () => false }).start();
    expect(calls).toHaveLength(1);
  });

  it("parses a log: pid, start, exit code, and a tail without its own marker lines", () => {
    expect(parseUpdateLog("")).toEqual({ pid: null, startedAt: null, exitCode: null, finished: false, tail: [] });
    const p = parseUpdateLog("[pideck] pid 7 started 2026-11-13T01:00:00Z\na\nb\n[pideck] exit 3\n");
    expect(p).toEqual({ pid: 7, startedAt: "2026-11-13T01:00:00Z", exitCode: 3, finished: true, tail: ["a", "b"] });
    // an "exit" line in the middle of the output is not the end marker
    expect(parseUpdateLog("[pideck] pid 7 started x\n[pideck] exit 0\n1\n2\n3\n4\n").finished).toBe(false);
  });
});
