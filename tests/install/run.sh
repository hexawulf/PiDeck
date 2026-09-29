#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Installer tests without root. Each case gets a throwaway
#              checkout (a git clone of the real scripts/templates), a fake
#              $HOME, a fake /etc (PIDECK_ETC_DIR) and PATH stubs for sudo,
#              apt-get, psql, pg_lsclusters, pm2, systemctl, systemd-analyze,
#              visudo, npm, npx, curl, hostname, ufw and id. The database is
#              faked by tests/install/fake-helper.mjs; an agent's
#              /api/agent/info by the curl stub (token checked against the
#              agent's PIDECK_AGENT_TOKEN_SHA256 or $W/state/agent-hash).
# Modified:    2026-09-28
# Usage:       tests/install/run.sh            (or: npm run test:install)
set -uo pipefail   # no -e: a failed check is counted, not fatal

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0; FAILED=()
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); FAILED+=("$CASE: $1"); printf '  FAIL %s\n' "$1"; }
check() { local what="$1"; shift; if "$@"; then ok "$what"; else bad "$what"; fi; }

REAL_VISUDO="$(command -v visudo || { [ -x /usr/sbin/visudo ] && echo /usr/sbin/visudo; } || true)"

# ── sandbox ────────────────────────────────────────────────────────────
new_sandbox() {
  CASE="$1"
  printf '\n%s\n' "$CASE"
  W="$(mktemp -d "${TMPDIR:-/tmp}/pideck-install-test.XXXXXX")"
  mkdir -p "$W/bin" "$W/home" "$W/etc/sudoers.d" "$W/etc/systemd/system" "$W/state" "$W/tmp" "$W/src"
  touch "$W/state/pm2"
  # A minimal checkout with the real installer pieces, as a git clone so --update works.
  (
    cd "$W/src" || exit 1
    mkdir -p scripts deploy
    cp "$ROOT/scripts/install.sh" "$ROOT/scripts/uninstall.sh" scripts/
    cp "$ROOT/tests/install/fake-helper.mjs" scripts/install-helper.mjs
    cp "$ROOT/tests/install/fake-migrate.mjs" scripts/migrate.mjs
    cp -r "$ROOT/deploy/." deploy/
    cp "$ROOT/.env.example" "$ROOT/ecosystem.config.cjs" "$ROOT/package.json" .
    printf '.env\nnode_modules/\ndist/\n' > .gitignore
    git init -q -b main . && git add -A && git -c user.name=t -c user.email=t@t commit -qm init
  )
  git clone -q "$W/src" "$W/app"
  APP="$W/app"
  write_stubs
}
cleanup() { [ -n "${W:-}" ] && rm -rf "$W"; }

stub() { local name="$1"; cat > "$W/bin/$name"; chmod +x "$W/bin/$name"; }
write_stubs() {
  local S="$W/state"
  stub id <<EOF
#!/usr/bin/env bash
case "\${1:-}" in -u) echo "\${FAKE_UID:-1000}" ;; -un) echo tester ;; *) exec /usr/bin/id "\$@" ;; esac
EOF
  # sudo: record, drop options, run the command as-is (we are "root" in the fake /etc).
  stub sudo <<EOF
#!/usr/bin/env bash
echo "sudo \$*" >> "$S/calls"
while [ \$# -gt 0 ]; do case "\$1" in -n|-H) shift ;; -u) shift 2 ;; --) shift; break ;; *) break ;; esac; done
exec "\$@"
EOF
  stub apt-get <<EOF
#!/usr/bin/env bash
echo "apt-get \$*" >> "$S/calls"
EOF
  # psql: record the SQL; answer the installer's "created_*" marker SELECTs
  # unless the test says the role/db already exist ($S/pg_exists).
  stub psql <<EOF
#!/usr/bin/env bash
echo "psql \$*" >> "$S/calls"
sql="\$(cat)"; printf '%s\n' "\$sql" >> "$S/psql.sql"
if [ ! -e "$S/pg_exists" ] && grep -q "'created_role'" <<<"\$sql"; then echo created_role; echo created_db; fi
EOF
  stub pg_lsclusters <<'EOF'
#!/usr/bin/env bash
echo "16  main    5432 online postgres /var/lib/postgresql/16/main /var/log/postgresql/postgresql-16-main.log"
EOF
  stub pm2 <<EOF
#!/usr/bin/env bash
[ "\${1:-}" = describe ] || echo "pm2 \$*" >> "$S/calls"   # describe is read-only
case "\${1:-}" in
  # Like real pm2: any command without a running daemon starts one.
  describe) [ -f "\$HOME/.pm2/pm2.pid" ] || echo "pm2 describe SPAWNED-DAEMON" >> "$S/calls"; grep -qx pideck "$S/pm2" ;;
  start) mkdir -p "\$HOME/.pm2"; echo 1 > "\$HOME/.pm2/pm2.pid"; grep -qx pideck "$S/pm2" || echo pideck >> "$S/pm2" ;;
  delete) sed -i '/^pideck\$/d' "$S/pm2" ;;
  restart|save|startup) : ;;
esac
EOF
  stub systemctl <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >> "$S/calls"
case "\$*" in
  "is-active --quiet "*) [ -f "$S/unit-active-\$3" ] ;;
  "enable --now "*) touch "$S/unit-active-\$3" ;;
  "disable --now "*) rm -f "$S/unit-active-\$3" ;;
