import { describe, expect, it, vi } from "vitest";
import { createSystemUpdateHandler, SYSTEM_UPDATE_DISABLED_MESSAGE, systemUpdateDisabled } from "../../server/routes/system-update";

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown };
  return Object.assign(res, {
    status: vi.fn((c: number) => { res.statusCode = c; return res; }),
    json: vi.fn((b: unknown) => { res.body = b; return res; }),
  });
}
const call = async (env: NodeJS.ProcessEnv, run: () => Promise<string>) => {
  const res = fakeRes();
  await createSystemUpdateHandler({ run, env })({} as never, res as never);
  return res;
};

describe("PIDECK_DISABLE_SYSTEM_UPDATE guard", () => {
  it("answers 409 and runs nothing when set to 1", async () => {
    const run = vi.fn(async () => "apt output");
    const res = await call({ PIDECK_DISABLE_SYSTEM_UPDATE: "1" }, run);
    expect(run).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ message: SYSTEM_UPDATE_DISABLED_MESSAGE });
  });

  it.each([undefined, "", "0", "true", "yes"])("runs the update when the env is %j", async (v) => {
    const run = vi.fn(async () => "apt output");
    const res = await call(v === undefined ? {} : { PIDECK_DISABLE_SYSTEM_UPDATE: v }, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: "System updated", output: "apt output" });
  });

  it("keeps the 500 path for a failed update", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call({}, async () => { throw new Error("apt locked"); });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ message: "Failed to update system" });
  });

  it("only exactly '1' disables", () => {
    expect(systemUpdateDisabled({ PIDECK_DISABLE_SYSTEM_UPDATE: "1" })).toBe(true);
    expect(systemUpdateDisabled({ PIDECK_DISABLE_SYSTEM_UPDATE: "true" })).toBe(false);
  });
});
