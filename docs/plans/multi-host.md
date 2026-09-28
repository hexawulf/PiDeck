# PiDeck multi-host — plan

Status: **planned** (2026-09-28). Owner: 0xWulf. Base: v2.3.0 (a252f84).

## Goal
One dashboard, several machines. pideck.piapps.dev (on piapps) shows piapps,
piapps2 and later piapps3/piapps4, with a host switcher, per-host history and
an "All hosts" overview. Nothing new is exposed to the internet.

## Non-goals (for now)
- Remote actions (Docker/pm2 restart, Update System, cron run) and remote log
  reading: later, opt-in per host.
- Agentless SSH collection: the hub would hold keys to every host.
- Multi-user / RBAC.

## Fleet
| Host | Network | Arch / OS | Role | Phase |
|---|---|---|---|---|
| piapps (192.168.50.102) | LAN | arm64, Ubuntu 26.04 | **hub** (UI, login, DB, nginx) | — |
| piapps2 (192.168.50.120) | LAN | arm64, Ubuntu 26.04 | agent | **H1** |
| piapps3 (VPS 139.59.x) | internet | x86_64, Ubuntu 24.04, 2 GB | agent over WireGuard | H3 |
| piapps4 (VPS 167.233.x, SG) | internet | x86_64, Ubuntu 26.04, 4 GB | agent over WireGuard | H3 |

## Architecture
```
 browser ──HTTPS──► nginx (piapps) ──► PiDeck hub :5006
                                        │  UI · login · Postgres · sampler
                                        │
                                        ├─ local host: existing routes (/api/...)
                                        │
                                        └─ /api/hosts/:id/<allowlisted GET>
                                              │  Authorization: Bearer <token>
                                              │  5 s timeout · 1 MB cap · GET only
                                              ▼
                                  PiDeck agent :5016 (piapps2)       H3: same, over wg0
                                  PIDECK_MODE=agent
                                  no UI · no DB · no sessions · read-only
```
- The browser only ever talks to the hub. The hub never forwards cookies or
  client headers; it adds the host's bearer token.
- The hub resolves `:id` against its configured hosts only (no URLs from the
  client → no SSRF).
- Agent = the same codebase started with `PIDECK_MODE=agent`: it mounts only
  the read-only metric routes, behind token auth. No `storage` import (no DB
  connection), no static files, no login.

## Agent API (H1, read-only allowlist)
`/api/agent/info` (version, hostname, capabilities), `/api/system/info`,
`/api/metrics/{ram,swap,cpu-freq,top-processes,filesystems,mounts,nvme,
power-status,thermal-zones,firewall-status,ip-config,listening-ports}`,
`/api/reboot-check`, `GET /api/docker/containers`, `GET /api/pm2/processes`.

Not on the agent: auth, history, alerts (the hub computes them), logs, cron,
Update System, any POST.

## Security model
- **Token:** 32 random bytes per agent, sent as `Authorization: Bearer`. The
  agent stores only its SHA-256 (`PIDECK_AGENT_TOKEN_SHA256`) and compares
  with `timingSafeEqual`; the hub stores the token in its `.env` (0600).
  Missing/wrong token → 401 with no detail; repeated failures are rate-limited.
- **Network (H1):** agent listens on piapps2's LAN address, port 5016. ufw
  allows 5016 **only from 192.168.50.102** (the hub). Plain HTTP on the home
  LAN is accepted for H1 (token + single-source firewall rule); H3 moves agent
  traffic onto WireGuard, and piapps2 can move with it.
- **Read-only:** the agent has no mutating routes at all in H1/H2, so a
  stolen token can read metrics but change nothing.
