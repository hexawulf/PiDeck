#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Build PiDeck into dist-dev/ and serve it on :5017 for E2E.
#              Never writes dist/ (prod, served by pm2 on :5006). Logs in with a
#              throwaway password from .e2e/password via APP_PASSWORD_FILE;
#              APP_PASSWORD is forced empty so a prod value in .env is ignored.
#              PIDECK_SAMPLER=off: this build shares the prod database, and
#              its sampler would double the prod history rows.
#              PIDECK_DISABLE_SYSTEM_UPDATE=1: it also shares the prod host, so
#              POST /api/system/update answers 409 instead of running apt.
#              Also starts two read-only agents (PIDECK_MODE=agent) on
#              127.0.0.1:5018/5019 and points the hub at them (multi-host);
#              the first serves remote logs from test fixtures (.e2e/agent-logs).
# Modified:    2026-09-28
# Usage:       scripts/e2e-server.sh [--dry-run]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist-dev"
PORT="${E2E_PORT:-5017}"
PWFILE="$ROOT/.e2e/password"
LOGDIR="$HOME/logs"; LOG="$LOGDIR/pideck-e2e-server-$(date +%Y%m%d-%H%M%S).log"

if [ "${1:-}" = "--dry-run" ]; then
  echo "would build client → $OUT/public, server → $OUT/index.js"
  echo "would serve on :$PORT with APP_PASSWORD_FILE=$PWFILE (log: $LOG)"
  echo "would start e2e agents on 127.0.0.1:${E2E_AGENT_PORT:-5018} and :$(( ${E2E_AGENT_PORT:-5018} + 1 ))"
  exit 0
fi

case "$OUT" in */dist) echo "refusing to build into prod dist/" >&2; exit 1 ;; esac
mkdir -p "$LOGDIR" "$ROOT/.e2e"
chmod 700 "$ROOT/.e2e"
[ -s "$PWFILE" ] || { (umask 077; openssl rand -base64 24 > "$PWFILE"); }

