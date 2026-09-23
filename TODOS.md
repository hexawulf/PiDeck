# TODOS

Deferred work. Source: PiDeck 2.0 CEO review (2026-09-23), see docs/plans/2.0-gui.md.

## P1 — Server-side 60s sampler: history + alert evaluation
- **What:** Start one server-side 60s timer (in bootstrap) that collects metrics, writes the history row and evaluates alerts; stop doing both inside `getSystemInfo()`.
- **Why:** Both currently run only when a client polls `/api/system/info` (`server/services/system.ts:76-77` history, `:90-109` temperature alert).
  - History has holes whenever no tab is open (2026-09-24: 2,579 rows / 304 kB, newest row 2026-09-22 06:52).
  - No temperature alerts while nobody is looking.
  - With a tab open 24h it's the opposite: one row per poll per tab (~17k/24h/tab), all returned by `/api/system/history`.
- **Pros:** Continuous history, charts for 6h/24h ranges become meaningful, alerts independent of browsers, fixed row rate, smaller payloads.
- **Cons:** Backend change; must avoid double-sampling if pm2 ever runs >1 instance.
- **Context:** v2.0 works around it client-side: `AlertHeartbeat` (E1) keeps alerts alive while paused; `downsample()` draws gaps and the chart captions "data only while PiDeck is open" (E19). Both workarounds can be removed once this lands.
- **Effort:** S–M · **Depends on:** nothing; best right after v2.0 P1.

## P1 — grep argument injection in rasplogs
- **What:** `spawn("grep", ["-e", pattern, "--", ...])`; validate `tail` with parseInt + clamp.
- **Why:** `server/routes/rasplogs.ts:111,136` passes the user pattern as grep's first arg; a leading `-` becomes an option. `tail` is unvalidated.
- **Pros:** Closes option injection; v2.0 log pins make patterns persistent.
- **Cons:** None meaningful.
- **Effort:** S · **Depends on:** ideally before v2.0 phase 3 (log pins) ships.

## P2 — ReDoS in hostLogs filter
- **What:** Default to substring match; regex only when explicitly `/…/`, with length limit and a line cap.
- **Why:** `server/routes/hostLogs.ts:269` runs `new RegExp(userPattern)` over up to MAX_TAIL_LINES lines on the event loop.
- **Effort:** S · **Depends on:** pairs with the grep fix above.

## P3 — Stale branches and stash
- **What:** List merged/stale remote branches (~65 `codex/*`, `feat/*`, `fix/*`, incl. dead `feat/dashboard-grid-layout`) and `stash@{0}` (on 339a59e); confirm, then delete.
- **Why:** Noise when reviewing; old grid branch could be mistaken for current work.
- **Effort:** S · **Depends on:** explicit confirmation per deletion batch.
