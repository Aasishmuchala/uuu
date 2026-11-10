#!/usr/bin/env bash
# part-name: Gate
# The gate: the door between agents and the board. It lets through only
# requests that carry an agent's token.
#   30-gate.sh start|stop|health|installed
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

GATE="$ENGINE_DIR/gate/gate.mjs"
PID_PATTERN="gate/gate.mjs"

part_installed() {
  if [ -f "$GATE" ]; then return 0; fi
  echo "The gate is not installed yet."
  return 1
}

# On only when the gate answers its own health address and refuses a request
# that has no token.
part_health() {
  local own no_token
  own="$(http_code "$CFG_GATE_URL/gate/health")"
  no_token="$(http_code "$CFG_GATE_URL/api/health")"
  if [ "$own" = 200 ] && [ "$no_token" = 401 ]; then
    echo "The gate is on and lets in only agents with a token."
    return 0
  fi
  if [ "$own" = 200 ]; then
    echo "The gate is running but is not turning away requests without a token; run engine stop, then engine start."
    return 2
  fi
  if port_open "$CFG_PORT_GATE" || [ -n "$(our_pid "$PART_PIDFILE" "$PID_PATTERN")" ]; then
    echo "The gate is running but not answering; run engine stop, then engine start."
    return 2
  fi
  echo "The gate is off; run engine start to turn it on."
  return 1
}

part_start() { start_node_service "$GATE" "$PID_PATTERN" "the gate"; }

part_stop() {
  stop_group "$PART_PIDFILE" "$PID_PATTERN" 15
  if wait_until 5 port_closed "$CFG_PORT_GATE"; then return 0; fi
  echo "Something is still answering where the gate runs."
  return 1
}

part_main "$@"
