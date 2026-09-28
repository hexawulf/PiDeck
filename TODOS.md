# TODOS

Deferred work. Source: PiDeck 2.0 CEO review (2026-09-23), see docs/plans/2.0-gui.md.

## Installer: re-exec after `--update` pulls
- **What:** after `git pull`, `install.sh --update` finishes with the old, already-loaded functions. Re-exec the pulled script (e.g. `exec scripts/install.sh --update --post-pull`) so fixes to the installer apply in the same run.
- **Why:** found on piapps2 (2026-09-28): an update pulled the pm2-daemon fix but still ran the old detection once.
- **Effort:** S

## Schema migrations for `--update`
- **What:** `--update` only warns when tables are missing. Adopt drizzle migrations (`migrations/`) and apply them on update.
- **Why:** the next release that changes `shared/schema.ts` would otherwise need manual SQL on every host.
- **Effort:** M

Stale branches and the old stash were removed on 2026-09-28 (archived in a git bundle on piapps).
