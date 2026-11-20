# shellcheck shell=bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Update mode (--update) and self-reexec after pulling installer
#              changes, sourced by scripts/install.sh.
# Modified:    2026-11-20

# After --update's git pull: when the pull changed this script or any of its
# modules, continue with the new one (exec, same arguments) so its fixes apply
# in this very run. The rollback target, the dist backup and the timestamp/log
# are handed over; the second run neither backs up nor pulls again, and never
# re-execs.
reexec_after_pull() { # reexec_after_pull OLD_HEAD PREV_BUILD BACKUP_DIR
  [ "$DRY_RUN" = 1 ] && return 0
  [ "${PIDECK_INSTALL_REEXEC:-}" = 1 ] && return 0
  git -C "$APP_DIR" diff --quiet "$1" HEAD -- scripts/install.sh scripts/install && return 0
  info "the pull changed scripts/install.sh: continuing with the new version"
  rm -rf "$TMP_DIR"                 # exec skips the EXIT trap
  exec >&3 2>&3                     # back to the terminal: the new run starts its own tee on the same log
  wait "$TEE_PID" 2>/dev/null || true
  exec env PIDECK_INSTALL_REEXEC=1 PIDECK_INSTALL_PREV="$2" PIDECK_INSTALL_BACKUP="$3" PIDECK_INSTALL_TS="$TS" \
    bash "$APP_DIR/scripts/install.sh" "${ORIG_ARGS[@]}"
}

update() {
  [ -f "$ENV_FILE" ] || die "no .env — run the installer first (without --update)"
  local agent=0
  if [ "$(env_get PIDECK_MODE)" = agent ]; then
    agent=1; MODE=agent
    AGENT_PORT="$(env_get PIDECK_AGENT_PORT)"; AGENT_PORT="${AGENT_PORT:-5016}"
    AGENT_BIND="$(env_get PIDECK_AGENT_BIND)"; AGENT_BIND="${AGENT_BIND:-127.0.0.1}"
    SERVICE=systemd
    if [ -f "$AGENT_PREBUILT_MARKER" ]; then
      die "this agent runs a prebuilt bundle ($AGENT_PREBUILT_MARKER): --update would npm ci + build here. Update it with git pull --ff-only, the new bundle, then install.sh --agent --prebuilt (docs/INSTALL.md › Agents over WireGuard)"
    fi
  fi
  PORT="${PORT:-$(env_get PORT)}"; PORT="${PORT:-5006}"
  detect_service
  step "Update ($([ "$agent" = 1 ] && echo "agent, $AGENT_UNIT_NAME, port $AGENT_PORT" || echo "$SERVICE, port $PORT"))"
  local prev backup="$HOME/backups/pideck-dist-$TS"
  if [ "${PIDECK_INSTALL_REEXEC:-}" = 1 ]; then
    # Second run (see reexec_after_pull): backup and pull are done already.
    prev="${PIDECK_INSTALL_PREV:-}"; backup="${PIDECK_INSTALL_BACKUP:-}"
    [[ "$prev" =~ ^[0-9a-f]{7,40}$ ]] || die "re-exec: bad PIDECK_INSTALL_PREV"
    [[ "$backup" == "$HOME/backups/pideck-dist-"* ]] || die "re-exec: bad PIDECK_INSTALL_BACKUP"
    info "continuing with the updated installer (rollback target $prev)"
  else
    prev="$(build_commit)"
    local head; head="$(git -C "$APP_DIR" rev-parse --short HEAD)"
    if [ "$prev" != "$head" ]; then
      info "the running build is from $prev (dist/.build-commit) but the checkout is at $head (pulled by hand?): rollback goes to $prev"
    fi
    if [ -n "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]; then
      die "the checkout has local changes; commit or stash them first (git status)"
    fi
    if [ -d "$APP_DIR/dist" ]; then run "back up dist/ to $backup" bash -c "mkdir -p \"\$1\" && cp -a \"\$2/dist\" \"\$1/\"" _ "$backup" "$APP_DIR"; fi
    local before; before="$(git -C "$APP_DIR" rev-parse HEAD)"
    run "git pull --ff-only" git -C "$APP_DIR" pull --ff-only
    reexec_after_pull "$before" "$prev" "$backup"
  fi
  deps
  if [ "$agent" != 1 ]; then
    # Migrate after npm ci and before the build/restart: if it fails, the
    # running PiDeck keeps its current build and nothing is restarted.
    step "Database"
    db_backup
    if [ "$DRY_RUN" = 1 ]; then dry "npm run db:migrate (baseline mark first on a pre-2.5 database)"
    elif ! db_migrate; then
      step "Migration failed — update stopped"
      warn "The failing migration was rolled back. PiDeck was NOT rebuilt or restarted: it keeps running its current build."
      restore_hint
      info "Back to the previous code: cd $APP_DIR && git reset --keep $prev && npm ci"
      die "migration failed"
    fi
  fi
  build
  if [ "$agent" = 1 ]; then agent_service; agent_health; else service; health; fi
  local restart
  if [ "$agent" = 1 ]; then restart="sudo systemctl restart $AGENT_UNIT_NAME"
  elif [ "$SERVICE" = pm2 ]; then restart="$(pm2_bin) restart pideck"
  else restart="sudo systemctl restart pideck"; fi
  step "Rollback, if needed"
  info "cd $APP_DIR && git reset --keep $prev && npm ci && rm -rf dist && cp -a $backup/dist dist && $restart"
  [ "$agent" = 1 ] || restore_hint
}
