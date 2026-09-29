# Server (Express Backend) - Agent Instructions

## Package Identity
**What**: Express API server for PiDeck system monitoring and control  
**Tech**: TypeScript, Node.js, Express, Drizzle ORM, PostgreSQL, dockerode, child_process

## Setup & Run
```bash
# From project root
npm install

# Dev server (tsx watch mode)
npm run dev           # Server at http://localhost:5006 (default PORT)

# Build
npm run build:server  # esbuild bundle to dist/index.js

# Production
npm run start         # NODE_ENV=production, PORT=5006

# Type check
npm run check         # TypeScript validation

# Database (migrations since 2.5; never `drizzle-kit push` on a real install)
npm run db:generate   # write migrations/NNNN_*.sql from shared/schema.ts
npm run db:migrate    # apply pending migrations (advisory lock, one transaction each)
node scripts/migrate.mjs --status   # exit 3 when work is pending
```

## Patterns & Conventions

### File Organization
```
server/
├── routes/           # Express route handlers (one file per domain)
├── middleware/       # Express middleware (auth, rate-limiting)
├── services/         # Business logic (if needed)
├── index.ts          # App entry + middleware + route registration
├── routes.ts         # Centralized route registration logic
├── db.ts             # Database connection (Drizzle)
├── env.ts            # Environment variable loading
└── vite.ts           # Vite dev server integration (dev only)
```

### Naming Conventions
- **Routes**: Lowercase with descriptive names (e.g., `mounts.ts`, `docker.ts`, `network.ts`)
- **Middleware**: camelCase with descriptive names (e.g., `rateLimitLogin.ts`)
- **API paths**: `/api/{domain}/{resource}` (e.g., `/api/metrics/mounts`, `/api/docker/containers`)
- **Exports**: Default export for routers, named exports for utilities

### Route Pattern (✅ COPY THIS)
**Reference**: `server/routes/mounts.ts`

```typescript
import { Router } from 'express'
import { exec } from 'child_process'

const router = Router()

router.get('/api/metrics/mounts', (_req, res) => {
  exec('mount | grep -v snap', (err, stdout, stderr) => {
    if (err || stderr) {
      const details = stderr || (err ? err.message : 'Unknown error')
      return res.status(500).json({ error: 'Failed to run mount', details })
    }

    const lines = stdout.trim().split('\n')
    const mounts = lines.map(line => {
      const match = line.match(/^(.+?) on (.+?) type (.+?) \((.+?)\)$/)
      if (!match) return null
      const [, device, mountpoint, fstype, options] = match
      return { device, mountpoint, fstype, options }
    }).filter(Boolean)

    res.json(mounts)
  })
})

export default router
```

**Rules**:
- ✅ Use `Router()` from Express
- ✅ Handle errors explicitly with appropriate HTTP status codes
- ✅ Always validate and sanitize shell command output
- ✅ Use `child_process.exec()` for shell commands (NOT `execSync` in request handlers)
- ✅ Export router as default: `export default router`
- ✅ Return JSON with `res.json()`, not `res.send()`
- ❌ DON'T use blocking operations in request handlers
- ❌ DON'T expose raw error messages to clients (sanitize details)

### Route Registration
**Location**: `server/routes.ts` (centralized registration)

**After creating a new route file**:
1. Import the router in `server/routes.ts`
2. Register with `app.use(myRouter)`

**Example**:
```typescript
// server/routes.ts
import mountsRouter from './routes/mounts'

export async function registerRoutes(app: Express) {
  // ... other routes
  app.use(mountsRouter)
}
```

### Middleware Pattern
**Reference**: `server/middleware/rateLimitLogin.ts`

```typescript
import type { Request, Response, NextFunction } from 'express'

export function myMiddleware(req: Request, res: Response, next: NextFunction) {
  // Validation logic
  if (/* invalid */) {
    return res.status(400).json({ message: 'Error message' })
  }
  return next()
}
```

