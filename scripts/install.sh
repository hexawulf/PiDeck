#!/usr/bin/env bash
# Author:      0xWulf
# Description: One-command install / re-run / update for PiDeck on Ubuntu or
#              Debian (arm64 Raspberry Pi and amd64). Idempotent: re-running
#              only fills in what is missing. Run as the user who will own
#              PiDeck (not root); sudo is used only for the steps it lists
#              up front. Start with --dry-run: it prints every action and
#              changes nothing. Modules live under scripts/install/.
# Modified:    2026-11-26
# Usage:       scripts/install.sh --dry-run            # see what would happen
#              scripts/install.sh                      # interactive install
#              scripts/install.sh --yes --lan-http     # unattended, plain-HTTP LAN
#              scripts/install.sh --update             # pull, build, restart, check
#              scripts/install.sh --agent --dry-run    # read-only agent (multi-host)
#              scripts/install.sh --add-host node2 --url http://192.0.2.10:5016
#              scripts/install.sh --help               # all flags
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
# --update re-runs itself once when the pull changed this script or its
# modules (see reexec_after_pull); the second run keeps the first run's
# timestamp/log.
if [ "${PIDECK_INSTALL_REEXEC:-}" = 1 ] && [[ "${PIDECK_INSTALL_TS:-}" =~ ^[0-9]{8}-[0-9]{6}$ ]]; then TS="$PIDECK_INSTALL_TS"; fi
# Test hook only: system paths (sudoers.d, systemd) under a fake root.
ETC="${PIDECK_ETC_DIR:-/etc}"

# ── options (flags override env) ───────────────────────────────────────
DRY_RUN=0
YES="${PIDECK_YES:-0}"
MODE=install
PORT="${PIDECK_PORT:-}"
DB_URL="${PIDECK_DATABASE_URL:-}"
NO_APT="${PIDECK_NO_APT:-0}"
SERVICE="${PIDECK_SERVICE:-}"
SUDOERS="${PIDECK_SUDOERS:-0}"
LAN_HTTP="${PIDECK_LAN_HTTP:-0}"
PW_SOURCE=""                                   # prompt | generate | file:<path>
[ -n "${PIDECK_ADMIN_PASSWORD_FILE:-}" ] && PW_SOURCE="file:$PIDECK_ADMIN_PASSWORD_FILE"
RESET_PW=0
NVME_DEVICE="${PIDECK_NVME_DEVICE:-}"
SKIP_HEALTH=0
PUBLIC_URL="${PIDECK_PUBLIC_URL:-}"
# multi-host: --agent (this host becomes a read-only agent) and --add-host (on the hub)
AGENT_BIND="${PIDECK_AGENT_BIND:-}"
AGENT_PORT="${PIDECK_AGENT_PORT:-}"
HUB_IP="${PIDECK_HUB_IP:-}"
UFW_FROM=""
UFW_IFACE=""
AGENT_AFTER=""
AGENT_MEMORY_MAX=""
PREBUILT=0
ROTATE_TOKEN=0
ADD_HOST=""
ADD_URL=""
TOKEN_FILE=""
ADD_LABEL=""
REPLACE=0
NO_DB_BACKUP="${PIDECK_NO_DB_BACKUP:-0}"
CHECK_LOGIN=0
CHECK_LOGIN_FILE="${PIDECK_CHECK_LOGIN_FILE:-}"