- **Hub proxy hardening:** GET only, allowlisted paths (exact match after
  normalisation; `..`, encoded slashes and query-string tricks rejected),
  5 s timeout, 1 MB response cap, JSON only, agent errors mapped to a calm
  "host offline" state (never the agent's raw error text).
- The agent runs as the owning user under systemd; sudo only through the
  existing optional sudoers rule (`sudo -n`, exact commands).

## Configuration
Hub `.env`:
```
PIDECK_HOSTS=piapps2=http://192.168.50.120:5016
PIDECK_HOST_TOKEN_PIAPPS2=<token>
# optional labels: PIDECK_HOST_LABELS=piapps2=piapps2 (LAN)
```
The hub itself is always host `local` (label = its hostname).

Agent `.env`:
```
PIDECK_MODE=agent
PIDECK_AGENT_PORT=5016
PIDECK_AGENT_BIND=192.168.50.120
PIDECK_AGENT_TOKEN_SHA256=<sha256 hex>
```

## UI
- **Host switcher** in the header (and in the command palette: "Switch to
  piapps2"): a status dot per host (online / offline / version mismatch),
  hub polls `/api/hosts` every 30 s.
- **Routes:** `/dashboard` etc. stay the local host; remote hosts live under
  `/h/:hostId/dashboard`, `/h/:hostId/apps`. Deep-linkable, back button works.
- **Queries:** a `HostProvider` from the URL; every widget query key includes
  the host id and its path is built by `apiPath(host, "/api/metrics/ram")`
  (local → unchanged, remote → `/api/hosts/piapps2/metrics/ram`), so caches
  never mix hosts.
- **Registry scope:** each widget declares `hosts: "local" | "any"`.
  Local-only in H1: history charts, Quick Actions, Logs, Cron. On a remote host
  they are hidden (Logs/Cron tabs hidden; Apps is read-only, action buttons
  absent).
- **Layout prefs:** one layout per host (`layoutByHost`), falling back to the
  local layout; export/import stays compatible (prefs schema bump + migration).
- **Offline host:** every card shows "piapps2 is offline (last seen …)", not
  an error card; the switcher dot turns grey.

## Phases
### H1 — 2.4.0: agent + hub proxy + switcher (piapps2)
- `PIDECK_MODE=agent` server entry; token auth; allowlisted routes; make
  `storage`/DB lazy so agent mode never connects to Postgres.
- Hub: host registry from `.env`, `/api/hosts` (status, version, last seen),
  `/api/hosts/:id/*` proxy.
- UI: switcher, `/h/:hostId/*` routes, `apiPath`, registry scope, per-host
  layout, offline states.
- `install.sh --agent` (no Postgres; generates the token, prints it once for
  the hub, stores the hash; systemd `pideck-agent` unit; optional `--sudoers`;
  prints the exact ufw rule, or applies it with `--ufw-allow-from <hub-ip>`).
  `install.sh --add-host <id> --url <url>` on the hub: prompts for the token,
  appends the two `.env` keys (append-only, `.bak`), tests `/api/agent/info`.
- `uninstall.sh` handles agent installs.

### H2 — 2.5.0: per-host history, alerts, overview
- **M0 (prerequisite): schema migrations.** Baseline the existing
  push-created schema as migration 0000, switch to drizzle migrations, and
  apply them from `install.sh` and `install.sh --update` (closes the TODOS
  item). Test the upgrade path on a copy of the prod DB.
- `historical_metrics.host_id` (default `local`, backfilled), index on
  `(host_id, timestamp)`.
- Hub sampler: each tick samples local and polls every agent in parallel
  (per-host timeout; one slow host never delays the others); alerts per host.
- History charts and alerts become `hosts: "any"`.
- "All hosts" overview page: a tile per host (status, CPU, temp, RAM, disk,
  open alerts), click-through to that host.

### H3 — 2.6.0: WireGuard + piapps3 / piapps4
- WireGuard between the hub and the VPSes (separate subnet from the existing
  brixhouse tunnel on piapps4); agents bind to their wg0 address only; no
  public port. Optionally move piapps2 onto it too.
- `install.sh --agent` on x86_64 VPSes (2 GB RAM on piapps3: measure agent RSS).
- Runbook in the Obsidian vault.

### H4 — later: opt-in remote actions and logs
- Per-host capability flags (`actions`, `logs`) enabled on the agent side;
  POST forwarding with CSRF and the existing ConfirmDialog; audit log line
  on the hub for every remote action.

## Error & rescue registry (H1)
| Codepath | Failure | Rescue | User sees |
|---|---|---|---|
| Hub → agent | timeout / refused | 502 `{offline:true}` | "piapps2 is offline (last seen …)" |
| Hub → agent | 401 (token wrong/rotated) | 502 `{auth:true}` | "Can't authenticate to piapps2 — check its token" |
| Hub → agent | non-JSON / >1 MB | 502 | card error "Bad response from piapps2" |
| Agent version | major mismatch | still proxied | amber dot + tooltip "update the agent" |
| Hub config | unknown host id in URL | 404 | "No such host" page with link back |
| Agent | tool missing | existing "unavailable" state | "Not available on this host" |

## Tests
- Unit: token hashing/compare, allowlist + path normalisation (`..`,
  `%2F`, `//`, query strings), host registry parsing, proxy timeout/size cap,
  `apiPath`, query-key isolation, registry scope filtering, per-host layout
  migration.
- Agent: never imports storage (assert no Postgres connection in agent mode);
  401 without/with wrong token; no static files; POST → 404/405.
- E2E: start a local agent (second process, fixed test token) plus the hub
  pointing at it; switch host, widgets render agent data; stop the agent →
  offline states; local-only tabs hidden on the remote host; deep link
  `/h/<id>/dashboard`; axe clean on the switcher.
- Installer harness: `--agent` (no Postgres, token shown once, hash stored,
  unit rendered), `--add-host` (append-only, connection test).

## Rollout (H1)
1. Branch in a cloud session → review worktree on piapps → full suites.
2. piapps2: `install.sh --agent --dry-run`, then real install (systemd);
   `sudo ufw allow from 192.168.50.102 to any port 5016 proto tcp`.
3. piapps (hub): backups, fast-forward, `install.sh --add-host piapps2 …`,
   rebuild, restart; verify switcher, piapps2 dashboard, offline behaviour
   (stop the agent briefly), and that nothing on piapps2 listens beyond LAN.
4. Release 2.4.0.

## Open questions
- Show piapps's own name ("piapps") or "local" in the switcher? (Plan: hostname.)
- Keep one shared layout for all hosts instead of per host? (Plan: per host,
  falling back to local.)