esac
EOF
  stub systemd-analyze <<EOF
#!/usr/bin/env bash
echo "systemd-analyze \$*" >> "$S/calls"
! grep -q '@[A-Z_]*@' "\${@: -1}"
EOF
  # visudo: the real one when available (it checks a file without root), else a syntax sniff.
  stub visudo <<EOF
#!/usr/bin/env bash
echo "visudo \$*" >> "$S/calls"
if [ -n "$REAL_VISUDO" ]; then exec "$REAL_VISUDO" "\$@"; fi
f="\${@: -1}"; ! grep -vE '^(#|$)' "\$f" | grep -vqE '^[a-z_][a-z0-9_-]* ALL=\(root\) NOPASSWD: /[^ ]+( .*)?$'
EOF
  stub npm <<EOF
#!/usr/bin/env bash
echo "npm \$*" >> "$S/calls"
case "\$1" in
  ci) mkdir -p node_modules ;;
  run) [ "\$2" = build ] && mkdir -p dist && echo "build \$(date +%s%N)" > dist/index.js ;;
esac
EOF
  stub npx <<EOF
#!/usr/bin/env bash
echo "npx \$*" >> "$S/calls"
[ "\$1" = drizzle-kit ] && touch "$S/tables" && echo default > "$S/admin"
EOF
  # curl: /healthz 204; login checks the password against the fake DB;
  # /api/agent/info checks the bearer token (from -H @file) against the
  # agent's hash. \$S/agent-down makes the agent unreachable (000).
  stub curl <<EOF
#!/usr/bin/env bash
hdr="" body="" url="" out="" hfile=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -D) hdr="\$2"; shift ;;
    --data-binary) body="\${2#@}"; shift ;;
    -o) out="\$2"; shift ;;
    -H) case "\$2" in @*) hfile="\${2#@}" ;; esac; shift ;;
    -w|-X|--max-time) shift ;;
    http*) url="\$1" ;;
  esac
  shift
done
case "\$url" in
  */api/agent/info)
    [ -e "$S/agent-down" ] && { printf 000; exit 7; }
    want="\$(cat "$S/agent-hash" 2>/dev/null || sed -n 's/^PIDECK_AGENT_TOKEN_SHA256=//p' "$W/app/.env" 2>/dev/null)"
    got=""
    [ -n "\$hfile" ] && got="\$(sed -n 's/^Authorization: Bearer //p' "\$hfile" | tr -d '\n' | sha256sum | cut -d' ' -f1)"
    if [ -n "\$got" ] && [ "\$got" = "\$want" ]; then
      printf '{"version":"2.4.0","hostname":"agent-box","capabilities":{"read":true}}' > "\${out:-/dev/stdout}"; printf 200
    else printf '{"message":"Unauthorized"}' > "\${out:-/dev/stdout}"; printf 401; fi ;;
  */healthz) printf 204 ;;
  */api/auth/login)
    if [ "\$(node -e 'const c=require("crypto");const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).password;process.stdout.write(c.createHash("sha256").update(p).digest("hex"))' "\$body")" = "\$(cat "$S/admin")" ]; then
      printf 'HTTP/1.1 200 OK\r\nSet-Cookie: pideck.sid=s%%3Atest; Path=/; HttpOnly\r\n' > "\$hdr"; printf 200
    else printf 401; fi ;;
  */api/auth/me) printf '{"authenticated":true}' ;;
esac
EOF
  stub pg_dump <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  stub smartctl <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  stub ufw <<EOF
#!/usr/bin/env bash
echo "ufw \$*" >> "$S/calls"
EOF
  stub hostname <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in -I) echo "192.0.2.10 fd00::10" ;; -s) echo "Agent-Box" ;; *) echo agent-box ;; esac
EOF
}

# Run the installer/uninstaller in the sandbox (stdin closed = non-interactive).
inst() { (cd "$APP" && env -i PATH="$W/bin:$PATH" HOME="$W/home" TMPDIR="$W/tmp" TERM=dumb \
  PIDECK_ETC_DIR="$W/etc" PIDECK_TEST_STATE="$W/state" FAKE_UID="${FAKE_UID:-1000}" \
  PIDECK_ADD_HOST_TOKEN="${PIDECK_ADD_HOST_TOKEN:-}" \
  "$APP/scripts/install.sh" "$@" </dev/null > "$W/out" 2>&1); }
uninst() { (cd "$APP" && env -i PATH="$W/bin:$PATH" HOME="$W/home" TMPDIR="$W/tmp" TERM=dumb \
  PIDECK_ETC_DIR="$W/etc" PIDECK_TEST_STATE="$W/state" FAKE_UID="${FAKE_UID:-1000}" \
  PIDECK_PURGE_CONFIRM="${PIDECK_PURGE_CONFIRM:-}" \
  "$APP/scripts/uninstall.sh" "$@" </dev/null > "$W/out" 2>&1); }

# Checksum of everything the installer could touch (checkout, $HOME, fake /etc, fake DB).
# shellcheck disable=SC2016  # the sh -c body is expanded by sh, per file
tree_sum() { (cd "$W" && find app home etc state -path app/.git -prune -o -print0 | sort -z \
  | xargs -0 -I{} sh -c 'if [ -f "{}" ]; then echo "{} $(stat -c %a "{}") $(sha256sum < "{}")"; else echo "{} $(stat -c %a "{}")"; fi') | sha256sum; }