usage() {
  cat <<'EOF'
PiDeck installer — scripts/install.sh [options]

  --dry-run                 print every action, change nothing (do this first)
  --yes                     non-interactive: accept defaults, no prompts
  --update                  git pull --ff-only, npm ci, pg_dump + db:migrate (hub),
                            build, restart, health check
  --no-db-backup            with --update: skip the pg_dump before migrating
  --port N                  listen port (default 5006; env PIDECK_PORT)
  --database-url URL        use this PostgreSQL instead of a local role/db
                            (never printed; prefer env PIDECK_DATABASE_URL,
                            which keeps it out of the process list)
  --no-apt                  don't offer apt-get for missing distro packages
  --service pm2|systemd|none   how to run PiDeck (default: pm2 if found, else systemd)
  --sudoers                 install /etc/sudoers.d/pideck (smartctl, ufw, apt-get only)
  --nvme-device /dev/nvmeX  NVMe device for SMART data (default: first found)
  --lan-http                allow login over plain http://<ip>:PORT (trusted LAN only)
  --admin-password-file F   use the password in F (0600) for the admin account
  --generate-password       generate the admin password (default with --yes)
  --reset-password          replace the admin password even if it was changed in the UI
  --public-url URL          where you open PiDeck (shown in the final message)
  --skip-health             don't run the health check
  --check-login             when the admin password was changed in the UI, ask for it
                            (hidden) and still test the login round-trip
                            (non-interactive: PIDECK_CHECK_LOGIN_FILE=<0600 file>)
  -h, --help                this help

Multi-host (docs/INSTALL.md › Add another machine):
  --agent                   install this host as a read-only agent: no database,
                            no login; systemd unit pideck-agent; prints a token
                            once for the hub
  --agent-bind IP           address the agent listens on (default: this host's
                            LAN address)
  --agent-port N            agent port (default 5016)
  --hub-ip IP               the hub's address (for the printed firewall rule)
  --ufw-allow-from IP       also run: ufw allow from IP to any port <port> proto tcp
  --ufw-interface IFACE     with --ufw-allow-from: only on this interface
                            (ufw allow in on IFACE from IP …; e.g. wg-pideck)
  --after UNIT              start the agent after UNIT (and pull it in), e.g.
                            wg-quick@wg-pideck when it binds to a tunnel address
  --memory-max SIZE         hard memory cap for the agent (systemd MemoryMax=,
                            e.g. 160M; at least 96M)
  --prebuilt                with --agent: no npm ci, no build; use the node_modules/
                            and dist/ unpacked from a bundle built on another host
                            (small VPS: npm ci + build peak ~650 MB)
  --rotate-token            with --agent: make a new token (the old one stops working)
  --add-host ID --url URL   on the hub: add an agent (id [a-z0-9-]{1,32}); the
                            token is read from a hidden prompt, --token-file F
                            (0600) or env PIDECK_ADD_HOST_TOKEN; tests the agent
  --label TEXT              with --add-host: name shown in the switcher
  --replace                 with --add-host: replace an existing host (keeps a .bak)

Env equivalents: PIDECK_YES=1 PIDECK_PORT PIDECK_DATABASE_URL PIDECK_NO_APT=1
PIDECK_SERVICE PIDECK_SUDOERS=1 PIDECK_LAN_HTTP=1 PIDECK_ADMIN_PASSWORD_FILE
PIDECK_NVME_DEVICE PIDECK_PUBLIC_URL PIDECK_DB_NAME PIDECK_DB_USER (default pideck)
PIDECK_AGENT_BIND PIDECK_AGENT_PORT PIDECK_HUB_IP PIDECK_ADD_HOST_TOKEN NO_COLOR=1
EOF
}

ORIG_ARGS=("$@")   # for the re-exec after --update pulls a new installer
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) YES=1 ;;
    --update) MODE=update ;;
    --port) PORT="${2:?--port needs a value}"; shift ;;
    --port=*) PORT="${1#*=}" ;;
    --database-url) DB_URL="${2:?--database-url needs a value}"; shift ;;
    --database-url=*) DB_URL="${1#*=}" ;;
    --no-apt) NO_APT=1 ;;
    --service) SERVICE="${2:?--service needs pm2|systemd|none}"; shift ;;
    --service=*) SERVICE="${1#*=}" ;;
    --sudoers) SUDOERS=1 ;;
    --nvme-device) NVME_DEVICE="${2:?}"; shift ;;
    --lan-http) LAN_HTTP=1 ;;
    --admin-password-file) PW_SOURCE="file:${2:?}"; shift ;;
    --generate-password) PW_SOURCE="generate" ;;
    --reset-password) RESET_PW=1 ;;
    --public-url) PUBLIC_URL="${2:?}"; shift ;;
    --skip-health) SKIP_HEALTH=1 ;;
    --check-login) CHECK_LOGIN=1 ;;
    --agent) MODE=agent ;;
    --agent-bind) AGENT_BIND="${2:?--agent-bind needs an IP}"; shift ;;
    --agent-port) AGENT_PORT="${2:?--agent-port needs a port}"; shift ;;
    --hub-ip) HUB_IP="${2:?--hub-ip needs an IP}"; shift ;;
    --ufw-allow-from) UFW_FROM="${2:?--ufw-allow-from needs an IP}"; shift ;;
    --ufw-interface) UFW_IFACE="${2:?--ufw-interface needs an interface}"; shift ;;
    --after) AGENT_AFTER="${2:?--after needs a systemd unit}"; shift ;;
    --memory-max) AGENT_MEMORY_MAX="${2:?--memory-max needs a size}"; shift ;;
    --prebuilt) PREBUILT=1 ;;
    --rotate-token) ROTATE_TOKEN=1 ;;
    --add-host) MODE=add-host; ADD_HOST="${2:?--add-host needs an id}"; shift ;;
    --url) ADD_URL="${2:?--url needs a URL}"; shift ;;
    --token-file) TOKEN_FILE="${2:?--token-file needs a file}"; shift ;;
    --label) ADD_LABEL="${2:?--label needs text}"; shift ;;
    --replace) REPLACE=1 ;;
    --no-db-backup) NO_DB_BACKUP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 64 ;;
  esac
  shift
