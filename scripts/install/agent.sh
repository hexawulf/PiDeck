# shellcheck shell=bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Read-only multi-host agent installation (--agent) sourced by
#              scripts/install.sh.
# Modified:    2026-11-20

# A read-only agent (docs/plans/multi-host.md): no database, no login, one
# systemd unit (pideck-agent). The token is generated here, shown once on
# the terminal (never logged), and only its SHA-256 is kept in .env.
AGENT_UNIT_NAME=pideck-agent
AGENT_MARKER="$CONFIG_DIR/install-agent"
# --after / --memory-max live in a drop-in, so --update (which re-renders the
# unit from the template) keeps them.
AGENT_DROPIN="$ETC/systemd/system/$AGENT_UNIT_NAME.service.d/10-install.conf"
# Written by a --prebuilt install: --update (npm ci + build) is refused there.
AGENT_PREBUILT_MARKER="$CONFIG_DIR/agent-prebuilt"
AGENT_TOKEN=""          # set only when this run made a (new) token
AGENT_TOKEN_FILE=""

is_private_ipv4() {
  local ip="$1" a b c d
  [[ "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  a=$((10#${BASH_REMATCH[1]})); b=$((10#${BASH_REMATCH[2]}))
  c=$((10#${BASH_REMATCH[3]})); d=$((10#${BASH_REMATCH[4]}))
  (( a <= 255 && b <= 255 && c <= 255 && d <= 255 )) || return 1
  # RFC1918 (10/8, 172.16/12, 192.168/16), loopback (127/8), CGNAT (100.64/10), link-local (169.254/16)
  (( a == 10 || a == 127 )) && return 0
  (( a == 172 && b >= 16 && b <= 31 )) && return 0
  (( a == 192 && b == 168 )) && return 0
  (( a == 100 && b >= 64 && b <= 127 )) && return 0
  (( a == 169 && b == 254 )) && return 0
  return 1
}
lan_ip() {
  local a
  for a in $(hostname -I 2>/dev/null); do
    is_private_ipv4 "$a" && { printf '%s\n' "$a"; return 0; }
  done
  hostname -I 2>/dev/null | awk '{print $1}'
}
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
  [ "$PREBUILT" = 1 ] && info "--prebuilt: uses the unpacked node_modules/ + dist/ (no npm ci, no build on this host)"
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

# --prebuilt: node_modules/ and dist/ come from a bundle built elsewhere
# (docs/INSTALL.md › Agents over WireGuard). Accept them only when dist/ was
# built from exactly this checkout's commit and the runtime packages are there.
prebuilt_check() {
  step "Prebuilt (no npm ci, no build)"
  # A dry run reports what is missing instead of stopping.
  local fail=die; [ "$DRY_RUN" = 1 ] && fail=warn
  local want have=""
  want="$(git -C "$APP_DIR" rev-parse HEAD)"
  [ -f "$APP_DIR/dist/.build-commit" ] && have="$(tr -d '[:space:]' < "$APP_DIR/dist/.build-commit")"
  if [ ! -f "$APP_DIR/dist/index.js" ]; then $fail "--prebuilt: no dist/index.js; unpack the bundle into $APP_DIR first"; return 0; fi
  if [ "$have" != "$want" ]; then $fail "--prebuilt: dist/ is from ${have:0:7} but the checkout is at ${want:0:7}; unpack the bundle built from ${want:0:7}"; return 0; fi
  if [ ! -d "$APP_DIR/node_modules/express" ]; then $fail "--prebuilt: node_modules/ is missing (the bundle holds it: npm ci --omit=dev on the build host)"; return 0; fi
  ok "dist/ built from $(git -C "$APP_DIR" rev-parse --short HEAD), node_modules/ present"
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
    if [ -z "$AGENT_BIND" ]; then
      AGENT_BIND=127.0.0.1
      warn "no LAN address found; binding to 127.0.0.1 (pass --agent-bind)"
    elif ! is_private_ipv4 "$AGENT_BIND"; then
      die "refusing to auto-bind plain-HTTP agent to non-private address $AGENT_BIND; pass --agent-bind explicitly (e.g. a WireGuard tunnel IP or 127.0.0.1)"
    fi
  fi
  dropin_merge
  preflight
  bind_check
  # Before anything is written: a wrong or missing bundle changes nothing.
  [ "$PREBUILT" = 1 ] && prebuilt_check
  agent_plan
  packages
  agent_env
  if [ "$PREBUILT" = 1 ]; then
    if [ "$DRY_RUN" = 1 ]; then dry "write $AGENT_PREBUILT_MARKER (--update then refuses to npm ci/build here)"
    else install -d -m 700 "$CONFIG_DIR"; printf 'PREBUILT=1\nSINCE=%s\n' "$TS" > "$AGENT_PREBUILT_MARKER"; chmod 600 "$AGENT_PREBUILT_MARKER"; fi
  else
    deps; build
    # Built here now: --update may build here again.
    if [ -f "$AGENT_PREBUILT_MARKER" ] && [ "$DRY_RUN" != 1 ]; then rm -f "$AGENT_PREBUILT_MARKER"; info "built on this host: removed $AGENT_PREBUILT_MARKER"; fi
  fi
  agent_service
  sudoers
  agent_firewall
  agent_health
  agent_summary
}
