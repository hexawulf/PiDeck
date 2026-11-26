import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { createNvmeHandler } from "../../server/routes/nvme";
import { createPowerStatusHandler } from "../../server/routes/powerStatus";
import { LOG_ID_RE } from "../../server/routes/hostLogs";

function makeRes() {
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => { resolveDone = r; });
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      resolveDone();
      return this;
    },
    done,
  };
  return res;
}

describe("host-command caching & concurrency guards (API-005)", () => {
  it("caches and deduplicates concurrent smartctl calls in createNvmeHandler", async () => {
    let t = 10_000;
    let calls = 0;
    let finish!: (err: Error | null, stdout: string, stderr: string) => void;
    const handler = createNvmeHandler({
      isDsm: () => false,
      hasTool: () => true,
      nvmeDevice: () => "/dev/nvme0",
      cacheMs: 5_000,
      now: () => t,
      runSmartctl: (_dev, cb) => {
        calls += 1;
        finish = cb;
      },
    });

    const r1 = makeRes();
    const r2 = makeRes();
    handler({} as Request, r1 as unknown as Response);
    handler({} as Request, r2 as unknown as Response);
    expect(calls).toBe(1);
    finish(null, "Temperature: 40 Celsius\nPower On Hours: 100\n", "");
    await Promise.all([r1.done, r2.done]);
    expect(r1.body).toMatchObject({ temperature: "40", power_on_hours: "100" });
    expect(r2.body).toMatchObject({ temperature: "40", power_on_hours: "100" });

    // Cached within TTL
    t += 2_000;
    const r3 = makeRes();
    handler({} as Request, r3 as unknown as Response);
    await r3.done;
    expect(calls).toBe(1);

    // Expired after TTL
    t += 4_000;
    const r4 = makeRes();
    handler({} as Request, r4 as unknown as Response);
    expect(calls).toBe(2);
    finish(null, "Temperature: 42 Celsius\n", "");
    await r4.done;
    expect(r4.body).toMatchObject({ temperature: "42" });
  });

  it("caches and deduplicates concurrent vcgencmd calls in createPowerStatusHandler", async () => {
    let t = 20_000;
    let calls = 0;
    const pending: Array<() => void> = [];
    const handler = createPowerStatusHandler({
      isDsm: () => false,
      hasTool: () => true,
      cacheMs: 5_000,
      now: () => t,
      runVcgencmd: (cmd, cb) => {
        calls += 1;
        pending.push(() => {
          if (cmd.includes("get_throttled")) cb(null, "throttled=0x0");
          else cb(null, "volt=1.20V");
        });
      },
    });

    const r1 = makeRes();
    const r2 = makeRes();
    handler({} as Request, r1 as unknown as Response);
    handler({} as Request, r2 as unknown as Response);
    expect(calls).toBe(1);
    pending.shift()?.();
    expect(calls).toBe(2);
    pending.shift()?.();
    await Promise.all([r1.done, r2.done]);
    expect(r1.body).toEqual({ voltage: 1.2, current: null, status: "Normal" });
    expect(r2.body).toEqual({ voltage: 1.2, current: null, status: "Normal" });

    // Cached within TTL
    t += 2_000;
    const r3 = makeRes();
    handler({} as Request, r3 as unknown as Response);
    await r3.done;
    expect(calls).toBe(2);
  });

  it("rejects malformed hostlog IDs before scanning", () => {
    expect(LOG_ID_RE.test("nginx_access")).toBe(true);
    expect(LOG_ID_RE.test("app-1_out")).toBe(true);
    expect(LOG_ID_RE.test("../etc/passwd")).toBe(false);
    expect(LOG_ID_RE.test("bad id")).toBe(false);
    expect(LOG_ID_RE.test("a".repeat(129))).toBe(false);
  });
});
