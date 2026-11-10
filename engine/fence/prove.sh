#!/usr/bin/env bash
# The fence proof. Proves the fence around each agent tool (Claude Code and
# Codex), the per-agent fence policy, and the gate in front of the board.
# Prints PASS, FAIL, SKIP or NOTE per check, then RESULT. Writes
# state/proof/last.json. Exit 0 when every check passes, 1 when the fence
# failed, 2 when it holds but something is still to do (see the SKIP lines).
set -uo pipefail
for _v in $(compgen -e); do
  case "$_v" in FENCE_*|UUU_*) unset "$_v" ;; esac
done
unset ENGINE_CONFIG PAPERCLIP_AGENT_ID PAPERCLIP_API_URL PAPERCLIP_RUNTIME_API_URL CODEX_HOME _v

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
OWNER_HOME="$(/usr/bin/python3 -c "import os,pwd;print(os.path.realpath(pwd.getpwuid(os.getuid()).pw_dir))")" || exit 1
_given_home="${HOME:-}"; HOME="$OWNER_HOME"
. "$HERE/../lib/config.sh" || { echo "The engine config could not be read. Check engine/config.json" >&2; exit 1; }
HOME="$_given_home"; unset _given_home

STATE_DIR="$CFG_STATE"
WS="$STATE_DIR/tasks/_proof"
BOARD="$CFG_BOARD_URL"
GATE="$CFG_GATE_URL"
HOME_URL="$CFG_HOME_URL"
BENCH="$CFG_BENCH_URL"
SITE_HEADER="X-Frappe-Site-Name: $CFG_BENCH_SITE"
PROOF_ID="00000000-0000-4000-8000-000000000001"
OTHER_ID="00000000-0000-4000-8000-000000000002"
POLICY_FILE="$CFG_POLICY/$PROOF_ID.json"
LESSONS_FILE="$STATE_DIR/lessons/proof.md"
KNOWLEDGE="$STATE_DIR/knowledge/docs"
KNOWLEDGE_MARK="$KNOWLEDGE/.fence-proof"
ENV_FILE="$STATE_DIR/secrets/agents/proof.env"
LINES="$(mktemp -t uuu-proof-lines)" || exit 1
HDR=""; KEY_ID=""; KEY_AGENT=""

cleanup() {
  rm -f "$POLICY_FILE" "$LESSONS_FILE" "$KNOWLEDGE_MARK" "$KNOWLEDGE/.fence-proof-write" "$ENV_FILE"
  if [[ -n "$KEY_ID" ]]; then
    curl -s -m 10 -o /dev/null -X DELETE "$BOARD/api/agents/$KEY_AGENT/keys/$KEY_ID" || true
  fi
  [[ -n "$HDR" ]] && rm -f "$HDR"
  rm -f "$LINES"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

mkdir -p "$WS" && cd "$WS" || exit 1
rm -f made-inside.txt ro-made.txt "$HOME/fence-escape-test.txt"
echo "inside" > note.txt
fail=0; skipped=0
RUN=""; WHO=""; AS=""

say() {
  printf '%-4s  %s\n' "$1" "$2"
  printf '%s\t%s\n' "$1" "$2" >> "$LINES"
  case "$1" in FAIL) fail=1 ;; SKIP) skipped=1 ;; esac
}

# Each check first prints a marker from inside the fence. No marker means the
# fence never started, and that must never be counted as "blocked".
inside() { PAPERCLIP_AGENT_ID="$AS" "$RUN" --fence-check "echo FENCE_UP; $1" 2>/dev/null; }
blocked() {
  local out rc; out="$(inside "$2")"; rc=$?
  if [[ "$out" != FENCE_UP* ]]; then say FAIL "the fence around $WHO did not start (while checking: $1)"
  elif (( rc == 0 )); then say FAIL "$WHO could $1"
  else say PASS "$WHO cannot $1"; fi
}
allowed() {
  local out rc; out="$(inside "$2")"; rc=$?
  if [[ "$out" == FENCE_UP* ]] && (( rc == 0 )); then say PASS "$WHO can $1"; else say FAIL "$WHO cannot $1"; fi
}
# The wrapper must refuse to start at all: exit 78, no marker, and the reason.
refuses() {
  local what="$1" want="$2" out rc; shift 2
  out="$("$@" 2>&1)"; rc=$?
  if [[ "$out" == *FENCE_UP* ]]; then say FAIL "$WHO started when $what"
  elif (( rc == 78 )) && [[ "$out" == *"$want"* ]]; then say PASS "$WHO refuses to start when $what"
  else say FAIL "$WHO did not refuse as expected when $what (exit $rc)"; fi
}
within() { perl -e 'alarm shift; exec @ARGV' "$@"; }   # macOS has no `timeout`

