// PD-21: /api/health reports the database and the schema, not constants.
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { createHealthHandler } from "../../server/routes/health";

type FakeRes = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status: (c: number) => FakeRes;
  set: (k: string, v: string) => FakeRes;
  json: (b: unknown) => FakeRes;
};

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    headers: {},
    body: undefined,
    status(c: number) { res.statusCode = c; return res; },
    set(k: string, v: string) { res.headers[k] = v; return res; },
    json(b: unknown) { res.body = b; return res; },
  };
  return res;
}

const fakeReq = {} as Request;

describe("createHealthHandler", () => {
  it("is 200 when the database answers and the schema is ready", async () => {
    const res = fakeRes();
    await createHealthHandler({ ping: async () => 1, schemaReady: () => true })(fakeReq, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, db: true, schema: true });
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("is 503 when the database query fails", async () => {
    const res = fakeRes();
    await createHealthHandler({ ping: () => Promise.reject(new Error("down")), schemaReady: () => true })(fakeReq, res as unknown as Response);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ ok: false, db: false, schema: true });
  });

  it("is 503 when the database does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      const res = fakeRes();
      const done = createHealthHandler({ ping: () => new Promise(() => {}), schemaReady: () => true, timeoutMs: 50 })(fakeReq, res as unknown as Response);
      await vi.advanceTimersByTimeAsync(60);
      await done;
      expect(res.statusCode).toBe(503);
      expect(res.body).toMatchObject({ ok: false, db: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is 503 while migrations are pending", async () => {
    const res = fakeRes();
    await createHealthHandler({ ping: async () => 1, schemaReady: () => false })(fakeReq, res as unknown as Response);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ ok: false, db: true, schema: false });
  });

  it("caches DB ping for cacheMs and deduplicates concurrent pings (API-004)", async () => {
    let t = 10_000;
    let calls = 0;
    let resolvePing!: () => void;
    const handler = createHealthHandler({
      ping: () => {
        calls += 1;
        return new Promise<void>((resolve) => { resolvePing = resolve; });
      },
      schemaReady: () => true,
      cacheMs: 5_000,
      now: () => t,
    });

    // Two concurrent requests share one in-flight ping
    const r1 = fakeRes();
    const r2 = fakeRes();
    const p1 = handler(fakeReq, r1 as unknown as Response);
    const p2 = handler(fakeReq, r2 as unknown as Response);
    expect(calls).toBe(1);
    resolvePing();
    await Promise.all([p1, p2]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);

    // Within TTL: served from cache without calling ping again
    t += 2_000;
    const r3 = fakeRes();
    await handler(fakeReq, r3 as unknown as Response);
    expect(calls).toBe(1);
    expect(r3.statusCode).toBe(200);

    // After TTL: triggers a fresh ping
    t += 4_000;
    const r4 = fakeRes();
    const p4 = handler(fakeReq, r4 as unknown as Response);
    expect(calls).toBe(2);
    resolvePing();
    await p4;
    expect(r4.statusCode).toBe(200);
  });
});