done

case "$SERVICE" in ""|pm2|systemd|none) ;; *) echo "--service must be pm2, systemd or none" >&2; exit 64 ;; esac
if [ -n "$PORT" ] && ! [[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1 && "$PORT" -le 65535 ]]; then
  echo "--port must be 1-65535" >&2; exit 64
fi
if [ -n "$NVME_DEVICE" ] && ! [[ "$NVME_DEVICE" =~ ^/dev/nvme[0-9]+(n[0-9]+)?$ ]]; then
  echo "--nvme-device must look like /dev/nvme0 or /dev/nvme0n1" >&2; exit 64
fi
is_ip() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ || "$1" =~ ^[0-9a-fA-F:]*:[0-9a-fA-F:]*$ ]]; }
for pair in "--agent-bind:$AGENT_BIND" "--hub-ip:$HUB_IP" "--ufw-allow-from:$UFW_FROM"; do
  v="${pair#*:}"
  if [ -n "$v" ] && ! is_ip "$v"; then echo "${pair%%:*} must be an IP address" >&2; exit 64; fi
done
if [ -n "$AGENT_PORT" ] && ! [[ "$AGENT_PORT" =~ ^[0-9]+$ && "$AGENT_PORT" -ge 1 && "$AGENT_PORT" -le 65535 ]]; then
  echo "--agent-port must be 1-65535" >&2; exit 64
