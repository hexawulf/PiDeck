#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Remove what scripts/install.sh set up: the pm2 app or systemd
#              unit (hub) or the pideck-agent unit and the ufw rule the
#              installer added (agent), and /etc/sudoers.d/pideck. Keeps the database, .env, the
#              admin password file and ~/backups unless --purge, which always
#              asks you to type "purge" and drops only the database/role that
#              install.sh recorded as created by it. Backups are deleted only
#              with --purge-backups. Never deletes the checkout itself. Run as
#              the owning user (not root); start with --dry-run.
# Modified:    2026-09-30
# Usage:       scripts/uninstall.sh --dry-run          # see what would be removed
#              scripts/uninstall.sh                    # remove service + sudoers
#              scripts/uninstall.sh --purge            # also installer-created DB, .env, password
#              scripts/uninstall.sh --purge --purge-backups   # and ~/backups/pideck-dist-*
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
ETC="${PIDECK_ETC_DIR:-/etc}"   # test hook only

DRY_RUN=0
YES="${PIDECK_YES:-0}"
PURGE=0
PURGE_BACKUPS=0
usage() {
  cat <<'EOF'
PiDeck uninstaller — scripts/uninstall.sh [options]

  --dry-run   print every action, change nothing (do this first)
  --yes       no prompts (does NOT skip the --purge confirmation)
  --purge     also drop the database and role *that install.sh created*
              (recorded in ~/.config/pideck/install-db; anything that already
              existed is left alone), delete .env and the admin password file.
              Always asks you to type "purge"; for scripts, set
              PIDECK_PURGE_CONFIRM=purge instead.
  --purge-backups  with --purge: also delete ~/backups/pideck-dist-*
  -h, --help  this help
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) YES=1 ;;
    --purge|-p) PURGE=1 ;;
    --purge-backups) PURGE_BACKUPS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 64 ;;
  esac
  shift
done

if [ "$PURGE_BACKUPS" = 1 ] && [ "$PURGE" != 1 ]; then
  echo "Error: --purge-backups only works together with --purge." >&2
  exit 64
fi

if [ "$(id -u)" -eq 0 ]; then
  echo "Error: run this as the user who owns PiDeck, not as root (sudo is used where needed)." >&2
  exit 1
