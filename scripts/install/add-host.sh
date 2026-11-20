# shellcheck shell=bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Register a remote read-only agent on the hub (--add-host)
#              sourced by scripts/install.sh.
# Modified:    2026-11-20

add_host() {
  step "Add host $ADD_HOST → $ADD_URL"
  [ -f "$ENV_FILE" ] || die "no .env — install the hub first (scripts/install.sh)"
  [ "$(env_get PIDECK_MODE)" != agent ] || die "this checkout is an agent; run --add-host on the hub"
  local key
  key="PIDECK_HOST_TOKEN_$(printf '%s' "$ADD_HOST" | tr 'a-z-' 'A-Z_')"
  local hosts; hosts="$(env_get PIDECK_HOSTS)"
  local exists=0
  if [[ ",${hosts// /}," == *",$ADD_HOST="* ]] || env_has "$key"; then exists=1; fi
  if [ "$exists" = 1 ] && [ "$REPLACE" != 1 ]; then
    die "host \"$ADD_HOST\" already exists in .env; use --replace to change its URL/token (a .bak is kept)"
  fi

  # The token: file (0600), env, or a hidden prompt. Never argv, never logged.
  local token=""
  if [ -n "$TOKEN_FILE" ]; then
    [ -f "$TOKEN_FILE" ] || die "token file $TOKEN_FILE not found"
    [[ "$(stat -c %a "$TOKEN_FILE")" =~ 00$ ]] || die "$TOKEN_FILE must not be readable by group/others (chmod 600)"
    token="$(head -n 1 "$TOKEN_FILE" | tr -d '\r\n')"
  elif [ -n "${PIDECK_ADD_HOST_TOKEN:-}" ]; then
    token="$PIDECK_ADD_HOST_TOKEN"
  elif [ "$DRY_RUN" = 1 ]; then
    token=""
  elif [ -t 0 ] || [ -r /dev/tty ]; then
    { printf '%s' "  Agent token for $ADD_HOST (input hidden): " >/dev/tty; read -r -s token </dev/tty; } 2>/dev/null || token=""
    echo >&3
  else
    die "no token: use --token-file F (0600) or PIDECK_ADD_HOST_TOKEN"
  fi
  if [ "$DRY_RUN" != 1 ] || [ -n "$token" ]; then
    [[ "$token" =~ ^[[:graph:]]{16,512}$ ]] || die "that doesn't look like an agent token (16-512 printable characters, no spaces)"
  fi

  # Connection test: GET /api/agent/info with the token (header from a 0600 file).
  if [ "$SKIP_HEALTH" = 1 ]; then warn "--skip-health: not testing $ADD_URL"
  elif [ -z "$token" ]; then dry "GET $ADD_URL/api/agent/info with the token (expect 200)"
  else
    local hfile="$TMP_DIR/add-host.hdr" body="$TMP_DIR/add-host.json" code
    bearer_header_file "$token" "$hfile"
    code="$(curl -s --max-time 5 -o "$body" -w '%{http_code}' -H "@$hfile" "$ADD_URL/api/agent/info" || true)"
    case "$code" in
      200) grep -q '"version"' "$body" || die "$ADD_URL answered, but not like a PiDeck agent"
           ok "agent answers: $(sed -n 's/.*"version":"\([^"]*\)".*/PiDeck \1/p' "$body")$(sed -n 's/.*"hostname":"\([^"]*\)".*/ on \1/p' "$body")" ;;
      401|429) die "$ADD_URL rejected the token (401/429). Copy it again from the agent's install output, or rotate it there with --agent --rotate-token." ;;
      000) die "can't reach $ADD_URL (agent running? firewall allows this hub?). Add it anyway with --skip-health." ;;
      *) die "$ADD_URL answered $code to /api/agent/info — is that a PiDeck agent?" ;;
    esac
  fi

  # New .env: PIDECK_HOSTS gets the entry (replaced with --replace), the token
  # line is added (or replaced), an optional label likewise. Everything else
  # is copied as is; install_file keeps a .bak and prints a one-line summary.
  local tmp="$TMP_DIR/env" line new_hosts="" item seen_hosts=0 seen_token=0 seen_labels=0
  for item in ${hosts//,/ }; do
    [[ "$item" == "$ADD_HOST="* ]] && continue
    new_hosts+="${new_hosts:+,}$item"
  done
  new_hosts+="${new_hosts:+,}$ADD_HOST=$ADD_URL"
  local labels new_labels=""
  labels="$(env_get PIDECK_HOST_LABELS)"
  if [ -n "$ADD_LABEL" ]; then
    local IFS_SAVE="$IFS"; IFS=','
    for item in $labels; do [[ "$item" == "$ADD_HOST="* ]] || new_labels+="${new_labels:+,}$item"; done
    IFS="$IFS_SAVE"
    new_labels+="${new_labels:+,}$ADD_HOST=$ADD_LABEL"
  fi
  : > "$tmp"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      PIDECK_HOSTS=*) line="PIDECK_HOSTS=$new_hosts"; seen_hosts=1 ;;
      "$key"=*) [ -n "$token" ] && line="$key=$token"; seen_token=1 ;;
      PIDECK_HOST_LABELS=*) [ -n "$ADD_LABEL" ] && line="PIDECK_HOST_LABELS=$new_labels"; seen_labels=1 ;;
    esac
    printf '%s\n' "$line" >> "$tmp"
  done < "$ENV_FILE"
  if [ "$seen_hosts$seen_token$([ -n "$ADD_LABEL" ] && echo "$seen_labels" || echo 1)" != 111 ]; then
    printf '\n# added by scripts/install.sh --add-host %s %s\n' "$ADD_HOST" "$TS" >> "$tmp"
    [ "$seen_hosts" = 1 ] || printf 'PIDECK_HOSTS=%s\n' "$new_hosts" >> "$tmp"
    [ "$seen_token" = 1 ] || printf '%s=%s\n' "$key" "${token:-(the token)}" >> "$tmp"
    if [ -n "$ADD_LABEL" ] && [ "$seen_labels" != 1 ]; then printf 'PIDECK_HOST_LABELS=%s\n' "$new_labels" >> "$tmp"; fi
  fi
  info "PIDECK_HOSTS=$new_hosts · $key=(not shown)$([ -n "$ADD_LABEL" ] && echo " · label \"$ADD_LABEL\"")"
  if [ "$DRY_RUN" = 1 ]; then dry "write $ENV_FILE (0600, with a .bak of the old one)"; return; fi
  install_file "$tmp" "$ENV_FILE" 600

  detect_service
  step "Next"
  info "Restart the hub to load the new host:"
  case "$SERVICE" in
    pm2) info "  $(pm2_bin || echo pm2) restart pideck --update-env" ;;
    systemd) info "  sudo systemctl restart pideck" ;;
    *) info "  restart PiDeck" ;;
  esac
  info "Then pick \"$ADD_HOST\" in the host switcher (header) or open /h/$ADD_HOST/dashboard."
}
