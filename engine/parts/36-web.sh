#!/usr/bin/env bash
# part-name: Web door
# The web door: the only way an agent reaches the public internet (the Researcher
# only, and only while its switch in Settings is on).
#   36-web.sh start|stop|health|installed
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

DOOR="$ENGINE_DIR/web/door.mjs"
PID_PATTERN="web/door.mjs"
# Written only by the live task of its step, after review (PLAN-V5 K12): until then
# engine start never starts this part.
READY="$ENGINE_DIR/web/READY"

part_installed() {
  if [ -f "$READY" ] && [ -f "$DOOR" ]; then return 0; fi
  echo "The web door is not installed yet."
  return 1
}

# On only when the part answers its own health address.
part_health() {
  local own
  own="$(http_code "$CFG_WEB_URL/web/health")"
  if [ "$own" = 200 ]; then
    echo "The web door is on."
    return 0
  fi
  if port_open "$CFG_PORT_WEB" || [ -n "$(our_pid "$PART_PIDFILE" "$PID_PATTERN")" ]; then
    echo "The web door is running but not answering; run engine stop, then engine start."
    return 2
  fi
  echo "The web door is off; run engine start to turn it on."
  return 1
}

part_start() {
  part_installed || return 1
  start_node_service "$DOOR" "$PID_PATTERN" "the web door"
}

part_stop() {
  stop_group "$PART_PIDFILE" "$PID_PATTERN" 15
  if wait_until 5 port_closed "$CFG_PORT_WEB"; then return 0; fi
  echo "Something is still answering where the web door runs."
  return 1
}

part_main "$@"
