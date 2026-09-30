# PiDeck 2.8.0 — Services (systemd) on every host

Status: plan, 2026-09-30. Build in a Claude Code **cloud** session on branch
`feat/2.8.0-services` from `main` (v2.7.1 + docs `beaaca1`). Rollout
(per-host config, deploy, release) is done afterwards from the CLI.

## Goal

The Apps tab shows what actually runs each machine. Today it knows only
Docker and pm2. The three cloud VPSes have neither, so their Apps tab is
empty. On the LAN hosts the services that matter most (nginx, PostgreSQL,
pm2 itself, WireGuard, OpenClaw, Syncthing) aren't shown either.

2.8.0 adds a **read-only Services view for systemd units on all hosts**:
the hub (piapps), the LAN agents (piapps2, DS920+) and the WireGuard agents
(piapps3, piapps4, hwca-ap02). It covers a curated list per host plus any
failed unit, shows them in the "All hosts" overview, and raises an alert when
a listed service goes down.

Out of scope: start/stop/restart (remote actions stay a later, opt-in phase),
timers/cron, editing unit files.

## Where we are (read-only recon, 2026-09-30)

| Host | systemd | Notable units (running) | User units (zk, linger) | Failed |
|---|---|---|---|---|
| piapps (hub) | 259 | nginx, docker, containerd, pm2-zk, postgresql@18-main, mysql, redis-server, fail2ban, ssh, filebeat, probplots-web, piapps2-static-sshfs, smartmontools, wg-quick@wg-pideck | none (linger yes) | – |
| piapps2 | 259 | pideck-agent, docker, postgresql@18-main, ssh, net-watchdog, filebeat, smartmontools, netplan-wpa-wlan0 | openclaw-gateway, syncthing, ssh-agent | – |
| piapps3 | 255 | pideck-agent, nginx, fail2ban, ssh, wg-quick@wg-pideck, do-agent, droplet-agent, vnstat | openclaw-gateway, syncthing | – |
| piapps4 | 259 | pideck-agent, fail2ban, ssh, wg-quick@wg-pideck, wg-quick@wg0 (brixhouse), vnstat | openclaw-gateway, syncthing, **piapps4-mail-listener: enabled but inactive (dead) for 10 h** | – |
| hwca-ap02 | 255 | pideck-agent, nginx, fail2ban, ssh, wg-quick@wg-pideck | none (no linger) | – |
| DS920+ (DSM 7.4.1) | **219** | nginx, sshd, pkg-ContainerManager-dockerd, pkg-synosamba-smbd, synostoraged, synocrond, synoscgi | n/a | **pkgctl-HyperBackup-ED** |

The recon itself found two real problems (the piapps4 mail listener, and
HyperBackup on the DS920). That's the case for this feature.

Facts that shape the code:
- All agents run as **zk** (systemd `User=zk`; on DSM the supervisor as
  zk). `systemctl show` / `list-units` need no privileges.
- **User units**: `systemctl --user` from a system service needs
  `XDG_RUNTIME_DIR=/run/user/<uid>` (and `DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus`)
  in the child env; that works only while the user manager runs (linger).
  Remote journal user units already work (`journalctl --user-unit`), but that's a different path.
- **systemd 219 on DSM**: no `--output=json`, no `NRestarts` (v235+),
  no `--timestamp=`. `systemctl show -p … <units…>` works on all versions.
  Use `ActiveEnterTimestampMonotonic` / `StateChangeTimestampMonotonic` (µs since
  boot) + `/proc/uptime` for "since" (no locale/TZ parsing). The order of
  properties in `show` output varies by version: parse key=value, never by position.
- Oneshot units with `RemainAfterExit` (wg-quick@…) are healthy as
  `active (exited)`.
- Alerts: `alerts.type` is free text with one open alert per (host, type):
  `service:<unit>` fits **without a migration**.
- Agent GET allowlist: `server/agent-api.ts` `AGENT_PATHS`; capabilities
  in `server/agent.ts`; Apps tab `client/src/components/app-monitor.tsx`;
  remote tabs gated in `client/src/components/app-shell.tsx`.
- Unit-name validation already exists for journal units
  (`UNIT_RE` in `server/services/agent-logs/sources.ts`, `user:` prefix):
  reuse it, don't fork it.

## Design

