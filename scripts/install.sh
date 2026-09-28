#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: One-command install / re-run / update for PiDeck on Ubuntu or
#              Debian (arm64 Raspberry Pi and amd64). Idempotent: re-running
#              only fills in what is missing. Run as the user who will own
#              PiDeck (not root); sudo is used only for the steps it lists
#              up front. Start with --dry-run: it prints every action and
#              changes nothing.
# Modified:    2026-09-28
# Usage:       scripts/install.sh --dry-run            # see what would happen
#              scripts/install.sh                      # interactive install
#              scripts/install.sh --yes --lan-http     # unattended, plain-HTTP LAN
#              scripts/install.sh --update             # pull, build, restart, check
#              scripts/install.sh --help               # all flags
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
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

usage() {
  cat <<'EOF'
PiDeck installer — scripts/install.sh [options]

  --dry-run                 print every action, change nothing (do this first)
  --yes                     non-interactive: accept defaults, no prompts
  --update                  git pull --ff-only, npm ci, build, restart, health check
  --port N                  listen port (default 5006; env PIDECK_PORT)
  --database-url URL        use this PostgreSQL instead of a local role/db
                            (env PIDECK_DATABASE_URL; never printed)
  --no-apt                  don't offer apt-get for missing distro packages
  --service pm2|systemd|none   how to run PiDeck (default: pm2 if found, else systemd)
  --sudoers                 install /etc/sudoers.d/pideck (smartctl, ufw, apt-get only)
  --nvme-device /dev/nvmeX  NVMe device for SMART data (default: first found)
  --lan-http                allow login over plain http://<ip>:PORT (trusted LAN only)
  --admin-password-file F   use the password in F (0600) for the admin account
  --generate-password       generate the admin password (default with --yes)
  --reset-password          replace the admin password even if it was changed in the UI
  --public-url URL          where you open PiDeck (for the final message and health check)
  --skip-health             don't run the health check
  -h, --help                this help

Env equivalents: PIDECK_YES=1 PIDECK_PORT PIDECK_DATABASE_URL PIDECK_NO_APT=1
PIDECK_SERVICE PIDECK_SUDOERS=1 PIDECK_LAN_HTTP=1 PIDECK_ADMIN_PASSWORD_FILE
PIDECK_NVME_DEVICE PIDECK_PUBLIC_URL NO_COLOR=1
EOF
}

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
  read -r -p "  $q [$([ "$def" = y ] && echo Y/n || echo y/N)] " ans </dev/tty || ans=""
  ans="${ans:-$def}"
  [[ "$ans" =~ ^[Yy] ]]
}

