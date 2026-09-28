#!/usr/bin/env bash
# Author:      0xWulf (zk@hexawulf.dev)
# Description: Installer tests without root. Each case gets a throwaway
#              checkout (a git clone of the real scripts/templates), a fake
#              $HOME, a fake /etc (PIDECK_ETC_DIR) and PATH stubs for sudo,
#              apt-get, psql, pg_lsclusters, pm2, systemctl, systemd-analyze,
#              visudo, npm, npx, curl and id. The database is faked by
#              tests/install/fake-helper.mjs.
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
  describe) grep -qx pideck "$S/pm2" ;;
  start) grep -qx pideck "$S/pm2" || echo pideck >> "$S/pm2" ;;
  delete) sed -i '/^pideck\$/d' "$S/pm2" ;;
  restart|save|startup) : ;;
esac
EOF
  stub systemctl <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >> "$S/calls"
case "\$*" in
  "is-active --quiet pideck") [ -f "$S/unit-active" ] ;;
  "enable --now pideck") touch "$S/unit-active" ;;
  "disable --now pideck") rm -f "$S/unit-active" ;;
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
  # curl: /healthz 204; login checks the password against the fake DB.
  stub curl <<EOF
#!/usr/bin/env bash
hdr="" body="" url=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -D) hdr="\$2"; shift ;;
    --data-binary) body="\${2#@}"; shift ;;
    -o|-w|-H|-X) shift ;;
    http*) url="\$1" ;;
  esac
  shift
done
case "\$url" in
  */healthz) printf 204 ;;
  */api/auth/login)
    if [ "\$(node -e 'const c=require("crypto");const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).password;process.stdout.write(c.createHash("sha256").update(p).digest("hex"))' "\$body")" = "\$(cat "$S/admin")" ]; then
      printf 'HTTP/1.1 200 OK\r\nSet-Cookie: pideck.sid=s%%3Atest; Path=/; HttpOnly\r\n' > "\$hdr"; printf 200
    else printf 401; fi ;;
  */api/auth/me) printf '{"authenticated":true}' ;;
esac
EOF
  stub smartctl <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  stub ufw <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
}

# Run the installer/uninstaller in the sandbox (stdin closed = non-interactive).
inst() { (cd "$APP" && env -i PATH="$W/bin:$PATH" HOME="$W/home" TMPDIR="$W/tmp" TERM=dumb \
  PIDECK_ETC_DIR="$W/etc" PIDECK_TEST_STATE="$W/state" FAKE_UID="${FAKE_UID:-1000}" \
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
check "schema pushed once" test "$(grep -c '^npx drizzle-kit push' "$W/state/calls")" = 1
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
check "re-run: no psql, no schema push" bash -c "! grep -qE '^(psql|npx)' '$W/state/calls'"
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
: > "$W/state/calls"
inst --yes --port 5098 || bad "re-run exit $?"
check "re-run detects systemd and restarts (no second instance)" bash -c "grep -q '^systemctl restart pideck' '$W/state/calls' && ! grep -q '^pm2 start' '$W/state/calls'"
uninst --yes || bad "uninstall exit $?"
check "uninstall: unit removed, copy kept in ~/backups" bash -c "test ! -e '$unit' && ls '$W'/home/backups/pideck-uninstall-*/pideck.service >/dev/null"
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
echo "local edit" >> "$APP/package.json"
if inst --update; then bad "dirty tree accepted"; else ok "refuses a checkout with local changes"; fi
cleanup

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || { printf '  %s\n' "${FAILED[@]}"; exit 1; }
