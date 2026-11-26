import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { clientKey, createRateLimitLogin } from "../../server/middleware/rateLimitLogin";
import { trustCloudflare } from "../../server/config";

const req = (ip: string | undefined, cf?: string | string[]) =>
  ({ ip, headers: cf === undefined ? {} : { "cf-connecting-ip": cf } }) as unknown as Request;

describe("login rate limit key", () => {
  it("ignores CF-Connecting-IP by default (client-controlled without Cloudflare)", () => {
    expect(trustCloudflare({})).toBe(false);
    expect(clientKey(req("10.0.0.5", "1.2.3.4"), {})).toBe("10.0.0.5");
    // a spoofed header per request must not create fresh buckets
    expect(clientKey(req("10.0.0.5", "9.9.9.9"), {})).toBe("10.0.0.5");
  });

  it("uses CF-Connecting-IP only with PIDECK_CLOUDFLARE=1", () => {
    const env = { PIDECK_CLOUDFLARE: "1" };
    expect(trustCloudflare(env)).toBe(true);
    expect(clientKey(req("172.67.0.1", " 1.2.3.4 "), env)).toBe("1.2.3.4");
    expect(clientKey(req("172.67.0.1", ["5.6.7.8", "x"]), env)).toBe("5.6.7.8");
  });

  it("falls back to req.ip when the header is missing or empty, and to 'unknown'", () => {
    const env = { PIDECK_CLOUDFLARE: "1" };
    expect(clientKey(req("172.67.0.1"), env)).toBe("172.67.0.1");
    expect(clientKey(req("172.67.0.1", "  "), env)).toBe("172.67.0.1");
    expect(clientKey(req(undefined), {})).toBe("unknown");
  });

  it("only the exact value 1 enables it", () => {
    for (const v of ["true", "yes", "0", ""]) expect(trustCloudflare({ PIDECK_CLOUDFLARE: v })).toBe(false);
  });

  it("ignores malformed CF-Connecting-IP values and falls back to req.ip (API-001)", () => {
    const env = { PIDECK_CLOUDFLARE: "1" };
    expect(clientKey(req("172.67.0.1", "not-an-ip"), env)).toBe("172.67.0.1");
    expect(clientKey(req("172.67.0.1", "1.2.3.4\r\nevil"), env)).toBe("172.67.0.1");
    expect(clientKey(req("172.67.0.1", "2001:db8::1"), env)).toBe("2001:db8::1");
  });

  it("bounds the in-memory bucket size with oldest-entry eviction (API-001)", () => {
    const limiter = createRateLimitLogin({ maxEntries: 3, maxAttempts: 2 });
    const res = {
      setHeader() {},
      status() { return this; },
      json() { return this; },
    } as unknown as Response;
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3", "198.51.100.4", "198.51.100.5"]) {
      limiter(req(ip), res, () => {});
    }
    expect(limiter.size()).toBe(3);
  });
});
