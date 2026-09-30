# PiDeck - Raspberry Pi Admin Dashboard

A sleek, full-stack web application for monitoring and managing Raspberry Pi servers. Built with modern technologies, PiDeck provides a centralized control hub for system monitoring, service management, and log analysis.

**Current version: 2.8.0** — multi-host (LAN machines and cloud VPSes over WireGuard) with remote logs (files, journald, Docker; secrets redacted on the agent), read-only systemd services with alerts, per-host history and alerts, an "All hosts" overview and Synology DSM support, through small read-only agents, plus the one-command installer with schema migrations. See the [Changelog](./CHANGELOG.md) and the [2.0 plan](./docs/plans/2.0-gui.md).

![PiDeck 2.2 dashboard (light theme)](./docs/screenshots/dashboard.png)

## ✨ What's new in 2.0

- **Remote logs and Synology DSM** (2.6): read other machines' logs in the Logs tab (files, journald units, every Docker container), opt-in per agent and redacted before they leave the host; a DS920+ runs as an agent with Docker logs, CPU temperature and `/volume1` usage. See [Remote logs](./docs/INSTALL.md) and "Synology DSM" in the install guide
- **All hosts overview, per-host history and alerts** (2.5): `/hosts` shows one tile per machine; every machine gets 24 h history charts and temperature/offline alerts, recorded by the hub each minute. Updates apply database migrations automatically (`install.sh --update` takes a `pg_dump` first)
- **Multi-host** (2.4): switch between machines in the header; other machines run a small read-only agent (`install.sh --agent`) that only the hub can reach. See [Add another machine](./docs/INSTALL.md#add-another-machine-agent)
- **One-command install** (2.3): `./scripts/install.sh --dry-run`, then `./scripts/install.sh`
- **Customisable dashboard** (2.1): drag, resize, hide and reorder widgets in Edit mode (keyboard-accessible); layout is saved per browser
- **Density and refresh controls** (2.1): Comfortable / Compact, Live / Relaxed / Slow refresh, and Pause/Resume in the header
- **Portable preferences** (2.1): export, import and reset dashboard settings under Settings
- **Command palette** (2.2): Ctrl/⌘+K to jump anywhere, toggle settings, open logs or run actions
- **Keyboard shortcuts** (2.2): press `?` for the list
- **Log pins** (2.2): pin logs with their filters for one-click access
- **Safer actions** (2.2): Update System and Reset all ask for confirmation
- **Deep-linkable tabs**: `/dashboard`, `/logs`, `/apps`, `/cron` and `/settings` are real URLs; the back button works
- **Resilient widgets**: every card validates its data and has its own error boundary, so one failing endpoint never blanks the dashboard
- **Leaner polling**: each tab only fetches its own data
- **Better charts**: 15m / 1h / 6h / 24h ranges, clean axes, gaps where no data was recorded, correct time zones
- **Light, dark and system themes** built on accessible (WCAG AA) theme tokens
- **Thermal Sensors and Power Status** widgets backed by real endpoints

## 🚀 Features

### System Monitoring
- **Real-time Metrics**: CPU, memory, temperature and network, with history charts
- **Multi-host**: read-only agents on other machines; the hub records their history every minute, raises
  per-host alerts (temperature, offline) and shows them all on the **All hosts** page (`/hosts`)
- **System Information**: Hostname, OS details, kernel version, uptime, top processes
- **Hardware Health**: Thermal sensors, power status, NVMe health, disk and swap usage
- **Network Status**: IP configuration, listening ports and firewall status

### Service Management
- **Docker Containers**: View, start, stop, and restart containers
- **PM2 Processes**: Monitor and manage Node.js applications
- **System Services**: Control various system processes

### Log Management
- **Log Viewer**: Browse project logs (`PIDECK_LOGS_DIR`, default `~/logs`), pm2 and nginx logs, plus any files listed in `PIDECK_HOST_LOGS`
- **Log Pins & Saved Filters**: Pin logs with their filters; deep links like `/logs?log=…&grep=…`
- **Real-time Updates**: Auto-refresh log content every 5 seconds
- **Log Download**: Export log files for offline analysis

### Task Scheduling
- **Cron Jobs**: View scheduled tasks and their status
- **Manual Execution**: Run cron jobs on-demand
- **Schedule Analysis**: Human-readable cron schedule interpretation

### User Interface
- **Light / Dark / System Theme**: Follows your OS by default, no flash on load
- **Responsive Design**: Works on desktop and mobile devices (down to 390px)
- **Real-time Updates**: Live data refresh without page reload (Live / Relaxed / Slow, or paused)
- **Customisable Layout**: Drag, resize, hide and reorder widgets; Comfortable / Compact density
- **Command Palette & Shortcuts**: Ctrl/⌘+K and single-key shortcuts (see below)
- **Routed Tabs**: Bookmark or share any tab; the header stays put when switching

## 🛠️ Tech Stack

### Backend
- **Node.js** with Express.js framework
- **TypeScript** for type safety
- **bcrypt** for password hashing
- **express-session** for session management
- **Shell integration** via `child_process`

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development and building
- **TailwindCSS** for styling
- **Shadcn/ui** component library
- **TanStack Query** for server state management
- **zod** schemas validating every widget response
- **Recharts** for history charts
- **react-grid-layout** for the customisable dashboard (lazy-loaded)
- **Wouter** for client-side routing

### Database & Storage
- **PostgreSQL** with Drizzle ORM
- **Session-based authentication** (sessions stored in PostgreSQL)

### Testing
- **Vitest** for unit tests
- **Playwright** + axe for end-to-end, accessibility and API contract tests

## 🔧 Quick Start

### Install (Ubuntu / Debian, Raspberry Pi arm64 or amd64)

Needs Node.js 22 and a normal (non-root) user; the script offers PostgreSQL
and the optional tools via apt.

```bash
git clone https://github.com/hexawulf/PiDeck.git && cd PiDeck
./scripts/install.sh --dry-run   # shows every step, changes nothing
./scripts/install.sh             # installs; prints the URL and a one-time admin password
```

HTTPS via nginx/Caddy is the default; `--lan-http` allows plain HTTP on a
trusted LAN. Flags, sudoers, updates (`--update`), uninstall and
troubleshooting: **[docs/INSTALL.md](./docs/INSTALL.md)**.

### Development

```bash
npm ci
cp .env.example .env && nano .env   # DATABASE_URL, SESSION_SECRET
npm run db:migrate
npm run dev                         # http://localhost:5006, log in as admin / admin
```

### Running tests
```bash
npm run check          # TypeScript
npm test               # unit tests (Vitest)
npm run check:theme    # theme-token lint
npm run check:shell    # shellcheck (installer scripts)
npm run test:install   # installer tests (no root needed)
npx playwright install chromium
npm run test:e2e       # E2E on a separate build at :5017, never the prod dist/
```

## 📖 Usage

### Initial Login
- Installed with `scripts/install.sh`: the admin password it printed once (also in `~/.config/pideck/admin-password`, mode 0600)
- Installed by hand: `admin` (a banner reminds you to change it in **Settings**)
- Sessions last 24 hours

### Navigation
- **Dashboard** (`/dashboard`): System overview, history charts and quick actions
- **Logs** (`/logs`): View system and application logs
- **Apps** (`/apps`): Manage Docker containers and PM2 processes
- **Cron** (`/cron`): Monitor and execute scheduled tasks
- **Settings** (`/settings`): Change the admin password; dashboard density, refresh speed, widgets, export/import/reset of preferences

### Keyboard Shortcuts
| Keys | Action |
|---|---|
| Ctrl/⌘ + K | Command palette |
| `?` | Show all shortcuts |
| `t` | Toggle light / dark theme |
| `g` then `d` / `l` / `a` / `c` / `s` | Go to Dashboard / Logs / Apps / Cron / Settings |
| `e` | Edit layout / done (dashboard, wide screens) |
| `p` | Pause / resume auto-refresh |
| `r` | Refresh now |

Single-key shortcuts are ignored while typing or when a dialog is open.

### Security Features
- bcrypt password hashing
- Session-based authentication
- HTTPS-ready configuration
- Secure (HTTPS-only) session cookie in production; plain LAN HTTP only with `--lan-http`

## 🔐 Security Notes

- **Default Password**: It is crucial to change the default `admin` password immediately after the first login, especially in a production environment. This can be done via the user settings panel in the UI.
- **Environment Variables**: Sensitive configuration, such as the `DATABASE_URL` (for PostgreSQL connection) and `SESSION_SECRET` (for securing user sessions), must be managed using environment variables.
    - A `.env.example` file is provided as a template. Copy it to a `.env` file and populate it with your actual secrets.
    - The `.env` file is included in `.gitignore` and should never be committed to the repository.
- **Command Execution**: The application uses `child_process` to execute certain system commands for monitoring and management. This functionality has been reviewed to prevent command injection vulnerabilities (e.g., by validating inputs for PM2 process names and ensuring only predefined cron jobs can be executed).
- **Network Access**: By default, the application server binds to `0.0.0.0`, making it accessible on your local network. Configure firewall rules (e.g., `ufw`) to restrict access as needed, especially if the device is connected to a public network.
- **HTTPS**: For production deployments, always use a reverse proxy like NGINX or Caddy to enable HTTPS with valid SSL certificates. This encrypts traffic between clients and the server. See `deploy/nginx/pideck.conf.example` and [docs/INSTALL.md](./docs/INSTALL.md#https-recommended-or-plain-lan-http).
- **Session Security**: Sessions are configured to be HTTP-only (reducing XSS risk) and use `SameSite=Lax` cookies. Ensure your `SESSION_SECRET` is strong and unique. Sessions expire after 24 hours of inactivity.
- **Dependencies**: Regularly update dependencies (`npm update`) and audit them (`npm audit`) to patch known vulnerabilities. As of 2.1.1, `npm audit --omit=dev` reports no known vulnerabilities; ongoing vigilance is still required.

## 🚀 Production Deployment

`./scripts/install.sh` sets up the database, `.env`, the build and a pm2 or
systemd service, and health-checks the result. See
[docs/INSTALL.md](./docs/INSTALL.md) for HTTPS with nginx
(`deploy/nginx/pideck.conf.example`) or Caddy.

## 🔄 Live Demo

🌐 **[View Live Demo](https://pideck.piapps.dev)** *(pideck.piapps.dev)*

## 📚 Documentation

- [Installation Guide](./docs/INSTALL.md) - One-command install, HTTPS, sudoers, update/uninstall, troubleshooting
- [API Documentation](./docs/API.md) - Backend API reference
- [Contributing Guide](./CONTRIBUTING.md) - How to contribute
- [Changelog](./CHANGELOG.md) - Version history

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

### Development Setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and test thoroughly
4. Commit your changes: `git commit -m 'Add amazing feature'`
5. Push to the branch: `git push origin feature/amazing-feature`
6. Open a Pull Request

### Areas for Contribution
- Additional system metrics and monitoring
- Enhanced log parsing and filtering
- Mobile responsiveness improvements
- Multi-user authentication system
- Plugin system for custom integrations

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Shadcn/ui](https://ui.shadcn.com/) for beautiful components
- Icons by [Lucide React](https://lucide.dev/)
- Inspired by server administration tools like Cockpit and Uptime Kuma

## 📞 Support

- 📧 **Email**: [dev@0xwulf.dev](mailto:dev@0xwulf.dev)
- 🐛 **Issues**: [GitHub Issues](https://github.com/hexawulf/PiDeck/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/hexawulf/PiDeck/discussions)

---

**Made with ❤️ for the Raspberry Pi community by 0xWulf**
