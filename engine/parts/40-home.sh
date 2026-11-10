#!/usr/bin/env bash
# part-name: Home screen
# The home screen: the owner's one front door.
#   40-home.sh start|stop|health|installed
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

HOME_SERVER="$ENGINE_DIR/home/server/main.mjs"
PID_PATTERN="home/server/main.mjs"

part_installed() {
  if [ -f "$HOME_SERVER" ]; then return 0; fi
  echo "The home screen is not installed yet."
  return 1
}

part_health() {
  if [ "$(http_code "$CFG_HOME_URL/healthz")" = 200 ]; then
    echo "The home screen is on at $CFG_HOME_URL"
    return 0
  fi
  if port_open "$CFG_PORT_HOME" || [ -n "$(our_pid "$PART_PIDFILE" "$PID_PATTERN")" ]; then
    echo "The home screen is running but not answering; run engine stop, then engine start."
    return 2
  fi
  echo "The home screen is off; run engine start to turn it on."
  return 1
}

part_start() { start_node_service "$HOME_SERVER" "$PID_PATTERN" "the home screen"; }

part_stop() {
  stop_group "$PART_PIDFILE" "$PID_PATTERN" 15
  if wait_until 5 port_closed "$CFG_PORT_HOME"; then return 0; fi
  echo "Something is still answering where the home screen runs."
  return 1
}

part_main "$@"
