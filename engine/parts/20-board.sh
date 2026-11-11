#!/usr/bin/env bash
# part-name: Board
# The board (paperclip). It is started only here, and only inside the fence:
# the fenced `claude` and `codex` wrappers and the engine's `git` come first on
# its PATH, no model API key is in its environment, and every address it hands
# to agents points at the gate.
#   20-board.sh start|stop|health|installed
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

PAPERCLIP="$ENGINE_DIR/node_modules/.bin/paperclipai"
FENCE_BIN="$ENGINE_DIR/fence/bin"
FENCE_RUN="$ENGINE_DIR/fence/fence-run"
# paperclip's own built-in database
BOARD_DB_PORT=54329
PID_PATTERN="paperclipai"
# The board's own git settings, written by the engine (see fence/bin/git).
BOARD_GITCONFIG="$CFG_STATE/git/config"

part_installed() {
  if [ -e "$PAPERCLIP" ]; then return 0; fi
  echo "The board's program is not installed."
  return 1
}

part_health() {
  local pid listener
  if http_body "$CFG_BOARD_URL/api/health" | grep -q '"status":"ok"'; then
    pid="$(our_pid "$PART_PIDFILE" "$PID_PATTERN")"
    listener="$(lsof -nP -iTCP:"$CFG_PORT_BOARD" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    if [ -n "$pid" ] && [ "$pid" = "$listener" ]; then
      echo "The board is on."
    else
      echo "The board is on, but it was started outside the engine; run engine stop, then engine start."
    fi
    return 0
  fi
  if port_open "$CFG_PORT_BOARD" || [ -n "$(our_pid "$PART_PIDFILE" "$PID_PATTERN")" ]; then
    echo "The board is running but not answering; run engine stop, then engine start."
    return 2
  fi
  echo "The board is off; run engine start to turn it on."
  return 1
}

refuse() {
  echo "The fence is not in place, so the board was not started: $1"
  exit 3
}

# The board runs git in the agents' task folders. fence/bin/git, first on its
# PATH, refuses those folders outright. These settings are the second guard,
# for a git called by its full path: it still refuses a repository laid out
# directly in a folder (the only kind an agent can make in its task folder),
# and runs no hooks and no file-watcher program. Used through
# GIT_CONFIG_GLOBAL, so neither the owner's own git settings nor the system's
# apply to the board.
write_git_config() {
  local tmp="$BOARD_GITCONFIG.$$.tmp"
  mkdir -p "$(dirname "$BOARD_GITCONFIG")"
  printf '[safe]\n\tbareRepository = explicit\n[core]\n\tfsmonitor = false\n\thooksPath = /dev/null\n' >"$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$BOARD_GITCONFIG"
}