### Config (same on hub and agent)

| Key | Default | Purpose |
|---|---|---|
| `PIDECK_SERVICES` | – | Comma-separated units to watch, `user:<unit>` for user units. Optional label: `Label=unit` (same `[id:]Label=` spirit as log entries is fine, but keep it simple). Invalid names are skipped with a `[config]` warning. |
| `PIDECK_SERVICES_FAILED` | `on` | Also list every unit in `failed` state (system manager, and the user manager when user units are configured), even unlisted ones. |
| `PIDECK_SERVICE_ALERT_MINUTES` | `3` | A **listed** unit not active this long raises an alert. |

The feature is always available on 2.8+ (it's read-only and needs no
privileges), so there's no on/off switch. With `PIDECK_SERVICES` unset, the
view shows only failed units and a hint on how to add some.

### Collection (`server/services/systemd.ts`, shared by hub + agent)

- `execFile("systemctl", ["show", "--no-pager", "-p", PROPS, "--", ...units])`,
  **one call for all system units**, one for all user units (with `--user` and
  the env above). No shell. Fixed argv. Units come only from config (validated)
  or from `list-units --state=failed --plain --no-legend` output (validated
  again with `UNIT_RE` before use). Timeout ~3 s, maxBuffer small.
- Properties: `Id, Description, LoadState, ActiveState, SubState, UnitFileState, Type, Result, MainPID, NRestarts, MemoryCurrent, ActiveEnterTimestampMonotonic, StateChangeTimestampMonotonic`.
  Treat missing/`[not set]`/`18446744073709551615` as null.
- Health: `ok` = active (any sub-state incl. `exited`); `warn` =
  activating/reloading/deactivating or inactive; `fail` = failed or
  `LoadState=not-found`. Show not-found as "unit not found" (a config typo
  or a missing package), not as a crash.
- Cache ~10 s per process (the UI polls; the sampler also asks).
- `hasTool("systemctl")` false → the feature reports "systemd not available"
  (a future non-systemd host), nothing else.

### API

- Hub local: `GET /api/services` → `{ services: Service[], failedOnly: Service[], warnings: string[], systemd: "259" }`.
- Agent: the same route, added to `AGENT_PATHS`; `capabilities.services: true`.
  The hub proxies it like the others (`/api/hosts/:id/api/services`).
  An old agent (2.7) without the capability → the UI says "update the agent".
- Sampler: add a compact `services: [{unit, user, health}]` to
  `/api/agent/sample` (and the local sample) so alerts need no extra request.
  An agent that doesn't send it = no service alerts for that host, no error.

### Alerts

- Type `service:<unit>` (user units: `service:user:<unit>`), severity
  `critical` for failed/not-found and `warning` for inactive. Open after
  `PIDECK_SERVICE_ALERT_MINUTES` of consecutive non-ok samples; resolve
  on the first ok sample. Only **listed** units alert. Unlisted failed units
  show in the UI and overview but don't page (avoids alert spam from DSM
  package units).
- Toast like the other alerts: "piapps4: piapps4-mail-listener (user) is inactive since 16:26".
- Offline host → no service alerts for it (offline already covers it).

### UI

- **Apps tab**: a new **Services** card first, as a compact table: status dot,
  name (+ "user" badge), description, sub-state, since (relative), restarts,
  memory. Failed/not-found sort to the top. Filter box. If a journal log
  source exists for the unit on that host (`journal_<slug>` /
  `journal_user_<slug>`), a "Logs" link opens it in the Logs tab.
- The Docker and pm2 cards collapse into a one-line "No Docker on this host" /
  "No pm2 on this host" when absent, instead of empty cards (the VPSes).
- **All hosts overview**: per host a services chip "14/14 ok" or
  "1 failed: pkgctl-HyperBackup-ED" (warn/fail colours = existing tokens);
  a click opens that host's Apps tab.
- Mobile width, dark/light, and keyboard use as in the rest of the app.
  Lazy-load if it grows the eager bundle noticeably (report the gzip number).

## Security

- Read-only: only `systemctl show` and `systemctl list-units --state=failed`.
  Never `start|stop|restart|enable|kill|set-property|edit`. Add a test that
  asserts the exact argv shapes (like the Docker gate in 2.6).
