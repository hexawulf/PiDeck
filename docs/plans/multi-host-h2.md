# PiDeck multi-host H2 — per-host history, alerts, overview (2.5.0)

Status: **ready** — planned 2026-09-28; facts re-checked and open questions
decided 2026-09-29 (see "Decisions"). Owner: 0xWulf.
Base: v2.4.0 (032f015). Parent plan: [multi-host.md](./multi-host.md) (H1 shipped as 2.4.0).

## Goal
Every machine gets what piapps already has: history charts, alerts, and
data recorded even when no tab is open. Plus an **"All hosts" overview**:
one tile per machine, click through to its dashboard.

## Scope
1. **M0: schema migrations** (prerequisite, lands first).
2. **Per-host history**: `historical_metrics.host_id`, index, retention per host.
3. **Hub sampler for all hosts**: local and every agent each minute, in parallel.
4. **Per-host alerts**: temperature (existing rule) for every host.
5. **Overview page** `/hosts` and history/alerts on remote dashboards.

## Non-goals (later phases)
- WireGuard, piapps3/piapps4 (H3); remote actions and remote logs (H4).
- New alert types beyond temperature (keep the rule, make it per host).
- Longer retention than 24 h (make it configurable, keep the default).

## Where we are (facts from prod, re-checked read-only 2026-09-29)
| Item | State |
|---|---|
| Postgres | 18.6 on piapps (hub) and piapps2; only schema `public`; tables `users`, `sessions`, `user_sessions`, `historical_metrics` |
| `historical_metrics` | 1,437 rows, 352 kB, pruned to 24 h each tick; **only a PK index** (no timestamp index) |
| **Timestamps** | `historical_metrics.timestamp` is `timestamp` **without time zone** (drizzle `mode: 'string'`) and holds **UTC** values written by the app as ISO strings. The DB `TimeZone` is **Asia/Taipei**. `now()`/`defaultNow()`/`localtimestamp` in SQL give **Taipei local** time → never compare this column with `now()`; see "Schema changes" |
| `users` | 1 admin row; unique constraint `users_username_unique` (from `.unique()` in schema.ts) **and** a redundant non-unique `idx_users_username` from the old hand-written `migrations/0001_…sql`, **not declared in `shared/schema.ts`** (drift) |
| `sessions` | declared in schema.ts, unused, 0 rows; FK `sessions_user_id_users_id_fk` → `users` |
| `user_sessions` | created by `connect-pg-simple` (`createTableIfMissing`), **not in schema.ts**; must never be touched by migrations |
| Migrations | none tracked; schema created with `drizzle-kit push` (installer); no `drizzle` schema/table in prod |
| Versions | drizzle-orm ^0.45.2, drizzle-kit ^0.31.10 |
| Alerts | in memory in `SystemService` (`activeAlerts`, `server/services/system.ts`), temperature only; served by `server/routes/system.ts` and `server/routes/compat.ts` as `/api/system/alerts`; client `use-alerts.ts` |
| Sampler | `server/services/sampler.ts`: 60 s tick, `pg_try_advisory_xact_lock`, insert row + prune > 24 h (`SystemService.pruneHistory`, cutoff computed in JS as a UTC ISO string) + temperature check (per process, no DB) |
| History | `/api/system/history` (`server/routes.ts`), client `use-system-info.ts` with `scope: "hub"` |
| Agent | piapps2, 2.4.0 (systemd `pideck-agent`); allowlist in `server/agent-api.ts`; `/api/agent/info` already returns `capabilities: { read, actions, logs, paths }` → add `sample: true` there; no raw counters endpoint |
| Hub | piapps, pm2 `pideck` 2.4.0 online; `main` = c391a8c (this plan on top of v2.4.0) |

## M0 — schema migrations (first; separate commit series)
**Design**
- drizzle migrations in `migrations/`, applied by `drizzle-orm`'s migrator
  from a small script (`scripts/migrate.mjs`, `npm run db:migrate`), under a
  Postgres advisory lock so two processes can't migrate at once.
- `drizzle.config.ts`: `tablesFilter` excludes `user_sessions` (and anything
  not in schema.ts), so no generated migration can ever drop it.
- Move the old hand-written `migrations/0001_add_password_management_to_users.sql`
  to `migrations/legacy/` (kept for history, not run).

**Baseline (the risky part, do it exactly like this)**
1. **Drift check:** `drizzle-kit pull` against a copy of prod into a temp dir;
   diff with `shared/schema.ts`. Resolve every difference *in schema.ts*
   (e.g. declare `idx_users_username`; decide whether the unused `sessions`
   table stays declared). Goal: schema.ts == prod, byte-for-byte in the
   generated SQL.
2. `drizzle-kit generate` → `0000_baseline.sql` (the full current schema).
3. **Existing databases** (prod, any 2.3/2.4 install): the migrate script sees
   the app tables but no migrations table → creates the drizzle migrations
   table and **records 0000 as applied without running it** (baseline mark).
   Log it loudly. Fresh databases run 0000 normally.
