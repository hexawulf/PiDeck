import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../server/storage", () => ({
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  storage: {
    getUserByUsername: vi.fn(async () => undefined),
    updateUser: vi.fn(async () => undefined),
  },
  adminPasswordIsDefault: vi.fn(() => false),
  markAdminPasswordChanged: vi.fn(),
}));

import { registerRoutes } from "../../server/routes";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  server = await registerRoutes(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("hub /api auth barrier (AUTHZ-001)", () => {
  it("removes __loginBypass and requireAuthUnlessLogin from server/routes.ts", () => {
    const src = fs.readFileSync(path.resolve("server/routes.ts"), "utf8");
    expect(src).not.toContain("__loginBypass");
    expect(src).not.toContain("requireAuthUnlessLogin");
  });

  it("returns 401 for unauthenticated /api/auth/login* and /api/auth/firebase-login* prefix lookalikes", async () => {
    for (const [method, p] of [
      ["GET", "/api/auth/login-extra"],
      ["POST", "/api/auth/login-extra"],
      ["POST", "/api/auth/firebase-login-extra"],
      ["GET", "/api/does-not-exist"],
    ] as const) {
      const res = await fetch(base + p, { method });
      expect(res.status, `${method} ${p}`).toBe(401);
    }

    // Exact public auth endpoints remain reachable as expected
    expect((await fetch(base + "/api/auth/login")).status).toBe(405);
    expect((await fetch(base + "/api/auth/firebase-login")).status).toBe(405);
    expect((await fetch(base + "/api/auth/me")).status).toBe(200);
  });
});