- Unit names: `UNIT_RE`, no leading `-`, and `--` before names in argv.
- No new sudoers, no new groups, no D-Bus writes. `Description` is
  admin-authored but still rendered as text only (no HTML).
- The agent path goes through the existing token auth, allowlist and
  failure limiter. No query parameters.

## Tests

- Unit: `show` parser (both property orders, systemd 219 without
  NRestarts, `[not set]`, max-uint64 memory, multiple units in one output,
  missing unit → not-found), health mapping incl. `active (exited)`,
  config parser (`user:`, labels, invalid names, duplicates), argv shapes,
  user-unit env, cache, the "since" calculation from monotonic + uptime.
- Alerts: open after N minutes, resolve, unlisted failed doesn't alert,
  offline host suppresses, old agent without `services` in sample.
- Hub proxy: allowlist includes `/api/services`; 2.7 agent (no capability) handled.
- E2E: the Services card on local and on a harness agent (fake `systemctl`
  on PATH in the harness, like other fakes), the overview chip, the Logs link,
  and the collapsed Docker/pm2 cards.
- Keep: tsc, unit, installer suite, shellcheck, `npm audit` 0, E2E green.

## Rollout (CLI, after review: not the cloud session)

1. Review the branch on a piapps worktree; run the whole suite.
2. Deploy: piapps2 agent `--update`, DS920 bundle procedure, piapps3/
   piapps4/hwca-ap02 prebuilt bundle (hwca-ap02: `--memory-max 160M`!),
   hub last (`install.sh --update`).
3. Per-host `PIDECK_SERVICES` (proposal; operator confirms):
   - piapps: `nginx,docker,pm2-zk,postgresql@18-main,mysql,redis-server,fail2ban,ssh,filebeat,probplots-web,piapps2-static-sshfs,smartmontools,wg-quick@wg-pideck`
   - piapps2: `pideck-agent,docker,postgresql@18-main,ssh,net-watchdog,filebeat,smartmontools,user:openclaw-gateway,user:syncthing`
   - piapps3: `pideck-agent,nginx,fail2ban,ssh,wg-quick@wg-pideck,do-agent,vnstat,user:openclaw-gateway,user:syncthing`
   - piapps4: `pideck-agent,fail2ban,ssh,wg-quick@wg-pideck,wg-quick@wg0,vnstat,user:openclaw-gateway,user:syncthing,user:piapps4-mail-listener`
   - hwca-ap02: `pideck-agent,nginx,fail2ban,ssh,wg-quick@wg-pideck`
   - DS920: `nginx,sshd,pkg-ContainerManager-dockerd,pkg-synosamba-smbd,synostoraged,synocrond`
4. Verify: the two known problems show up (piapps4 mail listener, DS920
   HyperBackup), then an alert test (stop a harmless listed unit, e.g.
   `vnstat` on piapps4, for > 3 min: alert, then resolve).
5. Version bump, CHANGELOG, README, INSTALL.md section, tag v2.8.0, GH release.

## Open questions (operator)

1. Should unlisted failed units also alert (warning), or only show? Plan: only show.
2. Should DS920's `pkgctl-*` package units be in the list? Plan: no, only the core
   ones above; failed ones show anyway.
3. Fix the piapps4 mail listener and DS920 HyperBackup now, or leave them
   as live test cases for 2.8.0? Plan: leave them until the rollout check, then fix.

## Brief for the cloud session (paste with this file)
> Implement `docs/plans/services-2.8.0.md` on branch `feat/2.8.0-services`
> from `main` (v2.7.1). Read-only systemd services for the hub and every
> agent: `server/services/systemd.ts`, `GET /api/services` (hub + agent
> allowlist + `capabilities.services`), compact services in the sample,
> `service:<unit>` alerts (listed units only, no DB migration), the Services
> card in the Apps tab, collapsed Docker/pm2 cards, and the overview chip.
> It must work on systemd 219 (DSM) through 259. Only `systemctl show` and
> `list-units --state=failed`, execFile, fixed argv (tested). Follow the
> repo's conventions and CLAUDE.md. Push the branch; don't merge, tag, bump
> the version or deploy. Report: commits, new env vars, test counts
> before/after, eager bundle gzip before/after, agent RSS on a real run if
> possible, deviations from the plan, open questions, and manual rollout
> steps in order.
