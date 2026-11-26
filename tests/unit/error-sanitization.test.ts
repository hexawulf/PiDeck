import type { NextFunction, Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { createErrorHandler } from "../../server/middleware/errorHandler";
import { createNvmeHandler } from "../../server/routes/nvme";

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("error handling hygiene (LOGGING-002)", () => {
  it("hides raw internal error messages on 5xx responses while preserving 4xx messages", () => {
    const logged: unknown[] = [];
    const handler = createErrorHandler((e) => logged.push(e));
    const noop: NextFunction = () => {};

    const res500 = makeRes();
    handler(
      new Error("FATAL: relation /var/lib/postgresql/secret_table does not exist"),
      { path: "/api/overview" } as Request,
      res500 as unknown as Response,
      noop,
    );
    expect(res500.statusCode).toBe(500);
    expect(res500.body).toEqual({ message: "Internal Server Error" });
    expect(logged).toHaveLength(1);

    const res400 = makeRes();
    handler(
      Object.assign(new Error("Invalid JSON payload"), { status: 400 }),
      { path: "/api/auth/login" } as Request,
      res400 as unknown as Response,
      noop,
    );
    expect(res400.statusCode).toBe(400);
    expect(res400.body).toEqual({ message: "Invalid JSON payload" });
  });

  it("logs smartctl stderr server-side without leaking details in /api/metrics/nvme 500 response", () => {
    const logged: unknown[][] = [];
    const handler = createNvmeHandler({
      isDsm: () => false,
      hasTool: () => true,
      nvmeDevice: () => "/dev/nvme0",
      runSmartctl: (_dev, cb) => cb(new Error("exit 1"), "", "sudo: /usr/sbin/smartctl internal stderr detail"),
      logError: (...args) => logged.push(args),
    });

    const res = makeRes();
    handler({} as Request, res as unknown as Response);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "SMART data unavailable" });
    expect(res.body).not.toHaveProperty("details");
    expect(logged).toHaveLength(1);
  });
});
