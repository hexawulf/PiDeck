PiDeck — Fix empty “Docker Containers” box on /dashboard

Repo: /home/zk/projects/PiDeck
Runtime: Node/Express backend + React (Vite) frontend, served on PORT=5006 via PM2 (containeryard-style setup)
Prod URL: https://pideck.piapps.dev
Symptoms: On the Apps tab, the “Docker Containers” panel shows “No Docker containers found” while multiple Docker containers are running on the host (Grafana, Prometheus, Redis, Freqtrade stack, etc.).
Goal: Implement a backend endpoint + frontend hook/UI to return and render the live list of Docker containers from the Pi host (read-only), using the local UNIX socket /var/run/docker.sock. No TCP exposure.

Deliverables

Backend

Add a read-only endpoint: GET /api/docker/containers

Uses dockerode with socketPath: '/var/run/docker.sock'

Returns an array of containers with fields:

{
  id: string
  name: string
  image: string
  state: 'running' | 'exited' | 'paused' | 'restarting' | string
  status: string          // e.g., "Up 3 hours (healthy)"
  ports: Array<{private: number, public?: number, ip?: string, type: string}>
  createdAt: number       // epoch seconds
  labels: Record<string,string>
}[]


Must gracefully handle:

Docker not installed / socket missing → return { containers: [] , note: 'docker socket not available' } with HTTP 200.

Permission denied on socket → same as above, plus note: 'permission denied'.

Enforce read-only: never start/stop containers here.

Add basic rate-limit (e.g., 20 req / 30s per IP) and reuse existing session auth middleware (same as other API routes).

Add quick health log on first request: write a one-line JSON to /home/zk/logs/pideck-docker-endpoint.log.

Frontend

On Apps tab, fetch /api/docker/containers on mount + on “Refresh”.

If array length > 0, render the grid with:

Name, image, state badge (green running, gray exited, etc.), status text, first mapped port(s).

Small copy button to copy name.

If empty and note provided, show a muted hint (e.g., “Docker unavailable: permission denied”).

Keep the existing PM2 Processes card unchanged.

Security/Config

Use the UNIX socket only. Never open Docker over TCP.

No elevated shelling out; only dockerode.

Do not expose container env or mounts.

Put all new server code under server/ (TypeScript), wire it in server/index.ts.

Quality

TypeScript types for the API response.

Zod (or lightweight manual) validation for query (none expected) and output shape.

Unit test (lightweight) for the mapper that converts dockerode data → response DTO.

Files to Add/Change (suggested paths)

server/lib/docker.ts

import Docker from 'dockerode';
export const docker = new Docker({ socketPath: '/var/run/docker.sock' });
export async function listContainersDto() {
  try {
    const containers = await docker.listContainers({ all: true });
    return containers.map(c => ({
      id: c.Id,
      name: (c.Names?.[0] || '').replace(/^\//,''),
      image: c.Image,
      state: c.State as string,
      status: c.Status || '',
      ports: (c.Ports || []).map(p => ({
        private: p.PrivatePort, public: p.PublicPort, ip: p.IP, type: p.Type
      })),
      createdAt: c.Created,
      labels: c.Labels || {}
    }));
  } catch (e: any) {
    if (String(e?.message || '').match(/ENOENT|EACCES|permission/i)) return { note: 'socket unavailable or permission denied', containers: [] };
    throw e;
  }
}


server/routes/docker.ts

import { Router } from 'express';
import { listContainersDto } from '../lib/docker';
const r = Router();

// reuse existing auth & rate-limit middlewares if present
r.get('/containers', async (req, res) => {
  const data = await listContainersDto();
  if (Array.isArray(data)) return res.json({ containers: data });
  return res.json(data); // {note, containers:[]}
});

export default r;


server/index.ts
Register: app.use('/api/docker', dockerRoutes);

client/src/pages/Apps.tsx (or the component that renders the “Apps” tab)

Fetch /api/docker/containers

Render containers grid (name, image, state badge, status, ports)

Keep the existing Refresh button wired to re-fetch

Edge Cases to Handle

No Docker on host → empty list with informational note.

Socket permission: if the node user isn’t in docker group, endpoint still responds with empty+note; do not crash.

Large lists (>200) → only show the first 100 with a “+N more” footer.

Networkless containers (no port mappings) → show “—” for ports.

Acceptance Tests (run on the Pi host)

1) API sanity (expect a non-empty array on this host):

curl -sS http://127.0.0.1:5006/api/docker/containers | jq '.containers | length'
curl -sS http://127.0.0.1:5006/api/docker/containers | jq '.containers[0]'


2) Cross-check with Docker:

docker ps --format '{{.Names}}' | wc -l
docker ps --format '{{.Names}}' | head -n 3


The first number should be ≥ the JSON length of running containers (your endpoint includes all:true, so exited containers may appear with different states).

3) UI smoke test

Open https://pideck.piapps.dev/dashboard → Apps

Click Refresh on the Docker card; cards render with names/images and green “running” where applicable.

4) Log

tail -n 50 /home/zk/logs/pideck-docker-endpoint.log

Constraints & Notes

Absolute paths only in scripts/notes (admin preference).

Don’t change auth/session behavior.

Don’t introduce new open ports or CORS changes.

Keep bundle size impact minimal; no heavyweight UI libs.

If you must add a dep: dockerode (and @types/dockerode) on the server only.

Deployment
# from /home/zk/projects/PiDeck
/usr/bin/npm run build
# restart pm2 app serving PiDeck (adjust name if different)
/usr/bin/pm2 restart pideck --update-env
/usr/bin/pm2 save

If you hit permissions on /var/run/docker.sock

Prefer not to change system groups in code. But you may leave a one-time post-fix note:

# One-time (manual) option to allow the running user to access docker socket:
# sudo usermod -aG docker zk && newgrp docker
# (then pm2 restart)


Success = the Docker box shows real containers (names/images/state/status/ports), refresh works, and API gracefully degrades when Docker isn’t available.
