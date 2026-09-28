import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Agent mode must never touch the database: importing ./storage fails this
// file outright, and any Pool / postgres client / getDb() call is recorded.
const touched = vi.hoisted(() => ({ pgPool: 0, postgres: 0, getDb: 0 }));
vi.mock("../../server/storage", () => {
  throw new Error("agent mode imported server/storage");
});
vi.mock("pg", () => ({ default: { Pool: vi.fn(() => { touched.pgPool++; }) }, Pool: vi.fn(() => { touched.pgPool++; }) }));
vi.mock("postgres", () => ({ default: vi.fn(() => { touched.postgres++; }) }));
vi.mock("../../server/db", () => ({ getDb: () => { touched.getDb++; throw new Error("agent touched the DB"); } }));

import { createAgentApp } from "../../server/agent";
import { agentAllows, agentPathFromHubUrl, AGENT_PATHS } from "../../server/agent-api";
import { bearerToken, createFailureLimiter, sha256Hex, tokenMatches } from "../../server/middleware/agentAuth";
import { agentConfig } from "../../server/config";
import { PIDECK_VERSION } from "../../server/version";

const TOKEN = "t".repeat(20) + "-agent-test-token";
const HASH = sha256Hex(TOKEN);

let server: Server;
let base = "";
beforeAll(async () => {
  const app = createAgentApp({ tokenSha256: HASH, limiter: createFailureLimiter({ max: 5 }) });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const get = (path: string, token: string | null = TOKEN, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });

describe("agent token", () => {
  it("hashes and compares in constant time", () => {
    expect(HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenMatches(HASH, TOKEN)).toBe(true);
    expect(tokenMatches(HASH, TOKEN + "x")).toBe(false);
    expect(tokenMatches(HASH, "")).toBe(false);
    expect(tokenMatches(HASH, null)).toBe(false);
    expect(tokenMatches("not-a-hash", TOKEN)).toBe(false);
    expect(tokenMatches(HASH.toUpperCase(), TOKEN)).toBe(false); // only lower-case hex is valid config
  });
  it("reads only a well-formed Bearer header", () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    for (const h of [undefined, "", "Bearer", "Bearer ", "bearer x", `Basic ${TOKEN}`, "Bearer a b", "Bearer é"]) {
      expect(bearerToken(h)).toBeNull();
    }
  });
  it("refuses to start without a valid hash", () => {
    expect(agentConfig({})).toHaveProperty("error");
    expect(agentConfig({ PIDECK_AGENT_TOKEN_SHA256: "abc" })).toHaveProperty("error");
    expect(agentConfig({ PIDECK_AGENT_TOKEN_SHA256: HASH })).toEqual({ port: 5016, bind: "127.0.0.1", tokenSha256: HASH });
    expect(agentConfig({ PIDECK_AGENT_TOKEN_SHA256: HASH, PIDECK_AGENT_PORT: "0" })).toHaveProperty("error");
    expect(agentConfig({ PIDECK_AGENT_TOKEN_SHA256: HASH, PIDECK_AGENT_BIND: "1.2.3.4; rm" })).toHaveProperty("error");
    expect(agentConfig({ PIDECK_AGENT_TOKEN_SHA256: HASH, PIDECK_AGENT_BIND: "192.168.50.120", PIDECK_AGENT_PORT: "6000" }))
      .toEqual({ port: 6000, bind: "192.168.50.120", tokenSha256: HASH });
  });
});