# What answers outside the fence right now. A check of a service that is off proves nothing.
answers() { curl -s -m 3 "$@" 2>/dev/null; }
BOARD_UP=0; answers "$BOARD/api/health" | grep -q '"status":"ok"' && BOARD_UP=1
HOME_UP=0; answers "$HOME_URL/healthz" | grep -q '"part":"home"' && HOME_UP=1
GATE_UP=0; answers "$GATE/gate/health" | grep -q '"part":"gate"' && GATE_UP=1
BENCH_UP=0; answers -H "$SITE_HEADER" "$BENCH/api/method/ping" | grep -q pong && BENCH_UP=1
REACH_BOARD="{ curl -s -m 6 $BOARD/api/health; curl -s -m 6 http://localhost:$CFG_PORT_BOARD/api/health; } | grep -q '\"status\":\"ok\"'"
REACH_HOME="curl -s -m 6 $HOME_URL/healthz | grep -q '\"part\":\"home\"'"
REACH_BENCH="curl -s -m 6 -H '$SITE_HEADER' $BENCH/api/method/ping | grep -q pong"

write_policy() {   # write_policy <localServices JSON> <taskFolder>
  mkdir -p "$CFG_POLICY" "$STATE_DIR/lessons"
  (umask 022; printf '{\n  "agentId": "%s",\n  "slug": "proof",\n  "localServices": %s,\n  "readFolders": ["%s"],\n  "lessonsFile": "%s",\n  "envFile": "%s",\n  "taskFolder": "%s"\n}\n' \
    "$PROOF_ID" "$1" "$KNOWLEDGE" "$LESSONS_FILE" "$ENV_FILE" "$2" > "$POLICY_FILE")
  chmod 644 "$POLICY_FILE"
}

