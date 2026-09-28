# Changelog

All notable changes to PiDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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