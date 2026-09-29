#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: One-command install / re-run / update for PiDeck on Ubuntu or
#              Debian (arm64 Raspberry Pi and amd64). Idempotent: re-running
#              only fills in what is missing. Run as the user who will own
#              PiDeck (not root); sudo is used only for the steps it lists
#              up front. Start with --dry-run: it prints every action and
#              changes nothing.
# Modified:    2026-09-30
# Usage:       scripts/install.sh --dry-run            # see what would happen
#              scripts/install.sh                      # interactive install
#              scripts/install.sh --yes --lan-http     # unattended, plain-HTTP LAN
#              scripts/install.sh --update             # pull, build, restart, check
#              scripts/install.sh --agent --dry-run    # read-only agent (multi-host)
#              scripts/install.sh --add-host piapps2 --url http://192.168.50.120:5016
#              scripts/install.sh --help               # all flags
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
# --update re-runs itself once when the pull changed this script (see
# reexec_after_pull); the second run keeps the first run's timestamp/log.
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
if [ "$MODE" != agent ] && { [ -n "$UFW_FROM$UFW_IFACE$AGENT_AFTER$AGENT_MEMORY_MAX" ] || [ "$ROTATE_TOKEN" = 1 ]; }; then
  echo "--ufw-allow-from, --ufw-interface, --after, --memory-max and --rotate-token go with --agent" >&2; exit 64
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
step() { printf '\n%s==> %s%s\n' "$B$CYN" "$*" "$RST"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$*"; }
die()  { printf '%sError:%s %s\n' "$RED" "$RST" "$*"; exit 1; }
dry()  { printf '  %s[dry-run]%s would %s\n' "$YEL" "$RST" "$*"; }

# Quote a command for display (secrets are never passed as arguments).
show_cmd() { local out="" a; for a in "$@"; do out+="$(printf '%q' "$a") "; done; printf '%s' "${out% }"; }

# run "what" cmd…   — mutating command; skipped (and printed) in dry-run
run() {
  local what="$1"; shift
  if [ "$DRY_RUN" = 1 ]; then dry "$what: $(show_cmd "$@")"; return 0; fi
  info "$what"
  "$@"
}
# as run, but the command's own output goes to the log only (npm ci/build are
# very chatty); on failure the last lines are shown.
qrun() {
  local what="$1"; shift
  if [ "$DRY_RUN" = 1 ]; then dry "$what: $(show_cmd "$@")"; return 0; fi
  info "$what (output in the log)"
  if ! "$@" >> "$LOG" 2>&1; then
    tail -n 25 "$LOG"
    die "$what failed (full output: $LOG)"
  fi
}
# as run, but with sudo (and listed in the sudo plan)
srun() { local what="$1"; shift; run "$what" sudo "$@"; }

confirm() { # confirm "question" default(y|n)
  local q="$1" def="${2:-y}" ans
  if [ "$YES" = 1 ]; then [ "$def" = y ]; return; fi
  if [ ! -t 0 ]; then [ "$def" = y ]; return; fi
  { printf '%s' "  $q [$([ "$def" = y ] && echo Y/n || echo y/N)] " >/dev/tty; read -r ans </dev/tty; } 2>/dev/null || ans=""
  ans="${ans:-$def}"
  [[ "$ans" =~ ^[Yy] ]]
}

# install_file SRC DEST MODE [sudo] — atomic install; backs up and summarises
# the change when DEST exists and differs. SRC is a validated temp file.
# Does a (root-owned) path exist? /etc/sudoers.d is 0750 root on Debian/
# Ubuntu, so a plain `[ -e ]` from the owning user is always false there.
# Ask sudo only when the directory can't be searched.
path_exists() {
  local p="$1"
  [ -e "$p" ] && return 0
  [ -x "$(dirname "$p")" ] && return 1
  sudo -n test -e "$p" 2>/dev/null
}
install_file() {
  local src="$1" dest="$2" mode="$3" use_sudo="${4:-}" pre=()
  [ -n "$use_sudo" ] && pre=(sudo)
  local exists=0
  if [ -n "$use_sudo" ]; then path_exists "$dest" && exists=1; else [ -e "$dest" ] && exists=1; fi
  if [ "$exists" = 1 ] && "${pre[@]}" cmp -s "$src" "$dest"; then ok "$dest unchanged"; return 0; fi
  if [ "$exists" = 1 ]; then
    local added removed
    added=$("${pre[@]}" diff "$dest" "$src" | grep -c '^>' || true)
    removed=$("${pre[@]}" diff "$dest" "$src" | grep -c '^<' || true)
    run "back up $dest" "${pre[@]}" cp -p "$dest" "$dest.bak.$TS"
    info "$dest: +$added / -$removed lines (backup: $dest.bak.$TS)"
  fi
  run "install $dest (mode $mode)" "${pre[@]}" install -m "$mode" "$src" "$dest"
}

# render TEMPLATE OUT KEY=VALUE… — plain string replacement, no sed, so
# values may contain any character (paths, '#', '/').
render() {
  local src="$1" out="$2" line kv; shift 2
  : > "$out"
  while IFS= read -r line || [ -n "$line" ]; do
    for kv in "$@"; do line="${line//"${kv%%=*}"/"${kv#*=}"}"; done
    printf '%s\n' "$line" >> "$out"
  done < "$src"
}

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pideck-install.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

# ── identity ───────────────────────────────────────────────────────────
RUN_USER="$(id -un)"
ENV_FILE="$APP_DIR/.env"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pideck"
PW_FILE="$CONFIG_DIR/admin-password"
DB_MARKER="$CONFIG_DIR/install-db"

printf '%sPiDeck installer%s — %s in %s as %s%s\n' "$B" "$RST" "$MODE" "$APP_DIR" "$RUN_USER" "$([ "$DRY_RUN" = 1 ] && echo " (dry run: nothing will change)")"
info "log: $LOG"

# ── .env helpers ───────────────────────────────────────────────────────
env_get() { # env_get KEY → value from .env ("" if absent)
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}
env_has() { [ -f "$ENV_FILE" ] && grep -q "^$1=" "$ENV_FILE"; }

osr() { sed -n "s/^$1=//p" /etc/os-release 2>/dev/null | tr -d '"' | head -n 1; }
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
have() { command -v "$1" >/dev/null 2>&1; }
sbin_have() { have "$1" || [ -x "/usr/sbin/$1" ] || [ -x "/sbin/$1" ]; }
tool_path() { command -v "$1" 2>/dev/null || { [ -x "/usr/sbin/$1" ] && echo "/usr/sbin/$1"; } || { [ -x "/sbin/$1" ] && echo "/sbin/$1"; } || true; }

local_pg_running() { have pg_lsclusters && pg_lsclusters --no-header 2>/dev/null | grep -q ' online '; }

detect_nvme() {
  [ -n "$NVME_DEVICE" ] && { echo "$NVME_DEVICE"; return; }
  local d; for d in /dev/nvme0 /dev/nvme1 /dev/nvme2 /dev/nvme3; do [ -e "$d" ] && { echo "$d"; return; }; done
}

pm2_bin() { have pm2 && command -v pm2 || { [ -x "$APP_DIR/node_modules/.bin/pm2" ] && echo "$APP_DIR/node_modules/.bin/pm2"; } || true; }
# Asking pm2 anything (even `describe`) starts a pm2 daemon when none is
# running, which a systemd host doesn't want. Probe the pid file first: no
# live daemon means no pm2 app 'pideck' is running either.
pm2_daemon_running() {
  local f="${PM2_HOME:-$HOME/.pm2}/pm2.pid" pid
  [ -f "$f" ] || return 1
  pid="$(cat "$f" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] && [ -e "/proc/$pid" ]
}
pm2_has_pideck() { [ -n "${1:-}" ] && pm2_daemon_running && "$1" describe pideck >/dev/null 2>&1; }

# ── 1. preflight (read-only) ───────────────────────────────────────────
MISSING_REQ=(); APT_PKGS=()
preflight() {
  step "Preflight (read-only)"
  local os arch
  os="$(osr PRETTY_NAME)"
  arch="$(uname -m)"
  info "OS: ${os:-unknown} · arch: $arch"
  case "$arch" in
    aarch64|arm64|x86_64|amd64) ;;
    *) warn "arch $arch is untested (PiDeck runs on aarch64 and x86_64)" ;;
  esac
  case "$(osr ID) $(osr ID_LIKE)" in
    *debian*|*ubuntu*) ;;
    *) warn "not Debian/Ubuntu: package names and paths may differ" ;;
  esac

  local pg_state="missing"
  if [ -n "$DB_URL" ] || env_has DATABASE_URL; then pg_state="external/configured"
  elif local_pg_running; then pg_state="local (running)"
  elif have psql; then pg_state="client only"; fi

  printf '\n  %-14s %-18s %s\n' "TOOL" "STATUS" "NEEDED FOR"
  row() { printf '  %-14s %-18s %s\n' "$1" "$2" "$3"; }
  local nm; nm="$(node_major || true)"
  if [ -z "$nm" ]; then row node "missing" "required (22.x)"; MISSING_REQ+=(node)
  elif [ "$nm" -lt 22 ]; then row node "v$nm (too old)" "required (22.x)"; MISSING_REQ+=(node)
  else row node "v$nm$([ "$nm" -gt 22 ] && echo ' (untested)')" "required"; fi
  if have npm; then row npm found required; else row npm missing required; MISSING_REQ+=(npm); fi
  if have git; then row git found required; else row git missing required; MISSING_REQ+=(git); fi
  if have curl; then row curl found "required (health check)"; else row curl missing required; APT_PKGS+=(curl); fi
  if have openssl; then row openssl found "required (secrets)"; else row openssl missing required; APT_PKGS+=(openssl); fi
  if [ "$MODE" = agent ]; then
    row postgresql "not needed" "agent mode keeps no database"
  else
    case "$pg_state" in
      missing|"client only") row postgresql "$pg_state" "required (or --database-url)"; APT_PKGS+=(postgresql) ;;
      *) row postgresql "$pg_state" required ;;
    esac
  fi
  if [ "$MODE" = agent ]; then row systemd "$(have systemctl && echo found || echo missing)" "service pideck-agent"
  elif have pm2; then row pm2 found "service (default when installed)"
  elif [ "$SERVICE" = pm2 ]; then row pm2 "from npm ci" "service: the repo's own pm2 (node_modules/.bin)"
  else row pm2 "optional-missing" "service: systemd unless --service pm2"; fi
  if have docker; then row docker found "Apps › Docker"; else row docker "optional-missing" "Apps › Docker shows 'not available'"; fi
  if have sensors; then row lm-sensors found "CPU temperature fallback"; else row lm-sensors "optional-missing" "CPU temperature on non-Pi hosts"; APT_PKGS+=(lm-sensors); fi
  if sbin_have smartctl; then row smartmontools found "NVMe Health"; else row smartmontools "optional-missing" "NVMe Health"; APT_PKGS+=(smartmontools); fi
  if sbin_have ufw; then row ufw found "Firewall (needs --sudoers)"; else row ufw "optional-missing" "Firewall shows 'not available'"; fi
  if [ -x /usr/bin/vcgencmd ]; then row vcgencmd found "Power Status (Pi only)"; else row vcgencmd "optional-missing" "Power Status is Pi-only"; fi
  local nvme; nvme="$(detect_nvme || true)"
  row "NVMe device" "${nvme:-none}" "NVMe Health"

  if [[ " ${MISSING_REQ[*]} " == *" node "* ]]; then
    cat <<EOF

  Node.js 22.x is required. Install it from NodeSource with a signed apt
  repository (review each step; nothing is piped into a shell):

    sudo install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /tmp/nodesource.gpg.key
    sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg /tmp/nodesource.gpg.key
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /tmp/nodesource.list
    sudo install -m 0644 /tmp/nodesource.list /etc/apt/sources.list.d/nodesource.list
    sudo apt-get update && sudo apt-get install -y nodejs

  Then run scripts/install.sh again.