fi
if [ "$MODE" = add-host ]; then
  if ! [[ "$ADD_HOST" =~ ^[a-z0-9-]{1,32}$ ]] || [ "$ADD_HOST" = local ]; then
    echo "--add-host: the id must be [a-z0-9-]{1,32} and not \"local\"" >&2; exit 64
  fi
  ADD_URL="${ADD_URL%/}"
  if ! [[ "$ADD_URL" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
    echo "--add-host needs --url http(s)://host[:port] (no path, query or credentials)" >&2; exit 64
  fi
  if [ -n "$ADD_LABEL" ] && ! [[ "$ADD_LABEL" =~ ^[[:print:]]{1,64}$ && "$ADD_LABEL" != *,* && "$ADD_LABEL" != *=* ]]; then
    echo "--label: up to 64 printable characters, no , or =" >&2; exit 64
  fi
fi
if [ "$MODE" != agent ] && { [ -n "$UFW_FROM$UFW_IFACE$AGENT_AFTER$AGENT_MEMORY_MAX" ] || [ "$ROTATE_TOKEN" = 1 ] || [ "$PREBUILT" = 1 ]; }; then
  echo "--ufw-allow-from, --ufw-interface, --after, --memory-max, --prebuilt and --rotate-token go with --agent" >&2; exit 64
fi
if [ -n "$UFW_IFACE" ]; then
  [ -n "$UFW_FROM" ] || { echo "--ufw-interface goes with --ufw-allow-from" >&2; exit 64; }
  [[ "$UFW_IFACE" =~ ^[A-Za-z0-9_.-]{1,15}$ ]] || { echo "--ufw-interface must be an interface name (1-15 of A-Z a-z 0-9 _ . -)" >&2; exit 64; }
fi
# A unit name, optionally without ".service": wg-quick@wg-pideck, network-online.target.
if [ -n "$AGENT_AFTER" ]; then
  [[ "$AGENT_AFTER" == *.* ]] || AGENT_AFTER="$AGENT_AFTER.service"
  if ! [[ "$AGENT_AFTER" =~ ^[A-Za-z0-9:_.@-]{1,200}\.(service|target|mount|device|socket)$ ]] || [[ "$AGENT_AFTER" == pideck-agent.* ]]; then
    echo "--after must be a systemd unit name such as wg-quick@wg-pideck(.service)" >&2; exit 64
  fi
fi
# Plain systemd sizes only (K/M/G, no percentages, no "infinity"); at least
# 96M, since the agent itself needs ~90 MB and would be OOM-killed in a loop.
if [ -n "$AGENT_MEMORY_MAX" ]; then
  if ! [[ "$AGENT_MEMORY_MAX" =~ ^([0-9]{1,6})([KMG])$ ]]; then
    echo "--memory-max must be a size like 160M or 1G" >&2; exit 64
  fi
  n=$((10#${BASH_REMATCH[1]}))   # 10#: "0160M" is not octal
  case "${BASH_REMATCH[2]}" in K) mem_mb=$(( n / 1024 )) ;; M) mem_mb=$n ;; G) mem_mb=$(( n * 1024 )) ;; esac
  [ "$mem_mb" -ge 96 ] || { echo "--memory-max must be at least 96M (the agent needs ~90 MB)" >&2; exit 64; }
fi

# Refuse root before touching anything (not even the log directory).
if [ "$(id -u)" -eq 0 ]; then
  echo "Error: run this as the user who will own PiDeck, not as root (sudo is used where needed)." >&2
  exit 1
fi

# ── output & logging ───────────────────────────────────────────────────
# fd 3 = the real terminal (for the one-time password, which must not reach
# the log); everything else is tee'd into the log. A dry run writes its log
# to $TMPDIR so it leaves $HOME and the checkout untouched.
if [ "$DRY_RUN" = 1 ]; then
  LOG="${TMPDIR:-/tmp}/pideck-install-dryrun-$TS.log"
else
  mkdir -p "$HOME/logs"
  LOG="$HOME/logs/pideck-install-$TS.log"
fi
exec 3>&1
exec > >(tee -a "$LOG") 2>&1
TEE_PID=$!

if [ -t 3 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != dumb ]; then
  B=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; RST=$'\033[0m'
else
  B=""; RED=""; GRN=""; YEL=""; CYN=""; RST=""
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pideck-install.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

# ── identity ───────────────────────────────────────────────────────────
RUN_USER="$(id -un)"
ENV_FILE="$APP_DIR/.env"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pideck"
PW_FILE="$CONFIG_DIR/admin-password"
DB_MARKER="$CONFIG_DIR/install-db"

# ── modules ────────────────────────────────────────────────────────────
# shellcheck source=install/common.sh
source "$SCRIPT_DIR/install/common.sh"
# shellcheck source=install/db.sh
source "$SCRIPT_DIR/install/db.sh"
# shellcheck source=install/hub.sh
source "$SCRIPT_DIR/install/hub.sh"
# shellcheck source=install/agent.sh
source "$SCRIPT_DIR/install/agent.sh"
# shellcheck source=install/add-host.sh
source "$SCRIPT_DIR/install/add-host.sh"
# shellcheck source=install/update.sh
source "$SCRIPT_DIR/install/update.sh"

printf '%sPiDeck installer%s — %s in %s as %s%s\n' "$B" "$RST" "$MODE" "$APP_DIR" "$RUN_USER" "$([ "$DRY_RUN" = 1 ] && echo " (dry run: nothing will change)")"
info "log: $LOG"

# ── main ───────────────────────────────────────────────────────────────
cd "$APP_DIR"
if [ "$MODE" = update ]; then
  preflight
  update
  exit 0
fi
if [ "$MODE" = agent ]; then
  agent_install
  exit 0
fi
if [ "$MODE" = add-host ]; then
  add_host
  exit 0
fi

# Defaults that depend on what's installed / configured.
PORT="${PORT:-$(env_get PORT)}"; PORT="${PORT:-5006}"
detect_service   # an existing pideck pm2 app / unit wins, so re-runs never start a second copy
if [ "$LAN_HTTP" = 1 ]; then
  warn "--lan-http: the session cookie will be sent over plain HTTP. Anyone on the network path"
  warn "can steal a session. Use only on a trusted LAN; prefer HTTPS via a reverse proxy."
  # Interactive runs confirm (default No); --yes means the flag was deliberate.
  if [ "$DRY_RUN" != 1 ] && [ "$YES" != 1 ] && ! confirm "Enable plain-HTTP login (PIDECK_INSECURE_HTTP=1)?" n; then
    LAN_HTTP=0; info "keeping HTTPS-only cookies"
  fi
fi

preflight
plan_sudo
packages
database
write_env
deps
schema
admin_password
build
service
sudoers
health
summary
