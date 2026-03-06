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

# Database
npm run db:push       # Push Drizzle schema to PostgreSQL
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

**Schema changes**:
1. Edit `shared/schema.ts`
2. Run `npm run db:push` to apply to database

### Shell Command Safety
**Rules**:
- ✅ Use `exec()` with callbacks (non-blocking)
- ✅ Always check for `err` and `stderr`
- ✅ Validate/sanitize user input if used in commands
- ✅ Use `grep -v` to filter out unwanted lines
- ❌ DON'T use user input directly in shell commands (injection risk)
- ❌ DON'T use `execSync()` in request handlers (blocks event loop)

**Example**:
```typescript
exec('systemctl status myservice', (err, stdout, stderr) => {
  if (err) return res.status(500).json({ error: 'Command failed' })
  res.json({ output: stdout })
})
```

## Touch Points / Key Files

### Core Files
- **Entry**: `server/index.ts` - Express app + middleware + server start
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

## Common Gotchas
- **Route registration**: New routes must be imported in `server/routes.ts`
- **Error handling**: Always return JSON errors, never throw unhandled exceptions
- **Shell commands**: Use `exec()` not `execSync()` to avoid blocking
- **Sessions**: Require `express-session` setup in `server/index.ts` (already configured)
- **Database**: Schema changes require `npm run db:push` to apply
- **CORS**: Configured for `https://pideck.piapps.dev` in production (see `server/index.ts`)

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