EOF
  fi
  [ ${#MISSING_REQ[@]} -eq 0 ] || die "missing required: ${MISSING_REQ[*]}"
}

# ── plan: say up front what needs sudo ─────────────────────────────────
plan_sudo() {
  local steps=()
  [ "$NO_APT" != 1 ] && [ ${#APT_PKGS[@]} -gt 0 ] && steps+=("apt-get install ${APT_PKGS[*]}")
  [ -z "$DB_URL" ] && ! env_has DATABASE_URL && steps+=("create the PostgreSQL role + database (sudo -u postgres psql)")
  [ "$SERVICE" = systemd ] && steps+=("install /etc/systemd/system/pideck.service, systemctl enable --now")
  [ "$SUDOERS" = 1 ] && steps+=("install /etc/sudoers.d/pideck (visudo-checked, 0440)")
  step "Plan"
  info "service: $SERVICE · port: $PORT · $([ "$LAN_HTTP" = 1 ] && echo "LAN HTTP (insecure cookie)" || echo "HTTPS via reverse proxy")"
  if [ ${#steps[@]} -eq 0 ]; then info "no sudo needed"
  else info "These steps use sudo:"; local s; for s in "${steps[@]}"; do info "  • $s"; done; fi
  if [ "$DRY_RUN" != 1 ] && ! confirm "Continue?" y; then die "stopped by user"; fi
}

# ── 2. packages ────────────────────────────────────────────────────────
packages() {
  step "Packages"
  if [ ${#APT_PKGS[@]} -eq 0 ]; then ok "nothing to install"; return; fi
  if [ "$NO_APT" = 1 ]; then warn "--no-apt: not installing ${APT_PKGS[*]}"; return; fi
  if ! confirm "Install ${APT_PKGS[*]} with apt-get?" y; then warn "skipped: ${APT_PKGS[*]}"; return; fi
  # A broken third-party repo makes `apt-get update` fail even though the main
  # archive is fine; warn and try the install anyway.
  srun "apt-get update" apt-get update || warn "apt-get update reported errors (a third-party repository?); trying the install anyway"
  srun "apt-get install ${APT_PKGS[*]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y "${APT_PKGS[@]}" \
    || warn "apt-get install failed; continuing (required pieces are checked again later)"
}

# ── 3a. .env ───────────────────────────────────────────────────────────
DATABASE_URL_VALUE=""
write_env() {
  step ".env"
  local tmp="$TMP_DIR/env" added=() k v
  if [ -f "$ENV_FILE" ]; then cp "$ENV_FILE" "$tmp"
  elif [ -f "$APP_DIR/.env.example" ]; then
    # New .env: the example's comments, with its KEY= lines commented out so
    # its placeholder values never count as set; real values are appended below.
    sed -E 's/^([A-Z][A-Z0-9_]*=)/# \1/' "$APP_DIR/.env.example" > "$tmp"
  else : > "$tmp"; fi
  local -A want=(
    [NODE_ENV]=production
    [PORT]="$PORT"
    [PIDECK_LOGS_DIR]="$HOME/logs"
    [PM2_LOGS_DIR]="$HOME/.pm2/logs"
    [CSP_ENFORCE]=true
  )
  [ -n "$DATABASE_URL_VALUE" ] && want[DATABASE_URL]="$DATABASE_URL_VALUE"
  if [ "$LAN_HTTP" = 1 ]; then want[PIDECK_INSECURE_HTTP]=1; want[TRUST_PROXY]=false; fi
  [ -n "$NVME_DEVICE" ] && want[PIDECK_NVME_DEVICE]="$NVME_DEVICE"
  if ! env_has SESSION_SECRET; then
    if [ "$DRY_RUN" = 1 ]; then want[SESSION_SECRET]="(generated)"; else want[SESSION_SECRET]="$(openssl rand -hex 32)"; fi
  fi
  local order=(NODE_ENV PORT SESSION_SECRET DATABASE_URL CSP_ENFORCE PIDECK_LOGS_DIR PM2_LOGS_DIR PIDECK_INSECURE_HTTP TRUST_PROXY PIDECK_NVME_DEVICE)
  local header=0
  for k in "${order[@]}"; do
    [ -n "${want[$k]+x}" ] || continue
    if env_has "$k"; then
      v="$(env_get "$k")"
      case "$k" in
        NODE_ENV) [ "$v" = production ] || warn ".env has NODE_ENV=$v (kept; production recommended)" ;;
        PIDECK_INSECURE_HTTP) [ "$v" = 1 ] || warn ".env has PIDECK_INSECURE_HTTP=$v (kept); --lan-http not applied" ;;
      esac
      continue
    fi
    if [ "$header" = 0 ]; then printf '\n# added by scripts/install.sh %s\n' "$TS" >> "$tmp"; header=1; fi
    printf '%s=%s\n' "$k" "${want[$k]}" >> "$tmp"
    added+=("$k")
  done
  if [ ${#added[@]} -eq 0 ]; then ok ".env has every key (values untouched)"; return; fi
  info "adding: ${added[*]} (existing values are never changed; secrets not shown)"
  if [ "$DRY_RUN" = 1 ]; then dry "write $ENV_FILE (mode 0600) with the keys above"; return; fi
  install_file "$tmp" "$ENV_FILE" 600
}

# ── 3b. database ───────────────────────────────────────────────────────
DB_NAME="${PIDECK_DB_NAME:-pideck}"
DB_USER="${PIDECK_DB_USER:-pideck}"
database() {
  step "Database"
  if [ -n "$DB_URL" ]; then
    DATABASE_URL_VALUE="$DB_URL"
    if env_has DATABASE_URL && [ "$(env_get DATABASE_URL)" != "$DB_URL" ]; then
      warn ".env already has a different DATABASE_URL — keeping it (edit .env to switch)"
    else ok "using --database-url (not shown)"; fi
    return
  fi
  if env_has DATABASE_URL; then ok "DATABASE_URL already in .env (not shown)"; return; fi
  if ! local_pg_running && [ "$DRY_RUN" != 1 ]; then
    die "no running local PostgreSQL. Install it (without --no-apt) or pass --database-url."
  fi
  local pw
  if [ "$DRY_RUN" = 1 ]; then pw="(generated)"; else pw="$(openssl rand -hex 24)"; fi
  # Idempotent: create the role/db if missing; (re)set the role password so
  # the new .env can connect. SQL goes in on stdin, never as arguments.
  # The two marker SELECTs print which objects are about to be created, so
  # uninstall --purge only ever drops what this installer made.
  local sql
  sql="$(cat <<SQL
SELECT 'created_role' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER');
SELECT 'created_db' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME');
SELECT 'CREATE ROLE "$DB_USER" LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER')\\gexec
ALTER ROLE "$DB_USER" WITH LOGIN PASSWORD '$pw';
SELECT 'CREATE DATABASE "$DB_NAME" OWNER "$DB_USER"' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME')\\gexec
SQL
)"
  if [ "$DRY_RUN" = 1 ]; then
    dry "sudo -u postgres psql: create role \"$DB_USER\" and database \"$DB_NAME\" if missing, set a generated role password"
    dry "record what was created in $DB_MARKER (uninstall --purge drops only that)"
  else
    info "creating role \"$DB_USER\" and database \"$DB_NAME\" if missing (password generated, not shown)"
    local out
    out="$(cd /tmp && printf '%s\n' "$sql" | sudo -u postgres psql -X -q -At -v ON_ERROR_STOP=1)"
    record_db_created "$(grep -qx created_role <<<"$out" && echo 1 || echo 0)" \
                      "$(grep -qx created_db <<<"$out" && echo 1 || echo 0)"
  fi
  DATABASE_URL_VALUE="postgresql://$DB_USER:$pw@localhost:5432/$DB_NAME"
}

# What this installer created (0600, outside the repo). Only these objects
# are ever dropped by uninstall --purge; an existing role/db is never "ours".
# A re-run never downgrades an earlier "created" to 0.
record_db_created() {
  local role="$1" db="$2" prev_role=0 prev_db=0
  if [ -f "$DB_MARKER" ] && grep -qx "DB_NAME=$DB_NAME" "$DB_MARKER" && grep -qx "DB_USER=$DB_USER" "$DB_MARKER"; then
    grep -qx 'CREATED_ROLE=1' "$DB_MARKER" && prev_role=1
    grep -qx 'CREATED_DB=1' "$DB_MARKER" && prev_db=1
  fi
  [ "$prev_role" = 1 ] && role=1
  [ "$prev_db" = 1 ] && db=1
  install -d -m 700 "$CONFIG_DIR"
  local tmp="$TMP_DIR/db-marker"
  printf 'DB_NAME=%s\nDB_USER=%s\nCREATED_ROLE=%s\nCREATED_DB=%s\n' "$DB_NAME" "$DB_USER" "$role" "$db" > "$tmp"
  install -m 600 "$tmp" "$DB_MARKER"
  if [ "$role$db" = 00 ]; then warn "role and database already existed: uninstall --purge will leave them alone"
  else ok "recorded in $DB_MARKER: created role=$role db=$db"; fi
}

helper() { DATABASE_URL="$(env_get DATABASE_URL)" node "$APP_DIR/scripts/install-helper.mjs" "$@"; }

# ── 6a. dependencies (npm ci before schema/password: they use node_modules) ──
deps() {
  step "Dependencies"
  qrun "npm ci" npm ci --no-audit --no-fund
}

# ── 3c. schema ─────────────────────────────────────────────────────────
schema() {
  step "Schema (migrations)"
  if [ "$DRY_RUN" = 1 ]; then dry "npm run db:migrate (a pre-2.5 database gets a baseline mark first; then pending migrations)"; return; fi
  helper db-check >/dev/null || die "cannot reach the database (see the message above)"
  # Fresh database: every migration runs. Existing (2.3/2.4) database: 0000 is
  # recorded without running, then only the new ones run. Each in its own transaction.
  db_migrate || die "schema migration failed (see above); nothing else was changed"
  [ -z "$(helper tables)" ] || die "migrations finished but PiDeck tables are still missing"
  ok "schema up to date"
}

# npm run db:migrate, with its (secret-free) output on the terminal and in the log.
db_migrate() {
  (cd "$APP_DIR" && node scripts/migrate.mjs)
}

# pg_dump -Fc of the PiDeck database to ~/backups (update only). Sets DB_DUMP.
DB_DUMP=""
db_backup() {
  DB_DUMP="$HOME/backups/pideck-db-$TS.dump"
  if [ "$NO_DB_BACKUP" = 1 ]; then warn "--no-db-backup: not dumping the database before migrating"; DB_DUMP=""; return; fi
  if [ "$DRY_RUN" = 1 ]; then dry "pg_dump -Fc the PiDeck database to $DB_DUMP (0600)"; return; fi
  have pg_dump || die "pg_dump not found: install postgresql-client (same major version as the server), or pass --no-db-backup"
  install -d -m 700 "$HOME/backups"
  local size
  size="$(helper db-dump "$DB_DUMP")" || die "database backup failed; nothing was migrated (see above)"
  ok "database backed up: $DB_DUMP ($size bytes)"
}

restore_hint() {
  [ -n "$DB_DUMP" ] || return 0
  info "Restore the database from before this update, if needed:"
  info "  cd $APP_DIR && pg_restore --clean --if-exists --no-owner --dbname \"\$(sed -n 's/^DATABASE_URL=//p' .env)\" $DB_DUMP"
}

# ── 5. admin password ──────────────────────────────────────────────────
GENERATED_PW=0
admin_password() {
  step "Admin password"
  if [ "$DRY_RUN" = 1 ]; then
    dry "make sure the DB admin isn't on the seeded 'admin' password: use ${PW_SOURCE:-a prompted or generated password}, store it in $PW_FILE (0600)"
    return
  fi
  local state; state="$(helper admin-state "$PW_FILE")"
  if [ "$state" = custom ] && [ "$RESET_PW" != 1 ]; then ok "admin password was changed in the UI — keeping it (use --reset-password to replace)"; return; fi
  if [ "$state" = matches ] && [ "$RESET_PW" != 1 ]; then ok "admin password matches $PW_FILE"; return; fi

  install -d -m 700 "$CONFIG_DIR"
  local src="$PW_SOURCE" tmp="$TMP_DIR/pw"
  ( umask 077; : > "$tmp" )
  if [ -z "$src" ]; then
    if [ "$YES" = 1 ] || [ ! -t 0 ]; then src=generate
    elif confirm "Generate a strong admin password? (No = type your own)" y; then src=generate
    else src=prompt; fi
  fi
  case "$src" in
    generate)
      # 20 chars, guaranteed to pass the UI's rules (lower, upper, digit, special).
      printf '%s' "$(openssl rand -base64 18 | tr -d '/+=\n' | cut -c1-16)aZ9-" > "$tmp"
      GENERATED_PW=1 ;;
    prompt)
      local a b
      read -r -s -p "  New admin password: " a </dev/tty; echo
      read -r -s -p "  Repeat: " b </dev/tty; echo
      [ "$a" = "$b" ] || die "passwords don't match"
      printf '%s' "$a" > "$tmp"; unset a b ;;
    file:*)
      local f="${src#file:}"
      [ -f "$f" ] || die "password file $f not found"
      cp "$f" "$tmp"; chmod 600 "$tmp" ;;
  esac
  local problem; problem="$(node "$APP_DIR/scripts/install-helper.mjs" strength "$tmp")"
  [ "$problem" = ok ] || die "admin password needs $problem (same rules as Settings)"
  install -m 600 "$tmp" "$PW_FILE"
  local force=(); [ "$RESET_PW" = 1 ] && force=(--force)
  local result; result="$(helper set-admin "$PW_FILE" "${force[@]}")"
  case "$result" in
    set) ok "admin password set (stored in $PW_FILE, mode 0600)" ;;
    unchanged*) ok "admin password unchanged" ;;
  esac
}

