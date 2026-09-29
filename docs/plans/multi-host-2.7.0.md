# PiDeck 2.7.0 — cloud hosts over WireGuard (todo)

Status: **todo**, to start 2026-09-30. Owner: 0xWulf.
Base: v2.6.1 (aa37934). Design origin: [multi-host-h3.md](./multi-host-h3.md) › Track C
(postponed there); parent plan: [multi-host.md](./multi-host.md).

## Goal
piapps3, piapps4 and hwca-ap02 appear in PiDeck like piapps2 and the DS920+
(dashboard, history, alerts, overview tile), reached **only through a new
WireGuard tunnel** from the hub. Nothing new is reachable from the internet
except one silent WireGuard UDP port per VPS.

Mostly infrastructure (keys, tunnels, firewalls, agent installs) plus a few
small installer changes → a **Claude Code CLI task** (like 2.6.1), phase-gated
per the homelab standard. No cloud session needed.

## Decide first (blocking)
1. **hwca-ap02 is colleague-billed, "read/ops only; never co-mingle personal
   services"** (hexawulf-homelab §1/§5). A PiDeck agent + a WireGuard
   interface there is a personal service on their box. **Needs the
   colleague's explicit OK**; without it hwca-ap02 is out of scope (the
   existing read-only `sigint-hwca-ap02-audit.sh` stays the monitoring).
   It also has only 961 MB RAM (622 MB free) next to nginx + fail2ban.
2. **Logs for cloud hosts in 2.7.0?** Plan: metrics/history/alerts first;
   remote logs opt-in per host afterwards (lower priority, decided
   2026-09-29). Which sources, if any (auth.log, RELAY/BUILD logs)?
3. **WireGuard port 51821/udp open to any address** on the VPSes (the Taipei
   WAN IP is dynamic; WireGuard ignores packets without a valid key) or
   pinned to the current WAN IP with a DDNS-driven update? Plan: any.
4. piapps2 and the DS920+ stay on the LAN (decided 2026-09-29).

## Facts (read-only recon 2026-09-29)
| Host | Facts |
|---|---|
| piapps (hub) | arm64, Ubuntu 26.04.1, Node 22, 16 GB. **No `wireguard-tools`, no wg interface.** Behind the ASUS NAT with a dynamic WAN IP → it dials out. Docker nets 172.17–172.20 |
| piapps3 | DO SGP1 `139.59.253.127`, **x86_64, Ubuntu 24.04.5**, Node 24, 2 GB with **~640 MB available** (RELAY 小信使, sole Mastodon poster). ufw 22/80/443. zk in `sudo`, `users` only. DO nets `10.104.0.0/20`, `10.15.0.0/16` |
| piapps4 | Hetzner FSN1 `167.233.201.18`, x86_64, Ubuntu 26.04.1, Node 24, 4 GB (2.1 GB avail). **`wg0` = brixhouse tunnel `192.168.178.202/24` — must stay untouched** (BUILD/GUARDIAN monitors depend on it). ufw 22 only |
| hwca-ap02 | Linode Osaka `172.233.75.18`, x86_64, Ubuntu 24.04.5, Node 22, **961 MB (622 avail)**, nginx + fail2ban (hwca.de). No wg. ufw 22/80/443. **Colleague-billed** (see above) |
| Subnet | `10.77.0.0/24` free on all hosts (checked 2026-09-29) |
| Code | Agent + installer are x86-ready in principle (hwmon temperature since 2.6.0) but **`install.sh --agent` has never run on x86_64** |

## Design
- New interface **`wg-pideck`** everywhere (never `wg0`): hub `10.77.0.1`,
  piapps3 `.3`, piapps4 `.4`, hwca-ap02 `.5` (piapps2 `.2` / ds920 reserved).
- **VPSes listen, the hub dials out**: VPS `ListenPort = 51821`; hub peers
  with `Endpoint = <vps-ip>:51821`, `PersistentKeepalive = 25`. VPS side has
  no endpoint for the hub (roams behind NAT). No router port forward, no DDNS.
- `AllowedIPs`: hub → each VPS `/32`; each VPS → `10.77.0.1/32` only. **Never
  `0.0.0.0/0`.** No IP forwarding, no NAT, no routes beyond the /32s.
- Keys generated on each host, private keys never leave it
  (`/etc/wireguard/wg-pideck.conf`, 0600 root); only public keys exchanged.
- Agents bind to their tunnel address (`10.77.0.x:5016`); ufw:
  `allow in on wg-pideck from 10.77.0.1 to any port 5016 proto tcp`.
  Unit ordering: `After=`/`Wants=wg-quick@wg-pideck.service`.
