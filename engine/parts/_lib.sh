# Shared helpers for the engine's part scripts. Sourced, never run.
# Works with macOS bash 3.2 and `set -euo pipefail` in the caller.
#
# After sourcing: ENGINE_DIR (the engine/ folder this part belongs to), the
# CFG_* settings from engine/lib/config.sh, PART_ID (from the script's file
# name, `20-board.sh` -> `board`), PART_LOG and PART_PIDFILE.

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=../lib/config.sh
if ! . "$ENGINE_DIR/lib/config.sh"; then
  echo "The engine's settings file could not be read."
  exit 1
fi

PART_ID="$(basename "$0" .sh)"
PART_ID="${PART_ID#[0-9][0-9]-}"
PART_LOG="$CFG_LOGS/$PART_ID.log"
PART_PIDFILE="$CFG_RUN/$PART_ID.pid"
NODE24_BIN="$CFG_NODE24/bin"

# True when something listens on 127.0.0.1:<port>.
port_open() { nc -z -G 1 127.0.0.1 "$1" >/dev/null 2>&1; }

# Prints the HTTP status code of a GET (000 when nothing answers).
#   http_code <url> [curl args...]
http_code() {
  local url="$1"
  shift
  curl -s -o /dev/null -m 3 -w '%{http_code}' "$@" "$url" 2>/dev/null || true
}

# Prints the body of a GET (empty when nothing answers).
http_body() { curl -s -m 3 "$1" 2>/dev/null || true; }

# Prints the process id in a pid file when that process is alive and its
# command line contains <pattern>; prints nothing otherwise. The pattern check
# keeps a reused process id from being mistaken for ours.
#   our_pid <pidfile> <pattern>
our_pid() {
  local pid
  [ -f "$1" ] || return 0
  pid="$(cat "$1" 2>/dev/null || true)"
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  kill -0 "$pid" 2>/dev/null || return 0
  if ps -o command= -p "$pid" 2>/dev/null | grep -qF -- "$2"; then
    printf '%s\n' "$pid"
  fi
}

# Waits up to <secs> seconds for the command to succeed.
#   wait_until <secs> <command> [args...]
wait_until() {
  local secs="$1" i=0
  shift
  while [ "$i" -lt "$secs" ]; do
    if "$@"; then return 0; fi
    sleep 1
    i=$((i + 1))
  done
  "$@"
}

port_closed() { ! port_open "$1"; }
group_gone() { ! kill -0 -- "-$1" 2>/dev/null; }

# Runs a command in a new session (its own process group), detached from this
# shell, with stdout and stderr appended to a log and stdin from /dev/null.
# The process id (also the process group id) is written to the pid file.
#   detach <pidfile> <logfile> <command> [args...]
detach() {
  local pidfile="$1" logfile="$2" i=0
  shift 2
  mkdir -p "$(dirname "$pidfile")" "$(dirname "$logfile")"
  rm -f "$pidfile"
  /usr/bin/python3 -I -c '
import os, sys
os.setsid()
with open(sys.argv[1], "w") as f:
    f.write(str(os.getpid()) + "\n")
fd = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
os.dup2(fd, 1)
os.dup2(fd, 2)
nul = os.open(os.devnull, os.O_RDONLY)
os.dup2(nul, 0)
os.execvp(sys.argv[3], sys.argv[3:])
' "$pidfile" "$logfile" "$@" </dev/null >/dev/null 2>&1 &
  while [ ! -s "$pidfile" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
}

# Sends TERM to the process group named by the pid file, waits up to <secs>
# seconds, then KILL. Removes the pid file. Safe when nothing runs.
#   stop_group <pidfile> <pattern> <secs>
stop_group() {
  local pid
  pid="$(our_pid "$1" "$2")"
  if [ -n "$pid" ]; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    if ! wait_until "$3" group_gone "$pid"; then
      kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
      wait_until 5 group_gone "$pid" || true
    fi
  fi
  rm -f "$1"
}

# Prints the health sentence of this part and returns its health code, by
# running the part's own `health` subcommand with output kept.
#   health_now -> sets HEALTH_CODE and HEALTH_SENTENCE
health_now() {
  HEALTH_CODE=0
  HEALTH_SENTENCE="$(part_health)" || HEALTH_CODE=$?
}

# Common `start` flow for a node service: never a second copy, then detach,
# then wait up to 90 seconds for health.
#   start_node_service <script path> <pid pattern> <plain name>
start_node_service() {
  local script="$1" pattern="$2" name="$3"
  health_now
  if [ "$HEALTH_CODE" = 0 ]; then echo "$HEALTH_SENTENCE"; return 0; fi
  if [ -z "$(our_pid "$PART_PIDFILE" "$pattern")" ]; then
    if [ "$HEALTH_CODE" = 2 ]; then
      echo "Another program is using the place $name needs, so it was not started."
      return 1
    fi
    (cd "$ENGINE_DIR" && detach "$PART_PIDFILE" "$PART_LOG" \
      env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u PAPERCLIP_API_URL \
      "$NODE24_BIN/node" "$script")
  fi
  if wait_until 90 part_health_ok; then return 0; fi
  health_now
  echo "$HEALTH_SENTENCE"
  return 1
}

part_health_ok() { part_health >/dev/null 2>&1; }

# Dispatches the subcommand to the part's functions:
#   part_installed, part_start, part_health, part_stop
part_main() {
  case "${1:-}" in
    installed) part_installed ;;
    health) part_health ;;
    start) mkdir -p "$CFG_LOGS" "$CFG_RUN"; part_start ;;
    stop) mkdir -p "$CFG_LOGS" "$CFG_RUN"; part_stop ;;
    *) echo "Usage: $(basename "$0") start|stop|health|installed" >&2; exit 64 ;;
  esac
}
