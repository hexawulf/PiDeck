#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Fail if client code uses raw colors instead of theme tokens.
#              Light/dark only works when colors come from --pi-* tokens
#              (see client/src/index.css). Allowed: components/ui (shadcn),
#              explicit `dark:` pairs, solid -500+ hues, lines marked theme-ok.
#              Also fails if a widget body under components/widgets/ draws
#              its own card chrome (WidgetFrame owns border radius, shadow, width),
#              or uses the --pi-accent fill as a text colour (use text-pi-accent-text).
# Modified:    2026-09-27
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

# 3) card chrome inside widget bodies
PAT_CHROME='\brounded-(lg|xl|2xl|3xl)\b|\bshadow(-[a-z0-9]+)?\b|\bmax-w-'
chrome="$( { grep -rnE "$PAT_CHROME" "$SRC/components/widgets" --include='*.tsx' --include='*.ts' || true; } \
           | grep -v 'theme-ok' | sort -u || true )"

# 4) --pi-accent is a fill behind white text; as text it fails AA on dark cards
PAT_ACCENT='\btext-pi-accent\b(-(text|hover)\b)?'
accent="$( { grep -rnoE "$PAT_ACCENT" "$SRC" --include='*.tsx' --include='*.ts' --exclude-dir=ui || true; } \
           | grep -vE 'text-pi-accent-(text|hover)$' | sort -u || true )"

status=0
if [ -n "$hits" ]; then
  printf '%s\n' "${RED}Raw colors found — use --pi-* tokens (bg-pi-card, text-pi-text, text-pi-success, …):${RST}"
  printf '%s\n' "${hits//$ROOT\//}"
  status=1
fi
if [ -n "$chrome" ]; then
  printf '%s\n' "${RED}Widget bodies must not draw card chrome (rounded-lg+, shadow, max-w-*) — WidgetFrame does:${RST}"
  printf '%s\n' "${chrome//$ROOT\//}"
  status=1
fi
if [ -n "$accent" ]; then
  printf '%s\n' "${RED}text-pi-accent is a fill colour (2.8:1 on dark cards) — use text-pi-accent-text for text and icons:${RST}"
  printf '%s\n' "${accent//$ROOT\//}"
  status=1
fi
[ "$status" -eq 0 ] || exit 1
printf '%s\n' "${GRN}check-theme-tokens: OK${RST}"