fi

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
# Does a (root-owned) path exist? /etc/sudoers.d is 0750 root on Debian/
# Ubuntu, so a plain `[ -e ]` from the owning user is always false there.
# Ask sudo only when the directory can't be searched.
path_exists() {
  local p="$1"
  [ -e "$p" ] && return 0
  [ -x "$(dirname "$p")" ] && return 1
  sudo -n test -e "$p" 2>/dev/null
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


ENV_FILE="$APP_DIR/.env"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pideck"
DB_MARKER="$CONFIG_DIR/install-db"
UNIT="$ETC/systemd/system/pideck.service"
AGENT_UNIT="$ETC/systemd/system/pideck-agent.service"
AGENT_DROPIN_DIR="$ETC/systemd/system/pideck-agent.service.d"
AGENT_DROPIN="$AGENT_DROPIN_DIR/10-install.conf"
AGENT_MARKER="$CONFIG_DIR/install-agent"
SUDOERS="$ETC/sudoers.d/pideck"
BACKUP="$HOME/backups/pideck-uninstall-$TS"

printf '%sPiDeck uninstaller%s — %s%s\n' "$B" "$RST" "$APP_DIR" "$([ "$DRY_RUN" = 1 ] && echo " (dry run: nothing will change)")"
info "log: $LOG"

# ── plan ───────────────────────────────────────────────────────────────
PM2="$(pm2_bin)"
HAS_PM2=0; pm2_has_pideck "$PM2" && HAS_PM2=1
HAS_UNIT=0; [ -f "$UNIT" ] && HAS_UNIT=1
HAS_SUDOERS=0; path_exists "$SUDOERS" && HAS_SUDOERS=1
HAS_AGENT=0; [ -f "$AGENT_UNIT" ] && HAS_AGENT=1
# The ufw rule is removed only when install.sh --agent recorded adding it.
UFW_FROM=""; UFW_PORT=""; UFW_IFACE=""
if [ -f "$AGENT_MARKER" ]; then
  UFW_FROM="$(sed -n 's/^UFW_FROM=//p' "$AGENT_MARKER")"; UFW_PORT="$(sed -n 's/^UFW_PORT=//p' "$AGENT_MARKER")"
  UFW_IFACE="$(sed -n 's/^UFW_IFACE=//p' "$AGENT_MARKER")"
  [[ "$UFW_FROM" =~ ^[0-9a-fA-F.:]+$ && "$UFW_PORT" =~ ^[0-9]+$ ]] || { UFW_FROM=""; UFW_PORT=""; }
  [[ "$UFW_IFACE" =~ ^[A-Za-z0-9_.-]{0,15}$ ]] || { UFW_FROM=""; UFW_PORT=""; UFW_IFACE=""; }
fi
# Only the drop-in install.sh writes (--after / --memory-max); others stay.
HAS_DROPIN=0; [ -f "$AGENT_DROPIN" ] && HAS_DROPIN=1
HAS_UFW=0; [ -n "$UFW_FROM" ] && HAS_UFW=1

step "Plan"
[ "$HAS_PM2" = 1 ] && info "- pm2: delete app 'pideck', pm2 save"
[ "$HAS_UNIT" = 1 ] && info "- systemd: stop + disable pideck, copy the unit to $BACKUP, remove $UNIT (sudo)"
[ "$HAS_AGENT" = 1 ] && info "- agent: stop + disable pideck-agent, copy the unit to $BACKUP, remove $AGENT_UNIT (sudo)"
[ "$HAS_DROPIN" = 1 ] && info "- agent: copy $AGENT_DROPIN to $BACKUP and remove it (sudo)"
[ "$HAS_UFW" = 1 ] && info "- ufw: delete the rule install.sh added (allow from $UFW_FROM to any port $UFW_PORT proto tcp)"
[ "$HAS_SUDOERS" = 1 ] && info "- remove $SUDOERS (sudo)"
if [ "$PURGE" = 1 ]; then
  info "- PURGE: drop only the database/role install.sh created (per $DB_MARKER; sudo -u postgres)"
  info "- PURGE: delete $ENV_FILE, $CONFIG_DIR"
  if [ "$PURGE_BACKUPS" = 1 ]; then info "- PURGE: delete $HOME/backups/pideck-dist-*"
  else info "- keep: $HOME/backups (add --purge-backups to delete pideck-dist-*)"; fi
else
  info "- keep: database, $ENV_FILE, $CONFIG_DIR, $HOME/backups (use --purge to remove)"
fi
info "- keep: the checkout $APP_DIR (delete it yourself when done)"
if [ "$HAS_PM2$HAS_UNIT$HAS_AGENT$HAS_UFW$HAS_SUDOERS$PURGE" = 000000 ]; then ok "nothing installed; nothing to do"; exit 0; fi

if [ "$DRY_RUN" != 1 ] && [ "$YES" != 1 ]; then
  [ -t 0 ] || die "not a terminal: pass --yes to proceed without prompts"
  { printf '%s' "  Proceed? [y/N] " >/dev/tty; read -r ans </dev/tty; } 2>/dev/null || ans=""
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
if [ "$HAS_AGENT" = 1 ]; then
  run "stop and disable pideck-agent" sudo systemctl disable --now pideck-agent
  run "create $BACKUP" mkdir -p "$BACKUP"
  run "keep a copy of the agent unit" cp -p "$AGENT_UNIT" "$BACKUP/"
  run "remove $AGENT_UNIT" sudo rm -f "$AGENT_UNIT"
  if [ "$HAS_DROPIN" = 1 ]; then
    run "keep a copy of the agent drop-in" cp -p "$AGENT_DROPIN" "$BACKUP/pideck-agent-10-install.conf"
    run "remove $AGENT_DROPIN" sudo rm -f "$AGENT_DROPIN"
    # rmdir only succeeds when nothing else (a drop-in of your own, .bak files) is left.
    run "remove $AGENT_DROPIN_DIR if empty" sudo rmdir --ignore-fail-on-non-empty "$AGENT_DROPIN_DIR"
  fi
  run "systemctl daemon-reload" sudo systemctl daemon-reload
fi
[ "$HAS_PM2$HAS_UNIT$HAS_AGENT" = 000 ] && ok "no pm2 app or systemd unit"

# ── firewall (agent) ───────────────────────────────────────────────────
if [ "$HAS_UFW" = 1 ]; then
  step "Firewall"
  UFW="$(command -v ufw 2>/dev/null || { [ -x /usr/sbin/ufw ] && echo /usr/sbin/ufw; } || true)"
  if [ -z "$UFW" ]; then
    warn "ufw is no longer installed; nothing to remove"
  else
    if [ -n "$UFW_IFACE" ]; then
      run "delete ufw rule: allow in on $UFW_IFACE from $UFW_FROM to any port $UFW_PORT proto tcp" sudo "$UFW" delete allow in on "$UFW_IFACE" from "$UFW_FROM" to any port "$UFW_PORT" proto tcp
    else
      run "delete ufw rule: allow from $UFW_FROM to any port $UFW_PORT proto tcp" sudo "$UFW" delete allow from "$UFW_FROM" to any port "$UFW_PORT" proto tcp
    fi
  fi
  if [ "$PURGE" != 1 ]; then run "forget the recorded rule" rm -f "$AGENT_MARKER"; fi
fi

# ── sudoers ────────────────────────────────────────────────────────────
step "Sudoers"
if [ "$HAS_SUDOERS" = 1 ]; then run "remove $SUDOERS" sudo rm -f "$SUDOERS"
else ok "no $SUDOERS"; fi

# ── purge ──────────────────────────────────────────────────────────────
if [ "$PURGE" = 1 ]; then
  step "Purge"
  if [ "$DRY_RUN" != 1 ]; then
    # Always typed, even with --yes: this deletes data. Scripts can set
    # PIDECK_PURGE_CONFIRM=purge on purpose.
    ans="${PIDECK_PURGE_CONFIRM:-}"
    if [ "$ans" != purge ]; then
      warn "This deletes the PiDeck database this installer created (metrics history, admin account), .env and the admin password."
      { printf '%s' "  Type 'purge' to continue: " >/dev/tty; read -r ans </dev/tty; } 2>/dev/null || ans=""
    fi
    [ "$ans" = purge ] || { info "not purged; the database, .env and backups are kept"; exit 0; }
  fi
  url=""; [ -f "$ENV_FILE" ] && url="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | tail -n 1)"
  re='^postgres(ql)?://([A-Za-z0-9_]+)(:[^@]*)?@(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?/([A-Za-z0-9_]+)([?].*)?$'
  m_name=""; m_user=""; m_role=0; m_db=0
  if [ -f "$DB_MARKER" ]; then
    m_name="$(sed -n 's/^DB_NAME=//p' "$DB_MARKER")"; m_user="$(sed -n 's/^DB_USER=//p' "$DB_MARKER")"
    grep -qx 'CREATED_ROLE=1' "$DB_MARKER" && m_role=1
    grep -qx 'CREATED_DB=1' "$DB_MARKER" && m_db=1
  fi
  if [ -z "$url" ]; then
    ok "no DATABASE_URL in .env"
  elif ! [[ "$url" =~ $re ]]; then
    warn "DATABASE_URL is not a local database: left alone (drop it on its server if you want)"
  elif [ ! -f "$DB_MARKER" ]; then
    warn "the database in .env was not created by install.sh (no $DB_MARKER): left alone"
  elif [ "${BASH_REMATCH[6]}" != "$m_name" ] || [ "${BASH_REMATCH[2]}" != "$m_user" ]; then
    warn ".env points at a different database than install.sh created ($m_name/$m_user): left alone"
  elif [ "$m_role$m_db" = 00 ]; then
    warn "role \"$m_user\" and database \"$m_name\" already existed before install.sh: left alone"
  else
    # Names are [A-Za-z0-9_] only (checked by the regex above), so quoting them is safe.
    sql=""
    [ "$m_db" = 1 ] && sql+="DROP DATABASE IF EXISTS \"$m_name\";"$'\n'
    [ "$m_role" = 1 ] && sql+="DROP ROLE IF EXISTS \"$m_user\";"$'\n'
    what="$([ "$m_db" = 1 ] && echo "database \"$m_name\"")$([ "$m_db$m_role" = 11 ] && echo " and ")$([ "$m_role" = 1 ] && echo "role \"$m_user\"")"
    if [ "$DRY_RUN" = 1 ]; then
      run "drop $what (created by install.sh)" sudo -u postgres psql -X -v ON_ERROR_STOP=1
    else
      info "dropping $what (created by install.sh)"
      (cd /tmp && printf '%s' "$sql" | sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 >/dev/null)
    fi
  fi
  [ -e "$ENV_FILE" ] && run "delete $ENV_FILE" rm -f "$ENV_FILE"
  [ -e "$CONFIG_DIR" ] && run "delete $CONFIG_DIR" rm -rf "$CONFIG_DIR"
  if [ "$PURGE_BACKUPS" = 1 ]; then
    for d in "$HOME"/backups/pideck-dist-*; do
      if [ -e "$d" ]; then run "delete $d" rm -rf "$d"; fi
    done
  else
    info "kept $HOME/backups/pideck-dist-* (use --purge-backups to delete them)"
  fi
fi

step "Done"
if [ "$DRY_RUN" = 1 ]; then info "dry run: nothing was changed"; exit 0; fi
info "PiDeck's service$([ "$HAS_UFW" = 1 ] && echo ", firewall rule") and sudoers rule are gone$([ "$PURGE" = 1 ] && echo "; data purged")."
info "The checkout is still at $APP_DIR."
if [ -d "$BACKUP" ]; then info "Unit copy: $BACKUP"; fi
info "Log: $LOG"
