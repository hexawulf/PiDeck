#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Remove what scripts/install.sh set up: the pm2 app or systemd
#              unit and /etc/sudoers.d/pideck. Keeps the database, .env, the
#              admin password file and ~/backups unless --purge (which asks
#              for confirmation). Never deletes the checkout itself. Run as
#              the owning user (not root); start with --dry-run.
# Modified:    2026-09-28
# Usage:       scripts/uninstall.sh --dry-run          # see what would be removed
#              scripts/uninstall.sh                    # remove service + sudoers
#              scripts/uninstall.sh --purge            # also DB, .env, password, backups
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
ETC="${PIDECK_ETC_DIR:-/etc}"   # test hook only

DRY_RUN=0
YES="${PIDECK_YES:-0}"
PURGE=0
usage() {
  cat <<'EOF'
PiDeck uninstaller — scripts/uninstall.sh [options]

  --dry-run   print every action, change nothing (do this first)
  --yes       no prompts (with --purge: purge without typing "purge")
  --purge     also drop the local database and role, delete .env, the admin
              password file and ~/backups/pideck-dist-*
  -h, --help  this help
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) YES=1 ;;
    --purge|-p) PURGE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 64 ;;
  esac
  shift
done

if [ "$DRY_RUN" = 1 ]; then LOG="${TMPDIR:-/tmp}/pideck-uninstall-dryrun-$TS.log"
else mkdir -p "$HOME/logs"; LOG="$HOME/logs/pideck-uninstall-$TS.log"; fi
exec > >(tee -a "$LOG") 2>&1

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != dumb ]; then
  B=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; RST=$'\033[0m'
else
  B=""; RED=""; GRN=""; YEL=""; CYN=""; RST=""