# ── 6b. build ──────────────────────────────────────────────────────────
build() {
  step "Build"
  qrun "npm run build" npm run build
  # The commit this dist/ was built from: --update's rollback target, even
  # when someone ran git pull by hand before --update.
  if [ "$DRY_RUN" = 1 ]; then dry "record the built commit in dist/.build-commit"; return; fi
  if [ -d "$APP_DIR/dist" ]; then
    git -C "$APP_DIR" rev-parse HEAD > "$APP_DIR/dist/.build-commit"
    ok "dist/.build-commit = $(git -C "$APP_DIR" rev-parse --short HEAD)"
  fi
}

# The commit the running dist/ was built from (dist/.build-commit), else HEAD.
build_commit() {
  local c=""
  [ -f "$APP_DIR/dist/.build-commit" ] && c="$(tr -d '[:space:]' < "$APP_DIR/dist/.build-commit")"
  if [[ "$c" =~ ^[0-9a-f]{40}$ ]] && git -C "$APP_DIR" cat-file -e "$c^{commit}" 2>/dev/null; then
    git -C "$APP_DIR" rev-parse --short "$c"
  else
    git -C "$APP_DIR" rev-parse --short HEAD
  fi
}

# ── 7. service ─────────────────────────────────────────────────────────
service() {
  step "Service ($SERVICE)"
  # One instance only: refuse to add a second service manager next to an existing one.
  local p; p="$(pm2_bin)"
  if [ "$SERVICE" != pm2 ] && pm2_has_pideck "$p"; then
    die "a pm2 app 'pideck' already runs this; remove it first ($p delete pideck && $p save) or use --service pm2"
  fi
  if [ "$SERVICE" != systemd ] && [ -f "$ETC/systemd/system/pideck.service" ]; then
    die "$ETC/systemd/system/pideck.service already runs this; run scripts/uninstall.sh first or use --service systemd"
  fi
  case "$SERVICE" in
    none) info "not managing a service; start it with: cd $APP_DIR && node dist/index.js" ;;
    pm2)
      local pm2; pm2="$(pm2_bin)"
      # pm2 is a dependency, so after npm ci the repo's copy is there.
      [ -n "$pm2" ] || [ "$DRY_RUN" != 1 ] || pm2="$APP_DIR/node_modules/.bin/pm2"
      [ -n "$pm2" ] || die "pm2 not found (npm i -g pm2, or --service systemd)"
      if pm2_has_pideck "$pm2"; then
        run "restart the existing pm2 app 'pideck'" "$pm2" restart pideck --update-env
      else
        run "start pideck under pm2" "$pm2" start "$APP_DIR/ecosystem.config.cjs"
      fi
      run "pm2 save" "$pm2" save
      info "To start at boot, run once:  $pm2 startup   (then run the sudo line it prints)"
      ;;
    systemd)
      local unit="$ETC/systemd/system/pideck.service" tmp="$TMP_DIR/pideck.service" nodebin
      nodebin="$(command -v node)"
      render "$APP_DIR/deploy/systemd/pideck.service.template" "$tmp" "@USER@=$RUN_USER" "@APP_DIR@=$APP_DIR" "@NODE@=$nodebin"
      if have systemd-analyze; then
        local verr; verr="$(systemd-analyze verify "$tmp" 2>&1)" || die "systemd-analyze verify rejected the unit; nothing installed: $(printf '%s' "$verr" | head -n 3 | tr '\n' ' ')"
        ok "systemd-analyze verify: unit OK"
      else warn "systemd-analyze not found: unit not verified"; fi
      if [ "$DRY_RUN" = 1 ]; then dry "install $unit (0644), systemctl daemon-reload, enable --now (restart if already running)"; return; fi
      install_file "$tmp" "$unit" 644 sudo
      srun "systemctl daemon-reload" systemctl daemon-reload
      if systemctl is-active --quiet pideck; then srun "restart pideck" systemctl restart pideck
      else srun "enable and start pideck" systemctl enable --now pideck; fi
      ;;
  esac
}

