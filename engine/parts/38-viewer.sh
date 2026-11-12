#!/usr/bin/env bash
# part-name: Page viewer
# The page viewer: opens the pages an agent made in a hidden Chrome outside the
# fence and takes pictures of them; it also serves the owner's preview.
#   38-viewer.sh start|stop|health|installed
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

DOOR="$ENGINE_DIR/viewer/viewer.mjs"
PID_PATTERN="viewer/viewer.mjs"
# Written only by the live task of its step, after review (PLAN-V5 K12): until then
# engine start never starts this part.
READY="$ENGINE_DIR/viewer/READY"

part_installed() {
  if [ -f "$READY" ] && [ -f "$DOOR" ]; then return 0; fi
  echo "The page viewer is not installed yet."
  return 1
}

# On only when the part answers its own health address.
part_health() {
  local own
  own="$(http_code "$CFG_VIEWER_URL/view/health")"
  if [ "$own" = 200 ]; then
    echo "The page viewer is on."
    return 0
  fi
  if port_open "$CFG_PORT_VIEWER" || port_open "$CFG_PORT_PREVIEW" || [ -n "$(our_pid "$PART_PIDFILE" "$PID_PATTERN")" ]; then
    echo "The page viewer is running but not answering; run engine stop, then engine start."
    return 2
  fi
  echo "The page viewer is off; run engine start to turn it on."
  return 1
}

part_start() {
  part_installed || return 1
  start_node_service "$DOOR" "$PID_PATTERN" "the page viewer"
}

# The viewer serves the agents on one port and the owner's preview on another.
both_closed() { port_closed "$CFG_PORT_VIEWER" && port_closed "$CFG_PORT_PREVIEW"; }

part_stop() {
  stop_group "$PART_PIDFILE" "$PID_PATTERN" 15
  if wait_until 5 both_closed; then return 0; fi
  echo "Something is still answering where the page viewer runs."
  return 1
}

part_main "$@"