# install_file SRC DEST MODE [sudo] — atomic install; backs up and summarises
# the change when DEST exists and differs. SRC is a validated temp file.
install_file() {
  local src="$1" dest="$2" mode="$3" use_sudo="${4:-}" pre=()
  [ -n "$use_sudo" ] && pre=(sudo)
  if [ -e "$dest" ] && "${pre[@]}" cmp -s "$src" "$dest"; then ok "$dest unchanged"; return 0; fi
  if [ -e "$dest" ]; then
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
[ "$(id -u)" -eq 0 ] && die "run this as the user who will own PiDeck, not as root (sudo is used where needed)."
RUN_USER="$(id -un)"
ENV_FILE="$APP_DIR/.env"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pideck"
PW_FILE="$CONFIG_DIR/admin-password"

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

# ── 1. preflight (read-only) ───────────────────────────────────────────
MISSING_REQ=(); APT_PKGS=()
preflight() {
  step "Preflight (read-only)"
  local os arch
  os="$(osr PRETTY_NAME)"
  arch="$(uname -m)"
  info "OS: ${os:-unknown} · arch: $arch"
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
  case "$pg_state" in
    missing|"client only") row postgresql "$pg_state" "required (or --database-url)"; APT_PKGS+=(postgresql) ;;
    *) row postgresql "$pg_state" required ;;
  esac
  if [ -n "$(pm2_bin)" ]; then row pm2 found "service (optional; systemd otherwise)"; else row pm2 "optional-missing" "service: systemd will be used"; fi
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
  if [ -f "$ENV_FILE" ]; then cp "$ENV_FILE" "$tmp"; else : > "$tmp"; fi
  local -A want=(
    [NODE_ENV]=production
    [PORT]="$PORT"
    [PIDECK_LOGS_DIR]="$HOME/logs"
    [PM2_LOGS_DIR]="$HOME/.pm2/logs"
    [CSP_ENFORCE]=true
  )
  [ -n "$DATABASE_URL_VALUE" ] && want[DATABASE_URL]="$DATABASE_URL_VALUE"
  [ "$LAN_HTTP" = 1 ] && want[PIDECK_INSECURE_HTTP]=1
  [ -n "$NVME_DEVICE" ] && want[PIDECK_NVME_DEVICE]="$NVME_DEVICE"
  if ! env_has SESSION_SECRET; then
    if [ "$DRY_RUN" = 1 ]; then want[SESSION_SECRET]="(generated)"; else want[SESSION_SECRET]="$(openssl rand -hex 32)"; fi
  fi
  local order=(NODE_ENV PORT SESSION_SECRET DATABASE_URL CSP_ENFORCE PIDECK_LOGS_DIR PM2_LOGS_DIR PIDECK_INSECURE_HTTP PIDECK_NVME_DEVICE)
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
  local sql
  sql="$(cat <<SQL
SELECT 'CREATE ROLE "$DB_USER" LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER')\\gexec
ALTER ROLE "$DB_USER" WITH LOGIN PASSWORD '$pw';
SELECT 'CREATE DATABASE "$DB_NAME" OWNER "$DB_USER"' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME')\\gexec
SQL
)"
  if [ "$DRY_RUN" = 1 ]; then
    dry "sudo -u postgres psql: create role \"$DB_USER\" and database \"$DB_NAME\" if missing, set a generated role password"
  else
    info "creating role \"$DB_USER\" and database \"$DB_NAME\" if missing (password generated, not shown)"
    (cd /tmp && printf '%s\n' "$sql" | sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 >/dev/null)
  fi
  DATABASE_URL_VALUE="postgresql://$DB_USER:$pw@localhost:5432/$DB_NAME"
}

helper() { DATABASE_URL="$(env_get DATABASE_URL)" node "$APP_DIR/scripts/install-helper.mjs" "$@"; }

# ── 6a. dependencies (npm ci before schema/password: they use node_modules) ──
deps() {
  step "Dependencies"
  qrun "npm ci" npm ci --no-audit --no-fund
}

# ── 3c. schema ─────────────────────────────────────────────────────────
schema() {
  step "Schema"
  if [ "$DRY_RUN" = 1 ]; then dry "check tables; if missing: DATABASE_URL=… npx drizzle-kit push --force </dev/null"; return; fi
  helper db-check >/dev/null || die "cannot reach the database (see the message above)"
  local missing; missing="$(helper tables)"
  if [ -z "$missing" ]; then ok "tables present (users, historical_metrics); not touching the schema"; return; fi
  info "missing tables: $missing → creating the schema (fresh database)"
  # Fresh database: push creates everything; --force + no stdin keeps it non-interactive.
  (cd "$APP_DIR" && DATABASE_URL="$(env_get DATABASE_URL)" timeout 180 npx drizzle-kit push --force </dev/null >/dev/null) \
    || die "schema push failed (run: npm run db:push)"
  [ -z "$(helper tables)" ] || die "schema push finished but tables are still missing"
  ok "schema created"
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
}

