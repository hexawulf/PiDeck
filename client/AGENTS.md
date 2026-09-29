# Client (React Frontend) - Agent Instructions

## Package Identity
**What**: React 18 SPA for PiDeck system monitoring dashboard  
**Tech**: TypeScript, Vite, TailwindCSS, TanStack Query, Wouter, Shadcn/ui

## Setup & Run
```bash
# From project root
npm install

# Dev server (Vite HMR)
npm run dev:client     # Client only at http://localhost:5173
npm run dev            # Full stack (client proxies to server at :5006)

# Build
npm run build:client   # Output to dist/public/

# Type check
npm run check          # TypeScript validation
```

## Patterns & Conventions

### File Organization
```
client/src/
├── components/
│   ├── ui/              # Shadcn components (NEVER edit manually)
│   ├── widgets/         # Feature widgets (fetch + display data)
│   ├── modals/          # Dialog/modal components
│   └── *.tsx            # Domain components (app-shell, app-monitor, etc.)
├── pages/               # Route-level pages (dashboard, settings, login)
├── hooks/               # React hooks (TanStack Query wrappers, useRefetch)
├── prefs/               # UI prefs: prefs.ts (pure storage/layout), UiPrefsProvider
├── widgets/             # registry, WidgetFrame, DashboardGrid (lazy, RGL), schemas
├── lib/                 # Utilities (queryClient, utils)
├── App.tsx              # Root component + routing
└── main.tsx             # Entry point
```

### Naming Conventions
- **Components**: PascalCase with descriptive suffixes
  - Widgets: `*Box.tsx` (e.g., `MountInfoBox.tsx`, `RamStatsBox.tsx`)
  - Domain components: Lowercase with hyphens (e.g., `app-monitor.tsx`)
  - Pages: Lowercase with hyphens (e.g., `dashboard.tsx`, `login.tsx`)
- **Hooks**: `use-*` (e.g., `use-system-info.ts`, `use-auth.ts`)
- **Imports**: Use `@/*` alias for client code, `@shared/*` for shared types

### Widget Pattern (✅ COPY THIS)
**Reference**: `client/src/components/widgets/MountInfoBox.tsx`, registry in `client/src/widgets/registry.tsx`

```tsx
import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { mountsSchema } from "@/widgets/schemas";   // add a zod schema per endpoint
import { QueryState } from "@/widgets/WidgetFrame";

export function MountInfoBox() {
  const query = useWidgetQuery("/api/metrics/mounts", 15000, mountsSchema); // key = [url]
  return (
    <QueryState query={query} isEmpty={(d) => d.length === 0} emptyText="No mounts">
      {(mounts) => <table>…</table>}
    </QueryState>
  );
}
```
Then add `{ id, title, icon, defaultSize, minSize?, maxSize?, component: memo(MyBox) }` to `WIDGETS`.
Sizes are grid units: `w` of 12 columns, `h` in 30px rows (4 ≈ stat card, 8 ≈ chart). Registry order
is the default layout; saved layouts get new widgets appended at the bottom automatically.

**Rules**:
- ✅ Body only: `WidgetFrame` draws title, border, radius, shadow and catches render errors
- ❌ No `rounded-lg+`, `shadow`, `max-w-*` under `components/widgets/` (`npm run check:theme` fails)
- ✅ Validate every response with a schema in `widgets/schemas.ts` (also used by `tests/e2e/contract.spec.ts`)
- ✅ Colors from `--pi-*` tokens only (`text-pi-text-muted`, `bg-pi-chart-1`, …)
- ✅ Accent: `bg-pi-accent` for fills (with `text-pi-on-accent`), `text-pi-accent-text` for accent text and icons — `text-pi-accent` fails AA on dark cards and `check:theme`

### Hosts (multi-host)
**Reference**: `client/src/hosts/host-path.ts` (pure), `client/src/hosts/HostProvider.tsx`
- The URL picks the host: `/dashboard` … = the hub (`"local"`), `/h/:hostId/<tab>` = a remote agent (only
  `REMOTE_TABS`: dashboard, apps). `useHost()` gives `{ id, isLocal }`; `useHosts()` the hub's host list.
- Every per-host request path comes from `apiPath(host.id, "/api/…")` (remote → `/api/hosts/<id>/…`) and its
  query key is `widgetQueryKey(host.id, url)` = `[path, hostId]`, so hosts never share a cache entry.
  `useWidgetQuery` does both; `useDocker`/`usePm2`/the reboot check use `widgetQueryKey`. Data the hub
  holds for every host passes `{ scope: "hub" }` with the host in the URL: history is
  `/api/system/history` (local) or `/api/history?host=<id>&range=24h` (`useHistory`).
