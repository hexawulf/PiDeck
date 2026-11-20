# shellcheck shell=bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Shared output, command execution, templating, .env, and host
#              probe helpers sourced by scripts/install.sh.
# Modified:    2026-11-20

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

# ── .env & system probes ───────────────────────────────────────────────
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

helper() { DATABASE_URL="$(env_get DATABASE_URL)" node "$APP_DIR/scripts/install-helper.mjs" "$@"; }

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

detect_service() {
  [ -n "$SERVICE" ] && return
  local pm2; pm2="$(pm2_bin)"
  if pm2_has_pideck "$pm2"; then SERVICE=pm2
  elif [ -f "$ETC/systemd/system/pideck.service" ]; then SERVICE=systemd
  elif have pm2; then SERVICE=pm2   # default: pm2 when installed globally
  else SERVICE=systemd; fi
}