- Memory guard on small hosts: agent unit `MemoryMax=` (e.g. 160M) so RELAY /
  hwca.de always win; measure RSS first (piapps2 ~98 MB, DS920 ~88 MB).
- Latency: Taipei→SGP ~40 ms, →FSN ~250 ms, →Osaka ~40 ms; well inside the
  5 s default (`PIDECK_HOST_TIMEOUT_<ID>` exists if needed).

## Todo
### 0. Prep (read-only)
- [ ] Decisions 1–3 above.
- [ ] Cloud-provider firewalls in front of the VPSes (DO Cloud Firewall,
      Hetzner Firewall, Linode Cloud Firewall): does 51821/udp need opening there too?
- [ ] Snapshot before/after state: `wg show`, `ip -br addr`, `ufw status numbered`
      on all hosts; piapps4 `wg0` handshake + brixhouse monitor status.

### 1. Code (small, on a branch, CLI)
- [ ] `install.sh --agent --after <unit>`: systemd drop-in so the agent
      starts after `wg-quick@wg-pideck` (bind address must exist).
- [ ] `install.sh --agent --memory-max <size>` → `MemoryMax=` in the unit.
- [ ] Installer harness: both flags, plus an x86_64 preflight path.
- [ ] docs/INSTALL.md: "Agents over WireGuard" (keys, configs, ufw, order).
- [ ] Release notes / version 2.7.0 (after the rollout).

### 2. Hub (piapps) — approval gate: apt, network
- [ ] `apt install wireguard-tools` (backup nothing; note needrestart).
- [ ] Key pair, `wg-pideck.conf` with the VPS peers (added one by one).
- [ ] `wg-quick@wg-pideck` enabled; hub ufw needs no inbound rule (it dials out).

### 3. Per VPS (piapps4 first — most RAM; then piapps3; hwca-ap02 only if OK'd)
- [ ] `apt install wireguard-tools`; key pair; `wg-pideck.conf`; ufw `51821/udp`.
- [ ] `wg-quick@wg-pideck` up + enabled; ping `10.77.0.1` ↔ `10.77.0.x`.
- [ ] piapps4: confirm `wg0` (brixhouse) unchanged and its monitors green.
- [ ] Agent: `install.sh --agent` bound to `10.77.0.x:5016`, `--after`,
      `--memory-max`; ufw rule on `wg-pideck` from `10.77.0.1` only.
- [ ] From the VPS's public side and from piapps2: 5016 unreachable.
- [ ] RSS after 30 min; piapps3: available memory before/after.

### 4. Hub registration + verification
- [ ] `install.sh --add-host piapps4 --url http://10.77.0.4:5016 --label …`
      (then piapps3, hwca-ap02); `pm2 restart pideck --update-env`.
- [ ] Overview shows 5–6 hosts; history rows per host; temperature via hwmon
      (VPS may have none → "not available").
- [ ] Offline test: `wg-quick down wg-pideck` on one VPS for 6 min → offline
      alert + toast, then recovery.
- [ ] Reboot test on one VPS (tunnel + agent come back by themselves).

### 5. Docs + release
- [ ] Obsidian runbook `pideck-wireguard-agents-runbook.md` (topology, keys'
      locations, add/remove a host, rollback).
- [ ] hexawulf-homelab skill: `references/network.md` (new tunnel),
      `references/hosts-detail.md` (pideck agents; DS920 is DSM 7.4.1, not 7.3).
- [ ] Release 2.7.0 (tag, GitHub release), memory notes.

## Rollback (per host, any time)
1. Hub: remove the host from `.env` (installer keeps `.env.bak.*`), restart.
2. VPS: `scripts/uninstall.sh` (agent + its ufw rule), `systemctl disable --now
   wg-quick@wg-pideck`, remove `/etc/wireguard/wg-pideck.conf` (ask first),
   delete the `51821/udp` ufw rule.
3. Hub: drop the peer / disable `wg-quick@wg-pideck` when no VPS is left.

## Risks
- **piapps3 memory** (~640 MB free): stop if the agent would push RELAY into
  swap/OOM; `MemoryMax` as a hard cap.
- **piapps4 `wg0`** (brixhouse): separate interface, separate port, separate
  subnet; verify before/after.
- **hwca-ap02**: ownership (decision 1) and 1 GB RAM.
- First x86_64 run of `install.sh --agent` (dry run first on each host).
- Provider firewalls silently dropping 51821/udp (step 0).