- Registry: every widget declares `hosts: "local" | "any"`; `widgetsFor(isLocal)` is what a host's dashboard
  and visibility list offer. Local-only = Quick Actions (agents are read-only); history charts are "any" (H2).
- H2: alert toasts poll `/api/alerts?host=all` and name the host (`alertText` in `hooks/use-alerts.ts`); the
  `/hosts` overview (`pages/hosts.tsx`, lazy chunk) reads `/api/overview`; `g o` / palette / switcher "All
  hosts" open it. An agent < 2.5 (`history: "unsupported"`) gets an amber dot ("update the agent for history").
- Remote failures arrive as 502 `{offline|auth|badResponse}`; `QueryState` renders `HostProblemNotice`
  ("<host> is offline (last seen …)") instead of an error card. Mutations (Docker/pm2 actions) are local only.
- Links to a tab on the current host: `hostHref(host.id, tab)`; Logs, Cron and Settings are always the hub's.

### TanStack Query Hooks Pattern
**Reference**: `client/src/hooks/use-docker.ts` — one hook per resource plus colocated mutation hooks.
A query polls only while a component using it is mounted, so keep hooks per resource
(`useSystemInfo`, `useHistory`, `useAlerts`, `useDocker`, `usePm2`, `useCron`) — never one hook for everything.

**Refetch Intervals** — always through `useRefetch(baseMs)` (`hooks/useRefetch.ts`), never a raw number:
it applies the header speed (Live ×1, Relaxed ×2, Slow ×5) and returns `false` while paused.
`useWidgetQuery` already does this. Base values:
- **5s**: system info · **10s**: Docker, PM2, most metrics · **15–30s**: mounts, network · **60s**: history
- **Exception**: `useAlerts` keeps a fixed 7s and ignores speed/Pause so alert toasts always arrive (E1).

### UI Prefs Pattern
**Reference**: `client/src/prefs/prefs.ts`, `client/src/prefs/UiPrefsProvider.tsx`
- `useUiPrefs()` reads; `useUiPrefsDispatch()` changes (`setLayout`, `hide`, `show`, `resetLayout`,
  `setDensity`, `setSpeed`, `setPaused`, `setEditing`, `setPins`, `replace`). Persisted to
  `localStorage["pideck:prefs:v1"]` (the key keeps its name; the value is `version: 2`, and v1 values/exports
  still load). `paused`, `editing` and `lastReset` are session-only and never saved.
- Per-host layouts: `layout`/`hidden` are the hub's; `layoutByHost[id]` a remote host's (falls back to the
  local layout minus local-only widgets). `useUiPrefs()` hands out the *current host's* layout and
  `useUiPrefsDispatch()` tags `setLayout`/`hide`/`show`/`resetLayout` with the current host — components
  don't pass a host themselves.
  Pass `reason` with `replace` when it is a reset, so About › Diagnostics can show it.
- Adding a section: add a zod schema to `SECTIONS` in `prefs.ts` (a bad section falls back alone).
- Layout geometry (compact, reading order, keyboard moves) lives in `prefs.ts`, not in the grid, so
  react-grid-layout stays in the lazy `DashboardGrid` chunk. Don't import `react-grid-layout` elsewhere.
- Save layout only on discrete events (drag/resize stop, hide/show, reset) — never on `onLayoutChange`.

### Density
`<html data-density="comfortable|compact">` drives `--pi-card-pad`, `--pi-gap`, `--pi-cell-pad-y`,
`--pi-font-body`, `--pi-chart-h` (`index.css`). Use these tokens for spacing inside cards instead of fixed
padding; the grid's row height/margin mirror them in `GRID_METRICS` (`DashboardGrid.tsx`).

### Confirming risky actions (E7)
**Reference**: `client/src/components/ui/confirm-dialog.tsx`, `client/src/components/update-system-confirm.tsx`
- Anything that changes the host or wipes prefs goes through `<ConfirmDialog>` — never `window.confirm`, never
  a single click. Focus starts on Cancel, Esc/overlay cancel, `pending` blocks dismissal, focus returns to the
  opener (or `returnFocusRef` when the opener is gone, e.g. the palette).
- Update System: render `<UpdateSystemConfirm open onOpenChange />`; it owns the mutation and the toasts.

### Keyboard shortcuts & command palette
- **Shortcut table**: `client/src/shortcuts/shortcuts.ts` (`SHORTCUTS` + pure `resolveKey`). The `?` sheet renders
  the table, so add a shortcut there and in `useCommandCenter`'s `run()` switch — nowhere else. Single keys must
  be ignored while typing / with a dialog open (the resolver does it); never bind a destructive action.
