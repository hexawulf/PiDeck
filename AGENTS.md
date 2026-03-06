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

# Database migrations
npm run db:push
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
- **Dark theme**: Use existing color scheme (`bg-[#0f172a]`, `text-white`)
- **Refetch intervals**: Set appropriately (5s for critical, 15s for metrics, 60s for historical)
- **Shell commands**: Use `child_process.exec()` for system commands, always handle stderr