# ── 8. sudoers (opt-in) ────────────────────────────────────────────────
sudoers() {
  step "Sudoers"
  if [ "$SUDOERS" != 1 ]; then
    info "skipped (--sudoers not given): NVMe Health, Firewall and Update System will show 'needs a sudoers rule'."
    return
  fi
  local smart ufw apt nvme tmp="$TMP_DIR/pideck.sudoers" dest="$ETC/sudoers.d/pideck"
  smart="$(tool_path smartctl)"; ufw="$(tool_path ufw)"; apt="$(tool_path apt-get)"; nvme="$(detect_nvme || true)"
  [ -n "$apt" ] || apt=/usr/bin/apt-get
  local smart_line="# (no NVMe device or smartctl: no smartctl rule)" ufw_line="# (ufw not installed: no ufw rule)"
  [ -n "$smart" ] && [ -n "$nvme" ] && smart_line="$RUN_USER ALL=(root) NOPASSWD: $smart -a $nvme"
  [ -n "$ufw" ] && ufw_line="$RUN_USER ALL=(root) NOPASSWD: $ufw status verbose"
  local template="$APP_DIR/deploy/sudoers.d/pideck.template"
  if [ "$MODE" = agent ]; then
    # An agent is read-only: no Update System, so no apt-get rules.
    grep -v -e '@APT_GET@' -e 'apt-get lines' "$template" > "$TMP_DIR/sudoers.agent.template"
    template="$TMP_DIR/sudoers.agent.template"
  fi
  render "$template" "$tmp" "@SMARTCTL_LINE@=$smart_line" "@UFW_LINE@=$ufw_line" \
    "@USER@=$RUN_USER" "@APT_GET@=$apt"
  info "grants $RUN_USER passwordless sudo for exactly:"
  grep -E '^[^#].*NOPASSWD' "$tmp" | sed 's/^.*NOPASSWD: /    /'
  if [ "$DRY_RUN" = 1 ]; then dry "visudo -cf the rendered file, then install -m 0440 to $dest"; return; fi
  confirm "Install $dest?" y || { warn "skipped"; return; }
  sudo visudo -cf "$tmp" >/dev/null || die "rendered sudoers file failed visudo -c; nothing installed"
  install_file "$tmp" "$dest" 440 sudo
}