fi
step() { printf '\n%s==> %s%s\n' "$B$CYN" "$*" "$RST"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$*"; }
die()  { printf '%sError:%s %s\n' "$RED" "$RST" "$*"; exit 1; }
show_cmd() { local out="" a; for a in "$@"; do out+="$(printf '%q' "$a") "; done; printf '%s' "${out% }"; }
run() {
  local what="$1"; shift
  if [ "$DRY_RUN" = 1 ]; then printf '  %s[dry-run]%s would %s: %s\n' "$YEL" "$RST" "$what" "$(show_cmd "$@")"; return 0; fi
  info "$what"
  "$@"
}
have() { command -v "$1" >/dev/null 2>&1; }
pm2_bin() { have pm2 && command -v pm2 || { [ -x "$APP_DIR/node_modules/.bin/pm2" ] && echo "$APP_DIR/node_modules/.bin/pm2"; } || true; }

[ "$(id -u)" -eq 0 ] && die "run this as the user who owns PiDeck, not as root (sudo is used where needed)."

ENV_FILE="$APP_DIR/.env"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pideck"
UNIT="$ETC/systemd/system/pideck.service"
SUDOERS="$ETC/sudoers.d/pideck"
BACKUP="$HOME/backups/pideck-uninstall-$TS"

printf '%sPiDeck uninstaller%s — %s%s\n' "$B" "$RST" "$APP_DIR" "$([ "$DRY_RUN" = 1 ] && echo " (dry run: nothing will change)")"
info "log: $LOG"

# ── plan ───────────────────────────────────────────────────────────────
PM2="$(pm2_bin)"
HAS_PM2=0; [ -n "$PM2" ] && "$PM2" describe pideck >/dev/null 2>&1 && HAS_PM2=1
HAS_UNIT=0; [ -f "$UNIT" ] && HAS_UNIT=1
HAS_SUDOERS=0; [ -e "$SUDOERS" ] && HAS_SUDOERS=1

step "Plan"
[ "$HAS_PM2" = 1 ] && info "- pm2: delete app 'pideck', pm2 save"
[ "$HAS_UNIT" = 1 ] && info "- systemd: stop + disable pideck, copy the unit to $BACKUP, remove $UNIT (sudo)"
[ "$HAS_SUDOERS" = 1 ] && info "- remove $SUDOERS (sudo)"
if [ "$PURGE" = 1 ]; then
  info "- PURGE: drop the local database and role from .env's DATABASE_URL (sudo -u postgres)"
  info "- PURGE: delete $ENV_FILE, $CONFIG_DIR, $HOME/backups/pideck-dist-*"
else
  info "- keep: database, $ENV_FILE, $CONFIG_DIR, $HOME/backups (use --purge to remove)"
fi
info "- keep: the checkout $APP_DIR (delete it yourself when done)"
if [ "$HAS_PM2$HAS_UNIT$HAS_SUDOERS$PURGE" = 0000 ]; then ok "nothing installed; nothing to do"; exit 0; fi

if [ "$DRY_RUN" != 1 ] && [ "$YES" != 1 ]; then
  [ -t 0 ] || die "not a terminal: pass --yes to proceed without prompts"
  read -r -p "  Proceed? [y/N] " ans </dev/tty || ans=""
  [[ "${ans:-n}" =~ ^[Yy] ]] || { info "aborted; nothing changed"; exit 0; }
fi

# ── service ────────────────────────────────────────────────────────────
step "Service"
if [ "$HAS_PM2" = 1 ]; then
  run "delete pm2 app 'pideck'" "$PM2" delete pideck
  run "pm2 save --force (also when no apps are left, so boot does not resurrect it)" "$PM2" save --force
fi
if [ "$HAS_UNIT" = 1 ]; then
  run "stop and disable pideck" sudo systemctl disable --now pideck
  run "create $BACKUP" mkdir -p "$BACKUP"
  run "keep a copy of the unit" cp -p "$UNIT" "$BACKUP/"
  run "remove $UNIT" sudo rm -f "$UNIT"
  run "systemctl daemon-reload" sudo systemctl daemon-reload
fi
[ "$HAS_PM2$HAS_UNIT" = 00 ] && ok "no pm2 app or systemd unit"

# ── sudoers ────────────────────────────────────────────────────────────
step "Sudoers"
if [ "$HAS_SUDOERS" = 1 ]; then run "remove $SUDOERS" sudo rm -f "$SUDOERS"
else ok "no $SUDOERS"; fi

# ── purge ──────────────────────────────────────────────────────────────
if [ "$PURGE" = 1 ]; then
  step "Purge"
  if [ "$DRY_RUN" != 1 ] && [ "$YES" != 1 ]; then
    warn "This deletes the PiDeck database (metrics history, admin account), .env and the admin password."
    read -r -p "  Type 'purge' to continue: " ans </dev/tty || ans=""
    [ "$ans" = purge ] || { info "not purged; the database, .env and backups are kept"; exit 0; }
  fi
  url=""; [ -f "$ENV_FILE" ] && url="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | tail -n 1)"
  re='^postgres(ql)?://([A-Za-z0-9_]+)(:[^@]*)?@(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?/([A-Za-z0-9_]+)([?].*)?$'
  if [[ "$url" =~ $re ]]; then
    db_user="${BASH_REMATCH[2]}"; db_name="${BASH_REMATCH[6]}"
    # Names are [A-Za-z0-9_] only (checked above), so quoting them is safe.
    sql="DROP DATABASE IF EXISTS \"$db_name\";
DROP ROLE IF EXISTS \"$db_user\";"
    if [ "$DRY_RUN" = 1 ]; then
      run "drop database \"$db_name\" and role \"$db_user\"" sudo -u postgres psql -X -v ON_ERROR_STOP=1
    else
      info "dropping database \"$db_name\" and role \"$db_user\""
      (cd /tmp && printf '%s\n' "$sql" | sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 >/dev/null)
    fi
  elif [ -n "$url" ]; then
    warn "DATABASE_URL is not a local database: left alone (drop it on its server if you want)"
  else
    ok "no DATABASE_URL in .env"
  fi
  [ -e "$ENV_FILE" ] && run "delete $ENV_FILE" rm -f "$ENV_FILE"
  [ -e "$CONFIG_DIR" ] && run "delete $CONFIG_DIR" rm -rf "$CONFIG_DIR"
  for d in "$HOME"/backups/pideck-dist-*; do
    if [ -e "$d" ]; then run "delete $d" rm -rf "$d"; fi
  done
fi

step "Done"
if [ "$DRY_RUN" = 1 ]; then info "dry run: nothing was changed"; exit 0; fi
info "PiDeck's service and sudoers rule are gone$([ "$PURGE" = 1 ] && echo "; data purged")."
info "The checkout is still at $APP_DIR."
if [ -d "$BACKUP" ]; then info "Unit copy: $BACKUP"; fi
info "Log: $LOG"
