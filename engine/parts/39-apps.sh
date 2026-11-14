#!/usr/bin/env bash
# part-name: App Studio
# App Studio's host: starts each app the owner switched on inside its fence, serves its
# pages on its own local address, and is the app's only way into the engine. It adds the
# engine's tokens itself, so no app ever holds a secret.
#   39-apps.sh start|stop|health|installed
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

HOST="$ENGINE_DIR/apps/host.mjs"
PID_PATTERN="apps/host.mjs"
# Written only by the live task of its step, after review (PLAN-V5 K12): until then
# engine start never starts this part.
READY="$ENGINE_DIR/apps/READY"

part_installed() {
  if [ -f "$READY" ] && [ -f "$HOST" ]; then return 0; fi
  echo "App Studio is not installed yet."
  return 1
}

# On only when the part answers its own health address.
part_health() {
  local own
  own="$(http_code "$CFG_APPS_URL/apps/health")"
  if [ "$own" = 200 ]; then
    echo "App Studio is on."
    return 0
  fi
  if port_open "$CFG_PORT_APPS" || [ -n "$(our_pid "$PART_PIDFILE" "$PID_PATTERN")" ]; then
    echo "App Studio is running but not answering; run engine stop, then engine start."
    return 2
  fi
  echo "App Studio is off; run engine start to turn it on."
  return 1
}

part_start() {
  part_installed || return 1
  start_node_service "$HOST" "$PID_PATTERN" "App Studio"
}

# The host stops every app itself (each in its own process group, up to 10 seconds each, all at
# once) before it exits, so it is given longer than a door before it is killed.
part_stop() {
  stop_group "$PART_PIDFILE" "$PID_PATTERN" 25
  if wait_until 5 port_closed "$CFG_PORT_APPS"; then return 0; fi
  echo "Something is still answering where App Studio runs."
  return 1
}

part_main "$@"
