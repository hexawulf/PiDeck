# shellcheck shell=bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Hub installation steps (preflight, packages, .env, Postgres,
#              migrations, admin password, build, service, sudoers, health,
#              summary) sourced by scripts/install.sh.
# Modified:    2026-11-20

# ── 1. preflight (read-only) ───────────────────────────────────────────
MISSING_REQ=(); APT_PKGS=()
preflight() {
  step "Preflight (read-only)"
  local os arch
  os="$(osr PRETTY_NAME)"
  arch="$(uname -m)"
  info "OS: ${os:-unknown} · arch: $arch"
  case "$arch" in
    aarch64|arm64|x86_64|amd64) ;;
    *) warn "arch $arch is untested (PiDeck runs on aarch64 and x86_64)" ;;
  esac
  case "$(osr ID) $(osr ID_LIKE)" in
    *debian*|*ubuntu*) ;;
    *) warn "not Debian/Ubuntu: package names and paths may differ" ;;
  esac

  local pg_state="missing"
  if [ -n "$DB_URL" ] || env_has DATABASE_URL; then pg_state="external/configured"
  elif local_pg_running; then pg_state="local (running)"
  elif have psql; then pg_state="client only"; fi

  printf '\n  %-14s %-18s %s\n' "TOOL" "STATUS" "NEEDED FOR"
  row() { printf '  %-14s %-18s %s\n' "$1" "$2" "$3"; }
  local nm; nm="$(node_major || true)"
  if [ -z "$nm" ]; then row node "missing" "required (22.x)"; MISSING_REQ+=(node)
  elif [ "$nm" -lt 22 ]; then row node "v$nm (too old)" "required (22.x)"; MISSING_REQ+=(node)
  else row node "v$nm$([ "$nm" -gt 22 ] && echo ' (untested)')" "required"; fi
  if have npm; then row npm found required; else row npm missing required; MISSING_REQ+=(npm); fi
  if have git; then row git found required; else row git missing required; MISSING_REQ+=(git); fi
  if have curl; then row curl found "required (health check)"; else row curl missing required; APT_PKGS+=(curl); fi
  if have openssl; then row openssl found "required (secrets)"; else row openssl missing required; APT_PKGS+=(openssl); fi
  if [ "$MODE" = agent ]; then
    row postgresql "not needed" "agent mode keeps no database"
  else
    case "$pg_state" in
      missing|"client only") row postgresql "$pg_state" "required (or --database-url)"; APT_PKGS+=(postgresql) ;;
      *) row postgresql "$pg_state" required ;;
    esac
  fi
  if [ "$MODE" = agent ]; then row systemd "$(have systemctl && echo found || echo missing)" "service pideck-agent"
  elif have pm2; then row pm2 found "service (default when installed)"
  elif [ "$SERVICE" = pm2 ]; then row pm2 "from npm ci" "service: the repo's own pm2 (node_modules/.bin)"
  else row pm2 "optional-missing" "service: systemd unless --service pm2"; fi
  if have docker; then row docker found "Apps › Docker"; else row docker "optional-missing" "Apps › Docker shows 'not available'"; fi
  if have sensors; then row lm-sensors found "CPU temperature fallback"; else row lm-sensors "optional-missing" "CPU temperature on non-Pi hosts"; APT_PKGS+=(lm-sensors); fi
  if sbin_have smartctl; then row smartmontools found "NVMe Health"; else row smartmontools "optional-missing" "NVMe Health"; APT_PKGS+=(smartmontools); fi
  if sbin_have ufw; then row ufw found "Firewall (needs --sudoers)"; else row ufw "optional-missing" "Firewall shows 'not available'"; fi
  if [ -x /usr/bin/vcgencmd ]; then row vcgencmd found "Power Status (Pi only)"; else row vcgencmd "optional-missing" "Power Status is Pi-only"; fi
  local nvme; nvme="$(detect_nvme || true)"
  row "NVMe device" "${nvme:-none}" "NVMe Health"

  if [[ " ${MISSING_REQ[*]} " == *" node "* ]]; then
    cat <<EOF

  Node.js 22.x is required. Install it from NodeSource with a signed apt
  repository (review each step; nothing is piped into a shell):

    sudo install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /tmp/nodesource.gpg.key
    sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg /tmp/nodesource.gpg.key
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /tmp/nodesource.list
    sudo install -m 0644 /tmp/nodesource.list /etc/apt/sources.list.d/nodesource.list
    sudo apt-get update && sudo apt-get install -y nodejs

  Then run scripts/install.sh again.
