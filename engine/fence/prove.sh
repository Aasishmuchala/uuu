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
OWNER_HOME="$(/usr/bin/python3 -I -c "import os,pwd;print(os.path.realpath(pwd.getpwuid(os.getuid()).pw_dir))")" || exit 1
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
  rm -f "$STATE_DIR/media/.fence-proof" "$STATE_DIR/media/.fence-proof-new"
  rm -rf "${STATE_DIR:?}/claude-home/$OTHER_ID" "${STATE_DIR:?}"/tasks/_proof-answer.* "${STATE_DIR:?}/codex-home/_proof-login"
  if [[ -n "$KEY_ID" ]]; then
    curl -s -m 10 -o /dev/null -X DELETE "$BOARD/api/agents/$KEY_AGENT/keys/$KEY_ID" || true
  fi
  [[ -n "$HDR" ]] && rm -f "$HDR"
  rm -f "$LINES"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

# The proof itself runs from a folder no agent can write: every unfenced helper
# (python3 among them) would otherwise start in a folder an agent can plant files in.
# Only the fenced calls go into the proof's task folder, each in a subshell.
mkdir -p "$WS" && cd / || exit 1
rm -f "$WS/made-inside.txt" "$WS/ro-made.txt" "$HOME/fence-escape-test.txt"
echo "inside" > "$WS/note.txt"
fail=0; skipped=0
RUN=""; WHO=""; AS=""

say() {
  printf '%-4s  %s\n' "$1" "$2"
  printf '%s\t%s\n' "$1" "$2" >> "$LINES"
  case "$1" in FAIL) fail=1 ;; SKIP) skipped=1 ;; esac
}

# Each check first prints a marker from inside the fence. No marker means the
# fence never started, and that must never be counted as "blocked".
inside() { (cd "$WS" && PAPERCLIP_AGENT_ID="$AS" "$RUN" --fence-check "echo FENCE_UP; $1" 2>/dev/null); }
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
  out="$(cd "$WS" && "$@" 2>&1)"; rc=$?
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
RELAY="$CFG_RELAY_URL"
RELAY_UP=0; answers "$RELAY/relay/health" | grep -q '"part":"relay"' && RELAY_UP=1
REACH_BOARD="{ curl -s -m 6 $BOARD/api/health; curl -s -m 6 http://localhost:$CFG_PORT_BOARD/api/health; } | grep -q '\"status\":\"ok\"'"
REACH_HOME="curl -s -m 6 $HOME_URL/healthz | grep -q '\"part\":\"home\"'"
REACH_BENCH="curl -s -m 6 -H '$SITE_HEADER' $BENCH/api/method/ping | grep -q pong"

# Which models the agents use: plans (the Claude and Codex plans) or provider (the
# outside provider, reached only through the model relay). model_mode.py decides,
# outside the fence; a settings file it cannot trust is a failure of its own.
MODE="$(/usr/bin/python3 -I "$HERE/model_mode.py" --mode 2>&1 </dev/null)" \
  || { say FAIL "the model settings could not be read (${MODE#fence: })"; MODE=""; }

