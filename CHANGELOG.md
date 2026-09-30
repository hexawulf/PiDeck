# Changelog

All notable changes to PiDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Favicon: dashboard tiles on a teal rounded square (inline SVG, same style as PiTasker's).
- Logo tile (header and login) uses the favicon's teal via a new `--pi-brand` token (`#0d9488`, both themes); buttons keep `--pi-accent` blue.

## [2.8.0] - 2026-09-30

Services (plan: [docs/plans/services-2.8.0.md](./docs/plans/services-2.8.0.md)): what actually runs each machine, on every host. The Apps tab knew only Docker and pm2, so the cloud VPSes (neither) showed nothing, and nginx, PostgreSQL, WireGuard, OpenClaw or Syncthing weren't shown anywhere.

### Added
- **Services card** first in the Apps tab of every host (hub and agents): the units in `PIDECK_SERVICES` (`user:<unit>` for user units, `Label=<unit>`), plus every failed unit (`PIDECK_SERVICES_FAILED`, on). Status, sub-state, since, restarts, memory; failed and not-found first; a Logs link when the agent has that unit's journal source
- **Service alerts**: a listed unit down for `PIDECK_SERVICE_ALERT_MINUTES` (3) raises `service:<unit>` (critical when failed/not found, warning when inactive) with a toast, resolved on the next good sample. Unlisted failed units show but never alert. No migration
- **"All hosts" overview chip** per host ("9/9 ok", "1 failed: …") that opens its Apps tab
- `GET /api/services` on the hub and every agent (`capabilities.services`); a compact form rides in the sample. Agents older than 2.8 say "update the agent"

### Changed
- Docker and pm2 cards collapse to one line on a host without them
- Journal log units and services share one unit-name rule (`server/services/unit-name.ts`)

### Security
- Read-only by design: only `systemctl show` and `systemctl list-units --state=failed` (plus `show -p Version`), via execFile with fixed argv behind a tested gate (17 refused shapes incl. start/stop/restart/enable/kill/set-property/edit); no shell, no sudo, no new groups. User units use the agent user's own manager (`XDG_RUNTIME_DIR`/`DBUS_SESSION_BUS_ADDRESS`, needs lingering)

### Verified (2026-09-30)
- Real systemd 259 (piapps, piapps2, piapps4), 255 (piapps3, hwca-ap02) and 219 (Synology DSM: no restarts/memory, shown as "—"); user units from a system service; alias `sshd` → `ssh.service`; a typo shows "not found"
- Alert cycle live: `vnstat` stopped on piapps4 → alert after ~3.9 min, resolved 43 s after restart
- Tests: unit 549 → 603 (21 need Postgres), E2E 123 → 128; eager JS +587 B gzip (the card is a 2.7 kB lazy chunk). Agent RSS 80–98 MB

## [2.7.1] - 2026-09-30

Remote logs for the cloud hosts. No change to the hub or agent code; the agents on piapps3, piapps4 and hwca-ap02 were configured through their `.env`, and the docs describe how.

### Added
- **Remote logs on the WireGuard agents**: syslog, auth, ufw and fail2ban on all three, nginx access/error where nginx runs, a few `~/logs` files, and journald units incl. user units (`user:openclaw-gateway`, `user:syncthing`, `user:piapps4-mail-listener`). The agent user joins `adm` for the `/var/log` files and the system journal
- [docs/INSTALL.md › Remote logs](./docs/INSTALL.md): an Ubuntu VPS example, and notes that an agent serves only the files listed in its `PIDECK_HOST_LOGS` (the hub's default nginx entries don't apply there) and how to raise `--memory-max` on a host already installed

### Changed
- hwca-ap02's agent memory cap 128M → 160M (it idled at ~84 MB); peak with logs read: 62–76 MB on the three VPSes

## [2.7.0] - 2026-09-29

Cloud hosts over WireGuard (plan: [docs/plans/multi-host-2.7.0.md](./docs/plans/multi-host-2.7.0.md)): machines outside the LAN join as agents through a dedicated tunnel, so their agent port never faces the internet. No change to the hub or agent code; everything is in the installer and the docs.

### Added
- **Agents over WireGuard** ([docs/INSTALL.md › Agents over WireGuard (2.7)](./docs/INSTALL.md)): a separate `wg-pideck` interface, the VPS listens and the hub dials out, /32 `AllowedIPs` only; the agent binds to its tunnel address
- `install.sh --agent --after <unit>`: start the agent after (and pull in) e.g. `wg-quick@wg-pideck`; `--memory-max <size>`: hard memory cap (`MemoryMax=`, at least 96M). Both live in a systemd drop-in (`pideck-agent.service.d/10-install.conf`) that re-runs and `--update` keep and uninstall removes
- `--ufw-interface <iface>` with `--ufw-allow-from`: the agent rule only on the tunnel (`ufw allow in on wg-pideck from 10.77.0.1 …`); uninstall deletes exactly that rule
- `--prebuilt`: install an agent from a bundle (`dist/` + runtime `node_modules/`) built on another machine from the same commit, for small VPSes where `npm ci` and the build (~650 MB peak each) would crowd out the host's real job; `--update` is refused on such hosts (update = pull, new bundle, re-run)

### Changed
- The agent installer refuses a bind address the machine doesn't have (a dry run warns), and preflight warns on an architecture other than aarch64/x86_64. First x86_64 agent installs (Ubuntu 24.04 and 26.04, Node 22 and 24)
- Tests: installer 151 → 188

## [2.6.1] - 2026-09-29

Small follow-ups from the 2.6.0 rollout.

### Added
- **Download the viewed log**: a download button left of the pin in the Logs viewer (local and remote) saves exactly the lines on screen — remote ones already filtered and redacted by the agent — as `<host>-<source>-YYYYMMDD-HHMM.log`, in the browser (no new endpoint). Replaces the local viewer's unlabelled download button
- `PIDECK_HOST_TIMEOUT_<ID>` (1–9 s, default 5): more time for one slow host (e.g. a NAS during a media library scan), for its samples and proxied requests; the sampler's "skipped" line names each host's timeout

### Fixed
- Remote-log audit lines: logged when a (host, source, user, ip) is first read, then at most every 10 minutes with `polls=N`; errors always (an open log used to write a line per poll)
- The header stays on one line with the host switcher at 1024–1440 px: no "Raspberry Pi Admin" subtitle when several hosts are configured, compact uptime ("Up 5d 23h", full text as tooltip, from 1280 px)
- `npm run build` no longer deletes the running server's lazily loaded chunks: esbuild writes a metafile and `scripts/prune-dist.mjs` keeps the current and the previous build's chunks
- `install.sh --update` continues with the pulled installer when the pull changed it (one re-exec, same log, no second backup or pull), so installer fixes apply in the same run
- Tests: unit 533 → 549, installer 145 → 151, E2E 121 → 123

## [2.6.0] - 2026-09-29

Multi-host, phase H3 (plan: [docs/plans/multi-host-h3.md](./docs/plans/multi-host-h3.md)): logs from the machines at home, and the DS920+ as a host. LAN only; WireGuard and the cloud VPSes come in a later phase.

### Added
- **Remote logs** (read-only, opt-in per agent with `PIDECK_AGENT_LOGS=on`): the agent's `PIDECK_HOST_LOGS` files (now with `%Y`/`%m`/`%d` and newest-match `*` in file names), journald units (`PIDECK_AGENT_JOURNAL_UNITS`, `user:<unit>` for user units) and every Docker container (`PIDECK_AGENT_DOCKER_LOGS=on`). The hub's Logs tab shows them for any host whose agent offers logs; filters and pins per host; unreadable sources are listed with a hint
- **Redaction on the agent**, always on, before anything leaves the host and before filtering: Authorization headers, Bearer tokens, password/token/secret/api-key values (incl. JSON), and `user:password@` in URLs; redacted spans are highlighted
- **Docker logs** through the Engine API on the unix socket with exactly two allowed read-only calls (list containers, tail logs by id); every other request is refused before it is sent. No new dependency, no docker CLI
- The hub proxies logs with validated parameters (up to 2,000 lines / 1 MB) and writes an audit line per remote read
- **Synology DSM / x86**: CPU temperature from hwmon (coretemp, k10temp, …), DSM detection ("DSM 7.4.1"), "Not available on DSM" for NVMe/SMART, firewall, power and apt update, `PIDECK_DISK_MOUNT` for the disk tile (`/volume1` on a NAS), `deploy/dsm/start-agent.sh` and a "Synology DSM" section in the install guide
- History: 3-day and 7-day chart ranges when `PIDECK_HISTORY_HOURS` keeps them (averaged into 5- and 15-minute buckets)
- Installer: `--update` records the built commit in `dist/.build-commit` and prints it as the rollback target; `--check-login` (or `PIDECK_CHECK_LOGIN_FILE`) tests the login when the admin password was changed in the UI
- Tests: unit 397 → 533, installer 129 → 145, E2E 117 → 121 (remote logs against a real test agent and a fake Docker socket)

### Fixed
- Installer and uninstaller prompts were invisible (written to a silenced stderr); they now go to the terminal

### Upgrading
- Update agents first, then the hub (`./scripts/install.sh --update`; no database migration in this release). To turn on logs for an agent, add `PIDECK_AGENT_LOGS=on` and its sources to the agent's `.env` and restart it. On a Synology NAS follow "Synology DSM" in docs/INSTALL.md (the agent user needs the `docker` group for Docker logs and the `log` group for `/var/log/messages`)

## [2.5.0] - 2026-09-29

Multi-host, phase H2 (plan: [docs/plans/multi-host-h2.md](./docs/plans/multi-host-h2.md)). Every machine now gets what the hub already had: history charts, alerts, and data recorded even when no tab is open.

### Added
- **Schema migrations**: `migrations/` (drizzle-kit) applied by `npm run db:migrate` under an advisory lock, one transaction per migration. A database from 2.x is recognised and its baseline (`0000`) is only *recorded*, never run; `user_sessions` is never touched by any migration
- `install.sh`: fresh installs use `db:migrate` instead of `drizzle-kit push`; `--update` takes a `pg_dump -Fc` to `~/backups/` (`--no-db-backup` / `PIDECK_NO_DB_BACKUP` to skip), migrates before the restart, and on failure keeps the running build and prints the restore command. The hub serves with a "Database needs migrating" banner instead of crash-looping when migrations are pending
- **Per-host history**: the hub samples every host each minute in parallel (5 s per host, 10 s per tick); agents expose raw counters at `GET /api/agent/sample` (`capabilities.sample`) and the hub computes true one-minute averages, dropping intervals across counter resets. Retention `PIDECK_HISTORY_HOURS` (default 24, 1–168)
- **Per-host alerts** stored in a new `alerts` table (they survive a hub restart): temperature for every host, plus **offline** after `PIDECK_OFFLINE_ALERT_MINUTES` (default 5). Toasts name the host. An old agent or a wrong token is not "offline"
- **All hosts overview** `/hosts`: one tile per machine (status, CPU, temperature, RAM, disk, open alerts, last seen), click through to its dashboard; linked from the host switcher and the palette
- APIs: `GET /api/history?host=&range=`, `GET /api/alerts?host=<id|all>`, `GET /api/overview`; `/api/system/history` and `/api/system/alerts` stay as local aliases
- Tests: unit 336 → 397 (21 on a real Postgres with the prod time zone, `PIDECK_TEST_PG_URL`), installer 124 → 129, E2E 112 → 117

### Changed
- `historical_metrics` gains `host_id` (existing rows become `local`) and an index on `(host_id, timestamp DESC)`; timestamps are always written as UTC by the app (the column's database default is dropped)
- Remote dashboards show history charts and alerts; agents older than 2.5 show an amber "update the agent for history" state
- The old hand-written `migrations/0001_…sql` moved to `migrations/legacy/` (kept, never run); the redundant `idx_users_username` index is dropped

### Upgrading
- Update agents first (`git pull && ./scripts/install.sh --update --yes` on each), then the hub (`./scripts/install.sh --update`). The hub needs `pg_dump` of the server's major version

## [2.4.0] - 2026-09-28

Multi-host, phase H1 (plan: [docs/plans/multi-host.md](./docs/plans/multi-host.md)). One dashboard for several machines; guide: [Add another machine](./docs/INSTALL.md#add-another-machine-agent).

### Added
- **Agent mode** (`PIDECK_MODE=agent`): the same codebase as a read-only, JSON-only service with a fixed allowlist of metric endpoints. It needs a bearer token (only its SHA-256 is stored, compared in constant time), has no UI, no login, no database connection and no mutating routes, and binds to one address
- **Hub**: `PIDECK_HOSTS` registry, `GET /api/hosts` (status, version, last seen) and a read-only proxy `GET /api/hosts/:id/*`. The host comes from the registry only, the path must exactly match the allowlist, and forwarding uses the token only (no cookies), with a 5 s timeout, a 1 MB cap and JSON only. Failures show as calm offline/auth/bad-response states
- **Host switcher** in the header (status dots) and in the command palette, `g h` shortcut, `/h/:hostId/dashboard` and `/h/:hostId/apps` routes, per-host dashboard layout (prefs v2, v1 imports still work)
- `install.sh --agent` (token shown once, systemd `pideck-agent`, agent sudoers without apt-get, optional `--ufw-allow-from <hub-ip>`, `--rotate-token`), `install.sh --add-host` (tests the agent before writing `.env`), and agent support in `uninstall.sh` (removes only the ufw rule it added)
- Tests: unit 250 → 336, installer 69 → 124, E2E 100 → 112 (real local agents: online, wrong token, unreachable)

### Changed
- Server entry split into hub and agent with code splitting; the Postgres client, drizzle and the pm2 library load on first use (agent: about 84–92 MB RSS)
- Remote hosts show the live dashboard and a read-only Apps tab; history, Quick Actions, Logs, Cron and Settings stay the hub's own until H2
- `.env.bak.*` (installer backups, which contain secrets) are git-ignored

### Security
- An agent answers 401 before 404, so a caller without the token can't discover which paths exist. Wrong tokens are rate-limited per address; the correct token always passes and clears the count
- Tested live: piapps2's agent is reachable only from the hub (ufw), and other LAN hosts time out

## [2.3.0] - 2026-09-28

One-command install. Guide: [docs/INSTALL.md](./docs/INSTALL.md).

### Added
- `scripts/install.sh`: preflight table, `--dry-run` (changes nothing), PostgreSQL role/database, `.env` (only ever appended to, with a `.bak`), schema, admin password (prompted or generated; never left on `admin`), build, pm2 or systemd service, optional sudoers rule (`visudo`-checked), and a health check with a real login round-trip. Secrets never reach the terminal log. Idempotent re-runs
- `scripts/install.sh --update` (pull, rebuild, restart, health check, `dist` backup and a printed rollback command) and `scripts/uninstall.sh` (dry-run first)
- `deploy/`: systemd unit, sudoers and nginx templates; `ecosystem.config.cjs` works from any checkout path
- Configurable host: `PIDECK_HOST_LOGS` (extra log files, stable `id:` prefixes), `PIDECK_CORS_ORIGIN`, `PIDECK_NVME_DEVICE`, `PIDECK_INSECURE_HTTP` (plain-HTTP LAN mode with a visible warning), `PIDECK_CLOUDFLARE`
- Widgets for missing tools (vcgencmd, sensors, NVMe, ufw, pm2, docker) show "Not available on this host" instead of an error
- Installer test harness (70 checks, no root needed) and `npm run check:shell`; unit tests 214 → 250
- Tested for real on piapps2 (Ubuntu 26.04 arm64, systemd): install, update, uninstall, refused and confirmed purge

### Changed
- `docs/INSTALL.md` rewritten (Node 22, PostgreSQL required, no `curl | bash`); `DEPLOYMENT.md` is a pointer; README install section
- CORS is same-origin by default (no hard-coded origin)
- Privileged commands run as `sudo -n` with exact command lines
- `npm start` no longer forces `PORT=5006`; `.env` is the single source of settings

### Security
- NVMe metrics endpoint now requires login (was public)
- Login rate limit no longer trusts a client-supplied `CF-Connecting-IP` header (only with `PIDECK_CLOUDFLARE=1`)
- `TRUST_PROXY=false` now really disables proxy trust
- `uninstall --purge` only drops the database/role the installer created, always needs a typed confirmation, and keeps backups unless `--purge-backups`

### Fixed
- PiDeck no longer starts a pm2 daemon on hosts that don't use pm2 (Apps tab and installer)
- Installer/uninstaller now see the root-only `/etc/sudoers.d/pideck`

### Upgrading an existing install
- Settings formerly passed by pm2 (`PORT`, `CSP_ENFORCE`) must be in `.env`; re-create the pm2 app with `pm2 delete pideck && pm2 start ecosystem.config.cjs && pm2 save`
- Host-specific log files (e.g. PiTasker) move to `PIDECK_HOST_LOGS`; use `id:Label=/path` to keep existing pins

## [2.2.0] - 2026-09-28

Third and final phase of the 2.0 GUI refresh (plan: `docs/plans/2.0-gui.md`, tag `2.0-p3`).

### Added
- Command palette (Ctrl/⌘+K or the header button): navigate, toggle theme/density/Edit mode, pause/resume, refresh, open or search logs, Update System. Loaded lazily (3.5 KB gzip chunk)
- Keyboard shortcuts with a `?` help sheet: `t` theme, `g` then `d`/`l`/`a`/`c`/`s` to switch tabs, `e` edit layout, `p` pause, `r` refresh. Inactive while typing or when a dialog is open; nothing destructive has a shortcut
- Log pins and saved filters: pin a log with its current filter; pins appear at the top of the log picker and in the palette, survive reloads and export/import, and are greyed out when the file is gone. `/logs?log=…&grep=…` opens a log directly
- About › Diagnostics line (version, prefs version, visible widgets, refresh state, density, last prefs reset) with a copy button
- Unit tests 172 → 214, E2E 77 → 100

### Changed
- Update System (Quick Actions and palette) and Settings › Reset all now ask for confirmation in a shared, accessible dialog (focus starts on Cancel)
- Below `sm` the header shows the logo tile only, to fit the palette button at 390 px

### Security
- `PIDECK_DISABLE_SYSTEM_UPDATE=1` makes `POST /api/system/update` return 409 without running apt; the E2E server sets it because it shares the prod host

## [2.1.1] - 2026-09-28

### Security
- Production dependencies have no known vulnerabilities (`npm audit --omit=dev`: 11 → 0; all dependencies: 22 → 4, the rest dev-only in drizzle-kit's bundled esbuild)
- Updated: express 4.22.3, tsx 4.23.15, esbuild 0.28.2, plus `npm audit fix` (body-parser, ws, postcss, nanoid, ip-address, systeminformation, protobufjs, @grpc/grpc-js, vite 8.3)
- `overrides` for transitive fixes: js-yaml ^4.3.2 (pm2), qs ^6.16.0 (express), uuid ^11.1.1 (dockerode)

### Changed
- `@vitejs/plugin-react` 4 → 6 (Vite 8 support) and `@types/node` 20.16 → 22 (matches the Node 22 runtime): `npm install` / `npm ci` no longer need `--legacy-peer-deps`
- Remote repository cleaned up: 68 merged or abandoned branches removed

## [2.1.0] - 2026-09-28

Second phase of the 2.0 GUI refresh (plan: `docs/plans/2.0-gui.md`, tag `2.0-p2`).

### Added
- Customisable dashboard grid (react-grid-layout, loaded as its own lazy chunk): **Edit** mode with drag grip, resize corner, keyboard Move up / Move down / Hide buttons; Esc or Done leaves it
- Show/hide widgets and Reset layout from the Edit toolbar or Settings
- Density setting (Comfortable / Compact) via `data-density` theme tokens
- Refresh speed in the header (Live / Relaxed / Slow), Pause/Resume and an always-visible "Paused" badge; manual refresh still works while paused
- Settings › Dashboard card: density, refresh speed, widgets, Reset layout, Export / Import of preferences (validated, inline error), Reset all
- Preferences are saved per browser (`pideck:prefs:v1`), sync across tabs, and fall back safely on corrupt or blocked storage
- Unit tests 131 → 172, E2E 55 → 77 (layout, refresh, settings/density, axe serious/critical check)

### Changed
- Below the `md` breakpoint the dashboard is a plain column in saved order (no grid handles)
- Each card has a single scroll container (the card body), keyboard-focusable when it overflows
- Below `sm` the header hides the key icon to fit 390 px

### Fixed
- Logs category count badge contrast in dark mode (4.24:1 → 10.40:1)
- Phone-width header overflow from the new Pause button

## [2.0.1] - 2026-09-27

### Security
- Logs: grep patterns can no longer be read as grep options (`--help`, `-v`, `-f<file>` are searched as text); the grep process is stopped when a live stream closes
- Logs: regex filters are length-capped and nested quantifiers such as `(a+)+` are rejected, so a filter can no longer hang the server; invalid regexes return 400

### Changed
- Log filters are plain text by default; wrap a pattern in `/…/` for a regex (e.g. `/error|warn/`)
- History and temperature alerts come from a 60s server-side sampler instead of browser polls: charts have no gaps when no tab is open, alerts fire with nobody watching, and `/api/system/info` no longer writes to the database
- Disk and network rates in history are true one-minute averages
- Graceful shutdown on SIGTERM/SIGINT

## [2.0.0-p1] - 2026-09-27

First phase of the 2.0 GUI refresh (plan: `docs/plans/2.0-gui.md`, tag `2.0-p1`).
P2 (layout, density, refresh) and P3 (power-user features) follow.

### Added
- Routed tabs: `/dashboard`, `/logs`, `/apps`, `/cron`, `/settings` are real URLs, so deep links and the back button work
- Widget registry (`client/src/widgets/registry.tsx`) with a shared frame and a per-widget error boundary ("Widget failed – Retry")
- zod schemas for every widget endpoint; a malformed response only affects that card
- Separate CPU, Memory, Temperature, Network, System Information, Top Processes, Thermal Sensors and Power Status widgets
- Chart time-range picker (15m / 1h / 6h / 24h), downsampled to ≤300 points with visible gaps where no data was recorded
- `--pi-accent-text` theme token for accent-coloured text and icons (AA in light and dark)
- E2E specs for navigation, error resilience, phone width and a live endpoint contract check

### Changed
- One data hook per resource instead of `useSystemData`; each tab polls only its own data
- Cards use theme tokens only; `check-theme-tokens.sh` enforces it
- `/` goes to `/dashboard`; `/change-password` goes to `/settings`
- Listening Ports scrolls through all ports instead of stopping at 10
- Firewall badge uses an outline style for dark-mode contrast
- About shows the version from `package.json`

### Fixed
- Chart timestamps read as UTC (were 8 h off in Taipei)
- Opening `/logs` in a browser showed raw JSON
- Thermal-zones and power-status API routes were never registered (widgets got 404)

### Removed
- Stub "Thermal & Power" card, `*-row` wrappers, `system-overview`, `resource-graphs`, `process-list`, the 12 hand-written fetchers

## [1.0.0] - 2025-06-20

### Added
- Initial release of PiDeck Admin Dashboard
- Real-time system monitoring (CPU, memory, temperature, network)
- System information display (hostname, OS, kernel, architecture, uptime)
- Log file viewer with real-time updates and auto-refresh
- Docker container management (start, stop, restart, status monitoring)
- PM2 process management and monitoring
- Cron job scheduler with manual execution capability
- Dark theme optimized for server administration
- Session-based authentication with bcrypt password hashing
- Responsive design for desktop and mobile devices
- RESTful API with Express.js backend
- React frontend with TypeScript and TailwindCSS
- Real-time data updates without page reload
- Tab-based navigation interface

### Security
- bcrypt password hashing for admin authentication
- Session-based authentication with HTTP-only cookies
- HTTPS-ready configuration for production deployment
- Localhost/LAN access restriction by default

### Technical
- Node.js/Express.js backend with TypeScript
- React 18 frontend with Vite build system
- TailwindCSS for styling with Shadcn/ui components
- TanStack Query for server state management
- Wouter for client-side routing
- Drizzle ORM with PostgreSQL support
- In-memory storage for development
- Shell command integration for system operations

[1.0.0]: https://github.com/hexawulf/PiDeck/releases/tag/v1.0.0