# Security policy

## Supported versions

Only the latest release gets security fixes.

| Version | Supported |
|---|---|
| latest 2.x | yes |
| < 2.0 | no |

## Reporting a vulnerability

Please don't put details in a public issue. Use GitHub's private reporting
(the repository's **Security** tab → *Report a vulnerability*) when it is
offered; otherwise open an issue that only asks for a private channel, with
no details, and you'll get one.

Include the version (the About dialog shows it), what an attacker can do,
and the steps to reproduce. The maintainer aims to reply within a week; a
fix for a confirmed issue ships as a patch release, credited in the
changelog unless you ask otherwise.

## Scope

PiDeck monitors Linux hosts, reads logs, and can manage Docker containers,
pm2 processes, cron runs, and OS updates on the hub, so these matter most:

- authentication or session bypass on any `/api` route;
- cross-site request forgery against any state-changing route;
- command or argument injection in Docker, pm2, cron, systemd, or update
  handlers;
- path traversal or symlink escape in local or remote log readers, or secrets
  leaking past log redaction;
- a read-only agent answering without a valid token, accepting any mutating
  request, or exposing unconfigured host files/units.

Out of scope: attacks that already require the operator's login or shell
access, and running PiDeck over plain HTTP (`--lan-http`) on an untrusted
network.

## Design notes

- Every `/api` route except `/api/health`, `/api/auth/login`,
  `/api/auth/firebase-login`, `/api/auth/logout`, and `/api/auth/me` requires
  an authenticated session; sessions use `HttpOnly`, `SameSite=Strict`, and
  (unless `PIDECK_INSECURE_HTTP=1`) `Secure` cookies, regenerated at login
  with per-address lockout and absolute session lifetime checks.
- State-changing `/api` requests enforce same-origin checks
  (`server/middleware/sameOrigin.ts`) and accept JSON bodies only.
- Google sign-in verifies Firebase ID tokens server-side and restricts access
  to verified addresses listed in `FIREBASE_ALLOWED_EMAILS`.
- Systemd integration is strictly read-only (`show` and
  `list-units --state=failed` via fixed argv validation in
  `server/services/systemd.ts`); `pm2Action` validates live process names and
  refuses `all` or stopping PiDeck itself.
- Remote agents run DB-free and read-only (`GET` allowlist in
  `server/agent-api.ts`), store only the SHA-256 of their bearer token, and
  redact secrets before log lines leave the host.