part_start() {
  local out code path_for_board found_claude found_codex found_git v
  health_now
  if [ "$HEALTH_CODE" = 0 ]; then echo "$HEALTH_SENTENCE"; return 0; fi

  if [ -z "$(our_pid "$PART_PIDFILE" "$PID_PATTERN")" ]; then
    if [ "$HEALTH_CODE" = 2 ]; then
      echo "Another program is using the board's place, so the board was not started."
      return 1
    fi

    # 1. the fence must pass its own check
    if [ ! -x "$FENCE_RUN" ]; then
      refuse "the fence's files are missing."
    fi
    code=0
    out="$("$FENCE_RUN" --self-check 2>&1)" || code=$?
    if [ "$code" != 0 ]; then
      out="$(printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -1 || true)"
      [ -n "$out" ] || out="the fence did not pass its own check."
      refuse "$out"
    fi

    # 2. the fenced wrappers must be the `claude` and `codex` the board finds
    path_for_board="$FENCE_BIN:$NODE24_BIN:$PATH"
    found_claude="$(PATH="$path_for_board"; hash -r; command -v claude || true)"
    found_codex="$(PATH="$path_for_board"; hash -r; command -v codex || true)"
    if [ "$found_claude" != "$FENCE_BIN/claude" ] || [ "$found_codex" != "$FENCE_BIN/codex" ]; then
      refuse "the fenced claude and codex are not the first ones the board would find."
    fi
    found_git="$(PATH="$path_for_board"; hash -r; command -v git || true)"
    if [ "$found_git" != "$FENCE_BIN/git" ]; then
      refuse "the engine's git is not the first one the board would find."
    fi

    [ -e "$PAPERCLIP" ] || { echo "The board's program is not installed."; return 1; }

    write_git_config

    # 3. start it, detached. PAPERCLIP_API_URL is set for this one process only.
    # No git variable of the caller's reaches the board; it gets the engine's
    # git settings and never looks for a repository above the home folder.
    echo "$(date '+%Y-%m-%dT%H:%M:%S%z') engine: starting the board" >>"$PART_LOG"
    (for v in $(compgen -e); do
       case "$v" in GIT_*) unset "$v" ;; esac
     done
     cd "$ENGINE_DIR" && detach "$PART_PIDFILE" "$PART_LOG" \
      env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u ENGINE_CONFIG \
      PATH="$path_for_board" \
      GIT_CONFIG_GLOBAL="$BOARD_GITCONFIG" GIT_CONFIG_NOSYSTEM=1 GIT_CEILING_DIRECTORIES="$HOME" \
      CODEX_HOME="$CFG_STATE/codex-home" \
      PAPERCLIP_API_URL="$CFG_GATE_URL" \
      PAPERCLIP_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 PAPERCLIP_NO_BROWSER=1 \
      ./node_modules/.bin/paperclipai run)
  fi

  if wait_until 90 part_health_ok; then return 0; fi
  health_now
  echo "$HEALTH_SENTENCE"
  return 1
}

# Prints the ids of processes left from fenced runs of this engine: the
# wrappers and fence scripts, and the sandbox tool started from this engine.
fence_leftovers() {
  # the patterns go through the environment so awk's own command line
  # does not match them
  ps -axo pid=,command= 2>/dev/null | \
    LEFT_A="$ENGINE_DIR/fence/" \
    LEFT_B="$ENGINE_DIR/node_modules/.bin/srt" \
    LEFT_C="$ENGINE_DIR/node_modules/@anthropic-ai/sandbox-runtime" \
    awk -v me="$$" '
    $1 != me && (index($0, ENVIRON["LEFT_A"]) || index($0, ENVIRON["LEFT_B"]) \
      || index($0, ENVIRON["LEFT_C"])) { print $1 }'
}
no_leftovers() { [ -z "$(fence_leftovers)" ]; }

part_stop() {
  local db_was_on=0 pid listener left
  if port_open "$BOARD_DB_PORT"; then db_was_on=1; fi

  pid="$(our_pid "$PART_PIDFILE" "$PID_PATTERN")"
  if [ -n "$pid" ]; then
    stop_group "$PART_PIDFILE" "$PID_PATTERN" 30
  else
    rm -f "$PART_PIDFILE"
    # a board started outside the engine: stop it only if it is paperclip
    listener="$(lsof -nP -iTCP:"$CFG_PORT_BOARD" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    if [ -n "$listener" ] && ps -o command= -p "$listener" 2>/dev/null | grep -qF "$PID_PATTERN"; then
      kill -TERM "$listener" 2>/dev/null || true
      wait_until 30 port_closed "$CFG_PORT_BOARD" || true
    fi
  fi

  # anything left from fenced runs
  left="$(fence_leftovers)"
  if [ -n "$left" ]; then
    # shellcheck disable=SC2086
    kill -TERM $left 2>/dev/null || true
    if ! wait_until 10 no_leftovers; then
      left="$(fence_leftovers)"
      # shellcheck disable=SC2086
      [ -z "$left" ] || kill -KILL $left 2>/dev/null || true
      wait_until 5 no_leftovers || true
    fi
  fi

  if ! wait_until 5 port_closed "$CFG_PORT_BOARD"; then
    echo "The board is still running."
    return 1
  fi
  if [ "$db_was_on" = 1 ] && ! wait_until 30 port_closed "$BOARD_DB_PORT"; then
    echo "The board's own database is still running."
    return 1
  fi
  if ! no_leftovers; then
    echo "Some agent work is still running."
    return 1
  fi
  return 0
}

part_main "$@"
