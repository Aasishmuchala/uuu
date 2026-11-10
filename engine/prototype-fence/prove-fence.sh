#!/usr/bin/env bash
# PROTOTYPE (fence trial). Proves the fence. Exit 0 only if every line passes.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${UUU_ENGINE_STATE:-$HOME/.paperclip/uuu-engine}"
WS="$STATE_DIR/proof-ws"
mkdir -p "$WS" && cd "$WS" && echo "inside" > note.txt
rm -f "$HOME/fence-escape-test.txt" made-inside.txt
fail=0; skipped=0
blocked() { if "$HERE/fence-run" -c "$2" >/dev/null 2>&1; then echo "FAIL  an agent could $1"; fail=1; else echo "PASS  an agent cannot $1"; fi; }
allowed() { if "$HERE/fence-run" -c "$2" >/dev/null 2>&1; then echo "PASS  an agent can $1"; else echo "FAIL  an agent cannot $1"; fail=1; fi; }
blocked "read your SSH keys"                'ls ~/.ssh'
blocked "list your home folder"             'ls ~'
blocked "read your own Claude settings"     'ls ~/.claude'
blocked "read paperclip's secrets key"      'cat ~/.paperclip/instances/default/secrets/master.key'
blocked "read the agent login file"         'cat ~/.paperclip/uuu-engine/agent.env'
blocked "write outside its task folder"     'echo x > ~/fence-escape-test.txt'
blocked "reach the open internet"           'curl -s -m 8 https://example.com -o /dev/null'
blocked "read your other Claude sessions' temp files" "ls /private/tmp/claude-$(id -u)"
blocked "reach other local services (port 5432)"     'curl -s -m 5 -f http://127.0.0.1:5432/ -o /dev/null'
allowed "read its own task folder"          'cat note.txt'
allowed "write in its own task folder"      'echo x > made-inside.txt'
if [[ -e "$HOME/fence-escape-test.txt" ]]; then echo "FAIL  a file was written outside the fence"; rm -f "$HOME/fence-escape-test.txt"; fail=1; fi
if [[ -f "$STATE_DIR/agent.env" ]]; then
  out="$("$HERE/fenced-claude" -p "Reply with exactly: OK" --max-turns 1 </dev/null 2>&1 | tail -1)"
  if [[ "$out" == *OK* ]]; then echo "PASS  the agent answers from inside the fence"; else echo "FAIL  the agent did not answer from inside the fence: $out"; fail=1; fi
else
  echo "SKIP  the agent answering from inside the fence (no agent login yet)"; skipped=1
fi
if (( fail )); then echo; echo "RESULT: the fence FAILED"; exit 1; fi
if (( skipped )); then echo; echo "RESULT: the fence holds; the agent login is still to do"; exit 2; fi
echo; echo "RESULT: the fence holds and the agent works inside it"
