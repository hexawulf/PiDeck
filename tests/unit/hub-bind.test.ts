// PIDECK_BIND (2.13.1): the hub's listen address, validated like PIDECK_AGENT_BIND.
import { describe, expect, it } from "vitest";
import { hubBind, trustProxy } from "../../server/config";

describe("hubBind", () => {
  it("defaults to 0.0.0.0 so --lan-http installs keep working", () => {
    expect(hubBind({})).toBe("0.0.0.0");
    expect(hubBind({ PIDECK_BIND: "  " })).toBe("0.0.0.0");
  });

  it("defaults to 127.0.0.1 in production behind a reverse proxy and 0.0.0.0 for LAN HTTP (CONTAINERS-001)", () => {
    expect(hubBind({ NODE_ENV: "production" })).toBe("127.0.0.1");
    expect(hubBind({ NODE_ENV: "production", PIDECK_INSECURE_HTTP: "1" })).toBe("0.0.0.0");
    expect(hubBind({ NODE_ENV: "production", PIDECK_BIND: "0.0.0.0" })).toBe("0.0.0.0");
    expect(trustProxy({ PIDECK_INSECURE_HTTP: "1" })).toBe(false);
    expect(trustProxy({ PIDECK_INSECURE_HTTP: "1", TRUST_PROXY: "1" })).toBe(1);
  });

  it("accepts loopback, IPv4, IPv6 and localhost", () => {
    expect(hubBind({ PIDECK_BIND: "127.0.0.1" })).toBe("127.0.0.1");
    expect(hubBind({ PIDECK_BIND: " 192.168.50.10 " })).toBe("192.168.50.10");
    expect(hubBind({ PIDECK_BIND: "::1" })).toBe("::1");
    expect(hubBind({ PIDECK_BIND: "localhost" })).toBe("localhost");
  });

  it("refuses anything that isn't an address", () => {
    for (const bad of ["example.com", "127.0.0.1:5006", "0.0.0.0; rm -rf /", "*"]) {
      expect(hubBind({ PIDECK_BIND: bad })).toHaveProperty("error");
    }
  });
});
