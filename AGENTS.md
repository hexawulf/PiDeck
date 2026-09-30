# PiDeck Agent Instructions

## Project Snapshot
- **Type**: Single full-stack web application (not a monorepo)
- **Stack**: React 18 + Express + TypeScript + Vite + Drizzle ORM + PostgreSQL
- **Purpose**: Raspberry Pi system monitoring and management dashboard
- **Structure**: `/client` (React SPA), `/server` (Express API), `/shared` (types/schema)
- **Sub-packages**: See [client/AGENTS.md](client/AGENTS.md), [server/AGENTS.md](server/AGENTS.md), [shared/AGENTS.md](shared/AGENTS.md)

## Root Setup Commands
```bash
# Install all dependencies
npm install

# Development (runs both client and server)
npm run dev              # Server at http://localhost:5006
npm run dev:client       # Client only (Vite dev server)

# Build for production
npm run build            # Builds client + server bundle

# Type checking (REQUIRED before PR)
npm run check

# Installer (production install on a host): see docs/INSTALL.md
./scripts/install.sh --dry-run
npm run check:shell      # shellcheck scripts/*.sh tests/install/*.sh
npm run test:install     # installer tests, no root (PATH stubs)

# Database migrations (never `db:push` on a real install; see server/AGENTS.md)
npm run db:generate      # new migrations/NNNN_*.sql from shared/schema.ts
npm run db:migrate       # apply pending ones
# DB tests (*.db.test.ts) need an admin URL; skipped without it:
PIDECK_TEST_PG_URL=postgres://postgres@127.0.0.1:5432/postgres npx vitest run
```

## Universal Conventions

### Code Style
- **TypeScript strict mode** enabled (`tsconfig.json`)
- **No linter configured** - follow existing patterns in similar files
- **Prettier**: Not configured, maintain consistency with surrounding code
- **Imports**: Use path aliases `@/*` (client), `@shared/*` (shared types)

### Git & Commits
- **Commit format**: Conventional Commits recommended (feat:, fix:, chore:)
- **Branch strategy**: Work on feature branches, merge to `main`
- **PR requirements**: 
  - ✅ Must pass `npm run check`
  - ✅ Test manually with `npm run dev`
  - ✅ No secrets/credentials in commits

### Security & Secrets
- **NEVER commit**: `.env` files, API keys, passwords, session secrets
- **Environment variables**: Stored in `.env` (gitignored), loaded via `dotenv`
- **Session secret**: `SESSION_SECRET` env var (default: `CHANGE_ME_SESSION_SECRET_LONG_RANDOM`)
- **Admin password**: `PIDECK_PASSWORD` or `ADMIN_PASSWORD` or `APP_PASSWORD` env vars
- **Database**: `DATABASE_URL` for PostgreSQL connection
- **Update guard**: `PIDECK_DISABLE_SYSTEM_UPDATE=1` makes `POST /api/system/update` a 409 no-op (set for E2E)
- **Transport**: `PIDECK_INSECURE_HTTP=1` drops the cookie's `Secure` flag (LAN HTTP, `install.sh --lan-http`); `TRUST_PROXY` (default 1, `false` = no proxy); `PIDECK_CORS_ORIGIN` (default: no CORS); `COOKIE_DOMAIN` (default host-only)
- **Host logs**: `PIDECK_HOST_LOGS=[id:]Label=/abs/path,…` adds Logs-tab files (parsed in `server/config.ts`); no host paths are hard-coded
- **Multi-host**: `PIDECK_MODE=agent` runs the read-only agent (no DB, token auth, GET allowlist in `server/agent-api.ts`); the hub reads `PIDECK_HOSTS` / `PIDECK_HOST_TOKEN_<ID>` / `PIDECK_HOST_LABELS` / `PIDECK_HOST_TIMEOUT_<ID>` (1–9 s, default 5) and proxies `/api/hosts/:id/*`. Plan: `docs/plans/multi-host.md`
- **Every key** is documented in `.env.example`
- **Sampler**: `PIDECK_SAMPLER=off` disables the 60s history/alert sampler for every host (see [server/AGENTS.md](server/AGENTS.md)); it is also off when `NODE_ENV=test`. `PIDECK_HISTORY_HOURS` (24, 1–168) and `PIDECK_OFFLINE_ALERT_MINUTES` (5, 1–1440). Plan: `docs/plans/multi-host-h2.md`
- **Remote logs (2.6)**: agent-side, opt-in: `PIDECK_AGENT_LOGS=on`, sources from the agent's `PIDECK_HOST_LOGS` (`%Y/%m/%d`, newest-match glob), `PIDECK_AGENT_JOURNAL_UNITS`, `PIDECK_AGENT_DOCKER_LOGS=on` (+ `PIDECK_AGENT_DOCKER_SOCKET`); redacted on the agent. Plan: `docs/plans/multi-host-h3.md`
- **x86 / DSM**: `PIDECK_DISK_MOUNT` (default `/`) for the sampled disk usage; DSM detected from `/etc.defaults/VERSION` (`server/services/platform.ts`)
- **Agents over WireGuard (2.7)**: `install.sh --agent --after wg-quick@wg-pideck --memory-max 160M --ufw-interface wg-pideck` → drop-in `pideck-agent.service.d/10-install.conf` (never in the template, so `--update` keeps it). Plan: `docs/plans/multi-host-2.7.0.md`
- **Services (2.8)**: `PIDECK_SERVICES` (units, `user:<unit>`, `Label=<unit>`), `PIDECK_SERVICES_FAILED` (on), `PIDECK_SERVICE_ALERT_MINUTES` (3, hub); read-only systemd via `server/services/systemd.ts`. Plan: `docs/plans/services-2.8.0.md`
- **Installer checks**: `--check-login` (or `PIDECK_CHECK_LOGIN_FILE`) tests the login when the admin password was changed in the UI; rollback target = `dist/.build-commit`
- **Installer DB backup**: `install.sh --update` takes a `pg_dump -Fc` to `~/backups/` before migrating; `--no-db-backup` / `PIDECK_NO_DB_BACKUP=1` skips it