- **Palette actions**: `client/src/palette/actions.ts` → `buildActions(ctx)`. Add an entry (group, label,
  keywords, `perform`). Destructive entries only open a ConfirmDialog.
- **Lazy chunk**: `palette/CommandPalette.tsx` (palette + help sheet) is loaded on first open by
  `components/command-center.tsx`. Don't import `palette/*` from main-chunk code; the E2E palette spec checks the
  main JS for palette strings.

### Log pins (`useLogPins`)
**Reference**: `client/src/hooks/use-log-pins.ts`, `components/logview/pinned-logs.tsx`
- Pins are the `pins` prefs section (`logId`, optional `label`/`grep`, max 100); `pin()` dedupes same log + filter
  and refuses a 101st. Stale = not in `/api/hostlogs` or 404 on open (`markLogMissing`); stale pins stay, greyed.
- Open a log from anywhere with `logHref(id, grep?)` → `/logs?log=…&grep=…` (the log list is `useHostLogs()`).
- Keep new log UI out of `log-viewer.tsx` (it should only shrink); put it in `components/logview/` — not
  `components/logs/`, which `.gitignore` ignores.

### Styling Guidelines
- **Muted text**: `text-pi-text-muted` · **Warnings**: `text-pi-warning` · **Errors**: `text-pi-error`
- **Scrolling**: don't add inner `max-h`/`overflow` boxes in widget bodies — the `WidgetFrame` body is the
  card's single scroll container (and becomes keyboard-focusable when it overflows)
- **Tables**: Fixed layout with `table-fixed`, `truncate` for overflow; row padding follows density

### Shadcn/ui Components
**Location**: `client/src/components/ui/`  
**DO NOT EDIT** - These are auto-generated by shadcn CLI

**Usage**:
```tsx
// Import from @/components/ui
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

<Button variant="outline">Click me</Button>
<Card className="p-4">Content</Card>
```

**Available components**: Button, Card, Input, Table, Dialog, Tabs, etc.  
**Docs**: https://ui.shadcn.com/docs/components

## Touch Points / Key Files

### Core Files
- **Entry**: `client/src/main.tsx` - React root + query client setup
- **App**: `client/src/App.tsx` - Routing with Wouter
- **Query Client**: `client/src/lib/queryClient.ts` - TanStack Query config + apiRequest helper
- **Auth Hook**: `client/src/hooks/use-auth.ts` - Login/logout logic
- **Shell/routes**: `client/src/components/app-shell.tsx` - header (incl. `RefreshControl`) + tabs at `/:tab`
- **Prefs**: `client/src/prefs/UiPrefsProvider.tsx` - wraps the shell in `App.tsx`
- **Dashboard**: `client/src/pages/dashboard.tsx` (toolbar, phone stack) → lazy `widgets/DashboardGrid.tsx`
- **Palette/shortcuts**: `client/src/components/command-center.tsx` → lazy `palette/CommandPalette.tsx`

### Example Files (Good Patterns)
- **Widget**: `client/src/components/widgets/MountInfoBox.tsx`
- **Page**: `client/src/pages/dashboard.tsx` (renders `WIDGETS`)
- **Hook**: `client/src/hooks/use-docker.ts`
- **Domain Component**: `client/src/components/app-monitor.tsx`

## JIT Index Hints
```bash
# Find a widget
rg -n "export function.*Box" client/src/components/widgets

# Find a page component
ls client/src/pages/*.tsx

# Find a hook
rg -n "export function use" client/src/hooks

# Find TanStack Query usage
rg -n "useQuery|useMutation" client/src

# Find fetch calls (check for credentials: 'include')
rg -n "fetch\(" client/src

# Find Shadcn components
ls client/src/components/ui/*.tsx
```

## Common Gotchas
- **Fetch credentials**: ALWAYS include `credentials: 'include'` or session won't work
- **Path aliases**: Use `@/*` not relative paths for imports
- **Dark theme**: Don't hardcode colors, use existing Tailwind classes
- **Query keys**: Must match API endpoint for consistency (e.g., `['/api/metrics/mounts']`)
- **Shadcn components**: Never edit `components/ui/*` manually - regenerate with CLI

## Pre-PR Checks
```bash
# From project root
npm run check          # Must pass TypeScript validation
npm run dev            # Manual test in browser
```

**Checklist**:
- [ ] All fetch calls have `credentials: 'include'`
- [ ] TanStack Query hooks have proper `queryKey` and `refetchInterval`
- [ ] Types imported from `@shared/schema` where applicable
- [ ] Dark theme colors used (no hardcoded hex values outside existing palette)
- [ ] Loading/error states handled in all data-fetching components
