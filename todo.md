FIXIT — PiDeck logs & apps regressions

Context

App runs on port 5006 behind Nginx for pideck.piapps.dev. Keep auth/session as-is.

We previously had a host logs allowlist (Nginx/PM2/other files). Re-add it and expose as /api/hostlogs/:name (alias /api/rasplogs for backward compatibility). Use tail/since/grep/follow SSE as needed; for now snapshot + simple follow is enough. Use absolute paths; primary log directory is /home/zk/logs. (We also want Nginx and PM2 logs back.)

Docker is running (Grafana 3000, Prometheus 9090, Redis 6379, cAdvisor 8082, freqtrade stack), so “No Docker containers found” is incorrect—either list them via Docker socket or hide the card gracefully if the socket isn’t available.

1) Server — restore host logs API (and JSON-safe errors)

Create server/routes/hostLogs.ts:

import { Router } from 'express';
import fs from 'fs';
import path from 'path';

const r = Router();

// Allowlist (absolute paths only)
const LOGS: Record<string,string> = {
  'nginx_access': '/var/log/nginx/container.piapps.dev.access.log',
  'nginx_error':  '/var/log/nginx/container.piapps.dev.error.log',
  'pm2_pideck_out':  path.join(process.env.HOME || '/home/zk', '.pm2/logs/pideck-out.log'),
  'pm2_pideck_err':  path.join(process.env.HOME || '/home/zk', '.pm2/logs/pideck-error.log'),
  // project logs folder
  'pideck_cron': '/home/zk/logs/pideck-cron.log',
  'codepatchwork': '/home/zk/logs/codepatchwork.log',
  'synology': '/home/zk/logs/synology.log'
};

function tailFile(file: string, n = 500): string {
  // simple, safe tail without extra deps
  if (!fs.existsSync(file)) return '';
  const stat = fs.statSync(file);
  const size = Math.min(stat.size, 1024 * 1024); // cap to 1MB
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, stat.size - size);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').split('\n');
  return lines.slice(-n).join('\n');
}

r.get('/:name', (req, res) => {
  const name = req.params.name;
  const file = LOGS[name];
  if (!file) return res.status(404).json({ error: 'unknown_log' });

  const tail = Math.min(Math.max(parseInt(String(req.query.tail || 500), 10) || 500, 1), 5000);
  let text = tailFile(file, tail);

  const grep = String(req.query.grep || '').trim();
  if (grep) {
    try {
      const rx = grep.startsWith('/') && grep.endsWith('/') ? new RegExp(grep.slice(1,-1), 'i') : new RegExp(grep, 'i');
      text = text.split('\n').filter(l => rx.test(l)).join('\n');
    } catch {
      const q = grep.toLowerCase();
      text = text.split('\n').filter(l => l.toLowerCase().includes(q)).join('\n');
    }
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(text);
});

export default r;


Wire the route in server/index.ts (or wherever routes mount):

import hostLogs from './routes/hostLogs';
// … after auth/session middlewares:
app.use('/api/hostlogs', requireAuth, hostLogs);
// backward-compat alias for older UI:
app.use('/api/rasplogs', requireAuth, hostLogs);


Ensure API errors are JSON (not HTML) — in your global error handler, if the path starts with /api/, send application/json:

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (req.path.startsWith('/api/')) {
    res.status(status).json({ error: err.code || 'server_error', message: err.message || 'Internal error' });
  } else {
    res.status(status).send('Internal error');
  }
});


This prevents the client’s .json() from choking on an HTML error page, which is what caused “Unexpected token < …”.

2) Client — make the Logs viewer fetch text, not JSON, and restore the catalog label

Edit the logs page component (where we load a log by name, e.g. client/src/pages/Logs.tsx or similar):

// replace response.json() with response.text()
const res = await fetch(`/api/hostlogs/${encodeURIComponent(name)}?tail=${tail}&grep=${encodeURIComponent(grep || '')}`, {
  credentials: 'include'
});
if (!res.ok) {
  const msg = await res.text(); // keep it robust
  throw new Error(`HTTP ${res.status}: ${msg}`);
}
const text = await res.text();           // << text, not JSON
setLines(text ? text.split('\n') : []);


UI copy: change the page title back to “Raspberry Pi Logs” and repopulate the sidebar with the allowlist keys (nginx_access, nginx_error, pm2_pideck_out, pm2_pideck_err, pideck_cron, etc.).

3) Apps → Docker panel: list containers if socket available, otherwise hide the card

Server (optional minimal endpoint) — add server/routes/docker.ts:

import { Router } from 'express';
import Docker from 'dockerode';
const r = Router();

r.get('/containers', async (_req, res) => {
  try {
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    const list = await docker.listContainers({ all: false });
    res.json(list.map(c => ({
      id: c.Id, names: c.Names, image: c.Image, state: c.State, status: c.Status
    })));
  } catch (e:any) {
    // socket not available? return empty to let UI hide
    res.json([]);
  }
});

export default r;


Mount it:

import dockerRoute from './routes/docker';
app.use('/api/docker', requireAuth, dockerRoute);


Client — where we build the Apps screen, fetch /api/docker/containers and:

if array length > 0 → render the table

else → hide the “Docker Containers” card (don’t show “No containers found” unless the call itself failed)

This aligns with the fact that Docker is running and proxied services exist on 3000/9090/8082/6379 (per our mapping).

4) Quick regression checks (paste-ready)
# Verify auth cookie works against the same origin
BASE="https://pideck.piapps.dev"; CK="/tmp/pideck.cookies"; rm -f "$CK"
curl -sS -c "$CK" -H 'Content-Type: application/json' -H "Origin: ${BASE}" \
  -X POST "${BASE}/api/auth/login" --data '{"password":"<YOUR_ADMIN_PASSWORD>"}' | jq .

# Host logs should return text (no HTML)
curl -i -sS -b "$CK" "${BASE}/api/hostlogs/nginx_error?tail=30" | sed -n '1,10p'
curl -sS -b "$CK" "${BASE}/api/hostlogs/pideck_cron?tail=20&grep=error" | tail -n +1

# Back-compat alias
curl -sS -b "$CK" "${BASE}/api/rasplogs/pideck_cron?tail=10" | wc -l

# Docker containers (if socket readable)
curl -sS -b "$CK" "${BASE}/api/docker/containers" | jq 'length'

5) Small Nginx sanity (only if you changed conf recently)

Make sure your PiDeck vhost still proxies to 127.0.0.1:5006 and forwards scheme/host so session & redirects behave:

proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;


(Port 5006 is PiDeck per our inventory.)

6) Commit template
fix(pideck): restore host logs API + text log fetching; revive “Raspberry Pi Logs”; docker panel robustness

- server: add /api/hostlogs (+ alias /api/rasplogs) with allowlisted files (nginx, pm2, /home/zk/logs)
- server: ensure API errors return JSON; avoid HTML in /api responses
- client: logs viewer now uses response.text() (prevents “Unexpected token <” JSON parse errors)
- client: restore sidebar label and catalog
- apps: add /api/docker/containers via dockerode; hide card when socket absent
- tests: curl sanity for hostlogs + docker endpoints
