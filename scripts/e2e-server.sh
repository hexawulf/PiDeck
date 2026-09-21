#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Build PiDeck into dist-dev/ and serve it on :5017 for E2E.
#              Never writes dist/ (prod, served by pm2 on :5006). Logs in with a
#              throwaway password from .e2e/password via APP_PASSWORD_FILE;
#              APP_PASSWORD is forced empty so a prod value in .env is ignored.
# Modified:    2026-09-21
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
  exit 0
fi

case "$OUT" in */dist) echo "refusing to build into prod dist/" >&2; exit 1 ;; esac
mkdir -p "$LOGDIR" "$ROOT/.e2e"
chmod 700 "$ROOT/.e2e"
[ -s "$PWFILE" ] || { (umask 077; openssl rand -base64 24 > "$PWFILE"); }

cd "$ROOT"
npx vite build --outDir "$OUT/public" --emptyOutDir >>"$LOG" 2>&1
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir="$OUT" >>"$LOG" 2>&1

echo "serving dist-dev on :$PORT (log: $LOG)"
exec env NODE_ENV=production PORT="$PORT" APP_PASSWORD= APP_PASSWORD_FILE="$PWFILE" \
  node "$OUT/index.js" 2>&1 | tee -a "$LOG"
