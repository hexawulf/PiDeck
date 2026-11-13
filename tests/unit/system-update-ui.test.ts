import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeEnd, describeStart, resetUpdateWatch, watchSystemUpdate, type UpdateStatus } from "../../client/src/lib/system-update";

describe("update system: what the user is told", () => {
  it("a started job says where its output goes and is watched", () => {
    const d = describeStart({ state: "running", log: "pideck-system-update-20261113-040506.log" });
    expect(d.watch).toBe(true);
    expect(d.title).toBe("Update started");
    expect(d.description).toContain("pideck-system-update-20261113-040506.log");
  });

  it("an answer without a state (older hub) counts as finished", () => {
    expect(describeStart({ message: "System updated" })).toEqual({ title: "Success", description: "System updated successfully", watch: false });
  });

  it("describes the end: success, failure with the exit code, an interrupted run", () => {
    expect(describeEnd({ state: "running" })).toBeNull();
    expect(describeEnd({ state: "succeeded" })).toMatchObject({ description: "System updated successfully", failed: false });
    expect(describeEnd({ state: "failed", exitCode: 100, log: "x.log" })).toMatchObject({ failed: true, description: "System update failed (exit code 100). See x.log on the Logs tab." });
    expect(describeEnd({ state: "failed", exitCode: null, log: "x.log" })?.description).toContain("was interrupted");
    expect(describeEnd({ state: "idle" })).toMatchObject({ failed: false });
  });
});

describe("update system: following the job", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetUpdateWatch();
  });
  afterEach(() => vi.useRealTimers());

  it("polls until the job ends, then tells the user once", async () => {
    const answers: UpdateStatus[] = [{ state: "running" }, { state: "running" }, { state: "succeeded" }];
    const fetchStatus = vi.fn(async () => answers.shift() ?? { state: "succeeded" as const });
    const notify = vi.fn();
    watchSystemUpdate(fetchStatus, { intervalMs: 1000, notify: notify as never });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ description: "System updated successfully" });
  });

  it("a failed job gets a destructive toast", async () => {
    const notify = vi.fn();
    watchSystemUpdate(async () => ({ state: "failed", exitCode: 100, log: "u.log" }), { intervalMs: 1000, notify: notify as never });
    await vi.advanceTimersByTimeAsync(1500);
    expect(notify.mock.calls[0][0]).toMatchObject({ variant: "destructive" });
  });

  it("only one watcher runs at a time", async () => {
    const fetchStatus = vi.fn(async () => ({ state: "running" as const }));
    watchSystemUpdate(fetchStatus, { intervalMs: 1000, notify: vi.fn() as never });
    watchSystemUpdate(fetchStatus, { intervalMs: 1000, notify: vi.fn() as never });
    await vi.advanceTimersByTimeAsync(3100);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it("survives a few failed reads (PiDeck restarting mid-upgrade), then gives up quietly", async () => {
    let calls = 0;
    const notify = vi.fn();
    watchSystemUpdate(async () => {
      calls++;
      if (calls <= 3) throw new Error("502");
      return { state: "succeeded" };
    }, { intervalMs: 1000, notify: notify as never });
    await vi.advanceTimersByTimeAsync(5000);
    expect(notify).toHaveBeenCalledTimes(1);

    resetUpdateWatch();
    const dead = vi.fn(async () => { throw new Error("502"); });
    watchSystemUpdate(dead, { intervalMs: 1000, notify: notify as never });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dead).toHaveBeenCalledTimes(6);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
