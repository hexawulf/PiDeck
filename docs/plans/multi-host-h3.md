# PiDeck multi-host H3 — remote logs, DS920+, WireGuard VPSes (2.6.0)

Status: **draft** (2026-09-29), open questions below. Owner: 0xWulf.
Base: v2.5.0 (7654902). Parent plan: [multi-host.md](./multi-host.md);
previous phase: [multi-host-h2.md](./multi-host-h2.md) (shipped as 2.5.0).

## Goal
Every machine in one dashboard, including its logs:
1. **Remote logs**: read logs of piapps2 and every other agent host from the
   hub's Logs tab (pulled forward from H4; remote *actions* stay in H4).
2. **DS920+ as its own host** (quick win: LAN, Node 22 already installed).
3. **piapps3 and piapps4** as agents over a new WireGuard tunnel; nothing
   new reachable from the internet except one silent WireGuard UDP port.

## Who does what (and in which order)
| Step | Work | Who | Needs new code? |
|---|---|---|---|
| 1 | DS920+ agent on **2.5.0** (manual install, LAN, like piapps2) | Claude Code on piapps2 + operator (DSM GUI: boot task, firewall) | no (temperature shows "not available" until step 3) |
| 2 | WireGuard hub ↔ piapps3/piapps4, 2.5.0 agents there, `--add-host` on the hub | Claude Code, phase-gated (keys, firewalls on internet-facing hosts) | no |
| 3 | Remote logs, DSM/x86 support, TODOs → branch `feat/multi-host-h3` | **cloud Claude** (in parallel with steps 1–2) | yes |
| 4 | Review, deploy 2.6.0 (agents first, then hub), enable logs per host (group memberships), release | Claude Code + operator | — |

Steps 1 and 2 are pure infrastructure on today's code and give history,
alerts and overview tiles for three more hosts before 2.6.0 exists.

## Where we are (facts, read-only recon 2026-09-29)
| Host | Facts |
|---|---|
| piapps (hub) | arm64, Ubuntu 26.04.1, Node 22.22, 16 GB. **No WireGuard** (`wg` not installed, no interface). Docker 172.17–172.20. ufw active. zk in `adm`, `docker` |
| piapps2 | agent 2.5.0, LAN `192.168.50.120:5016`, ufw 5016 only from `.102`. Node 24.21, 8 GB (3.8 GB avail), agent RSS ~95 MB. zk in `adm`, `docker` (not `systemd-journal`). Docker/podman nets `10.88.0–6.0/24` |
| piapps3 | DO SGP1 `139.59.253.127`, **x86_64, Ubuntu 24.04.5**, Node 24.21, **2 GB with only ~590 MB available** (RELAY, Mastodon poster). No docker, no WireGuard. ufw: 22/80/443 only. zk only in `sudo`, `users`. DO nets `10.104.0.0/20`, `10.15.0.0/16` |
| piapps4 | Hetzner FSN1 `167.233.201.18`, x86_64, Ubuntu 26.04.1, Node 24.21, 4 GB (2.1 GB avail). **`wg0` = brixhouse tunnel `192.168.178.202/24`** (must stay untouched). No docker. ufw: 22 only. zk only in `sudo`, `users` |
| ds920plus | Synology DS920+ `192.168.50.147`, x86_64 (J4125), **DSM 7.4.1-90080** (vault notes say 7.3: stale), 20 GB (17 GB avail). **Node.js v22.22.3 package** (`/var/packages/Node.js_v22/target/usr/local/bin/{node,npm}`), no git, no ufw (DSM firewall / iptables), no systemd services for us (DSM Task Scheduler). Docker via Container Manager (`/usr/local/bin/docker`, root). CPU temp only in **hwmon** (`/sys/class/hwmon/hwmon0`, `coretemp`, `temp1_input` = package), **no `thermal_zone0`**. Logs: `/var/log/messages`; Dozzle `:9816` and cAdvisor `:9818` already run. SSH: root, port 60535, key `id_ed25519_hex` (`sshmr` alias) |
| Code | Temperature: `thermal_zone0` → vcgencmd → `sensors` (none works on DSM). Agent `capabilities.logs: false`; local logs: `server/routes/hostLogs.ts` (`/`, `/:id`, `/:id/follow`), `server/routes/rasplogs.ts`, filters in `server/services/log-filter.ts` (plain text default, `/…/` regex, ReDoS-guarded). Server build is `--packages=external` (agent needs `node_modules`, `npm ci --omit=dev` works without dev deps) |

