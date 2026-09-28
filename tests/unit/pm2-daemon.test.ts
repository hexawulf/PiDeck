import { describe, expect, it } from "vitest";
import { pm2DaemonRunning } from "../../server/routes/pm2";

const files = (m: Record<string, string>) => (p: string) => {
  if (p in m) return m[p];
  throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
};

describe("pm2DaemonRunning (never let pm2.connect start a daemon)", () => {
  it("false without a pid file", () => {
    expect(pm2DaemonRunning({ HOME: "/home/op" }, files({}), () => true)).toBe(false);
  });

  it("true only when the pid in $HOME/.pm2/pm2.pid is alive", () => {
    const read = files({ "/home/op/.pm2/pm2.pid": "4242\n" });
    expect(pm2DaemonRunning({ HOME: "/home/op" }, read, (p) => p === "/proc/4242")).toBe(true);
    expect(pm2DaemonRunning({ HOME: "/home/op" }, read, () => false)).toBe(false);
  });

  it("honours PM2_HOME and rejects a malformed pid", () => {
    expect(pm2DaemonRunning({ PM2_HOME: "/srv/pm2" }, files({ "/srv/pm2/pm2.pid": "77" }), (p) => p === "/proc/77")).toBe(true);
    expect(pm2DaemonRunning({ HOME: "/h" }, files({ "/h/.pm2/pm2.pid": "../1" }), () => true)).toBe(false);
  });
});