EOF
  fi
  [ ${#MISSING_REQ[@]} -eq 0 ] || die "missing required: ${MISSING_REQ[*]}"
}

# ── plan: say up front what needs sudo ─────────────────────────────────
plan_sudo() {
  local steps=()
  [ "$NO_APT" != 1 ] && [ ${#APT_PKGS[@]} -gt 0 ] && steps+=("apt-get install ${APT_PKGS[*]}")
  [ -z "$DB_URL" ] && ! env_has DATABASE_URL && steps+=("create the PostgreSQL role + database (sudo -u postgres psql)")
  [ "$SERVICE" = systemd ] && steps+=("install /etc/systemd/system/pideck.service, systemctl enable --now")
  [ "$SUDOERS" = 1 ] && steps+=("install /etc/sudoers.d/pideck (visudo-checked, 0440)")
  step "Plan"
  info "service: $SERVICE · port: $PORT · $([ "$LAN_HTTP" = 1 ] && echo "LAN HTTP (insecure cookie)" || echo "HTTPS via reverse proxy")"
  if [ ${#steps[@]} -eq 0 ]; then info "no sudo needed"
  else info "These steps use sudo:"; local s; for s in "${steps[@]}"; do info "  • $s"; done; fi
  if [ "$DRY_RUN" != 1 ] && ! confirm "Continue?" y; then die "stopped by user"; fi
}

# ── 2. packages ────────────────────────────────────────────────────────
packages() {
  step "Packages"
  if [ ${#APT_PKGS[@]} -eq 0 ]; then ok "nothing to install"; return; fi
  if [ "$NO_APT" = 1 ]; then warn "--no-apt: not installing ${APT_PKGS[*]}"; return; fi
  if ! confirm "Install ${APT_PKGS[*]} with apt-get?" y; then warn "skipped: ${APT_PKGS[*]}"; return; fi
  # A broken third-party repo makes `apt-get update` fail even though the main
  # archive is fine; warn and try the install anyway.
  srun "apt-get update" apt-get update || warn "apt-get update reported errors (a third-party repository?); trying the install anyway"
  srun "apt-get install ${APT_PKGS[*]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y "${APT_PKGS[@]}" \
    || warn "apt-get install failed; continuing (required pieces are checked again later)"
}

# ── 3a. .env ───────────────────────────────────────────────────────────
DATABASE_URL_VALUE=""
write_env() {
  step ".env"
  local tmp="$TMP_DIR/env" added=() k v
  if [ -f "$ENV_FILE" ]; then cp "$ENV_FILE" "$tmp"
  elif [ -f "$APP_DIR/.env.example" ]; then
    # New .env: the example's comments, with its KEY= lines commented out so
    # its placeholder values never count as set; real values are appended below.
    sed -E 's/^([A-Z][A-Z0-9_]*=)/# \1/' "$APP_DIR/.env.example" > "$tmp"
  else : > "$tmp"; fi
  local -A want=(
    [NODE_ENV]=production
    [PORT]="$PORT"
    [PIDECK_BIND]=127.0.0.1
    [PIDECK_LOGS_DIR]="$HOME/logs"
    [PM2_LOGS_DIR]="$HOME/.pm2/logs"
    [CSP_ENFORCE]=true
  )
  [ -n "$DATABASE_URL_VALUE" ] && want[DATABASE_URL]="$DATABASE_URL_VALUE"
  if [ "$LAN_HTTP" = 1 ]; then want[PIDECK_INSECURE_HTTP]=1; want[TRUST_PROXY]=false; want[PIDECK_BIND]=0.0.0.0; fi
  [ -n "$NVME_DEVICE" ] && want[PIDECK_NVME_DEVICE]="$NVME_DEVICE"
  if ! env_has SESSION_SECRET; then
    if [ "$DRY_RUN" = 1 ]; then want[SESSION_SECRET]="(generated)"; else want[SESSION_SECRET]="$(openssl rand -hex 32)"; fi
  fi
  local order=(NODE_ENV PORT PIDECK_BIND SESSION_SECRET DATABASE_URL CSP_ENFORCE PIDECK_LOGS_DIR PM2_LOGS_DIR PIDECK_INSECURE_HTTP TRUST_PROXY PIDECK_NVME_DEVICE)
  local header=0
  for k in "${order[@]}"; do
    [ -n "${want[$k]+x}" ] || continue
    if env_has "$k"; then
      v="$(env_get "$k")"
      case "$k" in
        NODE_ENV) [ "$v" = production ] || warn ".env has NODE_ENV=$v (kept; production recommended)" ;;
        PIDECK_INSECURE_HTTP) [ "$v" = 1 ] || warn ".env has PIDECK_INSECURE_HTTP=$v (kept); --lan-http not applied" ;;
      esac
      continue
    fi
    if [ "$header" = 0 ]; then printf '\n# added by scripts/install.sh %s\n' "$TS" >> "$tmp"; header=1; fi
    printf '%s=%s\n' "$k" "${want[$k]}" >> "$tmp"
    added+=("$k")
  done
  if [ ${#added[@]} -eq 0 ]; then ok ".env has every key (values untouched)"; return; fi
  info "adding: ${added[*]} (existing values are never changed; secrets not shown)"
  if [ "$DRY_RUN" = 1 ]; then dry "write $ENV_FILE (mode 0600) with the keys above"; return; fi
  install_file "$tmp" "$ENV_FILE" 600
}

# ── 6a. dependencies (npm ci before schema/password: they use node_modules) ──
deps() {
  step "Dependencies"
  qrun "npm ci" npm ci --no-audit --no-fund
}

# ── 6b. build ──────────────────────────────────────────────────────────
build() {
  step "Build"
  qrun "npm run build" npm run build
  # The commit this dist/ was built from: --update's rollback target, even
  # when someone ran git pull by hand before --update.
  if [ "$DRY_RUN" = 1 ]; then dry "record the built commit in dist/.build-commit"; return; fi
  if [ -d "$APP_DIR/dist" ]; then
    git -C "$APP_DIR" rev-parse HEAD > "$APP_DIR/dist/.build-commit"
    ok "dist/.build-commit = $(git -C "$APP_DIR" rev-parse --short HEAD)"
  fi
}

# ── 7. service ─────────────────────────────────────────────────────────
service() {
  step "Service ($SERVICE)"
  # One instance only: refuse to add a second service manager next to an existing one.
  local p; p="$(pm2_bin)"
  if [ "$SERVICE" != pm2 ] && pm2_has_pideck "$p"; then
    die "a pm2 app 'pideck' already runs this; remove it first ($p delete pideck && $p save) or use --service pm2"
  fi
  if [ "$SERVICE" != systemd ] && [ -f "$ETC/systemd/system/pideck.service" ]; then
    die "$ETC/systemd/system/pideck.service already runs this; run scripts/uninstall.sh first or use --service systemd"
  fi
  case "$SERVICE" in
    none) info "not managing a service; start it with: cd $APP_DIR && node dist/index.js" ;;
    pm2)
      local pm2; pm2="$(pm2_bin)"
      # pm2 is a dependency, so after npm ci the repo's copy is there.
      [ -n "$pm2" ] || [ "$DRY_RUN" != 1 ] || pm2="$APP_DIR/node_modules/.bin/pm2"
      [ -n "$pm2" ] || die "pm2 not found (npm i -g pm2, or --service systemd)"
      if pm2_has_pideck "$pm2"; then
        run "restart the existing pm2 app 'pideck'" "$pm2" restart pideck --update-env
      else
        run "start pideck under pm2" "$pm2" start "$APP_DIR/ecosystem.config.cjs"
      fi
      run "pm2 save" "$pm2" save
      info "To start at boot, run once:  $pm2 startup   (then run the sudo line it prints)"
      ;;
    systemd)
      local unit="$ETC/systemd/system/pideck.service" tmp="$TMP_DIR/pideck.service" nodebin
      nodebin="$(command -v node)"
      render "$APP_DIR/deploy/systemd/pideck.service.template" "$tmp" "@USER@=$RUN_USER" "@APP_DIR@=$APP_DIR" "@NODE@=$nodebin"
      if have systemd-analyze; then
        local verr; verr="$(systemd-analyze verify "$tmp" 2>&1)" || die "systemd-analyze verify rejected the unit; nothing installed: $(printf '%s' "$verr" | head -n 3 | tr '\n' ' ')"
        ok "systemd-analyze verify: unit OK"
      else warn "systemd-analyze not found: unit not verified"; fi
      if [ "$DRY_RUN" = 1 ]; then dry "install $unit (0644), systemctl daemon-reload, enable --now (restart if already running)"; return; fi
      install_file "$tmp" "$unit" 644 sudo
      srun "systemctl daemon-reload" systemctl daemon-reload
      if systemctl is-active --quiet pideck; then srun "restart pideck" systemctl restart pideck
      else srun "enable and start pideck" systemctl enable --now pideck; fi
      ;;
  esac
}

# ── 8. sudoers (opt-in) ────────────────────────────────────────────────
sudoers() {
  step "Sudoers"
  if [ "$SUDOERS" != 1 ]; then
    info "skipped (--sudoers not given): NVMe Health, Firewall and Update System will show 'needs a sudoers rule'."
    return
  fi
  local smart ufw apt nvme tmp="$TMP_DIR/pideck.sudoers" dest="$ETC/sudoers.d/pideck"
  smart="$(tool_path smartctl)"; ufw="$(tool_path ufw)"; apt="$(tool_path apt-get)"; nvme="$(detect_nvme || true)"
  [ -n "$apt" ] || apt=/usr/bin/apt-get
  local smart_line="# (no NVMe device or smartctl: no smartctl rule)" ufw_line="# (ufw not installed: no ufw rule)"
  [ -n "$smart" ] && [ -n "$nvme" ] && smart_line="$RUN_USER ALL=(root) NOPASSWD: $smart -a $nvme"
  [ -n "$ufw" ] && ufw_line="$RUN_USER ALL=(root) NOPASSWD: $ufw status verbose"
  local template="$APP_DIR/deploy/sudoers.d/pideck.template"
  if [ "$MODE" = agent ]; then
    # An agent is read-only: no Update System, so no apt-get rules.
    grep -v -e '@APT_GET@' -e 'apt-get lines' "$template" > "$TMP_DIR/sudoers.agent.template"
    template="$TMP_DIR/sudoers.agent.template"
  fi
  render "$template" "$tmp" "@SMARTCTL_LINE@=$smart_line" "@UFW_LINE@=$ufw_line" \
    "@USER@=$RUN_USER" "@APT_GET@=$apt"
  info "grants $RUN_USER passwordless sudo for exactly:"
  grep -E '^[^#].*NOPASSWD' "$tmp" | sed 's/^.*NOPASSWD: /    /'
  if [ "$DRY_RUN" = 1 ]; then dry "visudo -cf the rendered file, then install -m 0440 to $dest"; return; fi
  confirm "Install $dest?" y || { warn "skipped"; return; }
  sudo visudo -cf "$tmp" >/dev/null || die "rendered sudoers file failed visudo -c; nothing installed"
  install_file "$tmp" "$dest" 440 sudo
}

# ── 10. health check ───────────────────────────────────────────────────
health() {
  step "Health check"
  if [ "$SKIP_HEALTH" = 1 ] || [ "$SERVICE" = none ]; then info "skipped"; return; fi
  if [ "$DRY_RUN" = 1 ]; then dry "poll http://127.0.0.1:$PORT/healthz, then log in with $PW_FILE and GET /api/auth/me"; return; fi
  local base="http://127.0.0.1:$PORT" code=""
  for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$base/healthz" || true)"
    [ "$code" = 204 ] && break
    sleep 1
  done
  [ "$code" = 204 ] || die "/healthz did not answer 204 within 60s (see the service logs)"
  ok "/healthz 204"

  local pwf="$PW_FILE"
  if [ "$(helper admin-state "$PW_FILE")" != matches ]; then
    if [ "$CHECK_LOGIN" != 1 ]; then
      warn "admin password differs from $PW_FILE (changed in the UI): skipping the login round-trip — NOT verified; re-run with --check-login to test it"
      return
    fi
    pwf="$TMP_DIR/check-login"
    if [ -n "$CHECK_LOGIN_FILE" ]; then
      [ -f "$CHECK_LOGIN_FILE" ] || die "PIDECK_CHECK_LOGIN_FILE $CHECK_LOGIN_FILE not found"
      [[ "$(stat -c %a "$CHECK_LOGIN_FILE")" =~ 00$ ]] || die "$CHECK_LOGIN_FILE must not be readable by group/others (chmod 600)"
      ( umask 077; cp "$CHECK_LOGIN_FILE" "$pwf" )
    elif [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then
      local typed=""
      { printf '%s' "  Admin password (to test the login; input hidden): " >/dev/tty; read -r -s typed </dev/tty; } 2>/dev/null || typed=""
      echo
      [ -n "$typed" ] || die "--check-login: no password entered"
      ( umask 077; printf '%s' "$typed" > "$pwf" )
      typed=""
    else
      die "--check-login needs a terminal to ask for the password (or PIDECK_CHECK_LOGIN_FILE=<0600 file>)"
    fi
  fi
  login_roundtrip "$base" "$pwf"
  [ "$pwf" = "$PW_FILE" ] || rm -f "$pwf"
}

# Login round-trip without the password or cookie ever in argv: body and
# headers come from 0600 files. Behind TLS the cookie is Secure, so ask the
# app to act as if proxied over HTTPS and hand the cookie back by header.
login_roundtrip() { # login_roundtrip BASE PASSWORD_FILE
  local base="$1" pwf="$2" code
  local body="$TMP_DIR/login.json" hdr="$TMP_DIR/headers" cookie="$TMP_DIR/cookie" proto=()
  helper login-body "$pwf" "$body"
  [ "$(env_get PIDECK_INSECURE_HTTP)" = 1 ] || proto=(-H "X-Forwarded-Proto: https")
  code="$(curl -s -o /dev/null -D "$hdr" -w '%{http_code}' "${proto[@]}" -H 'Content-Type: application/json' --data-binary "@$body" "$base/api/auth/login")"
  rm -f "$body"
  [ "$code" = 200 ] || die "login returned $code$([ "$pwf" != "$PW_FILE" ] && echo " (wrong password?)")"
  ( umask 077; printf 'Cookie: %s\n' "$(sed -n 's/^[Ss]et-[Cc]ookie: \(pideck\.sid=[^;]*\).*/\1/p' "$hdr" | tr -d '\r')" > "$cookie" )
  local me; me="$(curl -s "${proto[@]}" -H "@$cookie" "$base/api/auth/me")"
  [[ "$me" == *'"authenticated":true'* ]] || die "logged in but /api/auth/me is not authenticated"
  curl -s -o /dev/null "${proto[@]}" -H "@$cookie" -X POST "$base/api/auth/logout" || true
  ok "login round-trip: /api/auth/me 200, authenticated"
}

# ── summary ────────────────────────────────────────────────────────────
summary() {
  step "Done"
  local url="${PUBLIC_URL:-}"
  if [ -z "$url" ]; then
    if [ "$LAN_HTTP" = 1 ] || [ "$(env_get PIDECK_INSECURE_HTTP)" = 1 ]; then
      url="http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT"
    else url="https://<your-host> (via your TLS proxy → 127.0.0.1:$PORT)"; fi
  fi
  info "Open:      $url"
  info "Service:   $SERVICE $([ "$SERVICE" = pm2 ] && echo "(pm2 status / pm2 logs pideck)")$([ "$SERVICE" = systemd ] && echo "(systemctl status pideck / journalctl -u pideck)")"
  info "Config:    $ENV_FILE (0600) · admin password file: $PW_FILE (0600)"
  info "Install log: $LOG"
  if [ "$LAN_HTTP" != 1 ] && [ "$(env_get PIDECK_INSECURE_HTTP)" != 1 ]; then
    info "HTTPS:     put PiDeck behind a TLS proxy — see deploy/nginx/pideck.conf.example and docs/INSTALL.md."
    info "           Logging in over plain http://<ip>:$PORT will not work (Secure cookie)."
  fi
  if [ "$GENERATED_PW" = 1 ] && [ "$DRY_RUN" != 1 ]; then
    # Straight to the terminal (fd 3), never into the log.
    printf '\n  %sAdmin password (shown once; also in %s):%s %s\n' "$B" "$PW_FILE" "$RST" "$(cat "$PW_FILE")" >&3
    info "(password printed to the terminal only; it is not in the log)"
  fi
}