# ── 7. service ─────────────────────────────────────────────────────────
service() {
  step "Service ($SERVICE)"
  # One instance only: refuse to add a second service manager next to an existing one.
  local p; p="$(pm2_bin)"
  if [ "$SERVICE" != pm2 ] && [ -n "$p" ] && "$p" describe pideck >/dev/null 2>&1; then
    die "a pm2 app 'pideck' already runs this; remove it first ($p delete pideck && $p save) or use --service pm2"
  fi
  if [ "$SERVICE" != systemd ] && [ -f "$ETC/systemd/system/pideck.service" ]; then
    die "$ETC/systemd/system/pideck.service already runs this; run scripts/uninstall.sh first or use --service systemd"
  fi
  case "$SERVICE" in
    none) info "not managing a service; start it with: cd $APP_DIR && node dist/index.js" ;;
    pm2)
      local pm2; pm2="$(pm2_bin)"
      [ -n "$pm2" ] || die "pm2 not found (npm i -g pm2, or --service systemd)"
      if "$pm2" describe pideck >/dev/null 2>&1; then
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
  render "$APP_DIR/deploy/sudoers.d/pideck.template" "$tmp" "@SMARTCTL_LINE@=$smart_line" "@UFW_LINE@=$ufw_line" \
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

  if [ "$(helper admin-state "$PW_FILE")" != matches ]; then
    info "admin password differs from $PW_FILE (changed in the UI): skipping the login round-trip"
    return
  fi
  # Login round-trip without the password or cookie ever in argv: body and
  # headers come from 0600 files. Behind TLS the cookie is Secure, so ask the
  # app to act as if proxied over HTTPS and hand the cookie back by header.
  local body="$TMP_DIR/login.json" hdr="$TMP_DIR/headers" cookie="$TMP_DIR/cookie" proto=()
  helper login-body "$PW_FILE" "$body"
  [ "$(env_get PIDECK_INSECURE_HTTP)" = 1 ] || proto=(-H "X-Forwarded-Proto: https")
  code="$(curl -s -o /dev/null -D "$hdr" -w '%{http_code}' "${proto[@]}" -H 'Content-Type: application/json' --data-binary "@$body" "$base/api/auth/login")"
  [ "$code" = 200 ] || die "login returned $code"
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

# ── update mode ────────────────────────────────────────────────────────
detect_service() {
  [ -n "$SERVICE" ] && return
  local pm2; pm2="$(pm2_bin)"
  if [ -n "$pm2" ] && "$pm2" describe pideck >/dev/null 2>&1; then SERVICE=pm2
  elif [ -f "$ETC/systemd/system/pideck.service" ]; then SERVICE=systemd
  elif have pm2; then SERVICE=pm2   # default: pm2 when installed globally
  else SERVICE=systemd; fi
}

update() {
  [ -f "$ENV_FILE" ] || die "no .env — run the installer first (without --update)"
  PORT="${PORT:-$(env_get PORT)}"; PORT="${PORT:-5006}"
  detect_service
  step "Update ($SERVICE, port $PORT)"
  local prev backup="$HOME/backups/pideck-dist-$TS"
  prev="$(git -C "$APP_DIR" rev-parse --short HEAD)"
  if [ -n "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]; then
    die "the checkout has local changes; commit or stash them first (git status)"
  fi
  if [ -d "$APP_DIR/dist" ]; then run "back up dist/ to $backup" bash -c "mkdir -p \"\$1\" && cp -a \"\$2/dist\" \"\$1/\"" _ "$backup" "$APP_DIR"; fi
  run "git pull --ff-only" git -C "$APP_DIR" pull --ff-only
  deps
  if [ "$DRY_RUN" != 1 ] && [ -n "$(helper tables)" ]; then warn "PiDeck tables are missing; run scripts/install.sh (not --update)"; fi
  build
  service
  health
  step "Rollback, if needed"
  info "cd $APP_DIR && git reset --keep $prev && npm ci && rm -rf dist && cp -a $backup/dist dist && $([ "$SERVICE" = pm2 ] && echo "pm2 restart pideck" || echo "sudo systemctl restart pideck")"
}

# ── main ───────────────────────────────────────────────────────────────
cd "$APP_DIR"
if [ "$MODE" = update ]; then
  preflight
  update
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