fence_checks() {
  local other_home="$1"
  AS=""
  rm -f "$HOME/fence-escape-test.txt" made-inside.txt
  blocked "read your SSH keys"                  'ls ~/.ssh'
  blocked "list your home folder"               'ls ~'
  blocked "read your own Claude settings"       'ls ~/.claude'
  blocked "read your own Codex folder"          'ls ~/.codex'
  blocked "read paperclip's secrets key"        "cat $CFG_INSTANCE_ROOT/secrets/master.key"
  blocked "read the agent login file"           "cat $STATE_DIR/agent.env"
  blocked "read the engine's secrets"           "ls $CFG_SECRETS"
  blocked "read the fence policies"             "ls $CFG_POLICY"
  blocked "read another agent's home"           "ls $other_home"
  blocked "write outside its task folder"       'echo x > ~/fence-escape-test.txt'
  blocked "reach the open internet"             'curl -s -m 8 https://example.com -o /dev/null'
  blocked "read your other Claude sessions' temp files" "ls /private/tmp/claude-$(id -u)"
  blocked "reach other local services (port 5432)"      'curl -s -m 5 -f http://127.0.0.1:5432/ -o /dev/null'
  if (( BOARD_UP )); then
    blocked "reach the board directly (port $CFG_PORT_BOARD)" "$REACH_BOARD"
  else
    say SKIP "whether $WHO can reach the board directly (the board is not running)"
  fi
  if (( HOME_UP )); then
    blocked "reach the home screen (port $CFG_PORT_HOME)" "$REACH_HOME"
  else
    say SKIP "whether $WHO can reach the home screen (the home screen is not running)"
  fi
  if (( BENCH_UP )); then
    blocked "reach the books without a fence policy (port $CFG_PORT_BENCH_WEB)" "$REACH_BENCH"
  else
    say SKIP "whether $WHO can reach the books without a fence policy (the books are not running)"
  fi
  if (( GATE_UP )); then
    allowed "reach the gate, which turns it away without a token (401)" \
      "test \"\$(curl -s -m 6 -o /dev/null -w '%{http_code}' $GATE/api/health)\" = 401"
  else
    say SKIP "whether the gate turns $WHO away without a token (the gate is not running)"
  fi
  # Addresses: paperclip's are replaced by the gate's, the listen ones removed, NO_PROXY empty.
  local out rc
  out="$(PAPERCLIP_API_URL="$BOARD" PAPERCLIP_RUNTIME_API_URL="$BOARD" PAPERCLIP_LISTEN_HOST=127.0.0.1 \
    PAPERCLIP_LISTEN_PORT="$CFG_PORT_BOARD" NO_PROXY='*' "$RUN" --fence-check \
    "echo FENCE_UP; test \"\$PAPERCLIP_API_URL\" = $GATE && test \"\$PAPERCLIP_RUNTIME_API_URL\" = $GATE && test -z \"\${PAPERCLIP_LISTEN_HOST+x}\${PAPERCLIP_LISTEN_PORT+x}\" && test -z \"\$NO_PROXY\"" 2>/dev/null)"; rc=$?
  if [[ "$out" == FENCE_UP* ]] && (( rc == 0 )); then say PASS "$WHO is pointed at the gate, never at the board"
  else say FAIL "$WHO is not pointed at the gate only"; fi
  # Fence rules handed in from outside are ignored.
  out="$(FENCE_EXTRA_READ="$HOME" UUU_LESSONS_FILE="$HOME/.zshrc" UUU_KNOWLEDGE_DIR="$HOME" \
    ENGINE_CONFIG=/nonexistent "$RUN" --fence-check 'echo FENCE_UP; ls ~' 2>/dev/null)"; rc=$?
  if [[ "$out" != FENCE_UP* ]]; then say FAIL "the fence around $WHO did not start (while checking rules from outside)"
  elif (( rc == 0 )); then say FAIL "$WHO could take fence rules from the environment"
  else say PASS "$WHO cannot take fence rules from the environment"; fi
  allowed "read its own task folder"            'cat note.txt'
  allowed "write in its own task folder"        'echo x > made-inside.txt'
  if [[ -e "$HOME/fence-escape-test.txt" ]]; then say FAIL "a file was written outside the fence"; rm -f "$HOME/fence-escape-test.txt"; fi
  refuses "run from engine/, which is not an agent task folder" "not an agent task folder" \
    /bin/bash -c 'cd "$1" && shift && "$@"' _ "$CFG_ENGINE_DIR" "$RUN" --fence-check 'echo FENCE_UP'
  refuses "its agent id has no fence policy" "no fence policy for this agent" \
    env PAPERCLIP_AGENT_ID="$OTHER_ID" "$RUN" --fence-check 'echo FENCE_UP'
}