## Track A — DS920+ as a host
**Step 1 (infra, 2.5.0, today):**
- Copy a `git archive` of v2.5.0 plus a built `dist/` (esbuild output is
  platform-independent JS) to `/volume1/pideck-agent/`; `npm ci --omit=dev`
  with the NAS's Node 22 npm (x86_64 native deps build there).
- Run as a **dedicated non-admin DSM user `pideck`** (see Open questions):
  `/proc`, `/sys`, `df` work unprivileged; SMART/NVMe and Docker widgets show
  "not available" (the DS920 report + Dozzle already cover those).
- Start at boot: DSM **Task Scheduler → Triggered task → Boot-up** running a
  small start script (operator creates it in the GUI; CLI can't). Script:
  `set -euo pipefail`, env from a 0600 file (`PIDECK_MODE=agent`,
  `PIDECK_AGENT_BIND=192.168.50.147`, `PIDECK_AGENT_PORT=5016`,
  `PIDECK_AGENT_TOKEN_SHA256`), restart loop with backoff, log to
  `/volume1/pideck-agent/logs/`.
- Firewall: DSM Control Panel → Security → Firewall: allow TCP 5016 from
  `192.168.50.102` only, deny 5016 otherwise (operator, GUI). Verify from
  piapps2 (must time out) and from the hub (200 with token, 401 without).
- Hub: `install.sh --add-host ds920 --url http://192.168.50.147:5016`,
  label "DS920+".

**Step 3 (code, 2.6.0):**
- Temperature fallback: read `/sys/class/hwmon/*/temp*_input` when the
  hwmon `name` is `coretemp`/`k10temp`/`cpu_thermal` (package or max core);
  unit tests with fixture trees. Benefits every x86 host (piapps3/4 too).
- DSM platform detection (`/etc.defaults/VERSION`): hide/mark widgets that
  can't work (apt Update, ufw, vcgencmd, systemd) as "not available on this
  host" instead of errors; About shows "DSM 7.4.1".
- `deploy/dsm/`: start script + README section "Synology DSM" in
  `docs/INSTALL.md` (manual, documented; **no** DSM mode in `install.sh`).

## Track B — remote logs (2.6.0, cloud)
**Agent (opt-in per host)**
- `PIDECK_AGENT_LOGS=on` enables `capabilities.logs: true`; default off.
- Sources, all explicit, nothing discovered implicitly:
  - files from the agent's own `PIDECK_HOST_LOGS` (same `id:Label=/path`
    syntax as the hub, stable ids),
  - journald units from `PIDECK_AGENT_JOURNAL_UNITS` (system units; user
    units like `openclaw-gateway` via `--user-unit` only if explicitly listed),
  - Docker container logs only if `PIDECK_AGENT_DOCKER_LOGS=on` and the
    agent user can reach the socket (read-only calls only).
- Endpoints (allowlisted, token-protected, GET only):
  `GET /api/agent/logs` (list: id, label, kind, size, mtime, readable?) and
  `GET /api/agent/logs/:id?lines=&filter=` (tail, default 200, max 2,000
  lines and 1 MB, filter via the existing `log-filter.ts`).
- **Redaction on the agent** before anything leaves the host (on by
  default): `Bearer …`, `Authorization:` headers, `password|passwd|token|
  secret|api[_-]?key` `=`/`:` values, URLs with `user:pass@`. Unit-tested;
  the UI marks redacted spans.
