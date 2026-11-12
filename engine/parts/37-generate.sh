#!/usr/bin/env bash
# part-name: Generation door
# The generation door: the only way an agent reaches Runway. It adds the owner's
# key itself, so the key never enters the fence.
#   37-generate.sh start|stop|health|installed
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

DOOR="$ENGINE_DIR/generate/door.mjs"
PID_PATTERN="generate/door.mjs"
# Written only by the live task of its step, after review (PLAN-V5 K12): until then
# engine start never starts this part.
READY="$ENGINE_DIR/generate/READY"

part_installed() {
  if [ -f "$READY" ] && [ -f "$DOOR" ]; then return 0; fi
  echo "The generation door is not installed yet."
  return 1
}

# On only when the part answers its own health address.
part_health() {
  local own
  own="$(http_code "$CFG_GENERATE_URL/gen/health")"
  if [ "$own" = 200 ]; then
    echo "The generation door is on."
    return 0
  fi
  if port_open "$CFG_PORT_GENERATE" || [ -n "$(our_pid "$PART_PIDFILE" "$PID_PATTERN")" ]; then
    echo "The generation door is running but not answering; run engine stop, then engine start."
    return 2
  fi
  echo "The generation door is off; run engine start to turn it on."
  return 1
}

part_start() {
  part_installed || return 1
  start_node_service "$DOOR" "$PID_PATTERN" "the generation door"
}

part_stop() {
  stop_group "$PART_PIDFILE" "$PID_PATTERN" 15
  if wait_until 5 port_closed "$CFG_PORT_GENERATE"; then return 0; fi
  echo "Something is still answering where the generation door runs."
  return 1
}

part_main "$@"
