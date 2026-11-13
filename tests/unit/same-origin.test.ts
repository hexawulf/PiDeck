import { describe, expect, it, vi } from "vitest";
import { requireSameOrigin, sameOriginAllowed } from "../../server/middleware/sameOrigin";

const HOST = "pideck.example.dev";
const post = (o: Partial<Parameters<typeof sameOriginAllowed>[0]>) =>
  sameOriginAllowed({ method: "POST", host: HOST, origin: undefined, secFetchSite: undefined, ...o });

describe("same-origin guard (CSRF)", () => {
  it("lets safe methods through whatever the origin", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(sameOriginAllowed({ method, host: HOST, origin: "https://evil.example", secFetchSite: "cross-site" })).toBe(true);
    }
  });

  it("accepts the app's own origin, any scheme or case", () => {
    expect(post({ origin: `https://${HOST}` })).toBe(true);
    expect(post({ origin: `http://${HOST}` })).toBe(true);
    expect(post({ origin: `https://${HOST.toUpperCase()}` })).toBe(true);
    expect(post({ host: "192.168.1.5:5006", origin: "http://192.168.1.5:5006" })).toBe(true);
  });

  it("refuses sibling subdomains, other sites, other ports and the null origin", () => {
    expect(post({ origin: "https://kuma.example.dev" })).toBe(false);
    expect(post({ origin: "https://example.dev" })).toBe(false);
    expect(post({ origin: "https://evil.example" })).toBe(false);
    expect(post({ origin: `https://${HOST}.evil.example` })).toBe(false);
    expect(post({ host: "192.168.1.5:5006", origin: "http://192.168.1.5:8080" })).toBe(false);
    expect(post({ origin: "null" })).toBe(false);
    expect(post({ origin: "" })).toBe(false);
    expect(post({ host: undefined, origin: `https://${HOST}` })).toBe(false);
  });

  it("covers every state-changing method", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(sameOriginAllowed({ method, host: HOST, origin: "https://evil.example", secFetchSite: undefined })).toBe(false);
    }
  });

  it("without Origin, falls back to Sec-Fetch-Site", () => {
    expect(post({ secFetchSite: "same-origin" })).toBe(true);
    expect(post({ secFetchSite: "none" })).toBe(true);
    expect(post({ secFetchSite: "same-site" })).toBe(false); // a sibling subdomain
    expect(post({ secFetchSite: "cross-site" })).toBe(false);
  });

  it("lets non-browser clients through (no Origin, no Sec-Fetch-Site: curl, install.sh)", () => {
    expect(post({})).toBe(true);
  });

  it("allows origins listed in PIDECK_CORS_ORIGIN, exactly", () => {
    const allowedOrigins = ["https://admin.example.dev"];
    expect(post({ origin: "https://admin.example.dev", allowedOrigins })).toBe(true);
    expect(post({ origin: "https://admin.example.dev/", allowedOrigins })).toBe(true);
    expect(post({ origin: "http://admin.example.dev", allowedOrigins })).toBe(false);
  });

  it("the middleware answers 403 JSON and logs one line, or calls next", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mw = requireSameOrigin({});
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();
    mw({ method: "POST", path: "/system/update", ip: "10.0.0.9", headers: { host: HOST, origin: "https://kuma.example.dev" } } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    mw({ method: "POST", path: "/system/update", headers: { host: HOST, origin: `https://${HOST}` } } as any, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
