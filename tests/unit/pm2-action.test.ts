import { describe, expect, it, vi } from "vitest";
import { Pm2ActionError, pm2SelfName, SystemService } from "../../server/services/system";

const names = ["pideck", "keyjolt", "snippetmate"];
const deps = (over: Record<string, unknown> = {}) => {
  const run = vi.fn(async () => {});
  return { run, list: async () => names, self: "pideck", ...over } as { run: ReturnType<typeof vi.fn>; list: () => Promise<string[]>; self: string | undefined };
};
const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof Pm2ActionError ? e.status : 500;
  }
};

describe("pm2 actions", () => {
  it("runs pm2 with the action and the name as separate arguments", async () => {
    const d = deps();
    await SystemService.pm2Action("restart", "keyjolt", d);
    expect(d.run).toHaveBeenCalledWith(["restart", "keyjolt"]);
    await SystemService.pm2Action("stop", "snippetmate", d);
    expect(d.run).toHaveBeenLastCalledWith(["stop", "snippetmate"]);
  });

  it('refuses "all" in any case, before asking pm2 anything', async () => {
    for (const name of ["all", "ALL", "All"]) {
      const d = deps({ list: vi.fn(async () => [...names, name]) });
      expect(await status(SystemService.pm2Action("stop", name, d))).toBe(400);
      expect(await status(SystemService.pm2Action("restart", name, d))).toBe(400);
      expect(d.list).not.toHaveBeenCalled();
      expect(d.run).not.toHaveBeenCalled();
    }
  });

  it("refuses names with shell or option characters", async () => {
    for (const name of ["-all", "a b", "a;b", "$(id)", "", "../x", "a".repeat(101)]) {
      const d = deps();
      expect(await status(SystemService.pm2Action("stop", name, d))).toBe(400);
      expect(d.run).not.toHaveBeenCalled();
    }
  });

  it("refuses anything that is not a current pm2 process (numeric ids included)", async () => {
    const d = deps();
    expect(await status(SystemService.pm2Action("stop", "0", d))).toBe(404);
    expect(await status(SystemService.pm2Action("restart", "nope", d))).toBe(404);
    expect(d.run).not.toHaveBeenCalled();
  });

  it("refuses to stop PiDeck itself, but restarts it", async () => {
    const d = deps();
    expect(await status(SystemService.pm2Action("stop", "pideck", d))).toBe(409);
    expect(d.run).not.toHaveBeenCalled();
    await SystemService.pm2Action("restart", "pideck", d);
    expect(d.run).toHaveBeenCalledWith(["restart", "pideck"]);
  });

  it("outside pm2 (systemd install) there is no self to protect", async () => {
    const d = deps({ self: undefined });
    await SystemService.pm2Action("stop", "pideck", d);
    expect(d.run).toHaveBeenCalledWith(["stop", "pideck"]);
  });

  it("a failing pm2 is a plain error (500), not a refusal", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await status(SystemService.pm2Action("stop", "keyjolt", deps({ run: async () => { throw new Error("boom"); } })))).toBe(500);
    expect(await status(SystemService.pm2Action("stop", "keyjolt", deps({ list: async () => { throw new Error("no daemon"); } })))).toBe(500);
    quiet.mockRestore();
  });

  it("reads its own name only when pm2 started it", () => {
    expect(pm2SelfName({ name: "pideck", pm_id: "3" })).toBe("pideck");
    expect(pm2SelfName({ name: "pideck" })).toBeUndefined();
    expect(pm2SelfName({})).toBeUndefined();
  });
});
