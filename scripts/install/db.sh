# shellcheck shell=bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: PostgreSQL provisioning, migrations, backups, and admin
#              password helpers sourced by scripts/install.sh.
# Modified:    2026-11-20

# ── 3b. database ───────────────────────────────────────────────────────
DB_NAME="${PIDECK_DB_NAME:-pideck}"
DB_USER="${PIDECK_DB_USER:-pideck}"
validate_pg_ident() {
  local label="$1" val="$2"
  [[ "$val" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]] \
    || die "invalid $label '$val' (must match ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$)"
}
database() {
  step "Database"
  validate_pg_ident PIDECK_DB_NAME "$DB_NAME"
  validate_pg_ident PIDECK_DB_USER "$DB_USER"
  if [ -n "$DB_URL" ]; then
    DATABASE_URL_VALUE="$DB_URL"
    if env_has DATABASE_URL && [ "$(env_get DATABASE_URL)" != "$DB_URL" ]; then
      warn ".env already has a different DATABASE_URL — keeping it (edit .env to switch)"
    else ok "using --database-url (not shown)"; fi
    return
  fi
  if env_has DATABASE_URL; then ok "DATABASE_URL already in .env (not shown)"; return; fi
  if ! local_pg_running && [ "$DRY_RUN" != 1 ]; then
    die "no running local PostgreSQL. Install it (without --no-apt) or pass --database-url."
  fi
  local pw
  if [ "$DRY_RUN" = 1 ]; then pw="(generated)"; else pw="$(openssl rand -hex 24)"; fi
  # Idempotent: create the role/db if missing; (re)set the role password so
  # the new .env can connect. SQL goes in on stdin, never as arguments.
  # The two marker SELECTs print which objects are about to be created, so
  # uninstall --purge only ever drops what this installer made.
  local sql
  sql="$(cat <<SQL
SELECT 'created_role' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER');
SELECT 'created_db' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME');
SELECT 'CREATE ROLE "$DB_USER" LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER')\\gexec
ALTER ROLE "$DB_USER" WITH LOGIN PASSWORD '$pw';
SELECT 'CREATE DATABASE "$DB_NAME" OWNER "$DB_USER"' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME')\\gexec
SQL
)"
  if [ "$DRY_RUN" = 1 ]; then
    dry "sudo -u postgres psql: create role \"$DB_USER\" and database \"$DB_NAME\" if missing, set a generated role password"
    dry "record what was created in $DB_MARKER (uninstall --purge drops only that)"
  else
    info "creating role \"$DB_USER\" and database \"$DB_NAME\" if missing (password generated, not shown)"
    local out
    out="$(cd /tmp && printf '%s\n' "$sql" | sudo -u postgres psql -X -q -At -v ON_ERROR_STOP=1)"
    record_db_created "$(grep -qx created_role <<<"$out" && echo 1 || echo 0)" \
                      "$(grep -qx created_db <<<"$out" && echo 1 || echo 0)"
  fi
  DATABASE_URL_VALUE="postgresql://$DB_USER:$pw@localhost:5432/$DB_NAME"
}

# What this installer created (0600, outside the repo). Only these objects
# are ever dropped by uninstall --purge; an existing role/db is never "ours".
# A re-run never downgrades an earlier "created" to 0.
record_db_created() {
  local role="$1" db="$2" prev_role=0 prev_db=0
  if [ -f "$DB_MARKER" ] && grep -qx "DB_NAME=$DB_NAME" "$DB_MARKER" && grep -qx "DB_USER=$DB_USER" "$DB_MARKER"; then
    grep -qx 'CREATED_ROLE=1' "$DB_MARKER" && prev_role=1
    grep -qx 'CREATED_DB=1' "$DB_MARKER" && prev_db=1
  fi
  [ "$prev_role" = 1 ] && role=1
  [ "$prev_db" = 1 ] && db=1
  install -d -m 700 "$CONFIG_DIR"
  local tmp="$TMP_DIR/db-marker"
  printf 'DB_NAME=%s\nDB_USER=%s\nCREATED_ROLE=%s\nCREATED_DB=%s\n' "$DB_NAME" "$DB_USER" "$role" "$db" > "$tmp"
  install -m 600 "$tmp" "$DB_MARKER"
  if [ "$role$db" = 00 ]; then warn "role and database already existed: uninstall --purge will leave them alone"
  else ok "recorded in $DB_MARKER: created role=$role db=$db"; fi
}

