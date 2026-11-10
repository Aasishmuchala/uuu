#!/usr/bin/env bash
# PROTOTYPE (fence trial). Proves the fence around each agent tool (Claude Code
# and Codex). Exit 0 only if every line passes, 1 if the fence failed, 2 if the
# fence holds but a login is still to do.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$HOME/.paperclip/uuu-engine"
WS="$STATE_DIR/proof-ws"
BOARD="http://127.0.0.1:3100"
mkdir -p "$WS" && cd "$WS" && echo "inside" > note.txt
fail=0; skipped=0
RUN=""; WHO=""

# Each check first prints a marker from inside the fence. No marker means the
# fence never started, and that must never be counted as "blocked".
inside() { "$RUN" --fence-check "echo FENCE_UP; $1" 2>/dev/null; }
blocked() {
  local out; out="$(inside "$2")"; local rc=$?
  if [[ "$out" != FENCE_UP* ]]; then echo "FAIL  the fence around $WHO did not start (while checking: $1)"; fail=1
  elif (( rc == 0 )); then echo "FAIL  $WHO could $1"; fail=1
  else echo "PASS  $WHO cannot $1"; fi
}
allowed() {
  local out; out="$(inside "$2")"; local rc=$?
  if [[ "$out" == FENCE_UP* ]] && (( rc == 0 )); then echo "PASS  $WHO can $1"; else echo "FAIL  $WHO cannot $1"; fail=1; fi
}
within() { perl -e 'alarm shift; exec @ARGV' "$@"; }   # macOS has no `timeout`

fence_checks() {
  rm -f "$HOME/fence-escape-test.txt" made-inside.txt
  blocked "read your SSH keys"                  'ls ~/.ssh'
  blocked "list your home folder"               'ls ~'
  blocked "read your own Claude settings"       'ls ~/.claude'
  blocked "read your own Codex folder"          'ls ~/.codex'
  blocked "read paperclip's secrets key"        'cat ~/.paperclip/instances/default/secrets/master.key'
  blocked "read the agent login file"           'cat ~/.paperclip/uuu-engine/agent.env'
  blocked "read another agent's home"           "ls $1"
  blocked "write outside its task folder"       'echo x > ~/fence-escape-test.txt'
  blocked "reach the open internet"             'curl -s -m 8 https://example.com -o /dev/null'
  blocked "read your other Claude sessions' temp files" "ls /private/tmp/claude-$(id -u)"
  blocked "reach other local services (port 5432)"      'curl -s -m 5 -f http://127.0.0.1:5432/ -o /dev/null'
  if curl -s -m 3 -o /dev/null "$BOARD/api/health"; then
    # With no login at all, the board must not answer as if the owner had asked.
    blocked "act as you on the paperclip board" "test \"\$(curl -s -m 6 -o /dev/null -w '%{http_code}' $BOARD/api/companies)\" = 200"
  else
    echo "SKIP  whether $WHO can act as you on the paperclip board (the board is not running)"; skipped=1
  fi
  allowed "read its own task folder"            'cat note.txt'
  allowed "write in its own task folder"        'echo x > made-inside.txt'
  if [[ -e "$HOME/fence-escape-test.txt" ]]; then echo "FAIL  a file was written outside the fence"; rm -f "$HOME/fence-escape-test.txt"; fail=1; fi
}

echo "Claude Code (Chief of staff, Builder)"
RUN="$HERE/fenced-claude"; WHO="a Claude agent"
fence_checks "$STATE_DIR/codex-home"
if [[ -f "$STATE_DIR/agent.env" ]]; then
  out="$(within 180 "$HERE/fenced-claude" -p "Reply with exactly: OK" --max-turns 1 </dev/null 2>&1 | tail -1)"
  if [[ "$out" == *OK* ]]; then echo "PASS  a Claude agent answers from inside the fence"; else echo "FAIL  a Claude agent did not answer from inside the fence: $out"; fail=1; fi
else
  echo "SKIP  a Claude agent answering from inside the fence (no agent login yet)"; skipped=1
fi

echo; echo "Codex (Checker)"
RUN="$HERE/fenced-codex"; WHO="the Codex agent"
fence_checks "$STATE_DIR/claude-home"
if [[ -e "$STATE_DIR/codex-home/auth.json" ]]; then
  out="$(within 180 "$HERE/fenced-codex" exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "Reply with exactly: OK" </dev/null 2>/dev/null | tail -1)"
  if [[ "$out" == *OK* ]]; then echo "PASS  the Codex agent answers from inside the fence"; else echo "FAIL  the Codex agent did not answer from inside the fence: $out"; fail=1; fi
  case "$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$STATE_DIR/codex-home/auth.json")" in
    "$STATE_DIR"/*) ;;
    *) echo "NOTE  the Codex agent still uses your own Codex login file; a login of its own is still to do" ;;
  esac
else
  echo "SKIP  the Codex agent answering from inside the fence (no Codex login yet)"; skipped=1
fi

echo
if (( fail )); then echo "RESULT: the fence FAILED"; exit 1; fi
if (( skipped )); then echo "RESULT: the fence holds; something is still to do (see SKIP lines)"; exit 2; fi
echo "RESULT: the fence holds and the agents work inside it"
