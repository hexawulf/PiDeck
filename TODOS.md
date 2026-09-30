# TODOS

Deferred work. Source: PiDeck 2.0 CEO review (2026-09-23), see docs/plans/2.0-gui.md.

No open items: 2.7.0 (2026-09-29) brought piapps3, piapps4 and hwca-ap02 in over WireGuard; 2.6.1 closed the last six before it (log download, quieter audit, per-host timeout, header crowding, rebuild while running, installer re-exec).

2.7.1 (2026-09-30) turned on remote logs for the cloud hosts; 2.8.0 (same day) added read-only systemd services with alerts on every host.

Known flaky: `multi-host.spec.ts` "palette 'Switch to <host>'" can time out under full-suite load on a Pi (passes alone).

Stale branches and the old stash were removed on 2026-09-28 (archived in a git bundle on piapps).