## JIT Index (what to open, not what to paste)

### Package Structure
- **React Frontend**: `client/` → [see client/AGENTS.md](client/AGENTS.md)
  - Components: `client/src/components/`
  - Widgets: `client/src/components/widgets/`
  - Pages: `client/src/pages/`
  - Hooks: `client/src/hooks/`
  
- **Express Backend**: `server/` → [see server/AGENTS.md](server/AGENTS.md)
  - API Routes: `server/routes/`
  - Middleware: `server/middleware/`
  - Entry: `server/index.ts`
  
- **Shared Types**: `shared/` → [see shared/AGENTS.md](shared/AGENTS.md)
  - Schema: `shared/schema.ts` (Drizzle tables + Zod + types)

### Quick Find Commands
```bash
# Find a component
rg -n "export.*function.*Box" client/src/components/widgets

# Find a route handler
rg -n "router\.(get|post)" server/routes

# Find type definitions
rg -n "export type" shared/schema.ts

# Find API endpoints
rg -n "/api/" server/routes

# Find TanStack Query hooks
rg -n "useQuery|useMutation" client/src/hooks
```

## Definition of Done
Before creating a PR, verify:
- [ ] `npm run check` passes (no TypeScript errors)
- [ ] Code follows patterns from similar files (see sub-AGENTS.md)
- [ ] No secrets/credentials in code or logs
- [ ] Tested locally with `npm run dev`
- [ ] API changes have corresponding type updates in `shared/schema.ts`
- [ ] Touched `scripts/*.sh` or `deploy/`? `npm run check:shell` and `npm run test:install` pass

## Architecture Overview
```
┌─────────────────────────────────────────────────────┐
│  Client (React SPA)                                 │
│  - TanStack Query for server state                 │
│  - Wouter for routing                              │
│  - Shadcn/ui components                            │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP + Session Cookies
┌──────────────────▼──────────────────────────────────┐
│  Server (Express)                                   │
│  - Session-based auth                              │
│  - Shell integration (child_process)               │
│  - Docker API (dockerode)                          │
└──────────────────┬──────────────────────────────────┘
                   │ Drizzle ORM
┌──────────────────▼──────────────────────────────────┐
│  PostgreSQL Database                                │
│  - Users, sessions, historical_metrics             │
└─────────────────────────────────────────────────────┘
```

## Common Gotchas
- **Session cookies**: Require `credentials: 'include'` on all fetch calls
- **API paths**: Must start with `/api/` (enforced by routing logic)
- **Theme**: Use `--pi-*` tokens (`bg-pi-card`, `text-pi-text`); raw colors fail `npm run check:theme`. `--pi-accent` is for fills (`bg-pi-accent`); accent text and icons use `--pi-accent-text` (`text-pi-accent-text`)
- **Refetch intervals**: Set appropriately (5s for critical, 15s for metrics, 60s for historical)
- **Shell commands**: Use `child_process.exec()` for system commands, always handle stderr
- **Hosts**: per-host client queries go through `apiPath(host.id, "/api/…")` with the host id in the query key (`useWidgetQuery` does both); a new widget must declare `hosts: "local" | "any"` in the registry
- **History timezone**: `historical_metrics.timestamp` holds UTC in a zone-less column and prod's DB TimeZone is Asia/Taipei — cutoffs are UTC ISO strings computed in JS, never `now()` in SQL
- **Migrations**: never edit an applied file in `migrations/`; every change is a new one (`db:generate`)
- **systemctl is read-only**: only `show` and `list-units --state=failed` with fixed argv through `assertAllowedArgv` (`server/services/systemd.ts`); unit names via `server/services/unit-name.ts` — never add another systemctl verb
- **Agent stays read-only**: remote logs map ids to configured sources only (no paths from requests); the Docker client (`server/services/agent-logs/docker.ts`) allows exactly two GETs — never add a Docker endpoint or a mutating route
- **Agent mode must stay DB-free**: never import `server/storage` or call `getDb()` from code the agent loads (`tests/unit/agent.test.ts` fails if it does); keep heavy packages lazy (agent RSS ~88 MB)