# ── 10. health check ───────────────────────────────────────────────────
health() {
  step "Health check"
  if [ "$SKIP_HEALTH" = 1 ] || [ "$SERVICE" = none ]; then info "skipped"; return; fi
  if [ "$DRY_RUN" = 1 ]; then dry "poll http://127.0.0.1:$PORT/healthz, then log in with $PW_FILE and GET /api/auth/me"; return; fi
  local base="http://127.0.0.1:$PORT" code=""
  for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$base/healthz" || true)"
    [ "$code" = 204 ] && break
    sleep 1
  done
  [ "$code" = 204 ] || die "/healthz did not answer 204 within 60s (see the service logs)"
  ok "/healthz 204"

  local pwf="$PW_FILE"
  if [ "$(helper admin-state "$PW_FILE")" != matches ]; then
    if [ "$CHECK_LOGIN" != 1 ]; then
      warn "admin password differs from $PW_FILE (changed in the UI): skipping the login round-trip — NOT verified; re-run with --check-login to test it"
      return
    fi
    pwf="$TMP_DIR/check-login"
    if [ -n "$CHECK_LOGIN_FILE" ]; then
      [ -f "$CHECK_LOGIN_FILE" ] || die "PIDECK_CHECK_LOGIN_FILE $CHECK_LOGIN_FILE not found"
      [[ "$(stat -c %a "$CHECK_LOGIN_FILE")" =~ 00$ ]] || die "$CHECK_LOGIN_FILE must not be readable by group/others (chmod 600)"
      ( umask 077; cp "$CHECK_LOGIN_FILE" "$pwf" )
    elif [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then
      local typed=""
      { printf '%s' "  Admin password (to test the login; input hidden): " >/dev/tty; read -r -s typed </dev/tty; } 2>/dev/null || typed=""
      echo
      [ -n "$typed" ] || die "--check-login: no password entered"
      ( umask 077; printf '%s' "$typed" > "$pwf" )
      typed=""
    else
      die "--check-login needs a terminal to ask for the password (or PIDECK_CHECK_LOGIN_FILE=<0600 file>)"
    fi
  fi
  login_roundtrip "$base" "$pwf"
  [ "$pwf" = "$PW_FILE" ] || rm -f "$pwf"
}

# Login round-trip without the password or cookie ever in argv: body and
# headers come from 0600 files. Behind TLS the cookie is Secure, so ask the
# app to act as if proxied over HTTPS and hand the cookie back by header.
login_roundtrip() { # login_roundtrip BASE PASSWORD_FILE
  local base="$1" pwf="$2" code
  local body="$TMP_DIR/login.json" hdr="$TMP_DIR/headers" cookie="$TMP_DIR/cookie" proto=()
  helper login-body "$pwf" "$body"
  [ "$(env_get PIDECK_INSECURE_HTTP)" = 1 ] || proto=(-H "X-Forwarded-Proto: https")
  code="$(curl -s -o /dev/null -D "$hdr" -w '%{http_code}' "${proto[@]}" -H 'Content-Type: application/json' --data-binary "@$body" "$base/api/auth/login")"
  rm -f "$body"
  [ "$code" = 200 ] || die "login returned $code$([ "$pwf" != "$PW_FILE" ] && echo " (wrong password?)")"
  ( umask 077; printf 'Cookie: %s\n' "$(sed -n 's/^[Ss]et-[Cc]ookie: \(pideck\.sid=[^;]*\).*/\1/p' "$hdr" | tr -d '\r')" > "$cookie" )
  local me; me="$(curl -s "${proto[@]}" -H "@$cookie" "$base/api/auth/me")"
  [[ "$me" == *'"authenticated":true'* ]] || die "logged in but /api/auth/me is not authenticated"
  curl -s -o /dev/null "${proto[@]}" -H "@$cookie" -X POST "$base/api/auth/logout" || true
  ok "login round-trip: /api/auth/me 200, authenticated"
}

# ── summary ────────────────────────────────────────────────────────────
summary() {
  step "Done"
  local url="${PUBLIC_URL:-}"
  if [ -z "$url" ]; then
    if [ "$LAN_HTTP" = 1 ] || [ "$(env_get PIDECK_INSECURE_HTTP)" = 1 ]; then
      url="http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT"
    else url="https://<your-host> (via your TLS proxy → 127.0.0.1:$PORT)"; fi
  fi
  info "Open:      $url"
  info "Service:   $SERVICE $([ "$SERVICE" = pm2 ] && echo "(pm2 status / pm2 logs pideck)")$([ "$SERVICE" = systemd ] && echo "(systemctl status pideck / journalctl -u pideck)")"
  info "Config:    $ENV_FILE (0600) · admin password file: $PW_FILE (0600)"
  info "Install log: $LOG"
  if [ "$LAN_HTTP" != 1 ] && [ "$(env_get PIDECK_INSECURE_HTTP)" != 1 ]; then
    info "HTTPS:     put PiDeck behind a TLS proxy — see deploy/nginx/pideck.conf.example and docs/INSTALL.md."
    info "           Logging in over plain http://<ip>:$PORT will not work (Secure cookie)."
  fi
  if [ "$GENERATED_PW" = 1 ] && [ "$DRY_RUN" != 1 ]; then
    # Straight to the terminal (fd 3), never into the log.
    printf '\n  %sAdmin password (shown once; also in %s):%s %s\n' "$B" "$PW_FILE" "$RST" "$(cat "$PW_FILE")" >&3
    info "(password printed to the terminal only; it is not in the log)"
  fi
}

# ── multi-host: agent install (--agent) ────────────────────────────────
# A read-only agent (docs/plans/multi-host.md): no database, no login, one
# systemd unit (pideck-agent). The token is generated here, shown once on
# the terminal (never logged), and only its SHA-256 is kept in .env.
AGENT_UNIT_NAME=pideck-agent
AGENT_MARKER="$CONFIG_DIR/install-agent"
# --after / --memory-max live in a drop-in, so --update (which re-renders the
# unit from the template) keeps them.
AGENT_DROPIN="$ETC/systemd/system/$AGENT_UNIT_NAME.service.d/10-install.conf"
AGENT_TOKEN=""          # set only when this run made a (new) token
AGENT_TOKEN_FILE=""

lan_ip() { hostname -I 2>/dev/null | awk '{print $1}'; }
# A host id for the hub: this host's short name, lower-case, [a-z0-9-]{1,32}.
suggest_host_id() {
  local h; h="$(hostname -s 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-\n' '-' | cut -c1-32)"
  [[ "$h" =~ ^[a-z0-9-]{1,32}$ ]] && [ "$h" != local ] && echo "$h" || echo "agent"
}

# Write the token to a 0600 header file for curl (-H @file): never in argv.
bearer_header_file() {
  local token="$1" out="$2"
  ( umask 077; printf 'Authorization: Bearer %s\n' "$token" > "$out" )
}

dropin_summary() {
  local parts=()
  [ -n "$AGENT_AFTER" ] && parts+=("after $AGENT_AFTER")
  [ -n "$AGENT_MEMORY_MAX" ] && parts+=("MemoryMax=$AGENT_MEMORY_MAX")
  local IFS=,; printf '%s' "${parts[*]}" | sed 's/,/, /g'
}

# Values from an existing drop-in fill in what this run doesn't set, so a
# re-run without the flags keeps them (a re-run never drops a setting).
dropin_merge() {
  [ -f "$AGENT_DROPIN" ] || return 0
  local v
  if [ -z "$AGENT_AFTER" ]; then v="$(sed -n 's/^After=//p' "$AGENT_DROPIN" | head -n 1)"; AGENT_AFTER="$v"; fi
  if [ -z "$AGENT_MEMORY_MAX" ]; then v="$(sed -n 's/^MemoryMax=//p' "$AGENT_DROPIN" | head -n 1)"; AGENT_MEMORY_MAX="$v"; fi
}

dropin_render() { # dropin_render OUT
  {
    printf '# Written by scripts/install.sh --agent (%s); re-run it to change these.\n' "$TS"
    if [ -n "$AGENT_AFTER" ]; then
      printf '# Start after (and pull in) %s, e.g. the tunnel whose address the agent binds.\n' "$AGENT_AFTER"
      printf '[Unit]\nAfter=%s\nWants=%s\n' "$AGENT_AFTER" "$AGENT_AFTER"
    fi
    if [ -n "$AGENT_MEMORY_MAX" ]; then
      printf '# Hard memory cap: on a small host the other services always win.\n'
      printf '[Service]\nMemoryMax=%s\n' "$AGENT_MEMORY_MAX"
    fi
  } > "$1"
}

# Install or refresh the drop-in; returns 0 when it changed (daemon-reload needed).
agent_dropin() {
  [ -n "$AGENT_AFTER$AGENT_MEMORY_MAX" ] || return 1
  local tmp="$TMP_DIR/dropin.conf"
  dropin_render "$tmp"
  # Same settings = no rewrite (the header's timestamp alone doesn't count).
  if [ -f "$AGENT_DROPIN" ] && diff -q <(grep -v '^#' "$tmp") <(grep -v '^#' "$AGENT_DROPIN") >/dev/null 2>&1; then
    ok "drop-in unchanged ($(dropin_summary))"; return 1
  fi
  if [ "$DRY_RUN" = 1 ]; then dry "install $AGENT_DROPIN (0644): $(dropin_summary)"; return 0; fi
  srun "create $(dirname "$AGENT_DROPIN")" install -d -m 755 "$(dirname "$AGENT_DROPIN")"
  install_file "$tmp" "$AGENT_DROPIN" 644 sudo
  ok "drop-in: $(dropin_summary)"
  return 0
}

agent_plan() {
  local steps=()
  [ "$NO_APT" != 1 ] && [ ${#APT_PKGS[@]} -gt 0 ] && steps+=("apt-get install ${APT_PKGS[*]}")
  steps+=("install $ETC/systemd/system/$AGENT_UNIT_NAME.service, systemctl enable --now")
  [ -n "$AGENT_AFTER$AGENT_MEMORY_MAX" ] && steps+=("install $AGENT_DROPIN ($(dropin_summary))")
  [ "$SUDOERS" = 1 ] && steps+=("install /etc/sudoers.d/pideck (visudo-checked, 0440; no apt-get rules on an agent)")
  [ -n "$UFW_FROM" ] && steps+=("ufw $(ufw_rule_args "$UFW_FROM" "$AGENT_PORT" "$UFW_IFACE" | tr '\n' ' ' | sed 's/ $//')")
  step "Plan (agent)"
  info "read-only agent on $AGENT_BIND:$AGENT_PORT · no database, no login, no UI"
  info "These steps use sudo:"; local s; for s in "${steps[@]}"; do info "  • $s"; done
  if [ "$DRY_RUN" != 1 ] && ! confirm "Continue?" y; then die "stopped by user"; fi
}

agent_env() {
  step ".env (agent)"
  if env_has SESSION_SECRET || env_has DATABASE_URL; then
    [ "$(env_get PIDECK_MODE)" = agent ] \
      || die "this checkout is set up as a hub (.env has SESSION_SECRET/DATABASE_URL); install the agent from a separate checkout"
  fi
  local tmp="$TMP_DIR/env" added=() k
  if [ -f "$ENV_FILE" ]; then cp "$ENV_FILE" "$tmp"
  elif [ -f "$APP_DIR/.env.example" ]; then sed -E 's/^([A-Z][A-Z0-9_]*=)/# \1/' "$APP_DIR/.env.example" > "$tmp"
  else : > "$tmp"; fi
  local -A want=([NODE_ENV]=production [PIDECK_MODE]=agent [PIDECK_AGENT_PORT]="$AGENT_PORT" [PIDECK_AGENT_BIND]="$AGENT_BIND")
  [ -n "$NVME_DEVICE" ] && want[PIDECK_NVME_DEVICE]="$NVME_DEVICE"

  local rotate=0
  if env_has PIDECK_AGENT_TOKEN_SHA256 && [ "$ROTATE_TOKEN" = 1 ]; then rotate=1; fi
  if ! env_has PIDECK_AGENT_TOKEN_SHA256 || [ "$rotate" = 1 ]; then
    if [ "$DRY_RUN" = 1 ]; then
      want[PIDECK_AGENT_TOKEN_SHA256]="(sha256 of a generated token)"
    else
      AGENT_TOKEN="$(openssl rand -hex 32)"   # 32 random bytes
      AGENT_TOKEN_FILE="$TMP_DIR/agent-token.hdr"
      bearer_header_file "$AGENT_TOKEN" "$AGENT_TOKEN_FILE"
      want[PIDECK_AGENT_TOKEN_SHA256]="$(printf '%s' "$AGENT_TOKEN" | sha256sum | cut -d' ' -f1)"
    fi
  fi
  if [ "$rotate" = 1 ]; then
    # The one value this installer ever changes, and only when asked to.
    local line out="$TMP_DIR/env.rotated"
    : > "$out"
    while IFS= read -r line || [ -n "$line" ]; do
      if [[ "$line" == PIDECK_AGENT_TOKEN_SHA256=* ]]; then line="PIDECK_AGENT_TOKEN_SHA256=${want[PIDECK_AGENT_TOKEN_SHA256]}"; fi
      printf '%s\n' "$line" >> "$out"
    done < "$tmp"
    mv "$out" "$tmp"
    unset 'want[PIDECK_AGENT_TOKEN_SHA256]'
    info "--rotate-token: replacing the token hash (the old token stops working after the restart)"
  fi

  local header=0
  for k in NODE_ENV PIDECK_MODE PIDECK_AGENT_PORT PIDECK_AGENT_BIND PIDECK_AGENT_TOKEN_SHA256 PIDECK_NVME_DEVICE; do
    [ -n "${want[$k]+x}" ] || continue
    if env_has "$k"; then
      case "$k" in
        PIDECK_AGENT_PORT|PIDECK_AGENT_BIND)
          [ "$(env_get "$k")" = "${want[$k]}" ] || warn ".env has $k=$(env_get "$k") (kept; edit .env to change it)" ;;
      esac
      continue
    fi
    if [ "$header" = 0 ]; then printf '\n# added by scripts/install.sh --agent %s\n' "$TS" >> "$tmp"; header=1; fi
    printf '%s=%s\n' "$k" "${want[$k]}" >> "$tmp"
    added+=("$k")
  done
  if [ ${#added[@]} -eq 0 ] && [ "$rotate" != 1 ]; then ok ".env has every agent key (values untouched)"; return; fi
  [ ${#added[@]} -gt 0 ] && info "adding: ${added[*]} (existing values are never changed; the token itself is never stored here)"
  if [ "$DRY_RUN" = 1 ]; then dry "write $ENV_FILE (mode 0600) with the keys above"; return; fi
  install_file "$tmp" "$ENV_FILE" 600
}

agent_service() {
  step "Service ($AGENT_UNIT_NAME)"
  local p; p="$(pm2_bin)"
  if pm2_has_pideck "$p" || [ -f "$ETC/systemd/system/pideck.service" ]; then
    die "this host runs the PiDeck hub; an agent goes on another machine (or run scripts/uninstall.sh first)"
  fi
  have systemctl || [ "$DRY_RUN" = 1 ] || die "the agent runs under systemd, and systemctl isn't available here"
  local unit="$ETC/systemd/system/$AGENT_UNIT_NAME.service" tmp="$TMP_DIR/$AGENT_UNIT_NAME.service" nodebin
  nodebin="$(command -v node)"
  render "$APP_DIR/deploy/systemd/pideck-agent.service.template" "$tmp" "@USER@=$RUN_USER" "@APP_DIR@=$APP_DIR" "@NODE@=$nodebin"
  if have systemd-analyze; then
    local verr; verr="$(systemd-analyze verify "$tmp" 2>&1)" || die "systemd-analyze verify rejected the unit; nothing installed: $(printf '%s' "$verr" | head -n 3 | tr '\n' ' ')"
    ok "systemd-analyze verify: unit OK"
  else warn "systemd-analyze not found: unit not verified"; fi
  if [ "$DRY_RUN" = 1 ]; then agent_dropin || true; dry "install $unit (0644), systemctl daemon-reload, enable --now (restart if running)"; return; fi
  install_file "$tmp" "$unit" 644 sudo
  agent_dropin || true
  srun "systemctl daemon-reload" systemctl daemon-reload
  if systemctl is-active --quiet "$AGENT_UNIT_NAME"; then srun "restart $AGENT_UNIT_NAME" systemctl restart "$AGENT_UNIT_NAME"
  else srun "enable and start $AGENT_UNIT_NAME" systemctl enable --now "$AGENT_UNIT_NAME"; fi
}

ufw_rule_args() { # ufw_rule_args FROM PORT [IFACE]
  if [ -n "${3:-}" ]; then printf '%s\n' allow in on "$3" from "$1" to any port "$2" proto tcp
  else printf '%s\n' allow from "$1" to any port "$2" proto tcp; fi
}

agent_firewall() {
  step "Firewall"
  local hub="${UFW_FROM:-${HUB_IP:-<hub-ip>}}"
  if [ -z "$UFW_FROM" ]; then
    info "Allow only the hub to reach the agent (run on this host):"
    info "  sudo ufw allow from $hub to any port $AGENT_PORT proto tcp"
    info "(or re-run with --ufw-allow-from <hub-ip> to have the installer add it)"
    return
  fi
  local ufw; ufw="$(tool_path ufw)"
  if [ -z "$ufw" ]; then warn "ufw isn't installed: rule not added. Allow only $UFW_FROM → port $AGENT_PORT in your firewall."; return; fi
  local args; mapfile -t args < <(ufw_rule_args "$UFW_FROM" "$AGENT_PORT" "$UFW_IFACE")
  srun "ufw ${args[*]}" "$ufw" "${args[@]}" comment pideck-agent
  if [ "$DRY_RUN" = 1 ]; then dry "record the rule in $AGENT_MARKER (uninstall removes only that rule)"; return; fi
  # Recorded so uninstall.sh removes exactly this rule, and only if we added it.
  install -d -m 700 "$CONFIG_DIR"
  local tmp="$TMP_DIR/agent-marker"
  printf 'UFW_FROM=%s\nUFW_PORT=%s\n' "$UFW_FROM" "$AGENT_PORT" > "$tmp"
  [ -n "$UFW_IFACE" ] && printf 'UFW_IFACE=%s\n' "$UFW_IFACE" >> "$tmp"
  install -m 600 "$tmp" "$AGENT_MARKER"
  ok "recorded in $AGENT_MARKER"
}

agent_health() {
  step "Health check"
  if [ "$SKIP_HEALTH" = 1 ]; then info "skipped"; return; fi
  local url="http://$AGENT_BIND:$AGENT_PORT/api/agent/info"
  if [ "$DRY_RUN" = 1 ]; then dry "GET $url with the token (expect 200), or without it on a re-run (expect 401)"; return; fi
  local code="" body="$TMP_DIR/agent-info.json" hdr=()
  [ -n "$AGENT_TOKEN_FILE" ] && hdr=(-H "@$AGENT_TOKEN_FILE")
  for _ in $(seq 1 30); do
    code="$(curl -s -o "$body" -w '%{http_code}' "${hdr[@]}" "$url" || true)"
    [ "$code" = 200 ] || [ "$code" = 401 ] && break
    sleep 1
  done
  if [ -n "$AGENT_TOKEN_FILE" ]; then
    [ "$code" = 200 ] || die "$url answered $code with the new token (journalctl -u $AGENT_UNIT_NAME)"
    grep -q '"version"' "$body" || die "$url did not return agent info"
    ok "agent answers with the new token: $(sed -n 's/.*"version":"\([^"]*\)".*/PiDeck \1/p' "$body")"
  else
    [ "$code" = 401 ] || die "$url answered $code (expected 401 without a token; journalctl -u $AGENT_UNIT_NAME)"
    ok "agent answers and refuses requests without the token (token unchanged, not shown again)"
  fi
}

agent_summary() {
  step "Done (agent)"
  info "Agent:     http://$AGENT_BIND:$AGENT_PORT (read-only; token required)"
  info "Service:   systemctl status $AGENT_UNIT_NAME · journalctl -u $AGENT_UNIT_NAME"
  info "Config:    $ENV_FILE (0600; holds only the token's SHA-256)"
  info "Install log: $LOG"
  if [ -n "$AGENT_TOKEN" ] && [ "$DRY_RUN" != 1 ]; then
    # Straight to the terminal (fd 3), never into the log.
    {
      printf '\n  %sAgent token (shown once — copy it now; only its hash is stored here):%s\n    %s\n' "$B" "$RST" "$AGENT_TOKEN"
      printf '\n  %sOn the hub, run:%s\n' "$B" "$RST"
      printf '    cd ~/PiDeck && ./scripts/install.sh --add-host %s --url http://%s:%s\n' "$(suggest_host_id)" "$AGENT_BIND" "$AGENT_PORT"
      printf '  and paste the token when it asks. Then restart the hub (the command prints how).\n'
    } >&3
    info "(token printed to the terminal only; it is not in the log)"
  elif [ "$DRY_RUN" != 1 ]; then
    info "The token was not changed (use --rotate-token for a new one; the hub then needs --add-host … --replace)."
  fi
}

# The agent can only listen on an address this host has. A tunnel address
# (wg-pideck) exists only while the tunnel is up: bring it up first.
bind_check() {
  case "$AGENT_BIND" in 127.0.0.1|::1|0.0.0.0|::) return 0 ;; esac
  local a
  for a in $(hostname -I 2>/dev/null); do [ "$a" = "$AGENT_BIND" ] && { ok "bind address $AGENT_BIND is up on this host"; return 0; }; done
  local hint="bring its interface up first"
  [ -n "$AGENT_AFTER" ] && hint="start $AGENT_AFTER first (sudo systemctl enable --now $AGENT_AFTER)"
  if [ "$DRY_RUN" = 1 ]; then warn "$AGENT_BIND is not an address of this host yet: $hint"; return 0; fi
  die "$AGENT_BIND is not an address of this host: $hint"
}

agent_install() {
  AGENT_PORT="${AGENT_PORT:-$(env_get PIDECK_AGENT_PORT)}"; AGENT_PORT="${AGENT_PORT:-5016}"
  AGENT_BIND="${AGENT_BIND:-$(env_get PIDECK_AGENT_BIND)}"
  if [ -z "$AGENT_BIND" ]; then
    AGENT_BIND="$(lan_ip)"
    [ -n "$AGENT_BIND" ] || { AGENT_BIND=127.0.0.1; warn "no LAN address found; binding to 127.0.0.1 (pass --agent-bind)"; }
  fi
  dropin_merge
  preflight
  bind_check
  agent_plan
  packages
  agent_env
  deps
  build
  agent_service
  sudoers
  agent_firewall
  agent_health
  agent_summary
}

# ── multi-host: add an agent to this hub (--add-host) ──────────────────
add_host() {
  step "Add host $ADD_HOST → $ADD_URL"
  [ -f "$ENV_FILE" ] || die "no .env — install the hub first (scripts/install.sh)"
  [ "$(env_get PIDECK_MODE)" != agent ] || die "this checkout is an agent; run --add-host on the hub"
  local key
  key="PIDECK_HOST_TOKEN_$(printf '%s' "$ADD_HOST" | tr 'a-z-' 'A-Z_')"
  local hosts; hosts="$(env_get PIDECK_HOSTS)"
  local exists=0
  if [[ ",${hosts// /}," == *",$ADD_HOST="* ]] || env_has "$key"; then exists=1; fi
  if [ "$exists" = 1 ] && [ "$REPLACE" != 1 ]; then
    die "host \"$ADD_HOST\" already exists in .env; use --replace to change its URL/token (a .bak is kept)"
  fi

  # The token: file (0600), env, or a hidden prompt. Never argv, never logged.
  local token=""
  if [ -n "$TOKEN_FILE" ]; then
    [ -f "$TOKEN_FILE" ] || die "token file $TOKEN_FILE not found"
    [[ "$(stat -c %a "$TOKEN_FILE")" =~ 00$ ]] || die "$TOKEN_FILE must not be readable by group/others (chmod 600)"
    token="$(head -n 1 "$TOKEN_FILE" | tr -d '\r\n')"
  elif [ -n "${PIDECK_ADD_HOST_TOKEN:-}" ]; then
    token="$PIDECK_ADD_HOST_TOKEN"
  elif [ "$DRY_RUN" = 1 ]; then
    token=""
  elif [ -t 0 ] || [ -r /dev/tty ]; then
    { printf '%s' "  Agent token for $ADD_HOST (input hidden): " >/dev/tty; read -r -s token </dev/tty; } 2>/dev/null || token=""
    echo >&3
  else
    die "no token: use --token-file F (0600) or PIDECK_ADD_HOST_TOKEN"
  fi
  if [ "$DRY_RUN" != 1 ] || [ -n "$token" ]; then
    [[ "$token" =~ ^[[:graph:]]{16,512}$ ]] || die "that doesn't look like an agent token (16-512 printable characters, no spaces)"
  fi

  # Connection test: GET /api/agent/info with the token (header from a 0600 file).
  if [ "$SKIP_HEALTH" = 1 ]; then warn "--skip-health: not testing $ADD_URL"
  elif [ -z "$token" ]; then dry "GET $ADD_URL/api/agent/info with the token (expect 200)"
  else
    local hfile="$TMP_DIR/add-host.hdr" body="$TMP_DIR/add-host.json" code
    bearer_header_file "$token" "$hfile"
    code="$(curl -s --max-time 5 -o "$body" -w '%{http_code}' -H "@$hfile" "$ADD_URL/api/agent/info" || true)"
    case "$code" in
      200) grep -q '"version"' "$body" || die "$ADD_URL answered, but not like a PiDeck agent"
           ok "agent answers: $(sed -n 's/.*"version":"\([^"]*\)".*/PiDeck \1/p' "$body")$(sed -n 's/.*"hostname":"\([^"]*\)".*/ on \1/p' "$body")" ;;
      401|429) die "$ADD_URL rejected the token (401/429). Copy it again from the agent's install output, or rotate it there with --agent --rotate-token." ;;
      000) die "can't reach $ADD_URL (agent running? firewall allows this hub?). Add it anyway with --skip-health." ;;
      *) die "$ADD_URL answered $code to /api/agent/info — is that a PiDeck agent?" ;;
    esac
  fi

  # New .env: PIDECK_HOSTS gets the entry (replaced with --replace), the token
  # line is added (or replaced), an optional label likewise. Everything else
  # is copied as is; install_file keeps a .bak and prints a one-line summary.
  local tmp="$TMP_DIR/env" line new_hosts="" item seen_hosts=0 seen_token=0 seen_labels=0
  for item in ${hosts//,/ }; do
    [[ "$item" == "$ADD_HOST="* ]] && continue
    new_hosts+="${new_hosts:+,}$item"
  done
  new_hosts+="${new_hosts:+,}$ADD_HOST=$ADD_URL"
  local labels new_labels=""
  labels="$(env_get PIDECK_HOST_LABELS)"
  if [ -n "$ADD_LABEL" ]; then
    local IFS_SAVE="$IFS"; IFS=','
    for item in $labels; do [[ "$item" == "$ADD_HOST="* ]] || new_labels+="${new_labels:+,}$item"; done
    IFS="$IFS_SAVE"
    new_labels+="${new_labels:+,}$ADD_HOST=$ADD_LABEL"
  fi
  : > "$tmp"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      PIDECK_HOSTS=*) line="PIDECK_HOSTS=$new_hosts"; seen_hosts=1 ;;
      "$key"=*) [ -n "$token" ] && line="$key=$token"; seen_token=1 ;;
      PIDECK_HOST_LABELS=*) [ -n "$ADD_LABEL" ] && line="PIDECK_HOST_LABELS=$new_labels"; seen_labels=1 ;;
    esac
    printf '%s\n' "$line" >> "$tmp"
  done < "$ENV_FILE"
  if [ "$seen_hosts$seen_token$([ -n "$ADD_LABEL" ] && echo "$seen_labels" || echo 1)" != 111 ]; then
    printf '\n# added by scripts/install.sh --add-host %s %s\n' "$ADD_HOST" "$TS" >> "$tmp"
    [ "$seen_hosts" = 1 ] || printf 'PIDECK_HOSTS=%s\n' "$new_hosts" >> "$tmp"
    [ "$seen_token" = 1 ] || printf '%s=%s\n' "$key" "${token:-(the token)}" >> "$tmp"
    if [ -n "$ADD_LABEL" ] && [ "$seen_labels" != 1 ]; then printf 'PIDECK_HOST_LABELS=%s\n' "$new_labels" >> "$tmp"; fi
  fi
  info "PIDECK_HOSTS=$new_hosts · $key=(not shown)$([ -n "$ADD_LABEL" ] && echo " · label \"$ADD_LABEL\"")"
  if [ "$DRY_RUN" = 1 ]; then dry "write $ENV_FILE (0600, with a .bak of the old one)"; return; fi
  install_file "$tmp" "$ENV_FILE" 600

  detect_service
  step "Next"
  info "Restart the hub to load the new host:"
  case "$SERVICE" in
    pm2) info "  $(pm2_bin || echo pm2) restart pideck --update-env" ;;
    systemd) info "  sudo systemctl restart pideck" ;;
    *) info "  restart PiDeck" ;;
  esac
  info "Then pick \"$ADD_HOST\" in the host switcher (header) or open /h/$ADD_HOST/dashboard."
}