cd "$ROOT"
npx vite build --outDir "$OUT/public" --emptyOutDir >>"$LOG" 2>&1
# --splitting: the hub and the agent (PIDECK_MODE=agent) load separate chunks,
# so an agent never loads the hub's packages. Stale chunks are removed first.
rm -f "$OUT"/*.js
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --splitting --outdir="$OUT" >>"$LOG" 2>&1

# Multi-host E2E (tests/e2e/multi-host.spec.ts): two local agents from the
# same build, bound to 127.0.0.1, with fixed test-only tokens:
#   e2e-agent     → :AGENT_PORT      right token      (online)
#   e2e-badtoken  → :AGENT_PORT+1    wrong token      (auth-error; its own
#                   agent, so the failure limit never locks out e2e-agent)
#   e2e-offline   → :AGENT_PORT+2    nothing listens  (offline)
AGENT_PORT="${E2E_AGENT_PORT:-5018}"
AGENT_TOKEN="e2e-agent-token-test-only-0123456789abcdef"
sha() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
start_agent() { # start_agent PORT TOKEN [VAR=value …]
  local port="$1" token="$2"; shift 2
  env NODE_ENV=production PIDECK_MODE=agent PIDECK_AGENT_BIND=127.0.0.1 PIDECK_AGENT_PORT="$port" \
    PIDECK_AGENT_TOKEN_SHA256="$(sha "$token")" PIDECK_DISABLE_SYSTEM_UPDATE=1 PIDECK_HOST_LOGS= "$@" \
    node "$OUT/index.js" >>"$LOG" 2>&1 &
  AGENT_PIDS+=("$!")
}

# Remote logs (tests/e2e/remote-logs.spec.ts): test-only fixture files, and
# Docker logs from a fake Engine socket the spec itself serves (never a real
# daemon). e2e-agent has logs on; e2e-badtoken keeps them off.
LOGFIX="$ROOT/.e2e/agent-logs"
rm -rf "$LOGFIX"; mkdir -p "$LOGFIX"
{
  echo "2026-09-29T08:00:00Z app started"
  echo "2026-09-29T08:00:01Z GET /api/items Authorization: Bearer e2e-fake-bearer-0123456789"
  echo "2026-09-29T08:00:02Z db connect password=e2e-fake-password ok"
  echo "2026-09-29T08:00:03Z ERROR upstream timeout"
} > "$LOGFIX/app.log"
echo "monthly report line" > "$LOGFIX/report-$(date +%Y-%m).log"
ln -s "$LOGFIX/app.log" "$LOGFIX/link.log"   # a symlink: listed as unreadable, never followed
AGENT_LOG_ENV=(
  PIDECK_AGENT_LOGS=on
  "PIDECK_HOST_LOGS=app:App log=$LOGFIX/app.log,report:Monthly report=$LOGFIX/report-%Y-%m.log,link:Linked log=$LOGFIX/link.log"
  PIDECK_AGENT_DOCKER_LOGS=on
  "PIDECK_AGENT_DOCKER_SOCKET=$ROOT/.e2e/fake-docker.sock"
)

# Services (tests/e2e/services.spec.ts): a fake systemctl first on PATH for
# the hub and e2e-agent (never the real one: the harness shares the prod
# host). It logs every argv to .e2e/fake-systemctl.log.
mkdir -p "$ROOT/.e2e/fake-bin"
ln -sf "$ROOT/tests/e2e/fake-systemctl.sh" "$ROOT/.e2e/fake-bin/systemctl"
FAKE_SYSTEMCTL_LOG="$ROOT/.e2e/fake-systemctl.log"; : > "$FAKE_SYSTEMCTL_LOG"
FAKE_PATH="$ROOT/.e2e/fake-bin:$PATH"
AGENT_LOG_ENV+=(
  "PATH=$FAKE_PATH" "FAKE_SYSTEMCTL_LOG=$FAKE_SYSTEMCTL_LOG"
  "PIDECK_SERVICES=pideck-agent,nginx,wg-quick@wg-pideck,Typo=typo-unit,vnstat,user:syncthing"
  "PIDECK_AGENT_JOURNAL_UNITS=nginx,user:syncthing"
)

AGENT_PIDS=()
trap 'kill "${AGENT_PIDS[@]}" 2>/dev/null' EXIT INT TERM
start_agent "$AGENT_PORT" "$AGENT_TOKEN" "${AGENT_LOG_ENV[@]}"
start_agent "$((AGENT_PORT + 1))" "another-agents-token-test-only-0123456789"

echo "serving dist-dev on :$PORT with e2e agents on :$AGENT_PORT-$((AGENT_PORT + 2)) (log: $LOG)"
env PATH="$FAKE_PATH" FAKE_SYSTEMCTL_LOG="$FAKE_SYSTEMCTL_LOG" PIDECK_SERVICES=nginx,ssh \
  NODE_ENV=production CSP_ENFORCE=true PIDECK_SAMPLER=off PIDECK_DISABLE_SYSTEM_UPDATE=1 PORT="$PORT" APP_PASSWORD= APP_PASSWORD_FILE="$PWFILE" \
  PIDECK_HOSTS="e2e-agent=http://127.0.0.1:$AGENT_PORT,e2e-badtoken=http://127.0.0.1:$((AGENT_PORT + 1)),e2e-offline=http://127.0.0.1:$((AGENT_PORT + 2))" \
  PIDECK_HOST_TOKEN_E2E_AGENT="$AGENT_TOKEN" \
  PIDECK_HOST_TOKEN_E2E_BADTOKEN="wrong-token-test-only-0123456789abcdef" \
  PIDECK_HOST_TOKEN_E2E_OFFLINE="unused-token-test-only-0123456789abcdef" \
  PIDECK_HOST_LABELS="e2e-agent=E2E agent" \
  node "$OUT/index.js" 2>&1 | tee -a "$LOG"