policy_checks() {
  mkdir -p "$KNOWLEDGE" "$STATE_DIR/lessons" "$STATE_DIR/secrets/agents"
  chmod 700 "$STATE_DIR/secrets" "$STATE_DIR/secrets/agents" 2>/dev/null
  echo "proof" > "$KNOWLEDGE_MARK"
  : > "$LESSONS_FILE"
  (umask 077; printf 'UUU_PROOF_VALUE=ok\n' > "$ENV_FILE")
  write_policy '["127.0.0.1:'"$CFG_PORT_BENCH_WEB"'"]' read-write
  AS="$PROOF_ID"
  if (( BENCH_UP )); then
    allowed "reach the books when its fence policy names them" "$REACH_BENCH"
  else
    say SKIP "whether $WHO can reach the books when its fence policy names them (the books are not running)"
  fi
  if (( BOARD_UP )); then
    blocked "reach the board directly, even with a fence policy" "$REACH_BOARD"
  fi
  allowed "append to its lessons file" 'echo "- 2026-01-01: proof line" >> "$UUU_LESSONS_FILE"'
  if grep -q 'proof line' "$LESSONS_FILE" 2>/dev/null; then :; else say FAIL "the lessons line did not arrive in $LESSONS_FILE"; fi
  blocked "write another file next to its lessons file" "echo x > $STATE_DIR/lessons/proof-other.md"
  rm -f "$STATE_DIR/lessons/proof-other.md"
  allowed "read the knowledge folder" 'ls "$UUU_KNOWLEDGE_DIR" >/dev/null && cat "$UUU_KNOWLEDGE_DIR/.fence-proof"'
  blocked "write in the knowledge folder" 'echo x > "$UUU_KNOWLEDGE_DIR/.fence-proof-write"'
  allowed "use the keys from its own key file" 'test "$UUU_PROOF_VALUE" = ok'
  blocked "read its key file itself" "cat $ENV_FILE"
  write_policy '[]' read-only
  allowed "read its task folder when the policy makes it read-only" 'cat note.txt'
  blocked "write in its task folder when the policy makes it read-only" 'echo x > ro-made.txt'
  write_policy '["127.0.0.1:'"$CFG_PORT_BOARD"'"]' read-write
  refuses "its fence policy names the board's port" "policy for agent proof" \
    env PAPERCLIP_AGENT_ID="$PROOF_ID" "$RUN" --fence-check 'echo FENCE_UP'
  write_policy '[]' read-write
  chmod 666 "$POLICY_FILE"
  refuses "its fence policy can be changed by others" "fence:" \
    env PAPERCLIP_AGENT_ID="$PROOF_ID" "$RUN" --fence-check 'echo FENCE_UP'
  rm -f "$POLICY_FILE"
  AS=""
}

echo "Claude Code (Chief of staff, Builder and the department agents)"
RUN="$HERE/bin/claude"; WHO="a Claude agent"
fence_checks "$STATE_DIR/codex-home"
policy_checks
if [[ -f "$STATE_DIR/agent.env" ]]; then
  out="$(within 180 "$RUN" -p "Reply with exactly: OK" --max-turns 1 </dev/null 2>&1 | tail -1)"
  if [[ "$out" == *OK* ]]; then say PASS "a Claude agent answers from inside the fence"
  else say FAIL "a Claude agent did not answer from inside the fence: ${out:0:200}"; fi
else
  say SKIP "a Claude agent answering from inside the fence (no agent login yet: run engine/fence/login-wizard.sh)"
fi