**Apply middleware**:
```typescript
// In route file
import { myMiddleware } from '../middleware/myMiddleware'
router.post('/api/protected', myMiddleware, (req, res) => { /* ... */ })
```

### Database Pattern (Drizzle ORM)
**Location**: `server/db.ts` (connection), `shared/schema.ts` (schema)

```typescript
import { db } from './db'
import { users, historicalMetrics } from '@shared/schema'
import { eq } from 'drizzle-orm'

// Query
const allUsers = await db.select().from(users)
const user = await db.select().from(users).where(eq(users.id, 1))

// Insert
await db.insert(historicalMetrics).values({
  cpuUsage: 45,
  memoryUsage: 60,
  temperature: 55,
})

// Update
await db.update(users).set({ failed_login_attempts: 0 }).where(eq(users.id, 1))
```

**Schema changes** (docs/plans/multi-host-h2.md › M0):
1. Edit `shared/schema.ts` (only its tables are managed: `tablesFilter` in `drizzle.config.ts`;
   connect-pg-simple's `user_sessions` never appears in a migration)
2. `npm run db:generate` → review the new `migrations/NNNN_*.sql`, then `npm run db:migrate`
3. **Never edit an applied migration**; every change is a new file. `scripts/migrate-core.mjs` refuses an
   edited one. The hub serves with a "database needs migrating" banner while any are pending
   (`server/db-schema.ts`); `scripts/install.sh --update` backs up with `pg_dump` and migrates.

**Timezone trap**: `historical_metrics.timestamp` is `timestamp without time zone` holding **UTC**, and prod's
database TimeZone is Asia/Taipei. Write it from JS ISO strings, compute cutoffs in JS (`utcCutoff()` in
`services/history.ts`), never compare it with `now()`/`localtimestamp` or rely on a column default.
New time columns use `timestamptz` (e.g. `alerts`). `tests/unit/history.db.test.ts` runs under Asia/Taipei.

### Shell Command Safety
**Rules**:
- ✅ Use `exec()` with callbacks (non-blocking)
- ✅ Always check for `err` and `stderr`
- ✅ Validate/sanitize user input if used in commands
- ✅ Use `grep -v` to filter out unwanted lines
- ❌ DON'T use user input directly in shell commands (injection risk)
- ❌ DON'T use `execSync()` in request handlers (blocks event loop)

**Example** (a host tool that may be missing or need root — see `server/routes/network.ts`):
```typescript
import { classifyCommandFailure, SUDO, SUDOERS_HINT, unavailable } from '../services/unavailable'

// Fixed command, no user input. Privileged commands go through `sudo -n`
// (never prompts) and must be listed in deploy/sudoers.d/pideck.template.
exec(`${SUDO} ufw status verbose`, { timeout: 15000 }, (err, stdout, stderr) => {
  const reason = err ? classifyCommandFailure(err, stderr) : null
  if (reason === 'needs-sudoers') return res.json(unavailable('needs-sudoers', SUDOERS_HINT))
  if (reason) return res.json(unavailable(reason, 'ufw is not available on this host'))
  if (err) return res.status(500).json({ error: 'Command failed' })
  res.json({ output: stdout })
})
```
Missing tools/devices are a calm `{ available: false, reason, message }` (200), not a 500;
the client's `QueryState` renders it as "Not available on this host".

## Touch Points / Key Files

### Core Files
- **Entry**: `server/index.ts` - dispatch: agent (`server/agent.ts`) or hub (`server/hub.ts`: Express app + middleware + server start)
- **Route Registration**: `server/routes.ts` - Centralized route mounting
- **Database**: `server/db.ts` - Drizzle connection setup
- **Environment**: `server/env.ts` - dotenv loading

### Example Files (Good Patterns)
- **Simple Route**: `server/routes/mounts.ts` - Shell command + parsing
- **Complex Route**: `server/routes/docker.ts` - dockerode API integration
- **Middleware**: `server/middleware/rateLimitLogin.ts` - Rate limiting logic
- **Multi-endpoint Route**: `server/routes/network.ts` - Multiple related endpoints

### Authentication
- **Session setup**: `server/index.ts` (express-session config)
- **Auth routes**: Handled in `server/routes.ts` (login, logout)
- **Protection**: Routes starting with `/api/` are protected (see `server/index.ts`)
- **Rate limiting**: Login endpoints use `rateLimitLogin` middleware

## JIT Index Hints
```bash
# Find a route handler
rg -n "router\.(get|post|put|delete)" server/routes

# Find shell command usage
rg -n "exec\(" server/routes

# Find middleware
ls server/middleware/*.ts

# Find database queries
rg -n "db\.(select|insert|update)" server

# Find API endpoint definitions
rg -n "'/api/" server/routes
```

### Multi-host: agent mode and the hub proxy
**Plan**: `docs/plans/multi-host.md` · **Files**: `server/index.ts` (dispatch), `server/agent.ts`,
`server/agent-api.ts` (allowlist + path checks), `server/middleware/agentAuth.ts`, `server/hosts.ts`,
`parseHosts`/`agentConfig` in `server/config.ts`

- `server/index.ts` only dispatches: `PIDECK_MODE=agent` → `agent.ts`, else `hub.ts` (the full app). Both are
  dynamic imports and the bundle is built with `--splitting`, so an agent never loads the hub's packages.
- The agent is JSON-only: bearer token → SHA-256 → `timingSafeEqual` against `PIDECK_AGENT_TOKEN_SHA256`
  (401 without detail; 429 after 10 failures per address), then **exact** GET allowlist (`AGENT_PATHS`),
  then the *same* route handlers the hub uses. No sessions, login, static files, sampler, POST.
- **Never** import `./storage`, `./runtime` or call `getDb()` in code the agent loads; DB access is lazy
  (`getDb()` inside `services/history.ts` / `services/alerts.ts`). `tests/unit/agent.test.ts` fails if agent
  mode touches it.
- **Remote logs** (2.6, `server/services/agent-logs/`): `PIDECK_AGENT_LOGS=on` → `capabilities.logs` and
  `GET /api/agent/logs` + `/api/agent/logs/:id?lines=&filter=`. `sources.ts` (config, list, tail: 200 default,
  2,000 lines / 1 MB JSON max, lines cut at 8 kB, ANSI stripped), `redact.ts` (runs **before** the filter, so
  a filter can't probe a secret), `docker.ts` (node http on the socket; `assertAllowed` refuses everything but
  `GET /containers/json?all=1` and `GET /containers/<id>/logs?stdout=1&stderr=1&tail=N&timestamps=1`; streaming
  demux, TTY raw). Journald via `execFile("journalctl", [...])`, never a shell. The hub side is
  `agentLogsPathFromHubUrl` (`agent-api.ts`: only `lines`/`filter`, re-encoded) and `hosts.ts` passes the agent's
  400/404/409/503 with the message only; `routes.ts` logs `remoteLogAuditLine` per read.
- `GET /api/agent/sample` (2.5+, `capabilities.sample: true`) returns **raw counters only**
  (`readCounters()` in `services/counters.ts`: jiffies, sectors, bytes, boot id). The hub computes rates.
- Adding a metric for remote hosts: reuse/add its handler, add the path to `AGENT_PATHS` (both sides use it),
  keep it read-only and query-string-free.
- Hub: `GET /api/hosts` (status per host, cached 15 s) and `GET /api/hosts/:id/*` → `createHostHub().proxy()`:
  host from the registry only, raw-URL allowlist match (no `%`, `..`, `//`, `\`, `?`), bearer token only,
  5 s timeout incl. body, 1 MB cap, JSON only; failures are 502 `{offline,lastSeen}` / `{auth}` /
  `{badResponse}` — never the agent's own error text.

### Background sampler (every host, H2)
**Location**: `server/services/sampler.ts` (`createSampleTick`), shared state in `server/runtime.ts`
(`hubRuntime()`: host hub, alert manager, last sample per host). Plan: `docs/plans/multi-host-h2.md`.

- Every 60s, in parallel: local `readCounters()` and `GET /api/agent/sample` on each agent (5 s per host,
  10 s per tick; hosts that didn't answer are logged as skipped). An agent < 2.5 (no `capabilities.sample`)
  is skipped with history "unsupported" (amber in the UI), never offline.
- Rates come from `ratesBetween(prev, cur)` (`services/counters.ts`): a counter reset, a new boot id, a gap
  over 15 min or a non-forward time drops that interval — never a negative rate.
- Behind `pg_try_advisory_xact_lock` (one writer): insert one `historical_metrics` row per host
  (`host_id`), prune rows older than `PIDECK_HISTORY_HOURS` (default 24) with a UTC cutoff from JS, and
  evaluate alerts per `(host, type)` (`services/alerts.ts`): temperature > 70 °C, and offline after
  `PIDECK_OFFLINE_ALERT_MINUTES` (default 5) of failed polls **counted from the first failure this process
  saw** — so a restart never fires one early. A wrong token or bad answer is not offline.
- Alerts live in the `alerts` table (at most one open per host+type); open ones are loaded at start.
- Ticks never overlap; a failing tick is logged once per distinct error and the timer keeps going. No DB
  work while migrations are pending.
- **Off** when `NODE_ENV=test` or `PIDECK_SAMPLER=off` (set by `scripts/e2e-server.sh`: the E2E
  build shares the production database). With it off, no history rows and no alerts are produced.
- APIs (`server/routes/fleet.ts`, hub only, never proxied): `/api/history?host&range` (3d/7d bucket-averaged by
  `downsampleRows`), `/api/alerts?host`,
  `/api/overview`; `/api/system/history` and `/api/system/alerts` stay as the local 2.4 aliases.
- `/api/system/info` is read-only; disk/network rates are deltas against a per-caller baseline
  (`createRateBaseline()`), so the sampler and browser polls don't share one.

### System update guard
`POST /api/system/update` (`server/routes/system-update.ts`) runs `sudo apt-get update && upgrade -y`.
`PIDECK_DISABLE_SYSTEM_UPDATE=1` makes it answer `409 { message: "System update disabled in this environment" }`
without running anything. `scripts/e2e-server.sh` sets it (the E2E build shares the prod host); E2E specs also
stub the endpoint with `page.route`.

### Log filters
User `?grep=` values go through `server/services/log-filter.ts`: literal by default, regex only for
`/…/`, ≤200 chars, no newline/NUL. Pass them to grep only as `-e <pattern> --`, never as the first argument.

## Common Gotchas
- **Route registration**: New routes must be imported in `server/routes.ts`
- **Error handling**: Always return JSON errors, never throw unhandled exceptions
- **Shell commands**: Use `exec()` not `execSync()` to avoid blocking
- **Sessions**: Require `express-session` setup in `server/index.ts` (already configured)
- **Database**: Schema changes need a new migration (`npm run db:generate`, then `npm run db:migrate`)
- **CORS**: off by default (same-origin UI); `PIDECK_CORS_ORIGIN` lists extra origins (`corsOrigins()` in `server/config.ts`)

## Pre-PR Checks
```bash
# From project root
npm run check          # Must pass TypeScript validation
npm run dev            # Test API endpoints manually
```

**Checklist**:
- [ ] New route registered in `server/routes.ts`
- [ ] All errors return JSON with appropriate status codes
- [ ] Shell commands use `exec()` with error handling
- [ ] Types match `shared/schema.ts` definitions
- [ ] No secrets/credentials in code or logs