4. Every later change = a new numbered migration; never edit an applied one.

**Wiring**
- `install.sh` (fresh): replace `drizzle-kit push --force` with `db:migrate`.
- `install.sh --update`: run `db:migrate` after `npm ci`, **before** restart;
  on failure stop, keep the old build running, print the restore command.
- Hub startup: check that no migrations are pending; if some are, log an
  error and keep serving read paths (don't crash-loop), and show a banner
  "Database needs migrating: run scripts/install.sh --update".
- `--update` takes a `pg_dump -Fc` of the PiDeck DB to `~/backups/` before
  migrating (size is tiny), and prints the restore command.

**Testing M0 on a copy of prod (mandatory before rollout)**
- `pg_dump -Fc` prod → restore into a scratch database (e.g. `pideck_migtest`
  on piapps2's Postgres) → run baseline mark + all H2 migrations → run the app
  against it → verify rows, users/login, `user_sessions` untouched.

## Schema changes (migrations 0001+ after the baseline)
- `historical_metrics.host_id text NOT NULL DEFAULT 'local'`; existing rows
  become `local`.
- Index `(host_id, timestamp DESC)`; also serves the prune query.
- Retention: `PIDECK_HISTORY_HOURS` (default 24, integer, clamp to a sane
  range e.g. 1–168, invalid → 24 with a warning), one prune each tick for all
  hosts. **Timezone trap:** the column is `timestamp without time zone`
  holding UTC, and the DB `TimeZone` is Asia/Taipei. Keep computing the
  cutoff in JS as a UTC ISO string (as `pruneHistory` does today), or use
  `now() AT TIME ZONE 'UTC'` in SQL. A plain `timestamp < now() - interval`
  would delete ~8 h too much on prod. Same rule for the history range query
  and for any new timestamp column: always write UTC explicitly, never rely
  on `defaultNow()`. Add a unit test that runs with a non-UTC session
  `TimeZone`.
- **`alerts` table (decided: yes):** `id, host_id, type, severity, message,
  started_at, resolved_at` (UTC, `timestamptz` is fine for a new table;
  pick one and be consistent), index on open alerts
  (`resolved_at IS NULL`). Alerts survive a hub restart (on start, load open
  rows into memory); the overview shows "open since". Keep resolved rows for
  `PIDECK_HISTORY_HOURS`, pruned in the same tick.

## Hub sampler for all hosts
```
tick (60 s, advisory lock)
 ├─ local: sample as today → row(host_id='local')
 ├─ each agent in parallel (per-host timeout 5 s):
 │    GET /api/agent/sample → raw counters → hub computes 1-min averages
 │    → row(host_id=<id>)         offline/auth/bad → no row (gap), status updated
 ├─ prune rows older than PIDECK_HISTORY_HOURS
 └─ alerts: evaluate per host → open/resolve
```
- **New agent endpoint `GET /api/agent/sample`** (allowlisted, read-only):
  raw counters (CPU jiffies, disk sectors read/written, net rx/tx bytes, mem,
  temperature, sampled_at). The hub keeps the previous sample per host and
  computes rates the same way it does locally, so every host's history means
  the same thing (true one-minute averages, as in 2.0.1). Reuse the local
  sampling code on both sides.
- **Version gating:** agents older than 2.5 don't have `/api/agent/sample`;
  the hub marks that host "update the agent for history" (amber) and skips it.
  Bump the agent API with a `capabilities.sample: true` flag in `/api/agent/info`.
- One slow/offline host never delays others; a whole tick has an upper bound
  (e.g. 10 s) and logs which hosts were skipped.
- Counter resets (agent restart, reboot, wrap) → drop that interval, no
  negative rates.

## Per-host alerts
- Same temperature rule and threshold, evaluated per host; state keyed by
  `(host_id, type)`.
- `/api/system/alerts` keeps working for the local host; new
  `GET /api/alerts?host=<id|all>` for the UI.
- Toasts name the host ("piapps2: temperature above 70 °C").
- Offline for > 5 minutes (decided; `PIDECK_OFFLINE_ALERT_MINUTES`, default
  5) → an "offline" alert for that host, **with a toast** ("piapps2: offline
  since 08:12"); resolves when it's back (resolve toast too). A wrong token
  or an agent < 2.5 is not "offline" (it has its own status), and a hub
  restart must not raise offline alerts for hosts it simply hasn't polled yet.

## API (hub, login required)
- `GET /api/history?host=<id>&range=15m|1h|6h|24h` → served from the hub DB
  (not proxied). `host` must be `local` or a configured id (404 otherwise).
  Keep `/api/system/history` as the local alias.
- `GET /api/alerts?host=<id|all>`.
- `GET /api/overview` → per host: status, last sample (cpu, mem, temp, disk
  %, rx/tx), open alerts, last seen. One request for the overview page.

## UI
- History widgets and the alerts badge become `hosts: "any"`; on a remote
  host they read `/api/history?host=<id>`. Chart caption stays "sampled every
  minute by the hub — gaps mean the host was unreachable".
- **Overview page `/hosts`**: responsive grid of tiles (name, status dot,
  CPU, temp, RAM, disk, open alerts, last seen), click → `/h/<id>/dashboard`
  (or `/dashboard` for local). Linked from the host switcher ("All hosts")
  and the palette; shortcut `g o` if free.
- Offline tile: grey with "last seen …", not an error.
- Prefs: no change expected (per-host layouts exist since 2.4).

## Error & rescue registry
| Codepath | Failure | Rescue | User sees |
|---|---|---|---|
| db:migrate | fails mid-way | transaction per migration; stop; old build keeps running; restore from pg_dump | installer error with restore command |
| Hub start | pending migrations | serve, log error | banner "Database needs migrating" |
| Sampler → agent | offline/timeout | no row; status offline | gap in chart; tile grey |
| Sampler → agent | agent < 2.5 | skip; flag | amber dot "update the agent for history" |
| Counters | reset / wrap | drop interval | one missing point |
| History API | unknown host | 404 | "No such host" |
| Alerts | host offline > 5 min | open offline alert (DB row) | toast + tile badge |
| Alerts | hub restart | reload open rows; no offline alert before the first poll | badge stays, no false toast |
| Retention | bad `PIDECK_HISTORY_HOURS` | fall back to 24, log a warning | nothing |

## Tests
- **M0:** baseline mark on a DB created by `push` (fixture from a prod-like
  dump) → no DDL runs, migrations table populated; fresh DB → 0000 runs;
  `user_sessions` survives every path; re-running is a no-op; concurrent
  runs serialise (advisory lock); failure leaves the DB unchanged.
- **Unit:** rate computation from counter pairs incl. resets; per-host alert
  state machine; history query by host/range; overview aggregation;
  `/api/agent/sample` allowlisted and token-protected on the agent;
  prune/range queries correct with a non-UTC session `TimeZone`
  (Asia/Taipei, as on prod); `alerts` rows persist across a restart.
- **E2E:** local agents from the H1 harness now produce history: remote
  history chart renders; overview page tiles for online / wrong token /
  unreachable; click-through; alert toast names the host (stub a hot
  temperature on the test agent).
- **Installer harness:** `--update` runs `db:migrate` after `npm ci` and before
  restart, takes a `pg_dump`, stops on migration failure.
- Budgets as before: main JS ≤ 302,680 B gzip, `npm audit --omit=dev` = 0,
  E2E under ~6 min.

## Rollout
1. Cloud session on `feat/multi-host-h2`; review worktree on piapps; all suites.
2. **Migration dress rehearsal:** `pg_dump -Fc` prod → restore to
   `pideck_migtest` on piapps2 → run the branch's `db:migrate` against it →
   start a throwaway hub on it → check history, login, `user_sessions`.
3. Update the piapps2 agent first (it must serve `/api/agent/sample`):
   `git pull && ./scripts/install.sh --update --yes`.
4. Hub: backups (dist, `.env`, **pg_dump**), fast-forward, `install.sh
   --update` (migrates), restart; verify local history continuous,
   piapps2 history filling in, overview page, alerts.
5. Release 2.5.0; drop `pideck_migtest`.

## Decisions (operator, 2026-09-29; were the open questions)
- **`alerts` table: yes**, in H2 (see "Schema changes").
- **Offline alert after 5 minutes, with a toast** (configurable via
  `PIDECK_OFFLINE_ALERT_MINUTES`).
- **Unused `sessions` table: keep for now.** It stays declared in schema.ts
  and in the baseline, FK included; dropping it is a later release.
- **History retention: 24 h default, `PIDECK_HISTORY_HOURS`**, same value for
  all hosts. Document it in `.env.example` and the README env table.

## Drift to resolve in M0 (found 2026-09-29)
- `idx_users_username` (non-unique btree on `users.username`) exists on prod
  but not in schema.ts, and it duplicates `users_username_unique`. Choose one
  and say why: declare it in schema.ts so the baseline matches prod, **or**
  drop it in migration 0001 (`DROP INDEX IF EXISTS`), which also works for
  fresh installs. Either way, the baseline must match prod exactly.
- Installs whose schema came only from `drizzle-kit push` (2.3/2.4 installer
  on a new host) most likely do **not** have `idx_users_username`. Baseline marking must accept both shapes
  (with or without that index) and must not fail on either.

## Brief for the cloud session (paste with this file)
> Implement `docs/plans/multi-host-h2.md` on branch `feat/multi-host-h2` from
> `main`. Do M0 first as its own commits, including the drift check (report
> every difference between prod-shaped schema and `shared/schema.ts` and how
> you resolved it) and a baseline that never drops `user_sessions`. Then
> history, sampler, alerts, overview. Push the branch; don't merge, tag,
> bump the version or deploy. Report: commits, migration list with SQL
> summaries, drift findings, test counts before/after, bundle numbers, agent
> RSS, deviations, open questions.