echo; echo "Codex (Checker)"
RUN="$HERE/bin/codex"; WHO="the Codex agent"
fence_checks "$STATE_DIR/claude-home"
policy_checks
if [[ -e "$STATE_DIR/codex-home/auth.json" ]]; then
  out="$(within 180 "$RUN" exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "Reply with exactly: OK" </dev/null 2>/dev/null | tail -1)"
  if [[ "$out" == *OK* ]]; then say PASS "the Codex agent answers from inside the fence"
  else say FAIL "the Codex agent did not answer from inside the fence: ${out:0:200}"; fi
  case "$(/usr/bin/python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$STATE_DIR/codex-home/auth.json")" in
    "$STATE_DIR"/*) ;;
    *) say NOTE "the Codex agent still uses your own Codex login file; a login of its own is still to do (engine/fence/login-wizard.sh codex)" ;;
  esac
else
  say SKIP "the Codex agent answering from inside the fence (no Codex login yet: run engine/fence/login-wizard.sh codex)"
fi

# The gate, with a real agent token: a short-lived key for the Builder, made on
# the owner's side and removed again on every exit. The key lives only in a
# shell variable and a header file of mode 0600; it is never printed.
echo; echo "The gate (what an agent's own token can do)"
gate_checks() {
  local ids="$STATE_DIR/ids.json" co builder resp code body
  if (( ! GATE_UP )); then say SKIP "the gate checks with an agent token (the gate is not running)"; return; fi
  if (( ! BOARD_UP )); then say SKIP "the gate checks with an agent token (the board is not running)"; return; fi
  if [[ ! -f "$ids" ]]; then say SKIP "the gate checks with an agent token (no ids.json yet: run engine setup)"; return; fi
  co="$(/usr/bin/python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['companyId'])" "$ids" 2>/dev/null)"
  builder="$(/usr/bin/python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['agents']['builder'])" "$ids" 2>/dev/null)"
  if [[ -z "$co" || -z "$builder" ]]; then say SKIP "the gate checks with an agent token (ids.json has no company or Builder)"; return; fi
  KEY_AGENT="$builder"
  resp="$(curl -s -m 10 -X POST -H 'Content-Type: application/json' -d '{"name":"engine-proof"}' \
    "$BOARD/api/agents/$builder/keys")"
  KEY_ID="$(printf '%s' "$resp" | /usr/bin/python3 -c "import json,sys;print(json.load(sys.stdin).get('id') or '')" 2>/dev/null)"
  HDR="$(mktemp -t uuu-proof-hdr)" || { say FAIL "could not make a header file for the test key"; return; }
  chmod 600 "$HDR"
  printf '%s' "$resp" | /usr/bin/python3 -c "import json,sys;t=json.load(sys.stdin).get('token') or '';t and print('Authorization: Bearer '+t)" > "$HDR" 2>/dev/null
  resp=""
  if [[ -z "$KEY_ID" || ! -s "$HDR" ]]; then say FAIL "could not make a test key for the Builder on the board"; return; fi
  code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H @"$HDR" "$GATE/api/agents/me")"
  if [[ "$code" == 200 ]]; then say PASS "an agent token passes the gate (GET /api/agents/me is 200)"
  else say FAIL "an agent token did not pass the gate (GET /api/agents/me gave $code)"; fi
  code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer not-a-real-token' "$GATE/api/agents/me")"
  if [[ "$code" == 401 ]]; then say PASS "a made-up token is turned away (401)"
  else say FAIL "a made-up token was not turned away (got $code)"; fi
  local rule method path data
  while read -r rule method path; do
    [[ -n "$rule" ]] || continue
    path="${path//<co>/$co}"; path="${path//<builder>/$builder}"
    data=(); if [[ "$method" != GET ]]; then data=(--data '{}'); fi
    body="$(curl -s -m 10 -w '\n%{http_code}' -X "$method" -H @"$HDR" -H 'Content-Type: application/json' \
      ${data[@]+"${data[@]}"} "$GATE$path")"
    code="${body##*$'\n'}"; body="${body%$'\n'*}"
    if [[ "$code" == 403 && "$body" == *"\"rule\":\"$rule\""* ]]; then say PASS "the gate refuses an agent $method ${path} ($rule)"
    else say FAIL "the gate did not refuse an agent $method $path as $rule (got $code)"; fi
  done <<'EOF'
agents-write PATCH /api/agents/<builder>
agents-create POST /api/companies/<co>/agents
agents-create POST /api/companies/<co>/agent-hires
company-write PATCH /api/companies/<co>
members GET /api/companies/<co>/members/x/permissions
board-keys GET /api/board-api-keys
board-chat POST /api/board/chat/stream
board-chat POST /board/chat/stream
task-folder PUT /api/issues/x/workspace
projects POST /api/companies/<co>/projects
projects PATCH /api/projects/x
instance PATCH /api/instance/settings
secrets GET /api/companies/<co>/secrets
export-import POST /api/companies/<co>/exports
adapters POST /api/companies/<co>/adapters/claude_local/test-environment
EOF
  code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X DELETE "$BOARD/api/agents/$builder/keys/$KEY_ID")"
  rm -f "$HDR"; HDR=""
  if [[ "$code" == 200 || "$code" == 204 ]]; then KEY_ID=""; say PASS "the test key was removed again"
  else say FAIL "the test key could not be removed (got $code); remove the key named engine-proof on the board"; fi
}
gate_checks

echo
RESULT="holds"
if (( fail )); then RESULT="failed"; elif (( skipped )); then RESULT="holds-with-todo"; fi
/usr/bin/python3 "$HERE/proof_record.py" "$LINES" "$STATE_DIR/proof/last.json" "$RESULT" \
  || echo "NOTE  the result could not be saved to $STATE_DIR/proof/last.json"
if (( fail )); then echo "RESULT: the fence FAILED"; exit 1; fi
if (( skipped )); then echo "RESULT: the fence holds; something is still to do (see SKIP lines)"; exit 2; fi
echo "RESULT: the fence holds and the agents work inside it"
exit 0
