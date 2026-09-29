import { describe, expect, it, vi } from "vitest";
import { cookieSecure, corsOrigins, defaultHostLogs, hostLogs, insecureHttp, parseHostLogs, parseHosts, trustProxy } from "../../server/config";
import { transportWarning } from "@/components/transport-notice";

const PM2 = "/home/op/.pm2/logs";

describe("PIDECK_HOST_LOGS", () => {
  it("parses Label=/path entries, slugifying the id and inferring the source", () => {
    expect(parseHostLogs("PiTasker Output=/var/log/pitasker/out.log, Nginx Extra=/var/log/nginx/extra.log,App=/home/op/.pm2/logs/app-out.log", PM2)).toEqual([
      { id: "pitasker_output", label: "PiTasker Output", path: "/var/log/pitasker/out.log", name: "out.log", source: "project" },
      { id: "nginx_extra", label: "Nginx Extra", path: "/var/log/nginx/extra.log", name: "extra.log", source: "nginx" },
      { id: "app", label: "App", path: "/home/op/.pm2/logs/app-out.log", name: "app-out.log", source: "pm2" },
    ]);
  });

  it("keeps an explicit id: prefix (so existing pins keep working)", () => {
    expect(parseHostLogs("pitasker_out:PiTasker Output=/var/log/pitasker/out.log", PM2)[0]).toMatchObject({ id: "pitasker_out", label: "PiTasker Output" });
  });

  it("skips malformed, relative and duplicate entries with a warning", () => {
    const warn = vi.fn();
    const out = parseHostLogs("nolabel, =/x.log, Rel=logs/x.log, A=/a.log, A=/b.log, ,", PM2, warn);
    expect(out.map((e) => e.path)).toEqual(["/a.log"]);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("empty/unset → nothing extra", () => {
    expect(parseHostLogs(undefined, PM2)).toEqual([]);
    expect(parseHostLogs("  ", PM2)).toEqual([]);
  });

  it("defaults are generic (no host-specific paths) and a configured id overrides one", () => {
    const paths = defaultHostLogs(PM2).map((d) => d.path).join(" ");
    expect(paths).not.toMatch(/pitasker|\/home\/zk/);
    const merged = hostLogs({ PIDECK_HOST_LOGS: "nginx_access:Proxy Access=/srv/nginx/access.log" }, PM2);
    expect(merged.filter((e) => e.id === "nginx_access")).toEqual([
      expect.objectContaining({ label: "Proxy Access", path: "/srv/nginx/access.log" }),
    ]);
  });
});

describe("CORS origin", () => {
  it("is off by default (same-origin SPA)", () => {
    expect(corsOrigins({})).toBe(false);
    expect(corsOrigins({ PIDECK_CORS_ORIGIN: "" })).toBe(false);
  });
  it("accepts a comma list of http(s) origins, dropping junk and trailing slashes", () => {
    expect(corsOrigins({ PIDECK_CORS_ORIGIN: "https://pideck.piapps.dev/, http://10.0.0.5:5006, *, javascript:alert(1), https://x.test/path" }))
      .toEqual(["https://pideck.piapps.dev", "http://10.0.0.5:5006"]);
  });
});

describe("insecure-HTTP switch", () => {
  it("only exactly 1 turns it on", () => {
    expect(insecureHttp({ PIDECK_INSECURE_HTTP: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", "yes"]) expect(insecureHttp({ PIDECK_INSECURE_HTTP: v })).toBe(false);
  });
  it("Secure cookie in production unless the switch is set; never in development", () => {
    expect(cookieSecure({ NODE_ENV: "production" })).toBe(true);
    expect(cookieSecure({ NODE_ENV: "production", PIDECK_INSECURE_HTTP: "1" })).toBe(false);
    expect(cookieSecure({ NODE_ENV: "development" })).toBe(false);
  });
});

describe("TRUST_PROXY", () => {
  it("defaults to one proxy hop", () => {
    expect(trustProxy({})).toBe(1);
    expect(trustProxy({ TRUST_PROXY: "" })).toBe(1);
  });
  it("can be switched off (plain LAN HTTP, no proxy)", () => {
    for (const v of ["false", "0", "no", "OFF"]) expect(trustProxy({ TRUST_PROXY: v })).toBe(false);
  });
  it("takes hop counts, true, and Express presets", () => {
    expect(trustProxy({ TRUST_PROXY: "2" })).toBe(2);
    expect(trustProxy({ TRUST_PROXY: "true" })).toBe(true);
    expect(trustProxy({ TRUST_PROXY: "loopback" })).toBe("loopback");
  });
});

describe("transportWarning (login page)", () => {
  it("warns that login can't stick: Secure cookie over plain HTTP", () => {
    expect(transportWarning({ secureCookie: true, insecureHttp: false }, "http:")).toBe("blocked");
  });
  it("warns about the unencrypted cookie in LAN-HTTP mode", () => {
    expect(transportWarning({ secureCookie: false, insecureHttp: true }, "http:")).toBe("insecure");
  });
  it("is quiet over HTTPS and when unknown", () => {
    expect(transportWarning({ secureCookie: true, insecureHttp: false }, "https:")).toBeNull();
    expect(transportWarning({ secureCookie: false, insecureHttp: true }, "https:")).toBeNull();
    expect(transportWarning(undefined, "http:")).toBeNull();
    expect(transportWarning({ secureCookie: false, insecureHttp: false }, "http:")).toBeNull(); // dev server
  });
});

describe("PIDECK_HOST_TIMEOUT_<ID> (2.6.1)", () => {
  const TOKEN = "t".repeat(64);
  const env = (extra: Record<string, string>) => ({ PIDECK_HOSTS: "ds920=http://192.168.50.147:5016,my-pi=http://10.0.0.2:5016", PIDECK_HOST_TOKEN_DS920: TOKEN, PIDECK_HOST_TOKEN_MY_PI: TOKEN, ...extra });
  it("whole seconds 1–9 per host; unset = the default", () => {
    const hosts = parseHosts(env({ PIDECK_HOST_TIMEOUT_DS920: "9", PIDECK_HOST_TIMEOUT_MY_PI: "1" }), () => {});
    expect(hosts.map((h) => [h.id, h.timeoutMs])).toEqual([["ds920", 9000], ["my-pi", 1000]]);
    expect(parseHosts(env({}), () => {})[0].timeoutMs).toBeUndefined();
  });
  it("anything else keeps the default, with a warning", () => {
    for (const bad of ["0", "10", "2.5", "5s", "-1", "abc"]) {
      const warn = vi.fn();
      expect(parseHosts(env({ PIDECK_HOST_TIMEOUT_DS920: bad }), warn)[0].timeoutMs).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("PIDECK_HOST_TIMEOUT_DS920"));
    }
  });
});
