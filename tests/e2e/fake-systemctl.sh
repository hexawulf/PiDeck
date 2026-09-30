#!/usr/bin/env bash
# Fake systemctl for the E2E harness (scripts/e2e-server.sh puts it first on
# PATH for the hub and e2e-agent). Answers only the read-only calls PiDeck
# makes (server/services/systemd.ts) and logs every argv to
# $FAKE_SYSTEMCTL_LOG, so tests/e2e/services.spec.ts can check nothing else
# was ever run. Anything else exits 1.
set -u
printf '%s\n' "$*" >> "${FAKE_SYSTEMCTL_LOG:-/dev/null}"
user=0
if [ "${1:-}" = "--user" ]; then user=1; shift; fi

record() { # record UNIT LOAD ACTIVE SUB DESCRIPTION [TYPE]
  printf 'Id=%s.service\nDescription=%s\nLoadState=%s\nActiveState=%s\nSubState=%s\nUnitFileState=enabled\nType=%s\nResult=success\nMainPID=0\nNRestarts=0\nMemoryCurrent=[not set]\nActiveEnterTimestampMonotonic=5000000\nStateChangeTimestampMonotonic=5000000\n\n' \
    "${1%.service}" "$5" "$2" "$3" "$4" "${6:-simple}"
}

case "${1:-}" in
  list-units)
    [ "$*" = "list-units --state=failed --plain --no-legend --no-pager" ] || exit 1
    [ "$user" = 0 ] && echo "pkgctl-HyperBackup-ED.service loaded failed failed Hyper Backup"
    exit 0 ;;
  show)
    if [ "$*" = "show --no-pager -p Version" ]; then echo "Version=259"; exit 0; fi
    shift
    while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
    [ "${1:-}" = "--" ] || exit 1
    shift
    for u in "$@"; do
      case "$u" in
        nginx) record nginx loaded active running "A high performance web server" notify ;;
        ssh) record ssh loaded active running "OpenBSD Secure Shell server" ;;
        pideck-agent) record pideck-agent loaded active running "PiDeck agent (read-only)" ;;
        wg-quick@wg-pideck) record wg-quick@wg-pideck loaded active exited "WireGuard via wg-quick(8) for wg-pideck" oneshot ;;
        vnstat) record vnstat loaded inactive dead "vnStat network traffic monitor" ;;
        syncthing) [ "$user" = 1 ] && record syncthing loaded active running "Syncthing - Open Source Continuous File Synchronization" ;;
        pkgctl-HyperBackup-ED.service) record pkgctl-HyperBackup-ED loaded failed failed "Hyper Backup" ;;
        *) record "$u" not-found inactive dead "$u" ;;
      esac
    done
    exit 0 ;;
esac
exit 1
