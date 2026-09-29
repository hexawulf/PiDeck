# TODOS

Deferred work. Source: PiDeck 2.0 CEO review (2026-09-23), see docs/plans/2.0-gui.md.

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

## Installer: rollback target when the checkout was pulled first
- **What:** `--update` prints `git reset --keep <HEAD>` using the commit it finds, so if someone ran `git pull` before `--update` the printed rollback is the *new* commit. Record the commit that built `dist/` (e.g. `dist/.build-commit`) and print that instead.
- **Why:** hit on piapps2 and piapps during the 2.5.0 rollout (real target was 032f015).
- **Effort:** S

## Installer: stale admin-password file skips the login check
- **What:** after the password is changed in the UI, `~/.config/pideck/admin-password` is stale and `--update` skips its login round-trip. Offer `--check-login` (prompt for the password) or a token-based health endpoint that proves DB + session work.
- **Why:** 2.5.0 hub update on piapps skipped the check; login was verified by hand.
- **Effort:** S

## History charts beyond 24 h
- **What:** `PIDECK_HISTORY_HOURS` may be up to 168, but the chart's longest range is 24 h. Add 3d/7d ranges (downsampled) when retention allows.
- **Why:** noted in the H2 report (2026-09-29).
- **Effort:** S

Stale branches and the old stash were removed on 2026-09-28 (archived in a git bundle on piapps).
