#!/usr/bin/env bash
# part-name: Brain door
# The brain door: answers an agent's question from the company brain's index and hands
# it the brain notes made for its task. It reads a read-only copy of the index only.
#   39-brain.sh start|stop|health|installed
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

DOOR="$ENGINE_DIR/brain/door.mjs"
PID_PATTERN="brain/door.mjs"
# Written only by the live task of its step, after review: until then
# engine start never starts this part.
READY="$ENGINE_DIR/brain/READY"

part_installed() {
  if [ -f "$READY" ] && [ -f "$DOOR" ]; then return 0; fi
  echo "The brain door is not installed yet."
  return 1
}

# On only when the part answers its own health address.
part_health() {
  local own
  own="$(http_code "$CFG_BRAIN_URL/brain/health")"
  if [ "$own" = 200 ]; then
    echo "The brain door is on."
    return 0
  fi
  if port_open "$CFG_PORT_BRAIN" || [ -n "$(our_pid "$PART_PIDFILE" "$PID_PATTERN")" ]; then
    echo "The brain door is running but not answering; run engine stop, then engine start."
    return 2
  fi
  echo "The brain door is off; run engine start to turn it on."
  return 1
}

part_start() {
  part_installed || return 1
  start_node_service "$DOOR" "$PID_PATTERN" "the brain door"
}

part_stop() {
  stop_group "$PART_PIDFILE" "$PID_PATTERN" 15
  if wait_until 5 port_closed "$CFG_PORT_BRAIN"; then return 0; fi
  echo "Something is still answering where the brain door runs."
  return 1
}

part_main "$@"
