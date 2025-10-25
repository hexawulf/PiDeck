import { Router } from "express";
import Dockerode, { type ContainerInfo } from "dockerode";
import type { DockerContainer, DockerContainersResponse } from "@shared/schema";
import fs from "fs/promises";
import path from "path";

const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

// Health log path
const LOG_PATH = "/home/zk/logs/pideck-docker-endpoint.log";

// Write health log on first request
let hasLoggedHealth = false;

async function writeHealthLog() {
  if (!hasLoggedHealth) {
    try {
      await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
      await fs.appendFile(LOG_PATH, JSON.stringify({
        timestamp: new Date().toISOString(),
        endpoint: "/api/docker/containers",
        status: "initialized"
      }) + "\n");
      hasLoggedHealth = true;
    } catch (error) {
      console.error("[dockerRouter] Failed to write health log:", error);
    }
  }
}

export const dockerRouter = Router();

dockerRouter.get("/docker/containers", async (_req, res) => {
  try {
    await writeHealthLog();
    
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
  } catch (error: any) {
    console.error("[dockerRouter] Failed to list containers", error?.message ?? error);
    
    // Handle specific error cases
    let warning = "docker_unavailable";
    if (String(error?.message || "").match(/ENOENT|EACCES|permission/i)) {
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