# ── update mode ────────────────────────────────────────────────────────
detect_service() {
  [ -n "$SERVICE" ] && return
  local pm2; pm2="$(pm2_bin)"
  if pm2_has_pideck "$pm2"; then SERVICE=pm2
  elif [ -f "$ETC/systemd/system/pideck.service" ]; then SERVICE=systemd
  elif have pm2; then SERVICE=pm2   # default: pm2 when installed globally
  else SERVICE=systemd; fi
}

# After --update's git pull: when the pull changed this script, continue with
# the new one (exec, same arguments) so its fixes apply in this very run. The
# rollback target, the dist backup and the timestamp/log are handed over; the
# second run neither backs up nor pulls again, and never re-execs.
reexec_after_pull() { # reexec_after_pull OLD_HEAD PREV_BUILD BACKUP_DIR
  [ "$DRY_RUN" = 1 ] && return 0
  [ "${PIDECK_INSTALL_REEXEC:-}" = 1 ] && return 0
  git -C "$APP_DIR" diff --quiet "$1" HEAD -- scripts/install.sh && return 0
  info "the pull changed scripts/install.sh: continuing with the new version"
  rm -rf "$TMP_DIR"                 # exec skips the EXIT trap
  exec >&3 2>&3                     # back to the terminal: the new run starts its own tee on the same log
  wait "$TEE_PID" 2>/dev/null || true
  exec env PIDECK_INSTALL_REEXEC=1 PIDECK_INSTALL_PREV="$2" PIDECK_INSTALL_BACKUP="$3" PIDECK_INSTALL_TS="$TS" \
    bash "$APP_DIR/scripts/install.sh" "${ORIG_ARGS[@]}"
}

