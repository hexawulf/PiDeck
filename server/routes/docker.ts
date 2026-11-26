import { Router } from "express";
import Dockerode, { type ContainerInfo, type DockerOptions } from "dockerode";
import type { DockerContainer, DockerContainersResponse } from "@shared/schema";

const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";

/**
 * Resolve Dockerode connection options from PIDECK_DOCKER_SOCKET,
 * PIDECK_AGENT_DOCKER_SOCKET, or DOCKER_HOST (supporting unix://, tcp://,
 * http://, https://, or a filesystem socket path). Defaults to
 * /var/run/docker.sock.
 */
export function resolveDockerOptions(env: NodeJS.ProcessEnv = process.env): DockerOptions {
  const raw = (
    env.PIDECK_DOCKER_SOCKET ||
    env.PIDECK_AGENT_DOCKER_SOCKET ||
    env.DOCKER_HOST ||
    ""
  ).trim();
  if (!raw) return { socketPath: DEFAULT_DOCKER_SOCKET };
  if (/^unix:\/\//i.test(raw)) {
    const socketPath = raw.slice("unix://".length).trim();
    return { socketPath: socketPath || DEFAULT_DOCKER_SOCKET };
  }
  if (/^(?:tcp|https?):\/\//i.test(raw)) {
    const normalized = raw.replace(/^tcp:\/\//i, "http://");
    const parsed = new URL(normalized);
    return {
      protocol: parsed.protocol === "https:" ? "https" : "http",
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 2376 : 2375,
    };
  }
  return { socketPath: raw };
}

const docker = new Dockerode(resolveDockerOptions());

export const dockerRouter = Router();

dockerRouter.get("/docker/containers", async (_req, res) => {
  try {
    const containersInfo: ContainerInfo[] = await docker.listContainers({ all: true });
    const containers: DockerContainer[] = containersInfo.map((container) => ({
      id: container.Id,
      name: (container.Names?.[0] ?? "").replace(/^\//, ""),
      image: container.Image,
      status: container.Status ?? "",
      state: container.State ?? "unknown",
      ports: (container.Ports || []).map(p => ({
        private: p.PrivatePort,
        public: p.PublicPort,
        ip: p.IP,
        type: p.Type
      })),
      createdAt: container.Created,
      labels: container.Labels || {}
    }));

    const payload: DockerContainersResponse = { containers };
    res.json(payload);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error ?? "");
    console.error("[dockerRouter] Failed to list containers", errMsg || error);
    
    // Handle specific error cases
    let warning = "docker_unavailable";
    if (errMsg.match(/ENOENT|EACCES|permission/i)) {
      warning = "socket unavailable or permission denied";
    }
    
    const payload: DockerContainersResponse = {
      containers: [],
      warning,
    };
    res.json(payload);
  }
});

export default dockerRouter;
