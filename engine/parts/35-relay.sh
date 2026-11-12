#!/usr/bin/env bash
# part-name: Model relay
# The model relay: the door between agents and the outside model provider. It
# adds the provider's key itself, so the key never enters the fence.
#   35-relay.sh start|stop|health|installed
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

RELAY="$ENGINE_DIR/relay/relay.mjs"
PID_PATTERN="relay/relay.mjs"

part_installed() {
  if [ -f "$RELAY" ]; then return 0; fi
  echo "The model relay is not installed yet."
  return 1
}

# On only when the relay answers its own health address.
part_health() {
  local own
  own="$(http_code "$CFG_RELAY_URL/relay/health")"
  if [ "$own" = 200 ]; then
    echo "The model relay is on."
    return 0
  fi
  if port_open "$CFG_PORT_RELAY" || [ -n "$(our_pid "$PART_PIDFILE" "$PID_PATTERN")" ]; then
    echo "The model relay is running but not answering; run engine stop, then engine start."
    return 2
  fi
  echo "The model relay is off; run engine start to turn it on."
  return 1
}

part_start() { start_node_service "$RELAY" "$PID_PATTERN" "the model relay"; }

part_stop() {
  stop_group "$PART_PIDFILE" "$PID_PATTERN" 15
  if wait_until 5 port_closed "$CFG_PORT_RELAY"; then return 0; fi
  echo "Something is still answering where the model relay runs."
  return 1
}

part_main "$@"