update() {
  [ -f "$ENV_FILE" ] || die "no .env — run the installer first (without --update)"
  local agent=0
  if [ "$(env_get PIDECK_MODE)" = agent ]; then
    agent=1; MODE=agent
    AGENT_PORT="$(env_get PIDECK_AGENT_PORT)"; AGENT_PORT="${AGENT_PORT:-5016}"
    AGENT_BIND="$(env_get PIDECK_AGENT_BIND)"; AGENT_BIND="${AGENT_BIND:-127.0.0.1}"
    SERVICE=systemd
  fi
  PORT="${PORT:-$(env_get PORT)}"; PORT="${PORT:-5006}"
  detect_service
  step "Update ($([ "$agent" = 1 ] && echo "agent, $AGENT_UNIT_NAME, port $AGENT_PORT" || echo "$SERVICE, port $PORT"))"
  local prev backup="$HOME/backups/pideck-dist-$TS"
  if [ "${PIDECK_INSTALL_REEXEC:-}" = 1 ]; then
    # Second run (see reexec_after_pull): backup and pull are done already.
    prev="${PIDECK_INSTALL_PREV:-}"; backup="${PIDECK_INSTALL_BACKUP:-}"
    [[ "$prev" =~ ^[0-9a-f]{7,40}$ ]] || die "re-exec: bad PIDECK_INSTALL_PREV"
    [[ "$backup" == "$HOME/backups/pideck-dist-"* ]] || die "re-exec: bad PIDECK_INSTALL_BACKUP"
    info "continuing with the updated installer (rollback target $prev)"
  else
    prev="$(build_commit)"
    local head; head="$(git -C "$APP_DIR" rev-parse --short HEAD)"
    if [ "$prev" != "$head" ]; then
      info "the running build is from $prev (dist/.build-commit) but the checkout is at $head (pulled by hand?): rollback goes to $prev"
    fi
    if [ -n "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]; then
      die "the checkout has local changes; commit or stash them first (git status)"
    fi
    if [ -d "$APP_DIR/dist" ]; then run "back up dist/ to $backup" bash -c "mkdir -p \"\$1\" && cp -a \"\$2/dist\" \"\$1/\"" _ "$backup" "$APP_DIR"; fi
    local before; before="$(git -C "$APP_DIR" rev-parse HEAD)"
    run "git pull --ff-only" git -C "$APP_DIR" pull --ff-only
    reexec_after_pull "$before" "$prev" "$backup"
  fi
  deps
  if [ "$agent" != 1 ]; then
    # Migrate after npm ci and before the build/restart: if it fails, the
    # running PiDeck keeps its current build and nothing is restarted.
    step "Database"
    db_backup
    if [ "$DRY_RUN" = 1 ]; then dry "npm run db:migrate (baseline mark first on a pre-2.5 database)"
    elif ! db_migrate; then
      step "Migration failed — update stopped"
      warn "The failing migration was rolled back. PiDeck was NOT rebuilt or restarted: it keeps running its current build."
      restore_hint
      info "Back to the previous code: cd $APP_DIR && git reset --keep $prev && npm ci"
      die "migration failed"
    fi
  fi
  build
  if [ "$agent" = 1 ]; then agent_service; agent_health; else service; health; fi
  local restart
  if [ "$agent" = 1 ]; then restart="sudo systemctl restart $AGENT_UNIT_NAME"
  elif [ "$SERVICE" = pm2 ]; then restart="$(pm2_bin) restart pideck"
  else restart="sudo systemctl restart pideck"; fi
  step "Rollback, if needed"
  info "cd $APP_DIR && git reset --keep $prev && npm ci && rm -rf dist && cp -a $backup/dist dist && $restart"
  [ "$agent" = 1 ] || restore_hint
}

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
