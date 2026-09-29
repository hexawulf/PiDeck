# Installing PiDeck

PiDeck installs with one script on Ubuntu or Debian, on a Raspberry Pi
(arm64) or a regular amd64 server. The script is idempotent: running it again
only fills in what is missing, and `--update` pulls, rebuilds and restarts.

- [Quick start](#quick-start)
- [Requirements](#requirements)
- [What the installer does](#what-the-installer-does)
- [Flags](#flags)
- [HTTPS (recommended) or plain LAN HTTP](#https-recommended-or-plain-lan-http)
- [The admin password](#the-admin-password)
- [Sudoers: NVMe, firewall, system update](#sudoers-nvme-firewall-system-update)
- [Configuration (.env)](#configuration-env)
- [Update, rollback, uninstall](#update-rollback-uninstall)
- [Add another machine (agent)](#add-another-machine-agent)
- [Troubleshooting](#troubleshooting)
- [Installing by hand](#installing-by-hand)

## Quick start

Run it as the normal user who will own PiDeck, not as root. The script uses
`sudo` only for the steps it lists before it starts.

```bash
git clone https://github.com/hexawulf/PiDeck.git
cd PiDeck
./scripts/install.sh --dry-run    # 1. read what it would do; changes nothing
./scripts/install.sh              # 2. install (asks before each choice)
```

At the end it prints the URL, the service status command and the log paths.
If it generated the admin password, it shows that password **once**. The
password is also stored in `~/.config/pideck/admin-password` (mode 0600).

Unattended variants:

```bash
./scripts/install.sh --yes                      # HTTPS via your reverse proxy (see below)
./scripts/install.sh --yes --lan-http           # plain http://<ip>:5006 on a trusted LAN
./scripts/install.sh --yes --sudoers            # also enable NVMe / firewall / update widgets
```

Every run is logged to `~/logs/pideck-install-YYYYmmdd-HHMMSS.log`. A dry run
logs to `$TMPDIR` instead, so it leaves `$HOME` untouched. Secrets (the
session secret, database password and admin password) never appear in the
log or on the terminal. The one exception is the generated admin password,
shown once on the terminal only.

## Requirements

| What | Needed | Notes |
|---|---|---|
| Ubuntu 22.04+ / Debian 12+ | yes | arm64 (Pi 4/5) or amd64. Other distros: package names may differ. |
| Node.js **22.x** + npm | yes | Not installed by the script. The preflight prints the NodeSource keyring steps (nothing piped into a shell). |
| git, curl, openssl | yes | curl/openssl are offered via apt if missing. |
| PostgreSQL 14+ | yes | Local `postgresql` is offered via apt; or pass `--database-url`. |
| pm2 | optional | Used when installed globally; otherwise systemd. The repo also ships pm2 (`--service pm2`). |
| lm-sensors | optional | CPU temperature on non-Pi hosts. |
| smartmontools + an NVMe drive | optional | NVMe Health (needs `--sudoers`). |
| ufw | optional | Firewall widget (needs `--sudoers`). |
| Docker | optional | Apps › Docker. The user must be in the `docker` group. |
| vcgencmd | optional | Power Status, Raspberry Pi only. |

Missing optional pieces don't break anything: their widgets show a calm
**"Not available on this host"** state instead of an error.

## What the installer does

1. **Preflight** (read-only): a table of what is found and missing.
2. **Plan**: lists every step that will use `sudo`, then asks to continue.
3. **Packages**: `apt-get install` of missing distro packages (postgresql,
   lm-sensors, smartmontools, curl, openssl). `--no-apt` skips this step.
4. **Database**: creates the `pideck` role and database if missing
   (`sudo -u postgres psql`, SQL on stdin), with a generated password. With
   `--database-url`, or when `.env` already has `DATABASE_URL`, nothing is
   created.
5. **.env**: created from `.env.example` if absent (mode 0600). Later runs
   only **append missing keys** and never change a value you set. Whenever
   the file changes, a timestamped `.env.bak.<ts>` is kept and a one-line
   `+added / -removed` summary is printed.
6. **Dependencies**: `npm ci`.
7. **Schema**: `npm run db:migrate` ([migrations](#database-migrations-and-backups)).
   A fresh database gets every migration; a database from PiDeck ≤ 2.4 is
   recognised, its baseline is recorded without running any DDL, and only the
   newer migrations run. Already up to date → nothing happens.
8. **Admin password**: see [below](#the-admin-password).
9. **Build**: `npm run build`.
10. **Service**: pm2 (`pm2 start ecosystem.config.cjs`, `pm2 save`) or
    systemd (unit from `deploy/systemd/pideck.service.template`, checked
    with `systemd-analyze verify`, installed with `install -m 0644`). Re-runs
    restart the existing instance. The script refuses to start a second
    instance under the other service manager.
11. **Sudoers** (opt-in `--sudoers`): see [below](#sudoers-nvme-firewall-system-update).
12. **Health check**: polls `/healthz`, then does a real login round-trip
    (`POST /api/auth/login` → `GET /api/auth/me` returns authenticated).

System files are written with `install -m` from a validated temp file, never
with `tee` or `>` redirects. An existing file that would change is first
backed up to `<file>.bak.<timestamp>`.

## Flags

| Flag | Env | Meaning |
|---|---|---|
| `--dry-run` | | Print every action, change nothing. Start here. |
| `--yes` | `PIDECK_YES=1` | Non-interactive: accept defaults, no prompts. |
| `--update` | | `git pull --ff-only`, `npm ci`, database backup + `db:migrate` (hub), build, restart, health check. |
| `--no-db-backup` | `PIDECK_NO_DB_BACKUP=1` | With `--update`: skip the `pg_dump` before migrating (not recommended). |
| `--port N` | `PIDECK_PORT` | Listen port (default 5006, or `PORT` from `.env`). |
| `--database-url URL` | `PIDECK_DATABASE_URL` | Use this PostgreSQL. Prefer the env form, which keeps the URL out of the process list. |
| `--no-apt` | `PIDECK_NO_APT=1` | Don't install distro packages. |
| `--service pm2\|systemd\|none` | `PIDECK_SERVICE` | Default: the existing instance, else pm2 if installed globally, else systemd. |
| `--sudoers` | `PIDECK_SUDOERS=1` | Install `/etc/sudoers.d/pideck`. |
| `--nvme-device /dev/nvmeX` | `PIDECK_NVME_DEVICE` | NVMe device for the smartctl rule and widget (default: first found). |
| `--lan-http` | `PIDECK_LAN_HTTP=1` | Allow login over plain HTTP. Read the [risks](#plain-lan-http---lan-http) first. |
| `--admin-password-file F` | `PIDECK_ADMIN_PASSWORD_FILE` | Use the password in file F (mode 0600). |
| `--generate-password` | | Generate the admin password (the default with `--yes`). |
| `--reset-password` | | Replace the admin password even if it was changed in Settings. |
| `--public-url URL` | `PIDECK_PUBLIC_URL` | URL shown in the final message. |
| `--skip-health` | | Skip the health check. |
| | `PIDECK_DB_NAME`, `PIDECK_DB_USER` | Local database and role names (default `pideck`). |
| | `NO_COLOR=1` | No colours (also automatic when output isn't a terminal). |
| `--agent` | | Install this machine as a read-only agent ([below](#add-another-machine-agent)). |
| `--agent-bind IP` / `--agent-port N` | `PIDECK_AGENT_BIND` / `PIDECK_AGENT_PORT` | Agent address (default: the LAN address) and port (default 5016). |
| `--hub-ip IP` | `PIDECK_HUB_IP` | The hub's address, for the printed firewall rule. |
| `--ufw-allow-from IP` | | With `--agent`: add `ufw allow from IP to any port <port> proto tcp` (removed again by uninstall). |
| `--rotate-token` | | With `--agent`: new token; the old one stops working. |
| `--add-host ID --url URL` | `PIDECK_ADD_HOST_TOKEN` | On the hub: add an agent (token from a hidden prompt, `--token-file`, or the env). |
| `--label TEXT` / `--replace` / `--token-file F` | | With `--add-host`: switcher name / replace an existing host / read the token from a 0600 file. |

## HTTPS (recommended) or plain LAN HTTP

In production (`NODE_ENV=production`) the session cookie is `Secure`, so
browsers only send it over HTTPS. The default and recommended setup puts
PiDeck behind a TLS reverse proxy on the same host. The installer **never
edits your web server**. It leaves PiDeck on `127.0.0.1:PORT` and you add the
proxy yourself.

### nginx

`deploy/nginx/pideck.conf.example` is a complete site (HTTP→HTTPS redirect,
TLS, `X-Forwarded-Proto`, no buffering for live log tails):

```bash
sudo cp deploy/nginx/pideck.conf.example /etc/nginx/sites-available/pideck
sudoedit /etc/nginx/sites-available/pideck        # server_name, certificate paths, port
sudo ln -s /etc/nginx/sites-available/pideck /etc/nginx/sites-enabled/
sudo certbot --nginx -d pideck.example.com         # or your own certificates
sudo nginx -t && sudo systemctl reload nginx
```

### Caddy

Caddy gets certificates automatically:

```
pideck.example.com {
    reverse_proxy 127.0.0.1:5006
}
```

PiDeck trusts one proxy hop by default (`TRUST_PROXY` unset = 1), which is
right for both examples.

**Behind Cloudflare's proxy** (orange cloud), set `PIDECK_CLOUDFLARE=1` so
the login rate limit counts the real client address from
`CF-Connecting-IP`. Leave it unset otherwise: without Cloudflare in front,
that header is whatever the client sends, and trusting it would let anyone
dodge the rate limit.

### Plain LAN HTTP (`--lan-http`)

For a Pi on a home network without a domain, `--lan-http` sets
`PIDECK_INSECURE_HTTP=1` (the session cookie is sent without `Secure`) and
`TRUST_PROXY=false` (nothing sits in front of PiDeck, so client
`X-Forwarded-*` headers are ignored). You then open `http://<pi-ip>:5006`.

**The risk:** the password at login and the session cookie afterwards
travel unencrypted. Anyone who can see the traffic can use them: someone on
the same Wi-Fi, a compromised device on the LAN, or any hop if the port is
ever forwarded to the internet. With that session they can read logs and
run the actions PiDeck offers. Use it only on a network you trust, never
forward the port, and prefer HTTPS when you can. In this mode the UI shows
a warning banner, and the login page explains the situation.

### CORS and cookie domain

The UI is served from the same origin as the API, so no CORS headers are
sent by default. To let another origin call the API with credentials, set
`PIDECK_CORS_ORIGIN=https://a.example,https://b.example`. The session cookie
is host-only by default. Set `COOKIE_DOMAIN` only if you really need it
shared across subdomains.

## The admin password

PiDeck has one account, `admin`, whose bcrypt hash lives in the database.
A fresh database is seeded with the password `admin`. The installer
replaces that seed:

- **Interactive:** asks whether to generate a strong password or lets you
  type one (same rules as Settings: 8+ characters, upper, lower, digit,
  special).
- **`--yes`:** generates one. It is shown once, at the end.
- **`--admin-password-file F`:** uses your file.

The password is kept in `~/.config/pideck/admin-password` (0600, directory
0700). The file lives outside the repository and is used by the health
check's login round-trip.

**Changing it later:** use **Settings › Change password** in the UI. That
updates the database, so the file becomes stale. Re-runs notice this
("changed in the UI — keeping it"), leave your password alone and skip the
login round-trip. To make the installer set a new one (for example, if you
forgot it), run `./scripts/install.sh --reset-password`.

**Database password vs admin password:** these are unrelated. The database
password is generated for the `pideck` PostgreSQL role, lives only in
`DATABASE_URL` in `.env`, and you never type it. The admin password is what
you type on the login page.

`APP_PASSWORD` / `APP_PASSWORD_FILE` in `.env` add a *second* password that
is always accepted and can't be changed from Settings. It is useful for
recovery, but the installer doesn't use it.

## Sudoers: NVMe, firewall, system update

Three features need root: **NVMe Health** (`smartctl`), **Firewall**
(`ufw status`) and **Quick Actions › Update System** (`apt-get`). PiDeck
runs them as `sudo -n …`, which never prompts. Without a rule, those
widgets show "Not available on this host — needs a sudoers rule".

`--sudoers` installs `/etc/sudoers.d/pideck` from
`deploy/sudoers.d/pideck.template`, granting exactly these commands (with
their full paths), for your user only:

```
<you> ALL=(root) NOPASSWD: /usr/sbin/smartctl -a /dev/nvme0      # only if an NVMe device and smartctl exist
<you> ALL=(root) NOPASSWD: /usr/sbin/ufw status verbose           # only if ufw is installed
<you> ALL=(root) NOPASSWD: /usr/bin/apt-get update
<you> ALL=(root) NOPASSWD: /usr/bin/apt-get upgrade -y
```

The file is checked with `visudo -cf` before it is installed (mode 0440,
owned by root). Re-run with `--sudoers` after adding an NVMe drive or ufw.
Use `--nvme-device /dev/nvme1` to pick another drive. The Update System
button always asks for confirmation in the UI.

## Configuration (.env)

`.env.example` lists and explains every key. The ones you are most likely
to touch:

| Key | Default | Purpose |
|---|---|---|
| `PORT` | 5006 | Listen port. |
| `CSP_ENFORCE` | (unset = Report-Only) | `true` enforces the Content-Security-Policy. The installer sets it. |
| `PIDECK_INSECURE_HTTP` | unset | `1` = LAN HTTP mode (see above). |
| `TRUST_PROXY` | 1 | `false` when there is no reverse proxy. |
| `PIDECK_CLOUDFLARE` | unset | `1` only when PiDeck is behind Cloudflare's proxy (rate limit uses `CF-Connecting-IP`). |
| `PIDECK_CORS_ORIGIN` | unset | Extra allowed origins. |
| `COOKIE_DOMAIN` | unset (host-only) | Session cookie domain. |
| `PIDECK_LOGS_DIR` | `~/logs` | Project logs shown in the Logs tab. |
| `PM2_LOGS_DIR` | `~/.pm2/logs` | pm2 logs. |
| `PIDECK_HOST_LOGS` | unset | Extra log files for the Logs tab, see below. |
| `PIDECK_NVME_DEVICE` | first `/dev/nvme*` | NVMe Health device. |
| `PIDECK_SAMPLER` | on | `off` disables the 60 s history/alert sampler (every host). |
| `PIDECK_HISTORY_HOURS` | 24 | Hours of history kept per host (1–168). |
| `PIDECK_OFFLINE_ALERT_MINUTES` | 5 | Minutes an agent must be unreachable before its "offline" alert (1–1440). |

`PIDECK_HOST_LOGS` is a comma-separated list of `[id:]Label=/absolute/path`
entries. The optional `id:` keeps pins and "last opened" stable if you
rename the label. Files that don't exist are hidden. The nginx access/error
logs and PiDeck's own pm2 logs are always offered.

```
PIDECK_HOST_LOGS=myapp_out:My App Output=/var/log/myapp/out.log,myapp_err:My App Error=/var/log/myapp/error.log
```

After editing `.env`, restart PiDeck (`pm2 restart pideck` or
`sudo systemctl restart pideck`): the app reads `.env` at start.

## Update, rollback, uninstall

**Update:**

```bash
./scripts/install.sh --update --dry-run
./scripts/install.sh --update
```

The update refuses to run on a checkout with local changes. It copies
`dist/` to `~/backups/pideck-dist-<timestamp>`, then runs
`git pull --ff-only` and `npm ci`. On a hub it then backs up and migrates
the database ([below](#database-migrations-and-backups)), builds, restarts the
service, runs the health check and prints the exact rollback command, like:

```bash
cd ~/PiDeck && git reset --keep <previous> && npm ci && rm -rf dist \
  && cp -a ~/backups/pideck-dist-<ts>/dist dist && pm2 restart pideck
```

### Database migrations and backups

Since 2.5 the schema is managed by migrations in `migrations/`
(`npm run db:migrate`, `scripts/migrate.mjs`): each runs in its own
transaction under a Postgres advisory lock, so two runs never interleave and
a failing migration leaves the database as it was. Applied migrations are
recorded in `public.__drizzle_migrations`. The session table
(`user_sessions`) is never touched.

`--update` on a hub:

1. `pg_dump -Fc` to `~/backups/pideck-db-<timestamp>.dump` (mode 0600; needs
   `postgresql-client` of the server's major version; `--no-db-backup`
   skips it).
2. `db:migrate`, after `npm ci` and **before** the build and restart.
3. If the migration fails, the update stops: the running service keeps its
   current build, and the installer prints the restore command, like:

```bash
pg_restore --clean --if-exists --no-owner \
  --dbname "$(sed -n 's/^DATABASE_URL=//p' .env)" ~/backups/pideck-db-<ts>.dump
```

The first 2.5 update of a 2.x database records its baseline (logged as
`BASELINE … WITHOUT running it`) and then applies the newer migrations. If
the hub starts while migrations are pending, it keeps serving, logs
`DATABASE NEEDS MIGRATING`, and the UI shows a banner; run
`./scripts/install.sh --update` (or `npm run db:migrate`). Check with
`node scripts/migrate.mjs --status` (exit 3 = work pending).

**Uninstall:**

```bash
./scripts/uninstall.sh --dry-run
./scripts/uninstall.sh            # remove the pm2 app / systemd unit and the sudoers file
./scripts/uninstall.sh --purge    # also drop the DB + role the installer created, delete .env and the password file
./scripts/uninstall.sh --purge --purge-backups   # …and delete ~/backups/pideck-dist-*
```

A plain uninstall keeps your data (database, `.env`, password file and
backups). `--purge` always asks you to type `purge`, even with `--yes`
(for scripts, set `PIDECK_PURGE_CONFIRM=purge` deliberately). It only drops
the database and role that `install.sh` itself created, as recorded in
`~/.config/pideck/install-db`. A database or role that already existed, a
`DATABASE_URL` you configured yourself, or a remote database is left alone.
Backups are kept unless you add `--purge-backups`. The checkout itself is
never deleted.

## Add another machine (agent)

One PiDeck (the **hub**, with the UI, login and database) can show other
machines too. Each extra machine runs a small **agent**: the same checkout
started in agent mode. The agent has no UI, no login and no database. It
answers a fixed list of read-only metric requests, and only when the request
carries its token. Your browser only ever talks to the hub; the hub asks the
agent. In the header, the host switcher (or `g h`, or the palette's
"Switch to …") moves between machines. A remote host's pages live under
`/h/<id>/dashboard` and `/h/<id>/apps`.

What a remote host shows (2.4): the live dashboard cards and a read-only
Apps tab (Docker and pm2 lists, no buttons). History charts, Quick Actions,
Logs and Cron stay the hub's own for now.

### Walkthrough: hub `piapps` (192.168.50.102) + agent `piapps2` (192.168.50.120)

**1. On the agent machine (piapps2)**, clone PiDeck and install it as an agent:

```bash
git clone https://github.com/hexawulf/PiDeck.git && cd PiDeck
./scripts/install.sh --agent --hub-ip 192.168.50.102 --dry-run   # read it first
./scripts/install.sh --agent --hub-ip 192.168.50.102 --sudoers
```

This builds PiDeck and writes `.env` (`PIDECK_MODE=agent`, bind address,
port 5016, and the token's SHA-256). It installs and starts the systemd unit
`pideck-agent` and checks it answers. At the end it prints the **token, once**,
together with the exact command for the hub. Copy the token now: the agent
keeps only its hash, so it can't show it again. `--sudoers` is optional (NVMe
Health and Firewall; an agent's rule has no apt-get lines).

**2. Firewall on the agent**: allow only the hub to reach port 5016:

```bash
sudo ufw allow from 192.168.50.102 to any port 5016 proto tcp
```

or let the installer add exactly that rule with
`--ufw-allow-from 192.168.50.102` (it records it, so `uninstall.sh` removes
it again). The agent speaks plain HTTP on the LAN: the token plus this
single-source rule are what protect it. Don't expose port 5016 anywhere else.

**3. On the hub (piapps)**, add the host and paste the token when asked
(the input is hidden):

```bash
cd ~/PiDeck
./scripts/install.sh --add-host piapps2 --url http://192.168.50.120:5016 --label "piapps2 (LAN)"
pm2 restart pideck --update-env          # or: sudo systemctl restart pideck
```

`--add-host` first calls the agent's `/api/agent/info` with the token. It
stops if the token is rejected or the agent can't be reached (add
`--skip-health` to add it anyway). Then it appends `PIDECK_HOSTS`,
`PIDECK_HOST_TOKEN_PIAPPS2` and `PIDECK_HOST_LABELS` to `.env`, keeping a
`.bak`. For scripts, the token can come from `--token-file F` (mode 0600) or
`PIDECK_ADD_HOST_TOKEN` instead of the prompt.

**4. Check it:** open the dashboard, pick piapps2 in the header switcher,
and watch its cards fill in. Stop the agent for a moment
(`sudo systemctl stop pideck-agent`): its cards say "piapps2 is offline (last
seen …)", and they recover once it is started again. On piapps2,
`ss -ltnp | grep 5016` should show it listening on 192.168.50.120 only.

### Status dots

| Dot | Meaning |
|---|---|
| green | online |
| grey | offline: the hub can't reach it (cards say when it was last seen) |
| red | the hub's token is wrong or was rotated ("Can't authenticate to …") |
| amber | the agent runs a different major version, or is older than 2.5 ("update the agent for history": the hub can't record its history): update it (`./scripts/install.sh --update` on the agent) |

The **All hosts** page (`/hosts`, from the host switcher, the palette or
`g o`) shows every host's latest one-minute sample, open alerts and last-seen
time. The hub records history for every 2.5+ agent each minute (kept
`PIDECK_HISTORY_HOURS`), so remote dashboards have Disk I/O and Network
Bandwidth charts too. An agent unreachable for `PIDECK_OFFLINE_ALERT_MINUTES`
(5) raises an "offline" alert and a toast naming the host; a wrong token does
not. Update agents **before** the hub, so they serve `/api/agent/sample`.

### Rotate a token

On the agent: `./scripts/install.sh --agent --rotate-token`. This prints a
new token once and replaces the hash (keeping a `.bak`); the old token stops
working at once. Then on the hub:
`./scripts/install.sh --add-host piapps2 --url http://192.168.50.120:5016 --replace`,
paste the new token, and restart the hub.

### Remove a host

On the hub, delete the host from `PIDECK_HOSTS` and remove its
`PIDECK_HOST_TOKEN_<ID>` (and label) line in `.env`, then restart the hub.
On the agent machine, `./scripts/uninstall.sh --dry-run`, then
`./scripts/uninstall.sh`. This removes the `pideck-agent` unit and the
sudoers file, and deletes the ufw rule only if the installer added it.
`--purge` also deletes the agent's `.env`.

### Updating an agent

`./scripts/install.sh --update` on the agent works as on the hub: pull,
`npm ci`, build and restart `pideck-agent`. It then checks the agent answers,
and prints the rollback command. Keep the hub and its agents on the same
release; a different major version shows the amber dot.

### Agent settings (`.env` on the agent)

| Key | Default | Purpose |
|---|---|---|
| `PIDECK_MODE` | – | `agent` starts the agent instead of the hub. |
| `PIDECK_AGENT_BIND` | 127.0.0.1 | Address to listen on (the installer uses the LAN address). |
| `PIDECK_AGENT_PORT` | 5016 | Port. |
| `PIDECK_AGENT_TOKEN_SHA256` | – | SHA-256 of the token; the agent refuses to start without it. |

On the hub: `PIDECK_HOSTS=id=http://ip:port,…`,
`PIDECK_HOST_TOKEN_<ID>` (id upper-cased, `-` → `_`), and optionally
`PIDECK_HOST_LABELS=id=Label,…`. Ids are `[a-z0-9-]{1,32}`; `local` is the
hub itself.

## Troubleshooting

**Login "works" but you land back on the login page.** The session cookie
is `Secure` and you are on plain `http://`, so the browser drops it. The
login page warns about this. Fix it with HTTPS via a proxy (see above), or
on a trusted LAN re-run with `--lan-http`. Behind a proxy, check that it
sends `X-Forwarded-Proto` and that `TRUST_PROXY` isn't `false`.

**`password authentication failed for user "pideck"`.** `DATABASE_URL`
doesn't match the role's password, for example after restoring an old
`.env`. Either fix the URL, or remove the `DATABASE_URL` line from `.env`
and re-run the installer: it resets the role's password and writes a new
URL. With `--database-url`, check the URL with
`psql "$URL" -c 'select 1'`.

**PiDeck doesn't come back after a reboot (pm2).** `pm2 save` stores the
process list, but pm2 itself must be started at boot. Run `pm2 startup`
once and run the `sudo …` line it prints. The installer prints this
reminder.

**`EADDRINUSE` / health check times out.** Another process has the port:
`sudo ss -ltnp 'sport = :5006'`. Pick another port with
`./scripts/install.sh --port 5010` (a new install), or change `PORT` in
`.env` and restart.

**A widget says "Not available on this host".** That is expected when the
host lacks the tool or device. vcgencmd is Pi-only; also check sensors, an
NVMe drive, ufw, Docker (your user must be in the `docker` group) and pm2.
"Needs a sudoers rule" means re-run with `--sudoers`. For a new drive or
ufw, re-run with `--sudoers` after installing it.

**Node is too old.** The preflight prints the NodeSource steps for Node 22
with a signed keyring. Run them, then re-run the installer.

**Where are the logs?** Installer: `~/logs/pideck-install-*.log`. App:
`pm2 logs pideck` or `journalctl -u pideck`.

## Installing by hand

The installer only automates these steps. To do them yourself:

```bash
sudo apt-get install -y postgresql lm-sensors smartmontools
sudo -u postgres createuser -P pideck && sudo -u postgres createdb -O pideck pideck
cp .env.example .env && chmod 600 .env && nano .env   # SESSION_SECRET, DATABASE_URL, PORT, ...
npm ci && npm run db:migrate && npm run build
pm2 start ecosystem.config.cjs && pm2 save             # or a systemd unit from deploy/systemd/
```

Then log in with `admin` / `admin` and change the password in Settings (a
banner reminds you until you do).

## For contributors

```bash
npm run check:shell    # shellcheck scripts/*.sh tests/install/*.sh
npm run test:install   # installer tests: no root; stubs for sudo, apt-get, psql, pm2, systemctl, visudo …
```
