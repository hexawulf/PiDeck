# PiDeck 2.7.0 — cloud hosts over WireGuard (done)

Status: **done** 2026-09-29 (released as v2.7.0). Owner: 0xWulf.
Ops runbook: Obsidian `2026-09-29-pideck-wireguard-agents-runbook.md`.
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
1. ~~hwca-ap02 ownership~~ **Decided 2026-09-29: hwca-ap02 is in.** The
   operator is its server admin; the box belongs to HWCA studio (hwca.de).
   It stays a production web host, so: agent memory-capped, nothing that
   touches nginx/fail2ban, rollout last and only after piapps4/piapps3 went
   cleanly. (The homelab skill's "colleague-billed, read/ops only" wording
   is outdated for this purpose; correct it in step 5.)
2. **Logs for cloud hosts:** not in 2.7.0 — metrics, history and alerts only;
   remote logs opt-in per host later (TODOS.md).
3. ~~51821/udp open to any address?~~ **Decided 2026-09-30: pinned.** The
   Taipei WAN IP is a static Chunghwa Telecom address, `122.116.150.249`:
   VPS ufw (and any provider firewall) allows `51821/udp` from it only.
4. piapps2 and the DS920+ stay on the LAN (decided 2026-09-29).

## Facts (read-only recon 2026-09-29)
| Host | Facts |
|---|---|
| piapps (hub) | arm64, Ubuntu 26.04.1, Node 22, 16 GB. **No `wireguard-tools`, no wg interface.** Behind the ASUS NAT with a dynamic WAN IP → it dials out. Docker nets 172.17–172.20 |
| piapps3 | DO SGP1 `139.59.253.127`, **x86_64, Ubuntu 24.04.5**, Node 24, 2 GB with **~640 MB available** (RELAY 小信使, sole Mastodon poster). ufw 22/80/443. zk in `sudo`, `users` only. DO nets `10.104.0.0/20`, `10.15.0.0/16` |
| piapps4 | Hetzner FSN1 `167.233.201.18`, x86_64, Ubuntu 26.04.1, Node 24, 4 GB (2.1 GB avail). **`wg0` = brixhouse tunnel `192.168.178.202/24` — must stay untouched** (BUILD/GUARDIAN monitors depend on it). ufw 22 only |
| hwca-ap02 | Linode Osaka `172.233.75.18`, x86_64, Ubuntu 24.04.5, Node 22, **961 MB (622 avail)**, nginx + fail2ban (hwca.de, HWCA studio). No wg. ufw 22/80/443. In scope (decision 1), production web host |
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
### 0. Prep (read-only) — done
- [x] Decisions 1–3 above.
- [x] Cloud-provider firewalls: none blocked 51821/udp (first handshake worked on DO, Hetzner, Linode).
- [x] Snapshot: `~/backups/pideck-2.7.0-pre-20260929/` on piapps2; piapps4 `wg0` checked before/after.

### 1. Code (small, on a branch, CLI) — done on `feat/2.7.0`
- [x] `install.sh --agent --after <unit>`: drop-in
      `pideck-agent.service.d/10-install.conf` (`After=` + `Wants=`), kept by
      re-runs and `--update`, removed by uninstall; the installer refuses a
      bind address the host doesn't have (dry run: warning).
- [x] `install.sh --agent --memory-max <size>` → `MemoryMax=` in the same
      drop-in (K/M/G, ≥ 96M).
- [x] `--ufw-interface wg-pideck` → `ufw allow in on wg-pideck from 10.77.0.1 …`
      (recorded; uninstall deletes exactly that rule).
- [x] Installer harness: flags, validation, x86_64 + unknown-arch preflight.
- [x] docs/INSTALL.md: "Agents over WireGuard (2.7)".
- [x] `--prebuilt` (added during the rollout: `npm ci`/build peak ~650 MB, measured on piapps4).
- [x] Release notes / version 2.7.0 (after the rollout).

### 2. Hub (piapps) — done
- [x] `wireguard-tools` with `NEEDRESTART_MODE=l` (containerd restart deferred, not done).
- [x] Key pair, `wg-pideck.conf`; peers added one by one with `systemctl reload` (`wg syncconf`).
- [x] `wg-quick@wg-pideck` enabled; no inbound ufw rule.

### 3. Per VPS — done (piapps4, piapps3, hwca-ap02 in that order)
- [x] `wireguard-tools`; key pair; `wg-pideck.conf`; ufw `51821/udp` from `122.116.150.249` only.
- [x] `wg-quick@wg-pideck` up + enabled; ping both ways (piapps4 ~257 ms, piapps3 ~60, hwca-ap02 ~64).
- [x] piapps4: `wg0` unchanged (config checksum, port, handshake, brixhouse ping).
- [x] Agents on `10.77.0.x:5016`, `--after`, `--memory-max` (piapps4 160M built locally;
      piapps3 + hwca-ap02 128M from a `--prebuilt` bundle); ufw on `wg-pideck` from `10.77.0.1`.
- [x] Public side and piapps2: 5016 unreachable.
- [x] Memory: RSS 73–79 MB; available piapps3 747 → 705 MB, hwca-ap02 617 → 580 MB, no swap churn;
      hwca.de 200 before/after.

### 4. Hub registration + verification — done
- [x] `--add-host` piapps4, piapps3, hwca-ap02 (tokens via 0600 files, shredded); sampler "local + 5 agents".
- [x] Overview shows all hosts (operator checked); history rows per host; VPS temperature: none.
- [x] Offline test (piapps4): alert after ~5.6 min, resolved ~30 s after the tunnel returned; the agent
      needed no restart.
- [x] Reboot test (piapps4): tunnel + agent back in ~20 s, `wg0` fine, no alert.

### 5. Docs + release
- [x] Obsidian runbook `2026-09-29-pideck-wireguard-agents-runbook.md`.
- [x] hexawulf-homelab skill v3.3 (clawdops/hexawulf-homelab c8f0783): `references/network.md` (new tunnel),
      `references/hosts-detail.md` (pideck agents; DS920 is DSM 7.4.1, not 7.3;
      hwca-ap02: operator is the admin, owner HWCA studio — replace the
      "colleague-billed, read/ops only" wording with what's actually allowed).
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
- **hwca-ap02**: production site (hwca.de) with 1 GB RAM: memory cap, rollout last, verify the site before/after.
- First x86_64 run of `install.sh --agent` (dry run first on each host).
- Provider firewalls silently dropping 51821/udp (step 0).
