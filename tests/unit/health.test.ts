// PD-21: /api/health reports the database and the schema, not constants.
import { describe, expect, it, vi } from "vitest";
import { createHealthHandler } from "../../server/routes/health";

function fakeRes() {
  const res: any = { statusCode: 0, headers: {} as Record<string, string>, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.set = (k: string, v: string) => { res.headers[k] = v; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

describe("createHealthHandler", () => {
  it("is 200 when the database answers and the schema is ready", async () => {
    const res = fakeRes();
    await createHealthHandler({ ping: async () => 1, schemaReady: () => true })({} as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, db: true, schema: true });
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("is 503 when the database query fails", async () => {
    const res = fakeRes();
    await createHealthHandler({ ping: () => Promise.reject(new Error("down")), schemaReady: () => true })({} as any, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ ok: false, db: false, schema: true });
  });

  it("is 503 when the database does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      const res = fakeRes();
      const done = createHealthHandler({ ping: () => new Promise(() => {}), schemaReady: () => true, timeoutMs: 50 })({} as any, res);
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
    await createHealthHandler({ ping: async () => 1, schemaReady: () => false })({} as any, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ ok: false, db: true, schema: false });
  });
});