# An agent's id from ids.json, or nothing.
agent_id_of() {
  /usr/bin/python3 -I -c "import json,re,sys
a=json.load(open(sys.argv[1])).get('agents',{}).get(sys.argv[2])
print(a if isinstance(a,str) and re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',a) else '')" \
    "$STATE_DIR/ids.json" "$1" 2>/dev/null
}

write_policy() {   # write_policy <localServices JSON> <taskFolder>
  mkdir -p "$CFG_POLICY" "$STATE_DIR/lessons"
  (umask 022; printf '{\n  "agentId": "%s",\n  "slug": "proof",\n  "localServices": %s,\n  "readFolders": ["%s"],\n  "lessonsFile": "%s",\n  "envFile": "%s",\n  "taskFolder": "%s"\n}\n' \
    "$PROOF_ID" "$1" "$KNOWLEDGE" "$LESSONS_FILE" "$ENV_FILE" "$2" > "$POLICY_FILE")
  chmod 644 "$POLICY_FILE"
}

fence_checks() {
  local other_home="$1"
  AS=""
  rm -f "$HOME/fence-escape-test.txt" "$WS/made-inside.txt"
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
  blocked "reach the model provider directly"   'curl -s -m 8 https://api.omegaplusapi.com/v1/models -o /dev/null'
  blocked "read the provider key, the relay's secret or the model settings" \
    "cat $CFG_PROVIDER_KEY >/dev/null || cat $CFG_RELAY_SECRET >/dev/null || cat $CFG_MODELS_STATE >/dev/null"
  # In provider mode Codex runs with no login: neither a Codex home that links to
  # the login (as paperclip's homes do) nor the engine's own shared home may open it.
  if [[ "$MODE" == provider && "$RUN" == "$HERE/bin/codex" ]]; then
    local login_home="$STATE_DIR/codex-home/_proof-login" shared="$STATE_DIR/codex-home/auth.json"
    rm -rf "$login_home"
    mkdir -p "$STATE_DIR/codex-home" && mkdir -m 700 "$login_home" && ln -s "$shared" "$login_home/auth.json" \
      || say FAIL "could not make a Codex home that links to the login"
    CODEX_HOME="$login_home" blocked "read the Codex login" \
      "cat \"\$CODEX_HOME/auth.json\" >/dev/null || cat $shared >/dev/null || cat ~/.codex/auth.json >/dev/null"
    blocked "read the Codex login from the engine's own Codex home" \
      "cat \"\$CODEX_HOME/auth.json\" >/dev/null || cat $shared >/dev/null"
    rm -rf "$login_home"
  fi
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
  out="$(cd "$WS" && PAPERCLIP_API_URL="$BOARD" PAPERCLIP_RUNTIME_API_URL="$BOARD" PAPERCLIP_LISTEN_HOST=127.0.0.1 \
    PAPERCLIP_LISTEN_PORT="$CFG_PORT_BOARD" NO_PROXY='*' "$RUN" --fence-check \
    "echo FENCE_UP; test \"\$PAPERCLIP_API_URL\" = $GATE && test \"\$PAPERCLIP_RUNTIME_API_URL\" = $GATE && test -z \"\${PAPERCLIP_LISTEN_HOST+x}\${PAPERCLIP_LISTEN_PORT+x}\" && test -z \"\$NO_PROXY\"" 2>/dev/null)"; rc=$?
  if [[ "$out" == FENCE_UP* ]] && (( rc == 0 )); then say PASS "$WHO is pointed at the gate, never at the board"
  else say FAIL "$WHO is not pointed at the gate only"; fi
  # Fence rules handed in from outside are ignored.
  out="$(cd "$WS" && FENCE_EXTRA_READ="$HOME" UUU_LESSONS_FILE="$HOME/.zshrc" UUU_KNOWLEDGE_DIR="$HOME" \
    ENGINE_CONFIG=/nonexistent "$RUN" --fence-check 'echo FENCE_UP; ls ~' 2>/dev/null)"; rc=$?
  if [[ "$out" != FENCE_UP* ]]; then say FAIL "the fence around $WHO did not start (while checking rules from outside)"
  elif (( rc == 0 )); then say FAIL "$WHO could take fence rules from the environment"
  else say PASS "$WHO cannot take fence rules from the environment"; fi
  allowed "read its own task folder"            'cat note.txt'
  allowed "write in its own task folder"        'echo x > made-inside.txt'
  allowed "use a here-document in zsh, its tools' shell" "/bin/zsh -c 'cat <<< fence-heredoc | grep -q fence-heredoc'"
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
# In provider mode the answer comes from the Builder's pick, through the relay.
if [[ "$MODE" == provider ]]; then
  as="$(agent_id_of builder)"
  if [[ ! -f "$CFG_PROVIDER_KEY" ]]; then
    say SKIP "a Claude agent answering from inside the fence through the model relay (no provider key saved: paste it in Settings)"
  elif [[ -z "$as" ]]; then
    say SKIP "a Claude agent answering from inside the fence through the model relay (no Builder in ids.json yet: run engine setup)"
  else
    once="$(mktemp -d "$STATE_DIR/tasks/_proof-answer.XXXXXX")" || once=""
    out="$([[ -n "$once" ]] && cd "$once" && PAPERCLIP_AGENT_ID="$as" within 180 "$RUN" -p "Reply with exactly: OK" --max-turns 1 </dev/null 2>&1 | tail -1)"
    [[ -n "$once" ]] && rm -rf "$once"
    if [[ "$out" == *OK* ]]; then say PASS "a Claude agent answers from inside the fence through the model relay"
    else say FAIL "a Claude agent did not answer from inside the fence through the model relay: ${out:0:200}"; fi
  fi
elif [[ -f "$STATE_DIR/agent.env" ]]; then
  out="$(cd "$WS" && within 180 "$RUN" -p "Reply with exactly: OK" --max-turns 1 </dev/null 2>&1 | tail -1)"
  if [[ "$out" == *OK* ]]; then say PASS "a Claude agent answers from inside the fence"
  else say FAIL "a Claude agent did not answer from inside the fence: ${out:0:200}"; fi
else
  say SKIP "a Claude agent answering from inside the fence (no agent login yet: run engine/fence/login-wizard.sh)"
fi

echo; echo "Codex (Checker)"
RUN="$HERE/bin/codex"; WHO="the Codex agent"
fence_checks "$STATE_DIR/claude-home"
policy_checks
if [[ "$MODE" == provider ]]; then
  as="$(agent_id_of checker)"
  if [[ ! -f "$CFG_PROVIDER_KEY" ]]; then
    say SKIP "the Codex agent answering from inside the fence through the model relay (no provider key saved: paste it in Settings)"
  elif [[ -z "$as" ]]; then
    say SKIP "the Codex agent answering from inside the fence through the model relay (no Checker in ids.json yet: run engine setup)"
  else
    once="$(mktemp -d "$STATE_DIR/tasks/_proof-answer.XXXXXX")" || once=""
    out="$([[ -n "$once" ]] && cd "$once" && PAPERCLIP_AGENT_ID="$as" within 180 "$RUN" exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "Reply with exactly: OK" </dev/null 2>/dev/null | tail -1)"
    [[ -n "$once" ]] && rm -rf "$once"
    if [[ "$out" == *OK* ]]; then say PASS "the Codex agent answers from inside the fence through the model relay"
    else say FAIL "the Codex agent did not answer from inside the fence through the model relay: ${out:0:200}"; fi
  fi
elif [[ -e "$STATE_DIR/codex-home/auth.json" ]]; then
  out="$(cd "$WS" && within 180 "$RUN" exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "Reply with exactly: OK" </dev/null 2>/dev/null | tail -1)"
  if [[ "$out" == *OK* ]]; then say PASS "the Codex agent answers from inside the fence"
  else say FAIL "the Codex agent did not answer from inside the fence: ${out:0:200}"; fi
  case "$(/usr/bin/python3 -I -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$STATE_DIR/codex-home/auth.json")" in
    "$STATE_DIR"/*) ;;
    *) say NOTE "the Codex agent still uses your own Codex login file; a login of its own is still to do (engine/fence/login-wizard.sh codex)" ;;
  esac
else
  say SKIP "the Codex agent answering from inside the fence (no Codex login yet: run engine/fence/login-wizard.sh codex)"
fi

# The model relay (the door to the outside model provider). In plans mode no agent
# may reach it at all. In provider mode each tool acts as a real agent with a fence
# policy (the Builder for Claude, the Checker for Codex), and the relay must turn
# away a call with no token, with a token whose agent id was swapped for another
# agent's, and with a token for an agent that has no model picked; and a call
# that asks for another model must go to the agent's pick. Tokens come from
# model_mode.py outside the fence, live only in a shell variable and the call's
# environment (curl reads the header from its input, so no command line holds
# one), and are never printed.
echo; echo "The model relay (what an agent can do with it)"
relay_call() {   # relay_call <token or ""> <JSON body>: prints FENCE_UP, the answer, then its status
  PROOF_RELAY_TOKEN="$1" inside "printf '%s' \"\${PROOF_RELAY_TOKEN:+Authorization: Bearer \$PROOF_RELAY_TOKEN}\" \
| curl -s -m 20 -H @- -H 'Content-Type: application/json' -H 'anthropic-version: 2023-06-01' \
--data '$2' -w '\n%{http_code}' $RELAY/v1/messages"
}
relay_turns_away() {   # relay_turns_away <what> <token or ""> <status> [<relay code>]
  local what="$1" want="$3" code_want="${4:-}" out code
  out="$(relay_call "$2" '{"max_tokens":1,"messages":[{"role":"user","content":"proof"}]}')"
  code="${out##*$'\n'}"
  if [[ "$out" != FENCE_UP* ]]; then say FAIL "the fence around $WHO did not start (while checking: the model relay $what)"
  elif [[ "$code" == "$want" && ( -z "$code_want" || "$out" == *"\"code\":\"$code_want\""* ) ]]; then
    say PASS "the model relay turns $WHO away $what ($want${code_want:+ $code_want})"
  else say FAIL "the model relay did not turn $WHO away $what (got $code)"; fi
}
relay_checks() {   # relay_checks <slug> <name> <slug of another agent>
  local slug="$1" name="$2" me other tok run pick before out code line i
  AS=""
  if [[ "$MODE" == plans ]]; then
    blocked "reach the model relay while the provider is off" \
      "curl -s -m 6 -f -o /dev/null $RELAY/relay/health || curl -s -m 6 -f -o /dev/null http://localhost:$CFG_PORT_RELAY/relay/health"
    return
  fi
  [[ "$MODE" == provider ]] || return 0
  me="$(agent_id_of "$slug")"; other="$(agent_id_of "$3")"
  if [[ -z "$me" ]]; then say SKIP "the model relay checks for $WHO (no $name in ids.json yet: run engine setup)"; return; fi
  if [[ ! -f "$CFG_POLICY/$me.json" ]]; then say SKIP "the model relay checks for $WHO (the $name has no fence policy yet: run engine setup)"; return; fi
  [[ -n "$other" && "$other" != "$me" ]] || other="$OTHER_ID"
  AS="$me"
  relay_turns_away "without a token" "" 401
  tok="$(/usr/bin/python3 -I "$HERE/model_mode.py" --token --agent "$me" </dev/null 2>/dev/null)" || tok=""
  if [[ "$tok" != "v1.a.$me."* ]]; then say FAIL "a token for the $name could not be made (model_mode.py --token)"; AS=""; return; fi
  relay_turns_away "with a token whose agent id was swapped for another agent's" "v1.a.$other.${tok#v1.a.$me.}" 401
  if [[ ! -f "$CFG_PROVIDER_KEY" ]]; then
    say SKIP "whether the model relay turns $WHO away with a token for an agent that has no model picked (no provider key saved: paste it in Settings)"
  else
    relay_turns_away "with a token for an agent that has no model picked" \
      "$(/usr/bin/python3 -I "$HERE/model_mode.py" --token --agent "$PROOF_ID" </dev/null 2>/dev/null)" 403 relay_no_pick
  fi
  # The Builder asks for a model that is never picked; the relay's log must name the pick.
  if [[ "$slug" == builder ]]; then
    if [[ ! -f "$CFG_PROVIDER_KEY" ]]; then
      say SKIP "whether the relay sends the Builder's call to its picked model (no provider key saved: paste it in Settings)"
    else
      run="$(/usr/bin/python3 -I "$HERE/model_mode.py" --for-run --agent "$me" </dev/null 2>/dev/null)" || run=""
      pick="$(printf '%s\n' "$run" | sed -n 3p)"; run=""
      before="$(wc -l < "$CFG_LOGS/relay.log" 2>/dev/null | tr -d ' ')"; before="${before:-0}"
      out="$(relay_call "$tok" '{"model":"claude-quantum-lite-1","max_tokens":1,"messages":[{"role":"user","content":"Reply with exactly: OK"}]}')"
      code="${out##*$'\n'}"; out="${out%%$'\n'*}"
      line=""
      for i in 1 2 3 4 5 6 7 8 9 10; do   # the relay writes its line when the answer has ended
        line="$(tail -n +"$((before + 1))" "$CFG_LOGS/relay.log" 2>/dev/null | grep ' call builder ' | tail -1)"
        [[ -n "$line" ]] && break
        sleep 0.5
      done
      if [[ "$out" != FENCE_UP ]]; then say FAIL "the fence around $WHO did not start (while checking: the model the relay sends a call to)"
      elif [[ -n "$pick" && "$line" == *" model=$pick" ]]; then
        say PASS "the relay sent the call to the Builder's picked model, not the one asked for"
      else say FAIL "the relay did not send the call to the Builder's picked model (status $code; log: ${line:-no call line})"; fi
    fi
  fi
  tok=""; AS=""
}
if (( ! RELAY_UP )); then
  say SKIP "the model relay checks (the model relay is not running)"
else
  RUN="$HERE/bin/claude"; WHO="a Claude agent"
  relay_checks builder Builder checker
  RUN="$HERE/bin/codex"; WHO="the Codex agent"
  relay_checks checker Checker builder
fi

# The gate, with a real agent token: a short-lived key for the Builder, made on
# the owner's side and removed again on every exit. The key lives only in a
# shell variable and a header file of mode 0600; it is never printed. Each
# refused request is checked against the rule id the gate must give: the
# refusal list, `tools-endpoint`, `not-allowed` for writes off the allow-list, and
# the body rules of allowed writes (`task-launch-settings`, `approval-type`). A line
# may end with the JSON body to send; without one a write sends '{}'. Each body is
# also one the board itself rejects (no such task, a status or payload it refuses), so
# an older gate that lets it through still changes nothing.
echo; echo "The gate (what an agent's own token can do)"
gate_checks() {
  local ids="$STATE_DIR/ids.json" co builder resp code body
  if (( ! GATE_UP )); then say SKIP "the gate checks with an agent token (the gate is not running)"; return; fi
  if (( ! BOARD_UP )); then say SKIP "the gate checks with an agent token (the board is not running)"; return; fi
  if [[ ! -f "$ids" ]]; then say SKIP "the gate checks with an agent token (no ids.json yet: run engine setup)"; return; fi
  co="$(/usr/bin/python3 -I -c "import json,sys;print(json.load(open(sys.argv[1]))['companyId'])" "$ids" 2>/dev/null)"
  builder="$(/usr/bin/python3 -I -c "import json,sys;print(json.load(open(sys.argv[1]))['agents']['builder'])" "$ids" 2>/dev/null)"
  if [[ -z "$co" || -z "$builder" ]]; then say SKIP "the gate checks with an agent token (ids.json has no company or Builder)"; return; fi
  KEY_AGENT="$builder"
  resp="$(curl -s -m 10 -X POST -H 'Content-Type: application/json' -d '{"name":"engine-proof"}' \
    "$BOARD/api/agents/$builder/keys")"
  KEY_ID="$(printf '%s' "$resp" | /usr/bin/python3 -I -c "import json,sys;print(json.load(sys.stdin).get('id') or '')" 2>/dev/null)"
  HDR="$(mktemp -t uuu-proof-hdr)" || { say FAIL "could not make a header file for the test key"; return; }
  chmod 600 "$HDR"
  printf '%s' "$resp" | /usr/bin/python3 -I -c "import json,sys;t=json.load(sys.stdin).get('token') or '';t and print('Authorization: Bearer '+t)" > "$HDR" 2>/dev/null
  resp=""
  if [[ -z "$KEY_ID" || ! -s "$HDR" ]]; then say FAIL "could not make a test key for the Builder on the board"; return; fi
  code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H @"$HDR" "$GATE/api/agents/me")"
  if [[ "$code" == 200 ]]; then say PASS "an agent token passes the gate (GET /api/agents/me is 200)"
  else say FAIL "an agent token did not pass the gate (GET /api/agents/me gave $code)"; fi
  code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer not-a-real-token' "$GATE/api/agents/me")"
  if [[ "$code" == 401 ]]; then say PASS "a made-up token is turned away (401)"
  else say FAIL "a made-up token was not turned away (got $code)"; fi
  local rule method path payload data
  while read -r rule method path payload; do
    [[ -n "$rule" ]] || continue
    path="${path//<co>/$co}"; path="${path//<builder>/$builder}"
    data=()
    if [[ -n "$payload" ]]; then data=(--data "$payload")
    elif [[ "$method" != GET ]]; then data=(--data '{}'); fi
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
tools-endpoint POST /mcp/runtime-tools
tools-endpoint GET /runtime-tools/connections/search
tools-endpoint POST /api/mcp/connections
not-allowed POST /api/companies/<co>/skills
not-allowed POST /api/companies/<co>/tools/connections
not-allowed POST /api/companies/<co>/email/connections
task-launch-settings PATCH /api/issues/x {"status":"proof-refused","assigneeAdapterOverrides":{"adapterConfig":{"command":"/bin/sh","cwd":"/"}}}
task-launch-settings POST /api/companies/<co>/issues {"title":"proof","status":"proof-refused","executionWorkspaceSettings":{"mode":"agent_default"}}
approval-type POST /api/companies/<co>/approvals {"type":"hire_agent","payload":"proof-refused"}
EOF
  code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X DELETE "$BOARD/api/agents/$builder/keys/$KEY_ID")"
  rm -f "$HDR"; HDR=""
  if [[ "$code" == 200 || "$code" == 204 ]]; then KEY_ID=""; say PASS "the test key was removed again"
  else say FAIL "the test key could not be removed (got $code); remove the key named engine-proof on the board"; fi
}
gate_checks

# The board runs git in the task folders (to see whether a folder has changes),
# outside the fence. From inside the fence an agent lays out a made-up
# repository in its task folder whose settings name a program for git to run,
# and, in a subfolder, a `.git` file pointing at a repository whose files are
# said to be the engine's own folder. Git, run the way the board runs it (the
# board's PATH, where the engine's git comes first), must neither run the
# program nor show those files.
echo; echo "The board's git (a repository an agent makes up in its task folder)"
git_checks() {
  local board_path="$HERE/bin:$CFG_NODE24/bin:$PATH" found out rc plant
  local made="HEAD objects refs config watch.sh MARKED git-trap"
  RUN="$HERE/bin/claude"; WHO="a Claude agent"; AS=""
  # shellcheck disable=SC2086
  (cd "$WS" && rm -rf $made)
  found="$(PATH="$board_path"; hash -r; command -v git || true)"
  if [[ "$found" != "$HERE/bin/git" ]]; then
    say FAIL "the engine's git is not the first git on the board's PATH (found: ${found:-none})"; return
  fi
  plant='mkdir -p objects refs/heads git-trap/repo/objects git-trap/repo/refs/heads || exit 1
echo "ref: refs/heads/main" > HEAD
printf "#!/bin/sh\necho ran > \"%s/MARKED\"\n" "$PWD" > watch.sh && chmod +x watch.sh || exit 1
printf "[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tworktree = %s\n\tfsmonitor = %s/watch.sh\n" "$PWD" "$PWD" > config || exit 1
echo "ref: refs/heads/main" > git-trap/repo/HEAD
printf "gitdir: repo\n" > git-trap/.git || exit 1
printf "[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tworktree = %s\n" "@OUTSIDE@" > git-trap/repo/config'
  out="$(inside "${plant//@OUTSIDE@/$HERE}")"; rc=$?
  if [[ "$out" != FENCE_UP* ]] || (( rc != 0 )) || [[ ! -f "$WS/config" || ! -f "$WS/git-trap/.git" ]]; then
    say FAIL "the made-up repository could not be laid out from inside the fence"
  else
    out="$(cd / && PATH="$board_path" GIT_OPTIONAL_LOCKS=0 within 30 git -C "$WS" status --porcelain=v1 --untracked-files=all 2>&1)"
    if [[ -e "$WS/MARKED" ]]; then say FAIL "git, run the way the board runs it, ran a program named in an agent's made-up repository"
    else say PASS "git, run the way the board runs it, does not run a program named in an agent's made-up repository"; fi
    out="$(cd / && PATH="$board_path" GIT_OPTIONAL_LOCKS=0 within 30 git -C "$WS/git-trap" status --porcelain=v1 --untracked-files=all 2>&1)"
    if [[ "$out" == *prove.sh* ]]; then say FAIL "git, run the way the board runs it, followed an agent's .git file to files outside its task folder"
    else say PASS "git, run the way the board runs it, does not follow an agent's .git file outside its task folder"; fi
  fi
  # shellcheck disable=SC2086
  (cd "$WS" && rm -rf $made)
}
git_checks

# The Codex home is writable inside the fence, and codex_home.py reads it
# outside the fence before the next run. In a made-up paperclip folder (a temp
# folder, removed again), a skill link planted to paperclip's private settings
# file must make the helper refuse the run, and a skill link of the live shape
# (<instance>/skills/<company>/__versions__/...) must still be shared, read only.
echo; echo "The Codex helper (a skill link an agent plants in its Codex home)"
codex_skill_checks() {
  local fake run skill out rc co="00000000-0000-4000-8000-0000000000c0" tab
  tab="$(printf '\t')"
  fake="$(mktemp -d -t uuu-proof-codex)" && fake="$(cd "$fake" && pwd -P)" \
    || { say FAIL "could not make a made-up paperclip folder for the Codex helper"; return; }
  run="$fake/I/companies/$co/codex-home/skill-runtimes/$PROOF_ID/run"
  skill="$fake/I/skills/$co/__versions__/v1/r1"
  mkdir -p "$run/skills" "$skill" "$fake/I/db" "$fake/S" && printf 'PROOF_PRIVATE=1\n' > "$fake/I/.env" \
    && ln -s "$fake/I/.env" "$run/skills/planted" \
    || { say FAIL "could not lay out the made-up paperclip folder"; rm -rf "$fake"; return; }
  out="$(/usr/bin/python3 -I "$HERE/codex_home.py" "$run" "$fake/S" "$fake/I" "$co" "$PROOF_ID" 2>&1)"; rc=$?
  if (( rc == 78 )) && [[ "$out" == *planted* && "$out" != *PROOF_PRIVATE* ]]; then
    say PASS "the Codex helper refuses a skill link an agent planted to paperclip's private file"
  else say FAIL "the Codex helper did not refuse a skill link to paperclip's private file (exit $rc)"; fi
  rm -f "$run/skills/planted"; ln -s "$skill" "$run/skills/paperclip"
  out="$(/usr/bin/python3 -I "$HERE/codex_home.py" "$run" "$fake/S" "$fake/I" "$co" "$PROOF_ID" 2>&1)"; rc=$?
  if (( rc == 0 )) && [[ "$out" == *"read$tab$skill"* ]]; then
    say PASS "the Codex helper shares a skill in paperclip's skills folder, read only"
  else say FAIL "the Codex helper did not share a skill in paperclip's skills folder (exit $rc)"; fi
  rm -rf "$fake"
}
codex_skill_checks

# Each Claude agent has a Claude Code home of its own (state/claude-home/<agent
# id>): settings, CLAUDE.md, hooks or MCP entries one agent writes there must
# never load in another agent's run. Run through the real launcher as the proof
# agent, with the proof's second id standing in for another agent (its home is
# made here, with a mark in it, and removed again): the proof agent can neither
# read nor write that home, nor list the folder of all homes; it can write its own.
echo; echo "The Claude homes (each agent its own)"
claude_home_checks() {
  local homes="$STATE_DIR/claude-home" own other
  own="$homes/$PROOF_ID"; other="$homes/$OTHER_ID"
  RUN="$HERE/bin/claude"; WHO="a Claude agent"
  mkdir -p "$homes" && { [[ -d "$other" ]] || mkdir -m 700 "$other"; } && echo "proof" > "$other/.fence-proof" \
    || { say FAIL "could not make a Claude home for the other proof agent"; return; }
  write_policy '[]' read-write
  AS="$PROOF_ID"
  blocked "write in another agent's Claude home (or read it, or list all homes)" \
    "cat $other/.fence-proof || ls $homes || echo x > $other/settings.json"
  if [[ -e "$other/settings.json" ]]; then say FAIL "a file was written in another agent's Claude home"; fi
  rm -f "$own/.fence-proof"
  allowed "write in its own Claude home" "echo x > $own/.fence-proof"
  if [[ ! -f "$own/.fence-proof" ]]; then say FAIL "the file written in its own Claude home did not arrive in $own"; fi
  rm -f "$own/.fence-proof" "$POLICY_FILE"
  rm -rf "${STATE_DIR:?}/claude-home/$OTHER_ID"
  AS=""
}
claude_home_checks

# The media folder (state/media): the owner's footage and the speech model. One
# agent's policy may name it for reading; no agent may write there. A mark is put
# there on the owner's side, and a test policy for the proof's fixed id names the
# folder; both are removed again on every exit. When the folder is not there yet
# (engine/media/install.sh makes it) there is nothing to prove.
echo; echo "The media folder (read only, and only with a policy that names it)"
media_checks() {
  local media="$STATE_DIR/media" mark
  mark="$media/.fence-proof"
  RUN="$HERE/bin/claude"; WHO="a Claude agent"; AS=""
  if [[ ! -d "$media" ]]; then
    say NOTE "the media folder is not there yet, so its fence checks did not run (engine/media/install.sh makes it)"
    return
  fi
  rm -f "$media/.fence-proof-new"
  echo "proof" > "$mark" || { say FAIL "could not put a mark in the media folder"; return; }
  blocked "read the media folder without a fence policy that names it" "cat $mark"
  mkdir -p "$CFG_POLICY"
  (umask 022; printf '{\n  "agentId": "%s",\n  "slug": "proof",\n  "localServices": [],\n  "readFolders": ["%s"],\n  "lessonsFile": null,\n  "envFile": null,\n  "taskFolder": "read-write"\n}\n' \
    "$PROOF_ID" "$media" > "$POLICY_FILE")
  chmod 644 "$POLICY_FILE"
  AS="$PROOF_ID"
  allowed "read the media folder when its fence policy names it" "ls $media >/dev/null && cat $mark"
  blocked "write a file in the media folder, even with a fence policy" "echo x > $mark"
  blocked "create a file in the media folder, even with a fence policy" "echo x > $media/.fence-proof-new"
  blocked "delete a file in the media folder, even with a fence policy" "rm -f $mark"
  if [[ -e "$media/.fence-proof-new" ]] || [[ "$(cat "$mark" 2>/dev/null)" != proof ]]; then
    say FAIL "a file in the media folder was made, changed or deleted from inside the fence"
  fi
  rm -f "$POLICY_FILE" "$mark" "$media/.fence-proof-new"
  AS=""
}
media_checks

echo
RESULT="holds"
if (( fail )); then RESULT="failed"; elif (( skipped )); then RESULT="holds-with-todo"; fi
/usr/bin/python3 -I "$HERE/proof_record.py" "$LINES" "$STATE_DIR/proof/last.json" "$RESULT" \
  || echo "NOTE  the result could not be saved to $STATE_DIR/proof/last.json"
if (( fail )); then echo "RESULT: the fence FAILED"; exit 1; fi
if (( skipped )); then echo "RESULT: the fence holds; something is still to do (see SKIP lines)"; exit 2; fi
echo "RESULT: the fence holds and the agents work inside it"
exit 0
