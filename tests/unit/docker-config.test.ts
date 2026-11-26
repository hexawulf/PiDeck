import { describe, expect, it } from "vitest";
import { resolveDockerOptions } from "../../server/routes/docker";

describe("resolveDockerOptions (CONTAINERS-002)", () => {
  it("defaults to /var/run/docker.sock when no env var is set", () => {
    expect(resolveDockerOptions({})).toEqual({ socketPath: "/var/run/docker.sock" });
  });

  it("honors PIDECK_DOCKER_SOCKET, PIDECK_AGENT_DOCKER_SOCKET, and DOCKER_HOST", () => {
    expect(resolveDockerOptions({ PIDECK_DOCKER_SOCKET: "/run/docker-proxy.sock" })).toEqual({
      socketPath: "/run/docker-proxy.sock",
    });
    expect(resolveDockerOptions({ PIDECK_AGENT_DOCKER_SOCKET: "/tmp/agent-docker.sock" })).toEqual({
      socketPath: "/tmp/agent-docker.sock",
    });
    expect(resolveDockerOptions({ DOCKER_HOST: "unix:///run/custom.sock" })).toEqual({
      socketPath: "/run/custom.sock",
    });
    expect(resolveDockerOptions({ DOCKER_HOST: "tcp://127.0.0.1:2375" })).toEqual({
      protocol: "http",
      host: "127.0.0.1",
      port: 2375,
    });
    expect(resolveDockerOptions({ PIDECK_DOCKER_SOCKET: "https://127.0.0.1:2376" })).toEqual({
      protocol: "https",
      host: "127.0.0.1",
      port: 2376,
    });
  });

  it("prefers PIDECK_DOCKER_SOCKET over PIDECK_AGENT_DOCKER_SOCKET and DOCKER_HOST", () => {
    expect(
      resolveDockerOptions({
        PIDECK_DOCKER_SOCKET: "/run/hub.sock",
        PIDECK_AGENT_DOCKER_SOCKET: "/run/agent.sock",
        DOCKER_HOST: "tcp://127.0.0.1:2375",
      }),
    ).toEqual({ socketPath: "/run/hub.sock" });
  });
});