- No follow/stream through the proxy in 2.6 (the hub proxy stays
  request/response with a 5 s timeout and 1 MB cap): the remote Logs tab
  polls the tail (Live/Relaxed/Slow refresh like other widgets).
- Unreadable source (permissions) → listed with `readable: false` and a hint
  ("add the agent user to `adm`"), never a 500.

**Hub + UI**
- Proxy allowlist: `/api/agent/logs` and `/api/agent/logs/:id` with
  validated query params only (`lines` int 1–2000, `filter` ≤ 200 chars).
- Logs tab visible for remote hosts whose agent has `capabilities.logs`;
  otherwise the tab stays hidden (as in 2.4/2.5). Pins and filters work per
  host (prefs keyed by host).
- The hub logs one line per remote log read (host, source id, user) — the
  same pattern H4 will use for remote actions.

**Per-host defaults (operator decides, see Open questions)**
- piapps2: `/var/log/syslog`, `/var/log/auth.log`, `pideck-agent`,
  `docker` containers, `/home/zk/logs/agentmail-send.log`,
  `/home/zk/logs/wulfreport/<month>.log` (month rotation: glob or fixed id).
- piapps3/piapps4: syslog, auth.log, `pideck-agent`, `wg-quick@wg-pideck`,
  plus their `/home/zk/logs/*.log` of choice (RELAY poster, BUILD monitors).
- ds920: `/var/log/messages` (needs a read grant for user `pideck`).

## Track C — WireGuard + piapps3/piapps4 (infra, step 2)
- New interface **`wg-pideck`** on all three hosts (never touch piapps4's
  `wg0`). Subnet **`10.77.0.0/24`** (free on all hosts, checked):
  hub `10.77.0.1`, piapps3 `10.77.0.3`, piapps4 `10.77.0.4` (piapps2 `.2`
  and ds920 reserved, not used in H3).
- **VPSes listen, the hub dials out** (`PersistentKeepalive = 25`): no port
  forward on the ASUS router, no DDNS dependency (VPS IPs are static).
  VPS: `ListenPort = 51821`, ufw `allow 51821/udp` (WireGuard drops
  unauthenticated packets silently); check the DO/Hetzner cloud firewalls too.
- `AllowedIPs`: hub peers `10.77.0.3/32`, `10.77.0.4/32`; each VPS peer
  `10.77.0.1/32`. **Never `0.0.0.0/0`.** No forwarding, no NAT.
- Private keys generated on each host, never copied; only public keys
  exchanged. `/etc/wireguard/wg-pideck.conf` 0600 root. `wg-quick@wg-pideck`
  enabled at boot.
- Agents: `install.sh --agent` binding to `10.77.0.x:5016`; ufw
  `allow in on wg-pideck from 10.77.0.1 to any port 5016`. systemd drop-in
  `After=/Wants=wg-quick@wg-pideck.service` so the bind address exists
  (step 3: installer option `--after <unit>` for this).
- piapps3 memory: ~590 MB available; measure agent RSS (piapps2: ~95 MB)
  and stop if it would push the host into swap/OOM (RELAY must win).
- Hub: `--add-host piapps3 --url http://10.77.0.3:5016` (and piapps4);
  latency Taipei→SGP ~40 ms, →FSN ~250 ms, well inside the 5 s timeout.
- Runbook: `/home/zk/obsidian-vault/pideck-wireguard-agents-runbook.md`;
  update hexawulf-homelab `references/network.md` (new tunnel) and
  `hosts-detail.md` (DSM 7.4.1, Node 22, pideck agents).

## Track D — small TODOs (cloud, 2.6.0)
From TODOS.md (added at the 2.5.0 release):
- `--update` rollback target = the commit that built `dist/`
  (`dist/.build-commit`), not the current HEAD.
- Stale `~/.config/pideck/admin-password` → `--check-login` (prompt) instead
  of silently skipping the login round-trip.
- 3d/7d history ranges when `PIDECK_HISTORY_HOURS` allows (downsampled).