mode() { stat -c %a "$1"; }
latest_log() { find "$W/home/logs" -name 'pideck-install-*.log' 2>/dev/null | sort | tail -n 1; }
secrets_absent() { # secrets_absent FILE… — none of the secrets appear in any FILE
  local s f
  local list=("$(sed -n 's/^SESSION_SECRET=//p' "$APP/.env")" "$(cat "$W/home/.config/pideck/admin-password")")
  local dbpw; dbpw="$(sed -n "s/.*PASSWORD '\([^']*\)'.*/\1/p" "$W/state/psql.sql" 2>/dev/null | head -n 1)"
  [ -n "$dbpw" ] && list+=("$dbpw")
  for s in "${list[@]}"; do
    [ ${#s} -ge 8 ] || return 1
    for f in "$@"; do grep -qF -- "$s" "$f" && return 1; done
  done
  return 0
}

STD=(--yes --service pm2 --port 5099)

# ── cases ──────────────────────────────────────────────────────────────
new_sandbox "refuses to run as root"
if FAKE_UID=0 inst --dry-run; then bad "exit status"; else ok "exits non-zero"; fi
check "says why" grep -q "not as root" "$W/out"
check "creates nothing (no log dir in \$HOME)" test ! -e "$W/home/logs"
if FAKE_UID=0 uninst --dry-run; then bad "uninstall exit status"; else ok "uninstall refuses root too"; fi
cleanup

new_sandbox "--dry-run changes nothing"
before="$(tree_sum)"
inst --dry-run "${STD[@]}" --sudoers --lan-http --nvme-device /dev/nvme0 || bad "dry run exit $?"
check "tree + \$HOME + /etc unchanged" test "$before" = "$(tree_sum)"
check "prints what it would do" grep -q '\[dry-run\] would' "$W/out"
check "no sudo/apt/psql/pm2 calls" test ! -s "$W/state/calls"
check "dry-run log kept out of \$HOME" test ! -e "$W/home/logs"
uninst --dry-run --purge || bad "uninstall dry run exit $?"
check "uninstall --dry-run --purge changes nothing" test "$before" = "$(tree_sum)"
cleanup

new_sandbox "fresh install, then idempotent re-run"
inst "${STD[@]}" --sudoers --nvme-device /dev/nvme0 || { bad "install exit $?"; tail -n 20 "$W/out"; }
check ".env is 0600" test "$(mode "$APP/.env")" = 600
check "password file is 0600 in a 0700 dir" test "$(mode "$W/home/.config/pideck/admin-password")$(mode "$W/home/.config/pideck")" = 600700
check ".env has the installer keys" grep -qE '^SESSION_SECRET=[0-9a-f]{64}$' "$APP/.env"
check ".env keeps the example as comments only" bash -c "! grep -q CHANGE_ME '$APP/.env' || ! grep -qE '^[A-Z_]+=.*CHANGE_ME' '$APP/.env'"
check "DATABASE_URL points at the created role/db" grep -qE '^DATABASE_URL=postgresql://pideck:[0-9a-f]{48}@localhost:5432/pideck$' "$APP/.env"
check "role + db created through sudo -u postgres psql" grep -q '^sudo -u postgres psql' "$W/state/calls"
check "install-db marker records role+db as created (0600)" bash -c "test \"\$(stat -c %a '$W/home/.config/pideck/install-db')\" = 600 && grep -qx CREATED_ROLE=1 '$W/home/.config/pideck/install-db' && grep -qx CREATED_DB=1 '$W/home/.config/pideck/install-db'"
check "schema via db:migrate (once), never drizzle-kit push" bash -c "test \"\$(grep -cx migrate '$W/state/calls')\" = 1 && ! grep -q '^npx drizzle-kit' '$W/state/calls'"
check "admin no longer on the seeded password" test "$(cat "$W/state/admin")" != default
check "one pm2 app" test "$(grep -cx pideck "$W/state/pm2")" = 1
check "sudoers installed 0440" test "$(mode "$W/etc/sudoers.d/pideck")" = 440
check "sudoers has exactly the four commands" test "$(grep -c NOPASSWD "$W/etc/sudoers.d/pideck")" = 4
check "sudoers smartctl rule uses the device" grep -qE "^tester ALL=\(root\) NOPASSWD: $W/bin/smartctl -a /dev/nvme0$" "$W/etc/sudoers.d/pideck"
check "sudoers validates (visudo -cf)" bash -c "\"$W/bin/visudo\" -cf \"$W/etc/sudoers.d/pideck\" >/dev/null"
check "health check logged in" grep -q 'login round-trip' "$W/out"
check "password shown once on the terminal" test "$(grep -cF "$(cat "$W/home/.config/pideck/admin-password")" "$W/out")" = 1
log="$(latest_log)"
check "run logged to ~/logs/pideck-install-*.log" test -s "$log"
check "no secret in the log" secrets_absent "$log"
grep -vF 'shown once' "$W/out" > "$W/out.rest" || true
check "no secret elsewhere on the terminal" secrets_absent "$W/out.rest"
sums="$(sha256sum "$APP/.env" "$W/home/.config/pideck/admin-password" "$W/etc/sudoers.d/pideck" "$W/state/admin")"
: > "$W/state/calls"
inst "${STD[@]}" --sudoers --nvme-device /dev/nvme0 || bad "re-run exit $?"
check "re-run: .env, password, sudoers, DB admin unchanged" test "$sums" = "$(sha256sum "$APP/.env" "$W/home/.config/pideck/admin-password" "$W/etc/sudoers.d/pideck" "$W/state/admin")"
check "re-run: no backups made" bash -c "! ls '$APP'/.env.bak.* '$W'/etc/sudoers.d/*.bak.* 2>/dev/null | grep -q ."
check "re-run: still one pm2 app (restarted, not started)" bash -c "test \"\$(grep -cx pideck '$W/state/pm2')\" = 1 && grep -q '^pm2 restart pideck' '$W/state/calls' && ! grep -q '^pm2 start' '$W/state/calls'"
check "re-run: no psql; db:migrate is a no-op (up to date)" bash -c "! grep -qE '^(psql|npx)' '$W/state/calls' && grep -q 'up to date' '$W/out'"
check "re-run: no password printed" bash -c "! grep -q 'shown once' '$W/out'"
check "re-run with --service systemd refuses (single instance)" bash -c "! (cd '$APP' && env -i PATH='$W/bin:$PATH' HOME='$W/home' TMPDIR='$W/tmp' PIDECK_ETC_DIR='$W/etc' PIDECK_TEST_STATE='$W/state' '$APP/scripts/install.sh' --yes --service systemd </dev/null >/dev/null 2>&1)"
# UI password change → kept; --reset-password replaces it.
echo "changed-in-ui" > "$W/state/admin"
inst "${STD[@]}" || bad "re-run after UI change exit $?"
check "UI-changed password is kept" test "$(cat "$W/state/admin")" = changed-in-ui
check "…and the health login is skipped, not failed" grep -q 'skipping the login round-trip' "$W/out"
inst "${STD[@]}" --reset-password || bad "--reset-password exit $?"
check "--reset-password replaces it and logs in" bash -c "test \"\$(cat '$W/state/admin')\" != changed-in-ui && grep -q 'login round-trip' '$W/out'"
# Uninstall keeps data; --purge removes it.
uninst --yes || bad "uninstall exit $?"
check "uninstall: pm2 app and sudoers gone" bash -c "! grep -qx pideck '$W/state/pm2' && test ! -e '$W/etc/sudoers.d/pideck'"
check "uninstall: .env and password kept" test -f "$APP/.env" -a -f "$W/home/.config/pideck/admin-password"
check "uninstall: pm2 save --force (boot won't resurrect it)" grep -q '^pm2 save --force' "$W/state/calls"
mkdir -p "$W/home/backups/pideck-dist-20260101-000000"
uninst --yes --purge || bad "purge without confirmation exit $?"
check "purge --yes alone does NOT purge (typed confirmation required)" bash -c "test -e '$APP/.env' && ! grep -q 'DROP ' '$W/state/psql.sql'"
check "uninstall --purge-backups without --purge is refused" bash -c "! (cd '$APP' && env -i PATH='$W/bin:$PATH' HOME='$W/home' '$APP/scripts/uninstall.sh' --purge-backups </dev/null >/dev/null 2>&1)"
PIDECK_PURGE_CONFIRM=purge uninst --yes --purge || bad "purge exit $?"
check "purge: .env, password dir gone; created DB and role dropped" bash -c "test ! -e '$APP/.env' -a ! -e '$W/home/.config/pideck' && grep -q 'DROP DATABASE IF EXISTS \"pideck\"' '$W/state/psql.sql' && grep -q 'DROP ROLE IF EXISTS \"pideck\"' '$W/state/psql.sql'"
check "purge keeps ~/backups/pideck-dist-* without --purge-backups" test -d "$W/home/backups/pideck-dist-20260101-000000"
cleanup

new_sandbox "purge never drops a database the installer didn't create"
touch "$W/state/pg_exists"
inst "${STD[@]}" || bad "install exit $?"
check "marker says nothing was created" bash -c "grep -qx CREATED_ROLE=0 '$W/home/.config/pideck/install-db' && grep -qx CREATED_DB=0 '$W/home/.config/pideck/install-db'"
: > "$W/state/psql.sql"
mkdir -p "$W/home/backups/pideck-dist-20260101-000000"
PIDECK_PURGE_CONFIRM=purge uninst --yes --purge --purge-backups || bad "purge exit $?"
check "pre-existing role/db left alone" bash -c "! grep -q 'DROP ' '$W/state/psql.sql' && grep -q 'already existed before install.sh' '$W/out'"
check "--purge-backups deletes ~/backups/pideck-dist-*" test ! -e "$W/home/backups/pideck-dist-20260101-000000"
cleanup

new_sandbox "existing .env is only appended to"
printf '# my settings\nPORT=7000\nSESSION_SECRET=keep-this-session-secret-value\nDATABASE_URL=postgresql://me:mine@localhost:5432/mydb\nFOO=bar\n' > "$APP/.env"
chmod 600 "$APP/.env"; cp "$APP/.env" "$W/orig.env"
inst --yes --service pm2 --lan-http || bad "install exit $?"
check "original lines are an untouched prefix" cmp -s "$W/orig.env" <(head -n "$(wc -l < "$W/orig.env")" "$APP/.env")
check "missing keys appended" bash -c "grep -q '^PIDECK_INSECURE_HTTP=1$' '$APP/.env' && grep -q '^TRUST_PROXY=false$' '$APP/.env' && grep -q '^CSP_ENFORCE=true$' '$APP/.env'"
check "existing values win (PORT 7000, one SESSION_SECRET)" bash -c "test \"\$(grep -c '^PORT=' '$APP/.env')\" = 1 && grep -q '^PORT=7000$' '$APP/.env' && test \"\$(grep -c '^SESSION_SECRET=' '$APP/.env')\" = 1"
check "no role/db created (DATABASE_URL was set)" bash -c "! grep -q psql '$W/state/calls'"
check "timestamped .bak of the old .env" bash -c "cmp -s '$W/orig.env' $APP/.env.bak.*"
check "one-line diff summary" grep -qE '\.env: \+[0-9]+ / -0 lines \(backup: ' "$W/out"
check "health check used plain HTTP (LAN mode)" grep -q 'login round-trip' "$W/out"
check "no install-db marker (installer created no database)" test ! -e "$W/home/.config/pideck/install-db"
PIDECK_PURGE_CONFIRM=purge uninst --yes --purge || bad "purge exit $?"
check "purge leaves an operator's own database alone" bash -c "! grep -q 'DROP ' '$W/state/psql.sql' 2>/dev/null && grep -q 'not created by install.sh' '$W/out'"
cleanup

new_sandbox "systemd service"
inst --yes --service systemd --port 5098 || bad "install exit $?"
unit="$W/etc/systemd/system/pideck.service"
check "unit installed 0644" test "$(mode "$unit")" = 644
check "unit rendered (no placeholders)" bash -c "! grep -q '@[A-Z_]*@' '$unit' && grep -q '^User=tester$' '$unit' && grep -q \"^WorkingDirectory=$APP\$\" '$unit'"
check "verified before install" grep -q '^systemd-analyze verify' "$W/state/calls"
check "enabled and started" grep -q '^systemctl enable --now pideck' "$W/state/calls"
check "systemd install never starts a pm2 daemon" bash -c "! grep -q SPAWNED-DAEMON '$W/state/calls' && test ! -e '$W/home/.pm2'"
: > "$W/state/calls"
inst --yes --port 5098 || bad "re-run exit $?"
check "re-run detects systemd and restarts (no second instance)" bash -c "grep -q '^systemctl restart pideck' '$W/state/calls' && ! grep -q '^pm2 start' '$W/state/calls'"
uninst --yes || bad "uninstall exit $?"
check "uninstall: unit removed, copy kept in ~/backups" bash -c "test ! -e '$unit' && ls '$W'/home/backups/pideck-uninstall-*/pideck.service >/dev/null"
check "re-run + uninstall never start a pm2 daemon either" bash -c "! grep -q SPAWNED-DAEMON '$W/state/calls' && test ! -e '$W/home/.pm2'"
# /etc/sudoers.d is 0750 root on real hosts: existence must be asked via sudo.
chmod 000 "$W/etc/sudoers.d"; : > "$W/state/calls"
uninst --dry-run || bad "uninstall dry run exit $?"
check "unsearchable sudoers.d → existence checked with sudo -n test -e" grep -q '^sudo -n test -e .*/sudoers.d/pideck' "$W/state/calls"
chmod 755 "$W/etc/sudoers.d"
cleanup

new_sandbox "--update"
inst "${STD[@]}" || bad "install exit $?"
( cd "$W/src" && echo "// v2" >> ecosystem.config.cjs && git -c user.name=t -c user.email=t@t commit -qam v2 )
: > "$W/state/calls"
inst --update || { bad "update exit $?"; tail -n 20 "$W/out"; }
check "pulled the new commit" grep -q '// v2' "$APP/ecosystem.config.cjs"
check "dist backed up to ~/backups/pideck-dist-<ts>" bash -c "ls '$W'/home/backups/pideck-dist-*/dist/index.js >/dev/null"
check "npm ci + build + pm2 restart" bash -c "grep -q '^npm ci' '$W/state/calls' && grep -q '^npm run build' '$W/state/calls' && grep -q '^pm2 restart pideck' '$W/state/calls'"
check "prints the rollback command" grep -q 'git reset --keep' "$W/out"
line() { grep -nx "$1" "$W/state/calls" | head -n 1 | cut -d: -f1; }
check "order: npm ci → pg_dump → db:migrate → build → restart" bash -c "a=\$(grep -n '^npm ci' '$W/state/calls' | cut -d: -f1); b=\$(grep -nx 'helper db-dump' '$W/state/calls' | cut -d: -f1); c=\$(grep -nx migrate '$W/state/calls' | cut -d: -f1); d=\$(grep -n '^npm run build' '$W/state/calls' | cut -d: -f1); e=\$(grep -n '^pm2 restart pideck' '$W/state/calls' | cut -d: -f1); [ -n \"\$a\" ] && [ \"\$a\" -lt \"\$b\" ] && [ \"\$b\" -lt \"\$c\" ] && [ \"\$c\" -lt \"\$d\" ] && [ \"\$d\" -lt \"\$e\" ]"
check "database dump in ~/backups (0600) and the restore command printed" bash -c "f=\$(ls '$W'/home/backups/pideck-db-*.dump) && test \"\$(stat -c %a \"\$f\")\" = 600 && grep -q 'pg_restore --clean --if-exists' '$W/out'"
( cd "$W/src" && echo "// v3" >> ecosystem.config.cjs && git -c user.name=t -c user.email=t@t commit -qam v3 )
touch "$W/state/migrate-fail"; : > "$W/state/calls"
if inst --update; then bad "a failing migration was accepted"; else ok "a failing migration stops the update"; fi
check "…before the build and without any restart (old build keeps running)" bash -c "grep -qx migrate '$W/state/calls' && ! grep -q '^npm run build' '$W/state/calls' && ! grep -qE '^(pm2 (restart|start)|systemctl)' '$W/state/calls'"
check "…and says how to restore / go back" bash -c "grep -q 'keeps running its current build' '$W/out' && grep -q 'pg_restore' '$W/out' && grep -q 'git reset --keep' '$W/out'"
rm -f "$W/state/migrate-fail"; : > "$W/state/calls"
inst --update --no-db-backup || bad "update --no-db-backup exit $?"
check "--no-db-backup: migrates without a dump" bash -c "grep -qx migrate '$W/state/calls' && ! grep -qx 'helper db-dump' '$W/state/calls'"
echo "local edit" >> "$APP/package.json"
if inst --update; then bad "dirty tree accepted"; else ok "refuses a checkout with local changes"; fi
cleanup

# ── multi-host: agent ──────────────────────────────────────────────────
AGENT=(--agent --yes --hub-ip 192.0.2.1)
agent_token() { sed -n '/Agent token (shown once/{n;p}' "$W/out" | tr -d ' '; }
agent_hash() { sed -n 's/^PIDECK_AGENT_TOKEN_SHA256=//p' "$APP/.env"; }

new_sandbox "--agent --dry-run changes nothing"
before="$(tree_sum)"
inst "${AGENT[@]}" --dry-run --sudoers --ufw-allow-from 192.0.2.1 || bad "dry run exit $?"
# systemd-analyze verify (read-only) is the one call a dry run makes: it checks the rendered unit.
check "no sudo/apt/psql/ufw/systemctl calls (only systemd-analyze verify)" bash -c "! grep -v '^systemd-analyze verify ' '$W/state/calls' | grep -q ."
rm -f "$W/state/calls"
check "tree + \$HOME + /etc unchanged" test "$before" = "$(tree_sum)"
check "says it would add the ufw rule" grep -q 'would ufw allow from 192.0.2.1 to any port 5016 proto tcp' "$W/out"
cleanup

new_sandbox "--agent install, re-run, rotate, update, uninstall"
inst "${AGENT[@]}" --sudoers --nvme-device /dev/nvme0 || { bad "install exit $?"; tail -n 25 "$W/out"; }
check "no Postgres at all (no psql, no migrate, no admin password)" bash -c "! grep -qE '^(psql|npx|sudo -u postgres|migrate|helper db-dump)' '$W/state/calls' && test ! -e '$W/home/.config/pideck/admin-password'"
check ".env is 0600 and says agent mode" bash -c "test \"\$(stat -c %a '$APP/.env')\" = 600 && grep -qx PIDECK_MODE=agent '$APP/.env'"
check ".env binds the LAN address, port 5016" bash -c "grep -qx PIDECK_AGENT_BIND=192.0.2.10 '$APP/.env' && grep -qx PIDECK_AGENT_PORT=5016 '$APP/.env'"
check ".env has no hub secrets" bash -c "! grep -qE '^(SESSION_SECRET|DATABASE_URL)=' '$APP/.env'"
TOKEN="$(agent_token)"
check "token: 32 random bytes (64 hex), shown once on the terminal" bash -c "[[ '$TOKEN' =~ ^[0-9a-f]{64}\$ ]] && test \"\$(grep -cF '$TOKEN' '$W/out')\" = 1"
check "only its SHA-256 is stored" bash -c "test \"\$(printf %s '$TOKEN' | sha256sum | cut -d' ' -f1)\" = '$(agent_hash)' && ! grep -qF '$TOKEN' '$APP/.env'"
log="$(latest_log)"
check "token never in the log" bash -c "test -s '$log' && ! grep -qF '$TOKEN' '$log'"
check "prints the exact hub command" grep -q -- '--add-host agent-box --url http://192.0.2.10:5016' "$W/out"
unit="$W/etc/systemd/system/pideck-agent.service"
check "pideck-agent unit rendered, verified, installed 0644, started" bash -c "test \"\$(stat -c %a '$unit')\" = 644 && ! grep -q '@[A-Z_]*@' '$unit' && grep -qx 'Environment=PIDECK_MODE=agent' '$unit' && grep -q '^systemd-analyze verify' '$W/state/calls' && grep -q '^systemctl enable --now pideck-agent' '$W/state/calls'"
check "no hub service, no pm2" bash -c "test ! -e '$W/etc/systemd/system/pideck.service' && ! grep -q '^pm2 ' '$W/state/calls'"
check "agent sudoers: smartctl + ufw only (no apt-get), visudo-valid" bash -c "test \"\$(grep -c NOPASSWD '$W/etc/sudoers.d/pideck')\" = 2 && ! grep -q 'NOPASSWD: .*apt-get' '$W/etc/sudoers.d/pideck' && '$W/bin/visudo' -cf '$W/etc/sudoers.d/pideck' >/dev/null"
check "ufw rule printed, not applied (no --ufw-allow-from)" bash -c "grep -q 'sudo ufw allow from 192.0.2.1 to any port 5016 proto tcp' '$W/out' && ! grep -q 'ufw allow' '$W/state/calls'"
check "health check with the new token" grep -q 'agent answers with the new token' "$W/out"
sums="$(sha256sum "$APP/.env" "$unit" "$W/etc/sudoers.d/pideck")"
: > "$W/state/calls"
inst "${AGENT[@]}" --sudoers --nvme-device /dev/nvme0 || bad "re-run exit $?"
check "re-run: .env, unit, sudoers unchanged; no .bak" bash -c "test \"$sums\" = \"\$(sha256sum '$APP/.env' '$unit' '$W/etc/sudoers.d/pideck')\" && ! ls '$APP'/.env.bak.* 2>/dev/null | grep -q ."
check "re-run: no token shown, restart (not a second start)" bash -c "! grep -q 'shown once' '$W/out' && grep -q '^systemctl restart pideck-agent' '$W/state/calls' && ! grep -q 'enable --now' '$W/state/calls'"
check "re-run: health = refuses requests without the token" grep -q 'refuses requests without the token' "$W/out"
: > "$W/state/calls"
inst "${AGENT[@]}" --ufw-allow-from 192.0.2.1 || bad "ufw run exit $?"
check "--ufw-allow-from applies exactly that rule via sudo" grep -qE '^sudo .*/ufw allow from 192.0.2.1 to any port 5016 proto tcp comment pideck-agent$' "$W/state/calls"
check "…and records it (0600) for uninstall" bash -c "test \"\$(stat -c %a '$W/home/.config/pideck/install-agent')\" = 600 && grep -qx UFW_FROM=192.0.2.1 '$W/home/.config/pideck/install-agent'"
old_hash="$(agent_hash)"
inst "${AGENT[@]}" --rotate-token || bad "rotate exit $?"
NEW="$(agent_token)"
check "--rotate-token: new hash, old one gone, .bak kept, shown once" bash -c "test '$(agent_hash)' != '$old_hash' && test \"\$(printf %s '$NEW' | sha256sum | cut -d' ' -f1)\" = '$(agent_hash)' && ls '$APP'/.env.bak.* >/dev/null && test \"\$(grep -c '^PIDECK_AGENT_TOKEN_SHA256=' '$APP/.env')\" = 1"
check "--rotate-token: other .env values untouched" bash -c "grep -qx PIDECK_AGENT_BIND=192.0.2.10 '$APP/.env' && grep -qx PIDECK_MODE=agent '$APP/.env'"
( cd "$W/src" && echo "// v2" >> ecosystem.config.cjs && git -c user.name=t -c user.email=t@t commit -qam v2 )
: > "$W/state/calls"
inst --update || { bad "update exit $?"; tail -n 20 "$W/out"; }
check "--update on an agent: pull, npm ci, build, restart pideck-agent" bash -c "grep -q '// v2' '$APP/ecosystem.config.cjs' && grep -q '^npm ci' '$W/state/calls' && grep -q '^npm run build' '$W/state/calls' && grep -q '^systemctl restart pideck-agent' '$W/state/calls'"
check "--update on an agent never asks for a database" bash -c "! grep -q 'DATABASE_URL' '$W/out' && grep -q 'systemctl restart pideck-agent' '$W/out'"
: > "$W/state/calls"
uninst --yes || bad "uninstall exit $?"
check "uninstall: agent unit gone (copy kept), sudoers gone" bash -c "test ! -e '$unit' && ls '$W'/home/backups/pideck-uninstall-*/pideck-agent.service >/dev/null && test ! -e '$W/etc/sudoers.d/pideck'"
check "uninstall: deletes exactly the recorded ufw rule" grep -qE '^sudo .*/ufw delete allow from 192.0.2.1 to any port 5016 proto tcp$' "$W/state/calls"
check "uninstall: keeps .env, forgets the rule" bash -c "test -f '$APP/.env' && test ! -e '$W/home/.config/pideck/install-agent'"
cleanup

new_sandbox "agent uninstall leaves ufw alone when the installer didn't add the rule"
inst "${AGENT[@]}" || bad "install exit $?"
: > "$W/state/calls"
uninst --yes || bad "uninstall exit $?"
check "no ufw call" bash -c "! grep -q ufw '$W/state/calls'"
cleanup

new_sandbox "--agent refuses a hub checkout"
inst "${STD[@]}" || bad "hub install exit $?"
cp "$APP/.env" "$W/hub.env"
if inst "${AGENT[@]}"; then bad "agent install on a hub accepted"; else ok "refused"; fi
check "…with a reason, .env untouched" bash -c "grep -q 'set up as a hub' '$W/out' && cmp -s '$APP/.env' '$W/hub.env'"
cleanup

# ── multi-host: --add-host (hub) ───────────────────────────────────────
new_sandbox "--add-host"
inst "${STD[@]}" || bad "hub install exit $?"
T="$(openssl rand -hex 32)"
printf '%s' "$T" | sha256sum | cut -d' ' -f1 > "$W/state/agent-hash"
( umask 077; printf '%s\n' "$T" > "$W/token" )
cp "$APP/.env" "$W/before.env"
before="$(tree_sum)"
inst --add-host piapps2 --url http://192.0.2.10:5016 --token-file "$W/token" --dry-run || bad "dry run exit $?"
check "--dry-run changes nothing" test "$before" = "$(tree_sum)"
inst --add-host piapps2 --url http://192.0.2.10:5016/ --token-file "$W/token" --label "piapps2 (LAN)" || { bad "add exit $?"; tail -n 20 "$W/out"; }
check "tests the agent first" grep -q 'agent answers: PiDeck 2.4.0 on agent-box' "$W/out"
check "append-only: the old .env is an untouched prefix" cmp -s "$W/before.env" <(head -n "$(wc -l < "$W/before.env")" "$APP/.env")
check "adds PIDECK_HOSTS, the token, the label" bash -c "grep -qx 'PIDECK_HOSTS=piapps2=http://192.0.2.10:5016' '$APP/.env' && grep -qx 'PIDECK_HOST_TOKEN_PIAPPS2=$T' '$APP/.env' && grep -qx 'PIDECK_HOST_LABELS=piapps2=piapps2 (LAN)' '$APP/.env'"
check "keeps a .bak and prints a one-line summary" bash -c "cmp -s '$W/before.env' $APP/.env.bak.* && grep -qE '\.env: \+[0-9]+ / -0 lines' '$W/out'"
check ".env stays 0600" test "$(mode "$APP/.env")" = 600
check "token never on the terminal or in the log" bash -c "! grep -qF '$T' '$W/out' && ! grep -qF '$T' \"\$(ls -t '$W'/home/logs/pideck-install-*.log | head -n 1)\""
check "prints the restart step" grep -q 'restart pideck' "$W/out"
cp "$APP/.env" "$W/after1.env"
if inst --add-host piapps2 --url http://192.0.2.11:5016 --token-file "$W/token"; then bad "duplicate accepted"; else ok "refuses a duplicate id"; fi
check "…and changes nothing" bash -c "grep -q 'already exists' '$W/out' && cmp -s '$W/after1.env' '$APP/.env'"
rm -f "$APP"/.env.bak.*
inst --add-host piapps2 --url http://192.0.2.11:5016 --token-file "$W/token" --replace || bad "replace exit $?"
check "--replace: one entry, new URL, .bak kept" bash -c "grep -qx 'PIDECK_HOSTS=piapps2=http://192.0.2.11:5016' '$APP/.env' && test \"\$(grep -c '^PIDECK_HOST_TOKEN_PIAPPS2=' '$APP/.env')\" = 1 && cmp -s '$W/after1.env' $APP/.env.bak.*"
PIDECK_ADD_HOST_TOKEN="$T" inst --add-host piapps-3 --url https://10.8.0.3:5016 || bad "second host exit $?"
check "a second host (token from env): both listed, id → PIDECK_HOST_TOKEN_PIAPPS_3" bash -c "grep -qx 'PIDECK_HOSTS=piapps2=http://192.0.2.11:5016,piapps-3=https://10.8.0.3:5016' '$APP/.env' && grep -q '^PIDECK_HOST_TOKEN_PIAPPS_3=' '$APP/.env'"
cp "$APP/.env" "$W/after3.env"
( umask 077; printf 'wrong-token-%s\n' "$(openssl rand -hex 8)" > "$W/wrong" )
if inst --add-host piapps4 --url http://192.0.2.12:5016 --token-file "$W/wrong"; then bad "wrong token accepted"; else ok "wrong token: refused"; fi
check "…says the token was rejected, .env unchanged" bash -c "grep -q 'rejected the token' '$W/out' && cmp -s '$W/after3.env' '$APP/.env'"
touch "$W/state/agent-down"
if inst --add-host piapps4 --url http://192.0.2.12:5016 --token-file "$W/token"; then bad "unreachable accepted"; else ok "unreachable agent: refused"; fi
check "…with the --skip-health hint" grep -q -- '--skip-health' "$W/out"
inst --add-host piapps4 --url http://192.0.2.12:5016 --token-file "$W/token" --skip-health || bad "skip-health exit $?"
check "--skip-health adds it anyway" grep -q ',piapps4=http://192.0.2.12:5016$' "$APP/.env"
chmod 644 "$W/token"
if inst --add-host piapps5 --url http://192.0.2.13:5016 --token-file "$W/token" --skip-health; then bad "0644 token file accepted"; else ok "refuses a group/world-readable token file"; fi
for bad_args in "--add-host Bad --url http://h:1" "--add-host local --url http://h:1" "--add-host ok --url http://h:1/api" "--add-host ok --url ftp://h" "--add-host ok --url http://u:p@h:1"; do
  # shellcheck disable=SC2086  # word splitting of the case is intended
  if inst $bad_args --dry-run; then bad "accepted: $bad_args"; else ok "rejects: $bad_args"; fi
done
cleanup

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || { printf '  %s\n' "${FAILED[@]}"; exit 1; }
