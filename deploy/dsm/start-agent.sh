#!/bin/bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Start the PiDeck agent on the DS920+ (DSM has no systemd unit
#              for us). Run by DSM Task Scheduler as user zk at boot:
#                bash /var/services/homes/zk/pideck-agent/start-agent.sh
#              Keeps one agent running, restarts it with backoff, logs to
#              ~/logs/pideck-agent-YYYYMMDD.log. Settings: .env next to this
#              script (0600). --dry-run prints what it would do.
# Modified:    2026-09-29
set -euo pipefail

APP_DIR=/var/services/homes/zk/pideck-agent
NODE=/var/packages/Node.js_v22/target/usr/local/bin/node
LOG_DIR=/var/services/homes/zk/logs
PID_FILE="$APP_DIR/agent.pid"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_DIR/pideck-agent-$(date +%Y%m%d).log"; }

if [ "$(id -un)" != "zk" ]; then echo "run as zk, not $(id -un)" >&2; exit 1; fi
[ -x "$NODE" ] || { echo "Node.js v22 package missing: $NODE" >&2; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo "missing $APP_DIR/.env" >&2; exit 1; }

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "already running (supervisor pid $(cat "$PID_FILE"))"; exit 0
fi

if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] would start: cd $APP_DIR && $NODE dist/index.js (restart loop), log to $LOG_DIR"
  exit 0
fi

mkdir -p "$LOG_DIR"
cd "$APP_DIR"
# Detach the supervisor loop so the Task Scheduler task can finish.
nohup bash -c '
  set -u
  delay=5
  while true; do
    start=$(date +%s)
    printf "[%s] starting agent\n" "$(date "+%Y-%m-%d %H:%M:%S")"
    "$0" dist/index.js
    code=$?
    printf "[%s] agent exited with %s\n" "$(date "+%Y-%m-%d %H:%M:%S")" "$code"
    # a run longer than 5 minutes resets the backoff
    if [ $(( $(date +%s) - start )) -gt 300 ]; then delay=5; else delay=$(( delay < 300 ? delay * 2 : 300 )); fi
    sleep "$delay"
  done
' "$NODE" >> "$LOG_DIR/pideck-agent-$(date +%Y%m%d).log" 2>&1 &
echo $! > "$PID_FILE"
log "supervisor started (pid $(cat "$PID_FILE"))"
echo "started (supervisor pid $(cat "$PID_FILE"))"