## Error & rescue registry
| Codepath | Failure | Rescue | User sees |
|---|---|---|---|
| Agent logs | source unreadable | `readable:false` + hint | greyed source "no permission" |
| Agent logs | huge file / long lines | tail from the end, 1 MB cap, line cut at 8 kB | "truncated" marker |
| Agent logs | filter regex too costly | existing ReDoS guard → 400 | "Filter too complex" |
| Proxy | agent < 2.6 (no logs capability) | tab hidden | nothing |
| Redaction | pattern miss | defence in depth: logs opt-in, token + WG/LAN-only | — |
| WireGuard | tunnel down | agent offline → gap + offline alert after 5 min | grey tile, toast |
| Agent on VPS | bind before `wg-pideck` is up | systemd ordering + restart | brief offline at boot |
| DS920 | DSM update removes start task/Node package | offline alert; runbook to re-enable | grey tile, toast |
| DS920 | temperature missing (2.5 agent) | hwmon fallback in 2.6 | "not available" until then |

## Tests
- **Unit:** hwmon temperature parsing (coretemp/k10temp fixture trees,
  missing files); DSM detection; log source config parsing; tail with caps
  and long lines; redaction (table-driven, incl. false-positive checks);
  query validation; audit line on remote reads.
- **Agent:** logs endpoints 401 without token, 404 for unknown ids (after
  auth), off by default; path traversal (`..`, symlink escape) impossible
  because ids map to configured paths only.
- **E2E:** remote Logs tab with the local test agents (list, tail, filter,
  unreadable source, redacted token), tab hidden for an agent without logs.
- **Installer harness:** `--after <unit>` drop-in; rollback commit from
  `dist/.build-commit`; `--check-login`.
- Budgets as before: main JS ≤ 302,680 B gzip, `npm audit --omit=dev` = 0.

## Rollout
1. (step 1) DS920 agent 2.5.0 + DSM boot task + DSM firewall; `--add-host ds920`.
2. (step 2, phase-gated) install `wireguard-tools` on piapps, piapps3,
   piapps4 → keys → `wg-pideck` up → ping both ways → agents → ufw → hub
   `--add-host` ×2 → overview shows 5 hosts.
3. Cloud session on `feat/multi-host-h3`; review worktree on piapps; suites.
4. Update agents first (piapps2, piapps3, piapps4, ds920 by hand), then hub;
   enable logs per host (`PIDECK_AGENT_LOGS=on` + sources + group
   memberships: `adm` on piapps3/4, read grant on ds920); verify redaction
   live; release 2.6.0.

## Open questions (decide before step 1)
1. **DS920 agent user:** dedicated non-admin `pideck` (plan; no Docker/SMART
   widgets) or root (all widgets, but a root process on the NAS)?
2. **Remote log sources per host:** accept the defaults above? Add or drop any
   (e.g. auth.log on the VPSes)?
3. **Redaction on by default** with the listed patterns? (Plan: yes.)
4. **piapps2 onto WireGuard too?** (Plan: no; LAN + single-source ufw is
   fine and has fewer moving parts.)
5. **WireGuard port 51821/udp** open to anywhere on the VPSes (Taipei WAN IP
   is dynamic), or restricted to the current WAN IP with a DDNS-driven
   update? (Plan: anywhere; WireGuard is silent without a valid key.)

## Brief for the cloud session (paste with this file)
> Implement Tracks A-step-3, B and D of `docs/plans/multi-host-h3.md` on
> branch `feat/multi-host-h3` from `main` (v2.5.0). Track C and the DS920
> deploy are infrastructure and are done outside your session: don't touch
> WireGuard. Remote logs are read-only and opt-in per agent; redaction
> happens on the agent. Push the branch; don't merge, tag, bump the version
> or deploy. Report: commits, new env vars, redaction patterns with tests,
> test counts before/after, bundle numbers, agent RSS, deviations, open
> questions, manual rollout steps in order.
