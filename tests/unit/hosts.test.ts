import { describe, expect, it, vi } from "vitest";
import { hostTokenKey, parseHosts } from "../../server/config";
import { createHostHub } from "../../server/hosts";

const TOKEN = "0123456789abcdef0123456789abcdef";
const host = { id: "piapps2", label: "piapps2", url: "http://192.168.50.120:5016", token: TOKEN };

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

function hub(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, opts: Partial<Parameters<typeof createHostHub>[0]> = {}) {
  const f = vi.fn(fetchImpl);
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const h = createHostHub({
    hosts: [host], fetchImpl: f as unknown as typeof fetch, now: clock.now, hubVersion: "2.4.0", localLabel: "piapps",
    infoTimeoutMs: 50, proxyTimeoutMs: 50, ...opts,
  });
  return { h, f, clock };
}

describe("parseHosts", () => {
  const warn = vi.fn();
  it("reads ids, URLs, tokens and labels", () => {
    const hosts = parseHosts({
      PIDECK_HOSTS: "piapps2=http://192.168.50.120:5016, piapps-3=https://10.8.0.3:5016/",
      PIDECK_HOST_TOKEN_PIAPPS2: TOKEN,
      PIDECK_HOST_TOKEN_PIAPPS_3: TOKEN,
      PIDECK_HOST_LABELS: "piapps2=piapps2 (LAN)",
    }, warn);
    expect(hosts).toEqual([
      { id: "piapps2", label: "piapps2 (LAN)", url: "http://192.168.50.120:5016", token: TOKEN },
      { id: "piapps-3", label: "piapps-3", url: "https://10.8.0.3:5016", token: TOKEN },
    ]);
  });
  it("token variable name: upper-case, - → _", () => {
    expect(hostTokenKey("piapps-3")).toBe("PIDECK_HOST_TOKEN_PIAPPS_3");
  });
  it.each([
    ["bad id", "Piapps2=http://h:1"],
    ["reserved id", "local=http://h:1"],
    ["id too long", `${"a".repeat(33)}=http://h:1`],
    ["no =", "piapps2"],
    ["not a URL", "piapps2=nope"],
    ["file URL", "piapps2=file:///etc/passwd"],
    ["credentials", "piapps2=http://u:p@h:1"],
    ["path", "piapps2=http://h:1/api"],
    ["query", "piapps2=http://h:1?x=1"],
    ["fragment", "piapps2=http://h:1#x"],
  ])("skips %s with a warning", (_name, value) => {
    const w = vi.fn();
    expect(parseHosts({ PIDECK_HOSTS: value, PIDECK_HOST_TOKEN_PIAPPS2: TOKEN, PIDECK_HOST_TOKEN_LOCAL: TOKEN }, w)).toEqual([]);
    expect(w).toHaveBeenCalled();
  });
  it("skips a host without a usable token, without printing any token", () => {
    const w = vi.fn();
    expect(parseHosts({ PIDECK_HOSTS: "piapps2=http://h:1", PIDECK_HOST_TOKEN_PIAPPS2: "short" }, w)).toEqual([]);
    expect(w.mock.calls.join(" ")).toContain("PIDECK_HOST_TOKEN_PIAPPS2");
    expect(w.mock.calls.join(" ")).not.toContain("short");
  });
  it("skips duplicates and warns about labels for unknown hosts", () => {
    const w = vi.fn();
    const hosts = parseHosts({
      PIDECK_HOSTS: "a=http://h:1,a=http://h:2", PIDECK_HOST_TOKEN_A: TOKEN, PIDECK_HOST_LABELS: "b=B",
    }, w);
    expect(hosts.map((h) => h.url)).toEqual(["http://h:1"]);
    expect(w).toHaveBeenCalledTimes(2);
  });
  it("no PIDECK_HOSTS = no hosts, no warnings", () => {
    const w = vi.fn();
    expect(parseHosts({}, w)).toEqual([]);
    expect(w).not.toHaveBeenCalled();
  });
});