# ── 3c. schema ─────────────────────────────────────────────────────────
schema() {
  step "Schema (migrations)"
  if [ "$DRY_RUN" = 1 ]; then dry "npm run db:migrate (a pre-2.5 database gets a baseline mark first; then pending migrations)"; return; fi
  helper db-check >/dev/null || die "cannot reach the database (see the message above)"
  # Fresh database: every migration runs. Existing (2.3/2.4) database: 0000 is
  # recorded without running, then only the new ones run. Each in its own transaction.
  db_migrate || die "schema migration failed (see above); nothing else was changed"
  [ -z "$(helper tables)" ] || die "migrations finished but PiDeck tables are still missing"
  ok "schema up to date"
}

# npm run db:migrate, with its (secret-free) output on the terminal and in the log.
db_migrate() {
  (cd "$APP_DIR" && node scripts/migrate.mjs)
}

# pg_dump -Fc of the PiDeck database to ~/backups (update only). Sets DB_DUMP.
DB_DUMP=""
db_backup() {
  DB_DUMP="$HOME/backups/pideck-db-$TS.dump"
  if [ "$NO_DB_BACKUP" = 1 ]; then warn "--no-db-backup: not dumping the database before migrating"; DB_DUMP=""; return; fi
  if [ "$DRY_RUN" = 1 ]; then dry "pg_dump -Fc the PiDeck database to $DB_DUMP (0600)"; return; fi
  have pg_dump || die "pg_dump not found: install postgresql-client (same major version as the server), or pass --no-db-backup"
  install -d -m 700 "$HOME/backups"
  local size
  size="$(helper db-dump "$DB_DUMP")" || die "database backup failed; nothing was migrated (see above)"
  ok "database backed up: $DB_DUMP ($size bytes)"
}

restore_hint() {
  [ -n "$DB_DUMP" ] || return 0
  info "Restore the database from before this update, if needed:"
  info "  cd $APP_DIR && pg_restore --clean --if-exists --no-owner --dbname \"\$(sed -n 's/^DATABASE_URL=//p' .env)\" $DB_DUMP"
}

# ── 5. admin password ──────────────────────────────────────────────────
GENERATED_PW=0
admin_password() {
  step "Admin password"
  if [ "$DRY_RUN" = 1 ]; then
    dry "make sure the DB admin isn't on the seeded 'admin' password: use ${PW_SOURCE:-a prompted or generated password}, store it in $PW_FILE (0600)"
    return
  fi
  local state; state="$(helper admin-state "$PW_FILE")"
  if [ "$state" = custom ] && [ "$RESET_PW" != 1 ]; then ok "admin password was changed in the UI — keeping it (use --reset-password to replace)"; return; fi
  if [ "$state" = matches ] && [ "$RESET_PW" != 1 ]; then ok "admin password matches $PW_FILE"; return; fi

  install -d -m 700 "$CONFIG_DIR"
  local src="$PW_SOURCE" tmp="$TMP_DIR/pw"
  ( umask 077; : > "$tmp" )
  if [ -z "$src" ]; then
    if [ "$YES" = 1 ] || [ ! -t 0 ]; then src=generate
    elif confirm "Generate a strong admin password? (No = type your own)" y; then src=generate
    else src=prompt; fi
  fi
  case "$src" in
    generate)
      # 20 chars, guaranteed to pass the UI's rules (lower, upper, digit, special).
      printf '%s' "$(openssl rand -base64 18 | tr -d '/+=\n' | cut -c1-16)aZ9-" > "$tmp"
      GENERATED_PW=1 ;;
    prompt)
      local a b
      read -r -s -p "  New admin password: " a </dev/tty; echo
      read -r -s -p "  Repeat: " b </dev/tty; echo
      [ "$a" = "$b" ] || die "passwords don't match"
      printf '%s' "$a" > "$tmp"; unset a b ;;
    file:*)
      local f="${src#file:}"
      [ -f "$f" ] || die "password file $f not found"
      cp "$f" "$tmp"; chmod 600 "$tmp" ;;
  esac
  local problem; problem="$(node "$APP_DIR/scripts/install-helper.mjs" strength "$tmp")"
  [ "$problem" = ok ] || die "admin password needs $problem (same rules as Settings)"
  install -m 600 "$tmp" "$PW_FILE"
  local force=(); [ "$RESET_PW" = 1 ] && force=(--force)
  local result; result="$(helper set-admin "$PW_FILE" "${force[@]}")"
  case "$result" in
    set) ok "admin password set (stored in $PW_FILE, mode 0600)" ;;
    unchanged*) ok "admin password unchanged" ;;
  esac
}
