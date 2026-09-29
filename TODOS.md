# TODOS

Deferred work. Source: PiDeck 2.0 CEO review (2026-09-23), see docs/plans/2.0-gui.md.

## Logs: download the viewed log
- **What:** a download icon to the left of the pin in the Logs viewer (local and remote) that saves exactly the lines on screen (already filtered and redacted) as `<host>-<source>-<YYYYMMDD-HHMM>.log`, client-side. A "whole file" download would need a new capped endpoint on the agent; decide separately.
- **Why:** operator request after the 2.6.0 rollout.
- **Effort:** S

## Logs: quieter audit lines
- **What:** the hub writes `[logs] remote read …` on every poll (Live refresh = many lines per minute). Log once per (user, host, source) when a source is opened, then at most every 10 minutes while it stays open.
- **Why:** 29 lines within a few minutes on 2026-09-29.
- **Effort:** S

## Per-host timeout for slow agents
- **What:** the DS920 missed one sample (>5 s) during a Plex library scan (load 14). If it recurs, allow a per-host timeout (e.g. `PIDECK_HOST_TIMEOUT_DS920=10`), still bounded by the tick limit.
- **Why:** seen once on 2026-09-29.
- **Effort:** S

## Header crowding with the host switcher
- **What:** at 1440 px with the switcher, "Raspberry Pi Admin", "System Online" and the Ctrl K hint wrap onto two lines. Tighten the header (hide the subtitle or uptime from md–xl, keep the kbd hint on one line).
- **Why:** seen on the 2.4.0 rollout screenshot.
- **Effort:** S

## Server rebuild while running
- **What:** `build:server` deletes `dist/*.js` before esbuild writes new chunks; a running hub loads some chunks lazily (pm2 library, drizzle), so for the few seconds between build and restart such a first load could fail. Keep the previous build's chunks until the restart (for example a manifest of the last two builds).
- **Why:** code splitting arrived in 2.4.0.
- **Effort:** S

## Installer: re-exec after `--update` pulls
- **What:** after `git pull`, `install.sh --update` finishes with the old, already-loaded functions. Re-exec the pulled script (e.g. `exec scripts/install.sh --update --post-pull`) so fixes to the installer apply in the same run.
- **Why:** found on piapps2 (2026-09-28): an update pulled the pm2-daemon fix but still ran the old detection once.
- **Effort:** S

Stale branches and the old stash were removed on 2026-09-28 (archived in a git bundle on piapps).
