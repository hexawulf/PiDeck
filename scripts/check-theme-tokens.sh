#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Fail if client code uses raw colors instead of theme tokens.
#              Light/dark only works when colors come from --pi-* tokens
#              (see client/src/index.css). Allowed: components/ui (shadcn),
#              explicit `dark:` pairs, solid -500+ hues, lines marked theme-ok.
# Modified:    2026-09-21
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/client/src"

if [ -t 1 ]; then RED=$'\033[31m'; GRN=$'\033[32m'; RST=$'\033[0m'; else RED=""; GRN=""; RST=""; fi

# 1) neutrals + hex literals   2) pale hues (300/400) not prefixed by dark:
PAT_NEUTRAL='\b(text|bg|border|divide|ring|from|to)-(white|black)\b|\b(text|bg|border|divide|ring|from|to)-(gray|slate|zinc|neutral|stone)-[0-9]{2,3}\b|\[#[0-9a-fA-F]{3,8}\]|["'"'"']#[0-9a-fA-F]{3,8}["'"'"']'
PAT_PALE='(^|[^:a-z-])(text|border|divide)-(red|green|yellow|blue|purple|orange|cyan|violet|amber|emerald|sky|teal|indigo|pink|rose|lime)-(300|400)\b'

hits="$( { grep -rnE "$PAT_NEUTRAL" "$SRC" --include='*.tsx' --include='*.ts' --exclude-dir=ui || true
           grep -rnE "$PAT_PALE"    "$SRC" --include='*.tsx' --include='*.ts' --exclude-dir=ui || true; } \
         | grep -v 'theme-ok' | sort -u || true )"

if [ -n "$hits" ]; then
  printf '%s\n' "${RED}Raw colors found — use --pi-* tokens (bg-pi-card, text-pi-text, text-pi-success, …):${RST}"
  printf '%s\n' "${hits//$ROOT\//}"
  exit 1
fi
printf '%s\n' "${GRN}check-theme-tokens: OK${RST}"