describe("agent HTTP", () => {
  it("401 with no detail without a token or with a wrong one", async () => {
    for (const tok of [null, "wrong-token-but-long-enough"]) {
      const res = await get("/api/agent/info", tok);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ message: "Unauthorized" });
    }
  });
  it("hides which paths exist from unauthenticated callers", async () => {
    expect((await get("/api/nothing-here", null)).status).toBe(401);
  });
  it("answers /api/agent/info with version, hostname, capabilities", async () => {
    const res = await get("/api/agent/info");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.version).toBe(PIDECK_VERSION);
    expect(typeof body.hostname).toBe("string");
    expect(body.capabilities).toMatchObject({ read: true, actions: false, logs: false });
  });
  it("serves an allowlisted metric with the hub's handler", async () => {
    const res = await get("/api/metrics/ram");
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("total");
  });
  it("404s everything else: POST, other routes, static files, login", async () => {
    const cases: [string, string][] = [
      ["POST", "/api/metrics/ram"], ["POST", "/api/system/update"], ["POST", "/api/docker/containers/x/restart"],
      ["POST", "/api/auth/login"], ["GET", "/api/auth/me"], ["GET", "/api/system/history"], ["GET", "/api/system/alerts"],
      ["GET", "/api/hostlogs"], ["GET", "/api/cron/jobs"], ["GET", "/"], ["GET", "/index.html"], ["GET", "/healthz"],
      ["DELETE", "/api/metrics/ram"], ["GET", "/api/metrics/ram/../../auth/me"],
    ];
    for (const [method, path] of cases) {
      const res = await get(path, TOKEN, { method });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
  it("sets no cookies and no session", async () => {
    const res = await get("/api/agent/info");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
  it("never touched the database or imported storage", () => {
    expect(touched).toEqual({ pgPool: 0, postgres: 0, getDb: 0 });
  });
  it("rate-limits failed attempts per address; a correct token still gets through and clears it", async () => {
    for (let i = 0; i < 6; i++) await get("/api/agent/info", "wrong-token-but-long-enough");
    const blocked = await get("/api/agent/info", "wrong-token-but-long-enough");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // hub fixed its token: not locked out
    expect((await get("/api/agent/info")).status).toBe(200);
    // …and the count was cleared: a new wrong attempt is a plain 401 again
    expect((await get("/api/agent/info", "wrong-token-but-long-enough")).status).toBe(401);
  });
});

describe("failure limiter", () => {
  it("blocks after max failures and forgets after the window", () => {
    let t = 0;
    const l = createFailureLimiter({ max: 3, windowMs: 1000, now: () => t });
    l.fail("a"); l.fail("a");
    expect(l.blocked("a")).toBe(false);
    l.fail("a");
    expect(l.blocked("a")).toBe(true);
    expect(l.blocked("b")).toBe(false);
    t = 1001;
    expect(l.blocked("a")).toBe(false);
  });
  it("reset() clears an address", () => {
    const l = createFailureLimiter({ max: 1 });
    l.fail("a");
    expect(l.blocked("a")).toBe(true);
    l.reset("a");
    expect(l.blocked("a")).toBe(false);
  });
});

describe("allowlist and hub path normalisation", () => {
  it("allows exactly the plan's GET paths", () => {
    expect(AGENT_PATHS).toContain("/api/metrics/firewall-status");
    expect(agentAllows("GET", "/api/metrics/ram")).toBe(true);
    expect(agentAllows("POST", "/api/metrics/ram")).toBe(false);
    expect(agentAllows("HEAD", "/api/metrics/ram")).toBe(false);
    expect(agentAllows("GET", "/api/metrics/ram/")).toBe(false);
    expect(agentAllows("GET", "/api/system/history")).toBe(false);
  });
  it("maps hub URLs to agent paths", () => {
    expect(agentPathFromHubUrl("/api/hosts/piapps2/metrics/ram", "piapps2")).toBe("/api/metrics/ram");
    expect(agentPathFromHubUrl("/api/hosts/piapps2/metrics/ram/", "piapps2")).toBe("/api/metrics/ram");
    expect(agentPathFromHubUrl("/api/hosts/piapps2/agent/info", "piapps2")).toBe("/api/agent/info");
    expect(agentPathFromHubUrl("/api/hosts/piapps2/docker/containers", "piapps2")).toBe("/api/docker/containers");
  });
  it.each([
    "/api/hosts/piapps2/metrics/../auth/me",
    "/api/hosts/piapps2/metrics/%2e%2e/auth/me",
    "/api/hosts/piapps2/metrics%2Fram",
    "/api/hosts/piapps2/metrics/%72am",
    "/api/hosts/piapps2//metrics/ram",
    "/api/hosts/piapps2/metrics//ram",
    "/api/hosts/piapps2/metrics\\ram",
    "/api/hosts/piapps2/metrics/ram?x=1",
    "/api/hosts/piapps2/metrics/ram#x",
    "/api/hosts/piapps2/metrics/ram;x",
    "/api/hosts/piapps2/METRICS/RAM",
    "/api/hosts/piapps2/metrics/ram/.",
    "/api/hosts/piapps2/system/history",
    "/api/hosts/piapps2/system/update",
    "/api/hosts/piapps2/auth/login",
    "/api/hosts/piapps2/",
    "/api/hosts/piapps2",
    "/api/hosts/other/metrics/ram",
  ])("rejects %s", (url) => {
    expect(agentPathFromHubUrl(url, "piapps2")).toBeNull();
  });
  it("rejects a bad host id", () => {
    expect(agentPathFromHubUrl("/api/hosts/../metrics/ram", "..")).toBeNull();
    expect(agentPathFromHubUrl("/api/hosts/PIAPPS2/metrics/ram", "PIAPPS2")).toBeNull();
  });
});