describe("GET /api/hosts (list)", () => {
  it("lists the hub as local first, then each agent's status", async () => {
    const { h } = hub(async () => json({ version: "2.4.1", hostname: "piapps2" }));
    const [local, remote] = await h.list();
    expect(local).toMatchObject({ id: "local", label: "piapps", local: true, status: "online", version: "2.4.0" });
    expect(remote).toMatchObject({ id: "piapps2", local: false, status: "online", version: "2.4.1" });
    expect(remote.lastSeen).toBe(new Date(1_000_000).toISOString());
  });
  it("flags a different major version", async () => {
    const { h } = hub(async () => json({ version: "3.0.0" }));
    expect((await h.list())[1].status).toBe("version-mismatch");
  });
  it("auth-error on 401, offline on refusal or timeout", async () => {
    expect((await hub(async () => new Response("", { status: 401 })).h.list())[1].status).toBe("auth-error");
    expect((await hub(async () => { throw new TypeError("fetch failed"); }).h.list())[1].status).toBe("offline");
    const hanging = (_u: string, init: RequestInit) =>
      new Promise<Response>((_r, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
    const started = Date.now();
    expect((await hub(hanging).h.list())[1].status).toBe("offline");
    expect(Date.now() - started).toBeLessThan(1000); // one short timeout, not the default
  });
  it("caches each host's status for cacheMs and shares an in-flight check", async () => {
    const { h, f, clock } = hub(async () => json({ version: "2.4.0" }));
    await Promise.all([h.list(), h.list()]);
    await h.list();
    expect(f).toHaveBeenCalledTimes(1);
    clock.advance(15_001);
    await h.list();
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/hosts/:id/* (proxy)", () => {
  it("forwards an allowlisted GET with only the bearer token", async () => {
    const { h, f } = hub(async () => json({ total: 1 }));
    expect(await h.proxy("piapps2", "/api/hosts/piapps2/metrics/ram")).toEqual({ status: 200, body: { total: 1 } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("http://192.168.50.120:5016/api/metrics/ram");
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
    expect(init.headers).toEqual({ authorization: `Bearer ${TOKEN}`, accept: "application/json" });
  });
  it("404 for an unknown host, 400 for a path off the allowlist — without calling out", async () => {
    const { h, f } = hub(async () => json({}));
    expect((await h.proxy("nope", "/api/hosts/nope/metrics/ram")).status).toBe(404);
    for (const u of ["/api/hosts/piapps2/metrics/%2e%2e/auth/me", "/api/hosts/piapps2/system/history", "/api/hosts/piapps2/metrics/ram?x=1"]) {
      expect((await h.proxy("piapps2", u)).status).toBe(400);
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("maps refusal to 502 {offline} with the last-seen time", async () => {
    let up = true;
    const { h, clock } = hub(async () => { if (!up) throw new TypeError("ECONNREFUSED"); return json({ ok: 1 }); });
    await h.proxy("piapps2", "/api/hosts/piapps2/metrics/ram");
    clock.advance(60_000);
    up = false;
    const r = await h.proxy("piapps2", "/api/hosts/piapps2/metrics/ram");
    expect(r).toEqual({ status: 502, body: { offline: true, host: "piapps2", lastSeen: new Date(1_000_000).toISOString() } });
    expect((await h.list())[1].status).toBe("offline");
  });
  it("maps a timeout (headers or body) to offline", async () => {
    const slowBody = () => new Response(new ReadableStream({ start() { /* never sends */ } }), { headers: { "content-type": "application/json" } });
    const { h } = hub(async () => slowBody());
    expect((await h.proxy("piapps2", "/api/hosts/piapps2/metrics/ram")).body).toMatchObject({ offline: true });
  });
  it("maps 401/403/429 to 502 {auth}", async () => {
    for (const status of [401, 403, 429]) {
      const { h } = hub(async () => new Response('{"message":"Unauthorized"}', { status }));
      expect(await h.proxy("piapps2", "/api/hosts/piapps2/metrics/ram")).toEqual({ status: 502, body: { auth: true, host: "piapps2" } });
    }
  });
  it("never passes the agent's error text through", async () => {
    const { h } = hub(async () => json({ message: "secret internals" }, { status: 500 }));
    const r = await h.proxy("piapps2", "/api/hosts/piapps2/system/info");
    expect(r).toEqual({ status: 502, body: { badResponse: true, host: "piapps2" } });
  });
  it("rejects non-JSON and oversized responses", async () => {
    const html = hub(async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
    expect((await html.h.proxy("piapps2", "/api/hosts/piapps2/metrics/ram")).body).toMatchObject({ badResponse: true });
    const garbage = hub(async () => new Response("{nope", { headers: { "content-type": "application/json" } }));
    expect((await garbage.h.proxy("piapps2", "/api/hosts/piapps2/metrics/ram")).body).toMatchObject({ badResponse: true });
    const big = "x".repeat(2000);
    const streamed = hub(async () => new Response(JSON.stringify(big), { headers: { "content-type": "application/json" } }), { maxBytes: 1000 });
    expect((await streamed.h.proxy("piapps2", "/api/hosts/piapps2/metrics/ram")).body).toMatchObject({ badResponse: true });
    const declared = hub(async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024) } }));
    expect((await declared.h.proxy("piapps2", "/api/hosts/piapps2/metrics/ram")).body).toMatchObject({ badResponse: true });
  });
  it("a good answer brings an offline host back online", async () => {
    let up = false;
    const { h } = hub(async () => { if (!up) throw new TypeError("down"); return json({ version: "2.4.0" }); });
    expect((await h.list())[1].status).toBe("offline");
    up = true;
    await h.proxy("piapps2", "/api/hosts/piapps2/metrics/ram");
    expect((await h.list())[1].status).toBe("online");
  });
});
