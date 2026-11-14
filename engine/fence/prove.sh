#!/usr/bin/env bash
# The fence proof. Proves the fence around each agent tool (Claude Code and
# Codex), the per-agent fence policy, the walled Researcher, the gate in
# front of the board (the ordinary one and the narrow one), and who reaches the
# page viewer and the owner's preview.
# Prints PASS, FAIL, SKIP or NOTE per check, then RESULT. Writes
# state/proof/last.json. Exit 0 when every check passes, 1 when the fence
# failed, 2 when it holds but something is still to do (see the SKIP lines).
set -uo pipefail
for _v in $(compgen -e); do
  case "$_v" in FENCE_*|UUU_*) unset "$_v" ;; esac
done
unset ENGINE_CONFIG PAPERCLIP_AGENT_ID PAPERCLIP_TASK_ID PAPERCLIP_API_KEY PAPERCLIP_API_URL PAPERCLIP_RUNTIME_API_URL CODEX_HOME _v

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
HDR=""; KEY_ID=""; KEY_AGENT=""; KEY_CO=""
# The doors' two folders (PLAN-V5, K1) and the names a program loads as its settings
# from the folder it works in (K2a), as the checks below try to plant them.
DOORS_DIR="$STATE_DIR/doors"; DOOR_SECRETS="$STATE_DIR/secrets/doors"; MADE_DOOR_DIRS=""
PLANTS=".claude CLAUDE.md claude.md AGENTS.md .mcp.json .codex .agentſ sub y ordinary.txt"
# And the names a program loads as settings or instructions from its own home (fence_plan.py,
# HOME_CONFIG_NAMES), as the checks of the agents' homes try to plant them there; with the
# proof's own leftovers of the writes that must still work.
HOME_PLANTS="settings.json Settings.json ſettings.json .config.json remote-settings.json skills ſkills agents commands
  rules hooks plugins output-styles CLAUDE.md projects/-fence-proof session-env/fence-proof .fence-proof-state.json
  tmp/.fence-proof-carry config.toml Config.toml config.toml.paperclip-backup AGENTS.md instructions.md prompts
  memories hooks.json sessions/fence-proof state_9.sqlite"
STAND_IN=""
# The home screen's own pictures of pages (PLAN-V5, K16): a mark the proof puts there, and the
# folders it made for it when they were missing (removed again on every exit).
SHOTS_DIR="$STATE_DIR/home/shots"; MADE_SHOTS_DIRS=""
# Temp folders made for the Researcher's checks (its own and another run's), removed on every exit.
RUN_TMPS=""
# The Researcher's checks run for a real task on the board (its goal's folder comes from the board): a task
# the proof makes, assigned to the Researcher, with a key of the Researcher's own. All set back on every exit.
PROOF_TASK_ID=""; PROOF_IDENT=""; PROOF_RKEY=""; PROOF_RKEY_ID=""; PROOF_RKEY_AGENT=""
PROOF_GOAL_DIR=""; PROOF_GOAL_MADE=""; PROOF_OTHER_DIR=""
# The Researcher's Claude home for the proof task's goal (made by the fence on its first run) and
# another goal's home beside it (made by the proof): both removed on every exit.
PROOF_HOME_DIR=""; PROOF_HOME_MADE=""; PROOF_OTHER_HOME=""
# The sandbox tool's own temp folder: was it there before the proof (it is not on this Mac)?
SANDBOX_TMP_MADE=""; SANDBOX_TMP_WAS=""; [[ -e /private/tmp/claude || -L /private/tmp/claude ]] && SANDBOX_TMP_WAS=1

cleanup() {
  rm -f "$POLICY_FILE" "$LESSONS_FILE" "$KNOWLEDGE_MARK" "$KNOWLEDGE/.fence-proof-write" "$ENV_FILE"
  rm -f "$STATE_DIR/media/.fence-proof" "$STATE_DIR/media/.fence-proof-new"
  clear_plants
  rm -rf "$CFG_PLAYBOOKS/.fence-proof-write" "$CFG_PLAYBOOKS/.fence-proof-dir"
  rm -rf /private/tmp/claude/.fence-proof-carry /private/tmp/claude/.fence-proof-x /private/tmp/claude/.fence-proof-link
  [[ -n "$SANDBOX_TMP_MADE" ]] && rmdir /private/tmp/claude 2>/dev/null
  remove_door_marks
  remove_shots_mark
  stand_in_stop
  remove_run_tmps
  rm -f "${STATE_DIR:?}/tasks/research/.fence-proof-research"
  proof_task_end
  rm -rf "${STATE_DIR:?}/claude-home/$OTHER_ID" "${STATE_DIR:?}"/tasks/_proof-answer.* "${STATE_DIR:?}/codex-home/_proof-login"
  clear_home_plants "${STATE_DIR:?}/claude-home/$PROOF_ID"
  rm -rf "${STATE_DIR:?}/codex-home/_proof-plant"
  rm -rf "${CFG_INSTANCE_ROOT:?}"/companies/*/codex-home/_proof-home.*
  if [[ -n "$KEY_ID" ]]; then
    curl -s -m 10 -o /dev/null -X DELETE "$BOARD/api/agents/$KEY_AGENT/keys/$KEY_ID" || true
  fi
  [[ -n "$HDR" ]] && rm -f "$HDR"
  rm -f "$LINES"
}
# The proof's own leftovers in its task folder: removed from outside, never following
# a link (rm removes a link itself, not what it points at).
clear_plants() {
  local n
  for n in $PLANTS; do rm -rf "${WS:?}/$n"; done
}
clear_home_plants() {   # clear_home_plants <an agent home the proof plants in>
  local n
  [[ -n "$1" && -d "$1" && ! -L "$1" ]] || return 0
  for n in $HOME_PLANTS; do rm -rf "${1:?}/$n"; done
  rmdir "$1/projects" "$1/session-env" "$1/sessions" 2>/dev/null   # only when the proof's own left them empty
  return 0
}
remove_door_marks() {
  local d
  rm -f "$DOORS_DIR/.fence-proof" "$DOOR_SECRETS/.fence-proof"
  for d in $MADE_DOOR_DIRS; do rmdir "$d" 2>/dev/null; done
  MADE_DOOR_DIRS=""
}
remove_shots_mark() {
  local d
  rm -f "$SHOTS_DIR/.fence-proof"
  for d in $MADE_SHOTS_DIRS; do rmdir "$d" 2>/dev/null; done
  MADE_SHOTS_DIRS=""
}
stand_in_stop() {   # only the proof's own stand-in, by its process id
  if [[ -n "$STAND_IN" ]]; then kill "$STAND_IN" 2>/dev/null; wait "$STAND_IN" 2>/dev/null; fi
  STAND_IN=""
}
# The Researcher's proof task, quietly: set it to cancelled (and unassigned, so cancelling wakes no one), remove
# the Researcher's test key, remove the folders the checks made. Safe to call again; the checks report below.
proof_task_end() {
  if [[ -n "$PROOF_TASK_ID" ]]; then
    curl -s -m 10 -o /dev/null -X PATCH -H 'Content-Type: application/json' \
      -d '{"status":"cancelled","assigneeAgentId":null}' "$BOARD/api/issues/$PROOF_TASK_ID" || true
    PROOF_TASK_ID=""
  fi
  if [[ -n "$PROOF_RKEY_ID" ]]; then
    curl -s -m 10 -o /dev/null -X DELETE "$BOARD/api/agents/$PROOF_RKEY_AGENT/keys/$PROOF_RKEY_ID" || true
    PROOF_RKEY_ID=""
  fi
  PROOF_RKEY=""
  [[ -n "$PROOF_OTHER_DIR" ]] && rm -rf "${PROOF_OTHER_DIR:?}"
  PROOF_OTHER_DIR=""
  [[ -n "$PROOF_OTHER_HOME" ]] && rm -rf "${PROOF_OTHER_HOME:?}"
  PROOF_OTHER_HOME=""
  if [[ -n "$PROOF_HOME_MADE" && -n "$PROOF_HOME_DIR" && -d "$PROOF_HOME_DIR" && ! -L "$PROOF_HOME_DIR" ]]; then
    rm -rf "${PROOF_HOME_DIR:?}"
  fi
  PROOF_HOME_MADE=""; PROOF_HOME_DIR=""
  if [[ -n "$PROOF_GOAL_MADE" && -n "$PROOF_GOAL_DIR" ]]; then rm -f "$PROOF_GOAL_DIR/.fence-proof-research"; rmdir "$PROOF_GOAL_DIR" 2>/dev/null; fi
  PROOF_GOAL_MADE=""; PROOF_GOAL_DIR=""
}
remove_run_tmps() {   # each a folder the proof made itself; rm removes a link, never what it points at
  local d
  for d in $RUN_TMPS; do rm -rf "$d"; done
  RUN_TMPS=""
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
# fence never started, and that must never be counted as "blocked". Each ends
# within two minutes, whatever it runs.
# The Researcher's task and key go in by the environment only (never an argument), and only while its checks run.
inside() { (cd "$WS" && { [[ -z "$PROOF_TASK_ID" ]] || export PAPERCLIP_TASK_ID="$PROOF_TASK_ID" PAPERCLIP_API_KEY="$PROOF_RKEY"; } && PAPERCLIP_AGENT_ID="$AS" within 120 "$RUN" --fence-check "echo FENCE_UP; $1" 2>/dev/null); }
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
NARROW="$CFG_GATE_NARROW_URL"
NARROW_UP=0; answers "$NARROW/gate/health" | grep -q '"narrow":true' && NARROW_UP=1
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

# Which doors are switched on, as door_mode.py reads the switches file outside the
# fence: none when there is no file, or one it cannot trust (the fence then opens no door).
DOORS_ON="$(within 30 /usr/bin/python3 -I -c 'import sys
sys.path.insert(0, sys.argv[1])
import door_mode, model_mode
s = door_mode.read_state(model_mode.load_engine_config(model_mode.owner_home()))
print(" ".join(n for n in ("web", "generate", "viewer") if s.get("ok") and s[n]["on"] is True))' "$HERE" 2>/dev/null </dev/null)" \
  || { say FAIL "the doors' switches could not be read"; DOORS_ON=""; }

# A fenced call to a port where nothing answers fails whether or not the fence refuses
# it, so it proves nothing. The same request must first succeed from outside the fence.
# Where nothing listens on such a port, the proof listens there itself for the length of
# the check: a stand-in of its own that answers every request with 200, ends by itself
# after two minutes, and is stopped again by its process id.
STAND_IN_PY='import json, signal, socket, sys, threading, time
signal.alarm(int(sys.argv[1]))
body = json.dumps({"status": "ok", "part": "proof"}).encode()
answer = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: %d\r\n\r\n" % len(body) + body
def serve(s):
    while True:
        c = s.accept()[0]
        try:
            c.settimeout(2)
            c.recv(65536)
            c.sendall(answer)
        except OSError:
            pass
        finally:
            c.close()
bound = 0
for p in sys.argv[2:]:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", int(p)))
        s.listen(16)
    except OSError:
        s.close()
        continue
    threading.Thread(target=serve, args=(s,), daemon=True).start()
    bound += 1
if not bound:
    sys.exit(1)
while True:
    time.sleep(60)'
answers_ok() { curl -s -m 3 -f --noproxy '*' -o /dev/null "http://127.0.0.1:$1$2" 2>/dev/null; }   # <port> <path>
NOT_ANSWERING=""
stand_in() {   # stand_in <port> <path> ...: afterwards NOT_ANSWERING names each port that still does not answer
  local need=() ports=() i
  stand_in_stop
  NOT_ANSWERING=""
  while (( $# >= 2 )); do
    answers_ok "$1" "$2" || { need+=("$1" "$2"); ports+=("$1"); }
    shift 2
  done
  (( ${#need[@]} )) || return 0
  /usr/bin/python3 -I -c "$STAND_IN_PY" 120 "${ports[@]}" </dev/null >/dev/null 2>&1 &
  STAND_IN=$!
  set -- "${need[@]}"
  while (( $# >= 2 )); do
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      answers_ok "$1" "$2" && break
      sleep 0.25
    done
    answers_ok "$1" "$2" || NOT_ANSWERING="$NOT_ANSWERING $1"
    shift 2
  done
  NOT_ANSWERING="${NOT_ANSWERING# }"
}
# A fenced shell line that succeeds when anything on <port> answers <path> with 2xx,
# by either name, through the fence's proxy or around it.
reach() {
  printf "curl -s -m 5 -f -o /dev/null http://127.0.0.1:%s%s || curl -s -m 5 -f -o /dev/null http://localhost:%s%s || curl -s -m 5 -f --noproxy '*' -o /dev/null http://127.0.0.1:%s%s" \
    "$1" "$2" "$1" "$2" "$1" "$2"
}

# The owner's preview (PLAN-V5, K15) is for the owner's own browser: no fence reaches it. It
# answers 404 "Nothing to preview" while it holds no site, so reaching it is a 2xx or that
# sentence (a refusal by the fence's own proxy is neither). It must answer from outside first
# (or the proof's stand-in, where nothing listens on its port).
PREVIEW_SAYS="Nothing to preview"
reach_preview() {
  printf "%s || { curl -s -m 5 http://127.0.0.1:%s/; curl -s -m 5 http://localhost:%s/; curl -s -m 5 --noproxy '*' http://127.0.0.1:%s/; } 2>/dev/null | grep -q '%s'" \
    "$(reach "$CFG_PORT_PREVIEW" /)" "$CFG_PORT_PREVIEW" "$CFG_PORT_PREVIEW" "$CFG_PORT_PREVIEW" "$PREVIEW_SAYS"
}
preview_check() {
  if ! { answers_ok "$CFG_PORT_PREVIEW" / || curl -s -m 3 --noproxy '*' "http://127.0.0.1:$CFG_PORT_PREVIEW/" 2>/dev/null | grep -q "$PREVIEW_SAYS"; }; then
    stand_in "$CFG_PORT_PREVIEW" /
    if [[ -n "$NOT_ANSWERING" ]]; then
      say SKIP "whether $WHO can reach the preview (nothing answers on port $CFG_PORT_PREVIEW, and the proof could not stand in there)"
      stand_in_stop; return
    fi
  fi
  blocked "reach the preview" "$(reach_preview)"
  stand_in_stop
}

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
    # A PASS must mean a real file was refused: with no login file there (seen from
    # outside the fence, without reading it) there is nothing to try.
    local login_home="$STATE_DIR/codex-home/_proof-login" shared="$STATE_DIR/codex-home/auth.json"
    rm -rf "$login_home"
    if [[ ! -f "$shared" ]]; then
      say SKIP "whether $WHO can read the Codex login (no login file at $shared to try)"
      say SKIP "whether $WHO can read the Codex login from the engine's own Codex home (no login file at $shared to try)"
    else
      mkdir -m 700 "$login_home" && ln -s "$shared" "$login_home/auth.json" \
        || say FAIL "could not make a Codex home that links to the login"
      CODEX_HOME="$login_home" blocked "read the Codex login" 'cat "$CODEX_HOME/auth.json" >/dev/null'
      blocked "read the Codex login from the engine's own Codex home" "cat $shared >/dev/null"
      rm -rf "$login_home"
    fi
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
  preview_check
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
  # Program settings in a task folder would load in the next agent's program there
  # (PLAN-V5, K2a). Each try is joined with ||, so any one that works fails the
  # check; the folder is cleared of them first, so no try fails only because its
  # name is already taken. Ordinary files beside them must still write.
  clear_plants
  blocked "plant program settings in its task folder (.claude, CLAUDE.md, AGENTS.md, .mcp.json, .codex)" \
    'mkdir .claude || echo x > CLAUDE.md || echo x > claude.md || echo x > AGENTS.md || echo x > .mcp.json || mkdir .codex || mkdir .agentſ || { mkdir -p sub && echo x > sub/CLAUDE.md; } || { echo x > y && mv y CLAUDE.md; } || ln -s note.txt AGENTS.md'
  local name
  for name in .claude CLAUDE.md AGENTS.md .mcp.json .codex .agentſ sub/CLAUDE.md; do
    if [[ -e "$WS/$name" || -L "$WS/$name" ]]; then say FAIL "$WHO left $name in its task folder"; fi
  done
  clear_plants
  # The sandbox tool allows writes to its own temp folder in every profile; a folder
  # of program settings made there could be moved or linked into a task folder whole.
  blocked "use the sandbox tool's own temp folder to carry files in" \
    'mkdir -p /private/tmp/claude/.fence-proof-carry/.claude || mkdir -p /tmp/claude/.fence-proof-carry || echo x > /private/tmp/claude/.fence-proof-x || ln -s "$PWD" /private/tmp/claude/.fence-proof-link || ls /private/tmp/claude'
  if [[ -z "$SANDBOX_TMP_WAS" && ( -e /private/tmp/claude || -L /private/tmp/claude ) ]]; then
    SANDBOX_TMP_MADE=1; say FAIL "$WHO made the sandbox tool's own temp folder /private/tmp/claude"
  fi
  allowed "still write an ordinary file beside them" 'echo x > ordinary.txt && mkdir -p sub && echo x > sub/ordinary.txt'
  if [[ ! -f "$WS/ordinary.txt" || ! -f "$WS/sub/ordinary.txt" ]]; then say FAIL "the ordinary files $WHO wrote did not arrive in its task folder"; fi
  clear_plants
  allowed "use a here-document in zsh, its tools' shell" "/bin/zsh -c 'cat <<< fence-heredoc | grep -q fence-heredoc'"
  if [[ -e "$HOME/fence-escape-test.txt" ]]; then say FAIL "a file was written outside the fence"; rm -f "$HOME/fence-escape-test.txt"; fi
  refuses "run from engine/, which is not an agent task folder" "not an agent task folder" \
    /bin/bash -c 'cd "$1" && shift && "$@"' _ "$CFG_ENGINE_DIR" "$RUN" --fence-check 'echo FENCE_UP'
  refuses "its agent id has no fence policy" "no fence policy for this agent" \
    env PAPERCLIP_AGENT_ID="$OTHER_ID" "$RUN" --fence-check 'echo FENCE_UP'
}

# The playbooks (PLAN-V5, K4 and K2f): every run with a policy may read them, none may
# write there. Until the installer has put them in place there is nothing to read and
# nothing to refuse, so both checks wait for it.
playbook_checks() {
  local pb="$CFG_PLAYBOOKS" why="(playbooks not in place: run engine/playbooks/install.sh)"
  if [[ ! -d "$pb" || -L "$pb" || ! -f "$pb/index.json" || -L "$pb/index.json" ]]; then
    say SKIP "whether $WHO can read the playbooks $why"
    say SKIP "whether $WHO can write in the playbooks $why"
    return
  fi
  allowed "read the playbooks" \
    "test \"\$UUU_PLAYBOOKS_DIR\" = $pb && ls \"\$UUU_PLAYBOOKS_DIR\" >/dev/null && cat \"\$UUU_PLAYBOOKS_DIR/index.json\" >/dev/null"
  rm -rf "$pb/.fence-proof-write" "$pb/.fence-proof-dir"
  blocked "write in the playbooks" \
    'echo x > "$UUU_PLAYBOOKS_DIR/.fence-proof-write" || mkdir "$UUU_PLAYBOOKS_DIR/.fence-proof-dir"'
  if [[ -e "$pb/.fence-proof-write" || -e "$pb/.fence-proof-dir" ]]; then
    say FAIL "a file was made in the playbooks from inside the fence"
  fi
  rm -rf "$pb/.fence-proof-write" "$pb/.fence-proof-dir"
}

# The doors and the narrow gate (PLAN-V5, K2c and K2d). A door enters a run's fence only
# while its switch is on, and only for the agents it serves; the narrow gate only for
# the walled Researcher. The proof's own agent is neither, so it reaches none of them.
# Each port must answer from outside first (the real part, or the proof's stand-in).
# The doors' settings and secrets are read with nothing to tell them apart from any
# other file: the real ones when there are any, and a mark the proof puts in each of
# their two folders (made with the doors' own mode when missing, and removed again).
door_checks() {
  local what d ok=1
  if [[ -z "$DOORS_ON" ]]; then
    what="reach the web door, the generation door or the page viewer while their switches are off"
  else
    what="reach the web door, the generation door or the page viewer, none of which serves it (switched on: ${DOORS_ON// /, })"
  fi
  stand_in "$CFG_PORT_WEB" /web/health "$CFG_PORT_GENERATE" /gen/health "$CFG_PORT_VIEWER" /view/health \
    "$CFG_PORT_GATE_NARROW" /gate/health
  case " $NOT_ANSWERING " in
    *" $CFG_PORT_WEB "*|*" $CFG_PORT_GENERATE "*|*" $CFG_PORT_VIEWER "*)
      say SKIP "whether $WHO can $what (nothing answers on port ${NOT_ANSWERING// /, }, and the proof could not stand in there)" ;;
    *) blocked "$what" "$(reach "$CFG_PORT_WEB" /web/health) || $(reach "$CFG_PORT_GENERATE" /gen/health) || $(reach "$CFG_PORT_VIEWER" /view/health)" ;;
  esac
  case " $NOT_ANSWERING " in
    *" $CFG_PORT_GATE_NARROW "*)
      say SKIP "whether $WHO can reach the narrow gate, which serves only the Researcher (nothing answers on port $CFG_PORT_GATE_NARROW, and the proof could not stand in there)" ;;
    *) blocked "reach the narrow gate, which serves only the Researcher" "$(reach "$CFG_PORT_GATE_NARROW" /gate/health)" ;;
  esac
  stand_in_stop
  for d in "$DOORS_DIR" "$DOOR_SECRETS"; do
    if [[ ! -e "$d" && ! -L "$d" ]]; then
      mkdir -m 700 "$d" && MADE_DOOR_DIRS="$MADE_DOOR_DIRS $d" || ok=0
    fi
    [[ -d "$d" && ! -L "$d" ]] && (umask 077; echo proof > "$d/.fence-proof") || ok=0
  done
  if (( ok )); then
    blocked "read the doors' settings and secrets" \
      "cat $DOORS_DIR/.fence-proof >/dev/null || cat $DOOR_SECRETS/.fence-proof >/dev/null || ls $DOORS_DIR >/dev/null || ls $DOOR_SECRETS >/dev/null || cat $CFG_DOORS_STATE >/dev/null || cat $DOOR_SECRETS/web-secret >/dev/null || cat $DOOR_SECRETS/generate-secret >/dev/null || cat $DOOR_SECRETS/viewer-secret >/dev/null"
  else
    say FAIL "could not put a mark in the doors' folders ($DOORS_DIR, $DOOR_SECRETS)"
  fi
  remove_door_marks
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
  playbook_checks
  door_checks
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
    # Every real Checker run gets a Codex home paperclip made under the company's
    # codex-home, its auth.json a link to the login, which the fence now refuses.
    # A throwaway home of that shape (a link to the company's link; the login is
    # never read here), called with paperclip's own arguments; removed again.
    co="$(/usr/bin/python3 -I -c "import json,re,sys
c=json.load(open(sys.argv[1])).get('companyId')
print(c if isinstance(c,str) and re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',c) else '')" \
      "$STATE_DIR/ids.json" 2>/dev/null)"
    company_home="$CFG_INSTANCE_ROOT/companies/$co/codex-home"
    if [[ -z "$co" ]]; then
      say SKIP "the Codex agent answering from a Codex home that links to the login, as paperclip's do (ids.json has no company: run engine setup)"
    elif [[ ! -L "$company_home/auth.json" || ! -f "$company_home/auth.json" ]]; then
      say SKIP "the Codex agent answering from a Codex home that links to the login, as paperclip's do (paperclip has not linked a login into the company's Codex home yet)"
    else
      ph="$(mktemp -d "$company_home/_proof-home.XXXXXX")" && ln -s "$company_home/auth.json" "$ph/auth.json" || ph=""
      once="$(mktemp -d "$STATE_DIR/tasks/_proof-answer.XXXXXX")" || once=""
      out="$([[ -n "$ph" && -n "$once" ]] && cd "$once" && printf 'Reply with exactly: OK\n' \
        | CODEX_HOME="$ph" PAPERCLIP_COMPANY_ID="$co" PAPERCLIP_AGENT_ID="$as" within 180 "$RUN" \
          -c features.shell_snapshot=false -c 'shell_environment_policy.inherit="all"' \
          -c shell_environment_policy.ignore_default_excludes=true -c 'shell_environment_policy.include_only=["PATH","HOME"]' \
          exec --json --dangerously-bypass-approvals-and-sandbox --model codex - 2>/dev/null)"
      if [[ -n "$ph" && -L "$ph/auth.json" && "$out" == *'"text":"OK"'* ]]; then
        say PASS "the Codex agent answers from a Codex home that links to the login, as paperclip's do, with the login refused"
      else say FAIL "the Codex agent did not answer from a Codex home that links to the login, as paperclip's do"; fi
      [[ -n "$ph" ]] && rm -rf "$ph"
      [[ -n "$once" ]] && rm -rf "$once"
    fi
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
  KEY_CO="$co"
}
# The test key is kept for the narrow gate's checks below, then removed (and on every exit).
remove_test_key() {
  local code
  [[ -n "$HDR" ]] && rm -f "$HDR"; HDR=""
  [[ -n "$KEY_ID" ]] || return 0
  code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X DELETE "$BOARD/api/agents/$KEY_AGENT/keys/$KEY_ID")"
  if [[ "$code" == 200 || "$code" == 204 ]]; then KEY_ID=""; say PASS "the test key was removed again"
  else say FAIL "the test key could not be removed (got $code); remove the key named engine-proof on the board"; fi
}
gate_checks

# The Researcher, the one walled agent (PLAN-V5, K10, K2d): it works only in its own
# folder, reads only what the owner shared (and the playbooks), reaches the board only
# through the narrow gate and the internet only through the web door, and that only
# while the owner has the web switched on. Run as the Researcher itself (its id from
# ids.json, its own walled policy) from the proof's task folder: the fence moves it into
# its own. Every folder it must not read is first seen to be there from outside (the
# proof's own note, a mark in the company's files), so a refusal means the fence refused.
echo; echo "The Researcher and the web door (a walled agent, and who else reaches the door)"
# A temp folder of the shape paperclip gives each run (paperclip-run-* in the system's
# temp area, or in /private/tmp), made here; with <mark>, a file of the proof's inside.
RUN_TMP=""
run_tmp() {   # run_tmp <area> [mark]: sets RUN_TMP to the new folder's real path
  local d
  RUN_TMP=""
  [[ -n "$1" && -d "$1" ]] || return 1
  d="$(mktemp -d "${1%/}/paperclip-run-proof.XXXXXX")" || return 1
  RUN_TMPS="$RUN_TMPS $d"
  d="$(cd "$d" && pwd -P)" || return 1
  if [[ -n "${2:-}" ]]; then (umask 077; echo proof > "$d/.fence-proof") || return 1; fi
  RUN_TMP="$d"
}
# The proof's own task for the Researcher: made on the board assigned to it (in backlog, which wakes no one),
# with a key of the Researcher's own; a run of the Researcher carries both and the fence asks the board which
# goal the task belongs to. Sets PROOF_TASK_ID, PROOF_IDENT and PROOF_RKEY; says why when it cannot.
proof_task_make() {   # proof_task_make <the Researcher's id>
  local rid="$1" co resp made
  if (( ! BOARD_UP )); then
    say SKIP "the Researcher's fence checks (the board is not running, and a run of the Researcher needs a task on it)"; return 1
  fi
  co="$(/usr/bin/python3 -I -c "import json,sys;print(json.load(open(sys.argv[1]))['companyId'])" "$STATE_DIR/ids.json" 2>/dev/null)"
  if [[ -z "$co" ]]; then say SKIP "the Researcher's fence checks (ids.json has no company: run engine setup)"; return 1; fi
  resp="$(curl -s -m 10 -X POST -H 'Content-Type: application/json' -d '{"name":"engine-proof-researcher"}' \
    "$BOARD/api/agents/$rid/keys")"
  PROOF_RKEY_AGENT="$rid"
  PROOF_RKEY_ID="$(printf '%s' "$resp" | /usr/bin/python3 -I -c "import json,sys;print(json.load(sys.stdin).get('id') or '')" 2>/dev/null)"
  PROOF_RKEY="$(printf '%s' "$resp" | /usr/bin/python3 -I -c "import json,sys;print(json.load(sys.stdin).get('token') or '')" 2>/dev/null)"
  resp=""
  if [[ -z "$PROOF_RKEY_ID" || -z "$PROOF_RKEY" ]]; then say FAIL "could not make a test key for the Researcher on the board"; return 1; fi
  resp="$(curl -s -m 15 -X POST -H 'Content-Type: application/json' \
    -d "{\"title\":\"engine proof: the Researcher's folder (cancelled again when the proof ends)\",\"status\":\"backlog\",\"assigneeAgentId\":\"$rid\"}" \
    "$BOARD/api/companies/$co/issues")"
  made="$(printf '%s' "$resp" | /usr/bin/python3 -I -c 'import json,re,sys
try:
    d=json.load(sys.stdin)
    ok=isinstance(d,dict) and isinstance(d.get("id"),str) and re.fullmatch("[0-9a-f-]{36}",d["id"]) \
        and isinstance(d.get("identifier"),str) and re.fullmatch("[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}",d["identifier"]) \
        and d.get("assigneeAgentId")==sys.argv[1]
    print(d["id"],d["identifier"]) if ok else print("-")
except (ValueError,TypeError,KeyError):
    print("-")' "$rid" 2>/dev/null)"
  resp=""
  if [[ "$made" == "-" || -z "$made" ]]; then say FAIL "could not make a task for the Researcher on the board"; return 1; fi
  PROOF_TASK_ID="${made%% *}"; PROOF_IDENT="${made#* }"
}
# The task is set to cancelled (and unassigned in the same request, so nothing wakes the Researcher), the key
# is removed, and the folders the checks made go; each said in its own line.
proof_task_finish() {
  local code
  if [[ -n "$PROOF_TASK_ID" ]]; then
    code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X PATCH -H 'Content-Type: application/json' \
      -d '{"status":"cancelled","assigneeAgentId":null}' "$BOARD/api/issues/$PROOF_TASK_ID")"
    if [[ "$code" == 200 ]]; then
      say PASS "the Researcher's proof task $PROOF_IDENT was set to cancelled again (it is on the board only as a cancelled task)"
      PROOF_TASK_ID=""
    else say FAIL "the Researcher's proof task $PROOF_IDENT could not be set to cancelled (got $code); cancel it on the board"; fi
  fi
  if [[ -n "$PROOF_RKEY_ID" ]]; then
    code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X DELETE "$BOARD/api/agents/$PROOF_RKEY_AGENT/keys/$PROOF_RKEY_ID")"
    if [[ "$code" == 200 || "$code" == 204 ]]; then say PASS "the Researcher's test key was removed again"; PROOF_RKEY_ID=""
    else say FAIL "the Researcher's test key could not be removed (got $code); remove the key named engine-proof-researcher on the board"; fi
  fi
  proof_task_end
}
researcher_checks() {
  local rid why research shared what d cmd own other other_tmp area web_on=0 goal other_goal homes ghome other_home out one_home
  RUN="$HERE/bin/claude"; WHO="the Researcher"; AS=""
  rid="$(agent_id_of researcher)"; why=""
  if [[ -z "$rid" ]]; then why="no Researcher in ids.json yet: run engine setup"
  elif [[ ! -f "$CFG_POLICY/$rid.json" ]]; then why="the Researcher has no fence policy yet: run engine setup"
  fi
  if [[ -n "$why" ]]; then say SKIP "the Researcher's fence checks ($why)"; return; fi
  if ! within 30 /usr/bin/python3 -I -c "import json,sys
p=json.load(open(sys.argv[1]))
sys.exit(0 if isinstance(p,dict) and p.get('walled') is True else 1)" "$CFG_POLICY/$rid.json" 2>/dev/null; then
    say FAIL "the Researcher's fence policy is not a walled one ($CFG_POLICY/$rid.json)"; return
  fi
  AS="$rid"
  research="$(cd "$STATE_DIR" && pwd -P)/tasks/research"
  rm -f "$STATE_DIR/tasks/research/.fence-proof-research"
  proof_task_make "$rid" || { proof_task_finish; AS=""; return; }
  # Its working folder is its goal's folder under the research folder, whose name the fence got from the board.
  goal="$research/$PROOF_IDENT"
  PROOF_GOAL_DIR="$goal"; [[ -e "$goal" || -L "$goal" ]] || PROOF_GOAL_MADE=1
  # And its Claude home is that goal's own, claude-home/<its id>/<goal>, made by the fence too.
  homes="$(cd "$STATE_DIR/claude-home" && pwd -P)"
  ghome="$homes/$rid/$PROOF_IDENT"
  PROOF_HOME_DIR="$ghome"; [[ -e "$ghome" || -L "$ghome" ]] || PROOF_HOME_MADE=1
  # No task of its own, no run: the fence will not guess which goal's folder it is.
  refuses "it has no task of its own" "must name its task" \
    env -u PAPERCLIP_TASK_ID -u PAPERCLIP_API_KEY PAPERCLIP_AGENT_ID="$rid" "$RUN" --fence-check 'echo FENCE_UP'
  allowed "write in its own goal's research folder" \
    "test \"\$(pwd -P)\" = $goal && echo x > .fence-proof-research && test -f .fence-proof-research"
  if [[ ! -f "$goal/.fence-proof-research" ]]; then say FAIL "the file the Researcher wrote did not arrive in $goal"; fi
  rm -f "$goal/.fence-proof-research"
  # Another goal's folder, made here from outside with a mark in it (so a refusal is the fence's, not a missing
  # folder): the Researcher can neither read nor write it, nor list the research folder that holds both.
  other_goal="$research/FENCEPROOF-1"
  if [[ -e "$other_goal" || -L "$other_goal" ]]; then say FAIL "could not make another goal's folder for the Researcher's check ($other_goal is there already)"
  elif ! (umask 077; mkdir "$other_goal" && echo proof > "$other_goal/.fence-proof"); then
    rm -rf "${other_goal:?}"; say FAIL "could not make another goal's folder for the Researcher's check"
  else
    PROOF_OTHER_DIR="$other_goal"
    blocked "read or write another goal's research folder" \
      "ls $other_goal >/dev/null || cat $other_goal/.fence-proof >/dev/null || ls ../FENCEPROOF-1 >/dev/null || ls $research >/dev/null || ls .. >/dev/null || echo x > $other_goal/.fence-proof-x || echo x > ../FENCEPROOF-1/.fence-proof-x || echo x > $research/.fence-proof-x || mkdir $research/FENCEPROOF-2"
    if [[ -e "$other_goal/.fence-proof-x" || -e "$research/.fence-proof-x" || -e "$research/FENCEPROOF-2" ]]; then
      say FAIL "the Researcher wrote in another goal's research folder"
    fi
    rm -rf "${other_goal:?}" "${research:?}/FENCEPROOF-2" "${research:?}/.fence-proof-x"; PROOF_OTHER_DIR=""
  fi
  # Its Claude home is its goal's own (claude-home/<its id>/<goal>), made by the fence as a plain
  # folder closed to others, so nothing a run of one goal leaves there is read by a run of another
  # (the second look at the review of step 2). Another goal's home beside it, made here with a
  # mark, and the folder above them are out of its reach.
  allowed "use its goal's own Claude home" \
    "test \"\$CLAUDE_CONFIG_DIR\" = $ghome && echo x > \"\$CLAUDE_CONFIG_DIR/.fence-proof\" && test -f \"\$CLAUDE_CONFIG_DIR/.fence-proof\""
  if [[ -L "$ghome" || ! -d "$ghome" || "$(stat -f '%Lp' "$ghome" 2>/dev/null)" != 700 ]]; then
    say FAIL "the Researcher's Claude home for its goal is not a plain folder closed to others ($ghome)"
  fi
  rm -f "$ghome/.fence-proof"
  other_home="$homes/$rid/FENCEPROOF-1"
  if [[ -e "$other_home" || -L "$other_home" ]]; then say FAIL "could not make another goal's Claude home for the Researcher's check ($other_home is there already)"
  elif ! (umask 077; mkdir "$other_home" && echo proof > "$other_home/.fence-proof"); then
    rm -rf "${other_home:?}"; say FAIL "could not make another goal's Claude home for the Researcher's check"
  else
    PROOF_OTHER_HOME="$other_home"
    blocked "read or write another goal's Claude home, or list the homes of its goals" \
      "cat $other_home/.fence-proof >/dev/null || ls $other_home >/dev/null || ls $homes/$rid >/dev/null || echo x > $other_home/.fence-proof-x || echo x > $homes/$rid/.fence-proof-x || mkdir $homes/$rid/FENCEPROOF-2"
    if [[ -e "$other_home/.fence-proof-x" || -e "$homes/$rid/.fence-proof-x" || -e "$homes/$rid/FENCEPROOF-2" ]]; then
      say FAIL "the Researcher wrote beside its goal's own Claude home"
    fi
    rm -rf "${other_home:?}" "${homes:?}/$rid/FENCEPROOF-2" "${homes:?}/$rid/.fence-proof-x"; PROOF_OTHER_HOME=""
  fi
  # A real answer, as a run on the proof's task: the program starts, works and keeps its session
  # in its goal's own home, and nowhere a run of another goal could read it.
  if [[ "$MODE" == provider && ! -f "$CFG_PROVIDER_KEY" ]]; then
    say SKIP "the Researcher answering from inside the fence (no provider key saved: paste it in Settings)"
  elif [[ "$MODE" != provider && ! -f "$STATE_DIR/agent.env" ]]; then
    say SKIP "the Researcher answering from inside the fence (no agent login yet: run engine/fence/login-wizard.sh)"
  else
    one_home=0; [[ -e "$homes/$rid/projects" || -L "$homes/$rid/projects" ]] && one_home=1
    out="$(cd "$WS" && PAPERCLIP_TASK_ID="$PROOF_TASK_ID" PAPERCLIP_API_KEY="$PROOF_RKEY" PAPERCLIP_AGENT_ID="$rid" \
      within 180 "$RUN" -p "Reply with exactly: OK" --max-turns 1 </dev/null 2>&1 | tail -1)"
    if [[ "$out" == *"no model is picked for this agent"* ]]; then
      say SKIP "the Researcher answering from inside the fence (no model is picked for it: open Settings)"
    elif [[ "$out" != *OK* ]]; then
      say FAIL "the Researcher did not answer from inside the fence: ${out:0:200}"
    elif ! ls "$ghome/projects/"*/*.jsonl >/dev/null 2>&1; then
      say FAIL "the Researcher answered, but its session was not kept in its goal's own Claude home"
    else
      say PASS "the Researcher answers from inside the fence and keeps its session in its goal's own Claude home"
    fi
    if (( ! one_home )) && [[ -e "$homes/$rid/projects" || -L "$homes/$rid/projects" ]]; then
      say FAIL "the Researcher's session was kept in the home all its goals would share"
    fi
  fi
  # The other agents' work: the company's task folders and paperclip's, and the proof's own.
  cmd="cat $WS/note.txt >/dev/null"
  for d in "$STATE_DIR/tasks/company-work" "$STATE_DIR/tasks/agents" "$CFG_INSTANCE_ROOT/workspaces" "$CFG_INSTANCE_ROOT/isolated-workspaces"; do
    [[ -d "$d" ]] && cmd="$cmd || ls $d >/dev/null"
  done
  blocked "read the other agents' work" "$cmd"
  mkdir -p "$KNOWLEDGE" && echo "proof" > "$KNOWLEDGE_MARK"
  cmd="ls $KNOWLEDGE >/dev/null || cat $KNOWLEDGE_MARK >/dev/null"
  [[ -d "$STATE_DIR/lessons" ]] && cmd="$cmd || ls $STATE_DIR/lessons >/dev/null"
  blocked "read the company's files" "$cmd"
  cmd=""
  for d in "$STATE_DIR/media/room" "$STATE_DIR/media" "$STATE_DIR/art/tools" "$STATE_DIR/art"; do
    [[ -d "$d" ]] && cmd="${cmd:+$cmd || }ls $d >/dev/null"
  done
  if [[ -z "$cmd" ]]; then say SKIP "whether the Researcher can read the room or the art tools (neither is there yet)"
  else blocked "read the room or the art tools" "$cmd"; fi
  shared="$STATE_DIR/knowledge/shared"
  if [[ ! -d "$shared" || -L "$shared" ]]; then
    say SKIP "whether the Researcher can read what the owner shared (the shared folder is not there yet: run engine setup)"
  else
    allowed "read what the owner shared" \
      "test \"\$UUU_KNOWLEDGE_DIR\" = $shared && ls \"\$UUU_KNOWLEDGE_DIR\" >/dev/null && for f in \"\$UUU_KNOWLEDGE_DIR\"/*; do test -f \"\$f\" || continue; cat \"\$f\" >/dev/null || exit 1; done"
  fi
  # Its temp folder: one of its own, and another run's beside it (in the system's temp
  # area, and in /private/tmp), each with the proof's mark; every spelling of each, and
  # the temp areas that hold them. (Its own is used by a name made in $TMPDIR: macOS's
  # mktemp with no name of its own writes to the system's temp area, never $TMPDIR, and
  # no fenced run may write there.)
  area="$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null)"
  own=""; other=""; other_tmp=""
  run_tmp "$area" && own="$RUN_TMP" && run_tmp "$area" mark && other="$RUN_TMP" \
    && run_tmp /private/tmp mark && other_tmp="$RUN_TMP" || own=""
  if [[ -z "$own" ]]; then say FAIL "could not make the temp folders for the Researcher's checks"
  else
    area="$(dirname "$other")"
    TMPDIR="$own" allowed "use its own temp folder" \
      "test \"\$TMPDIR\" = $own && f=\"\$(mktemp \"\$TMPDIR/proof.XXXXXX\")\" && echo x > \"\$f\" && cat \"\$f\" >/dev/null && ls \"\$TMPDIR\" >/dev/null && echo x > \"\$TMPDIR/.fence-proof-own\""
    if [[ ! -f "$own/.fence-proof-own" ]]; then say FAIL "the file the Researcher wrote did not arrive in its own temp folder"; fi
    TMPDIR="$own" blocked "list or read another run's temp folder (or the temp areas that hold them)" \
      "ls $other >/dev/null || cat $other/.fence-proof >/dev/null || ls ${other#/private} >/dev/null || cat ${other#/private}/.fence-proof >/dev/null || ls $other_tmp >/dev/null || cat $other_tmp/.fence-proof >/dev/null || ls ${other_tmp#/private} >/dev/null || cat ${other_tmp#/private}/.fence-proof >/dev/null || ls $area >/dev/null || ls ${area#/private} >/dev/null || ls /private/tmp >/dev/null || ls /tmp/ >/dev/null"
  fi
  remove_run_tmps
  if (( GATE_UP )); then blocked "reach the ordinary gate" "$(reach "$CFG_PORT_GATE" /gate/health)"
  else say SKIP "whether the Researcher can reach the ordinary gate (the gate is not running)"; fi
  if (( NARROW_UP )); then
    allowed "reach the narrow gate, which turns it away without a token (401)" \
      "test \"\$PAPERCLIP_API_URL\" = $NARROW && curl -s -m 6 $NARROW/gate/health | grep -q '\"narrow\":true' && test \"\$(curl -s -m 6 -o /dev/null -w '%{http_code}' $NARROW/api/agents/me)\" = 401"
  else say SKIP "whether the narrow gate turns the Researcher away without a token (the narrow gate is not running)"; fi
  blocked "reach the open internet" 'curl -s -m 8 https://example.com -o /dev/null'
  preview_check
  case " $DOORS_ON " in *" web "*) web_on=1 ;; esac
  stand_in "$CFG_PORT_WEB" /web/health
  if [[ -n "$NOT_ANSWERING" ]]; then
    say SKIP "whether the Researcher can reach the web door (the web door is not running, and the proof could not stand in on port $CFG_PORT_WEB)"
  elif (( web_on )); then
    allowed "reach the web door while its switch is on, with its address and a token" \
      "test \"\$UUU_WEB_URL\" = $CFG_WEB_URL && test -n \"\$UUU_WEB_TOKEN\" && { $(reach "$CFG_PORT_WEB" /web/health); }"
  else
    blocked "reach the web door while it is switched off" "$(reach "$CFG_PORT_WEB" /web/health)"
    allowed "be given no web door address or token while it is switched off" 'test -z "${UUU_WEB_URL+x}${UUU_WEB_TOKEN+x}"'
  fi
  stand_in_stop
  AS=""
  proof_task_finish
}
# The narrow gate with the proof's own test key (the Builder's, made on the owner's side
# above): it lists nothing of the company's and shows no task that is not the caller's.
# Each refusal is set beside the same request through the ordinary gate, which must answer
# it (200), so a refusal shows the narrow gate refused, not that there was nothing to show.
# A task is picked by its id only; nothing of a task is printed.
narrow_key_checks() {
  local code body pick
  if (( ! NARROW_UP )); then say SKIP "the narrow gate checks with an agent token (the narrow gate is not running)"; return; fi
  if [[ -z "$KEY_CO" || -z "$HDR" || ! -s "$HDR" ]]; then
    say SKIP "the narrow gate checks with an agent token (there is no test key: see the gate's lines above)"; return
  fi
  code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H @"$HDR" "$NARROW/api/agents/me")"
  if [[ "$code" == 200 ]]; then say PASS "an agent token passes the narrow gate where it may (GET /api/agents/me is 200)"
  else say FAIL "an agent token did not pass the narrow gate where it may (GET /api/agents/me gave $code)"; fi
  pick="$(curl -s -m 20 -H @"$HDR" -w '\n%{http_code}' "$GATE/api/companies/$KEY_CO/issues" 2>/dev/null \
    | within 30 /usr/bin/python3 -I -c 'import json,re,sys
raw=sys.stdin.read(33554432)
body,_,code=raw.rpartition("\n")
pick="-"
try:
    for i in json.loads(body):
        if isinstance(i,dict) and isinstance(i.get("id"),str) and re.fullmatch("[0-9a-f-]{36}",i["id"]) and i.get("assigneeAgentId")!=sys.argv[1]:
            pick=i["id"]
            break
except (ValueError,TypeError):
    pass
print((code.strip() or "000")[:3],pick)' "$KEY_AGENT" 2>/dev/null)"
  code="${pick%% *}"; pick="${pick#* }"
  if [[ "$code" != 200 ]]; then
    say SKIP "whether the narrow gate lists the company's tasks (the ordinary gate did not list them either: got ${code:-nothing})"
  else
    body="$(curl -s -m 10 -w '\n%{http_code}' -H @"$HDR" "$NARROW/api/companies/$KEY_CO/issues")"
    code="${body##*$'\n'}"; body="${body%$'\n'*}"
    if [[ "$code" == 403 && "$body" == *'"rule":"narrow-read"'* ]]; then say PASS "the narrow gate will not list the company's tasks (403 narrow-read)"
    else say FAIL "the narrow gate did not refuse to list the company's tasks (got $code)"; fi
  fi
  if [[ ! "$pick" =~ ^[0-9a-f-]{36}$ ]]; then
    say SKIP "whether the narrow gate shows a task that is not the caller's (the board has no task that is not the Builder's to try)"
  else
    code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H @"$HDR" "$GATE/api/issues/$pick")"
    if [[ "$code" != 200 ]]; then
      say SKIP "whether the narrow gate shows a task that is not the caller's (the ordinary gate did not show it either: got $code)"
    else
      body="$(curl -s -m 15 -w '\n%{http_code}' -H @"$HDR" "$NARROW/api/issues/$pick")"
      code="${body##*$'\n'}"; body="${body%$'\n'*}"
      if [[ "$code" == 403 && "$body" == *'"rule":"narrow-not-yours"'* ]]; then
        say PASS "the narrow gate will not show a task that is not the caller's (403 narrow-not-yours)"
      else say FAIL "the narrow gate did not refuse a task that is not the caller's (got $code)"; fi
    fi
  fi
  body=""
}
# Every other agent: the Builder, with its own fence policy, never reaches the web door,
# whether the switch is on or off.
builder_web_check() {
  local bid state=off
  bid="$(agent_id_of builder)"
  if [[ -z "$bid" || ! -f "$CFG_POLICY/$bid.json" ]]; then
    say SKIP "whether the Builder can reach the web door (no Builder with a fence policy yet: run engine setup)"; return
  fi
  case " $DOORS_ON " in *" web "*) state=on ;; esac
  RUN="$HERE/bin/claude"; WHO="the Builder"; AS="$bid"
  stand_in "$CFG_PORT_WEB" /web/health
  if [[ -n "$NOT_ANSWERING" ]]; then
    say SKIP "whether the Builder can reach the web door (the web door is not running, and the proof could not stand in on port $CFG_PORT_WEB)"
  else
    blocked "reach the web door (its switch is $state)" "$(reach "$CFG_PORT_WEB" /web/health)"
  fi
  stand_in_stop
  AS=""
}
# The page viewer (PLAN-V5, K15, K16): it serves the Builder and the Art director, and them only
# while the owner has it switched on; the Checker never, whatever the switch. Each runs as itself
# (its id from ids.json, its own fence policy). None of them reaches the owner's preview or reads
# the home screen's own pictures of pages (a mark the proof puts there, in folders made with the
# home server's mode when missing); the Builder and the Art director read the site kit.
viewer_checks() {
  local slug id state=off d ok=1 kit="$CFG_PLAYBOOKS/site-kit"
  case " $DOORS_ON " in *" viewer "*) state=on ;; esac
  for d in "$STATE_DIR/home" "$SHOTS_DIR"; do
    if [[ ! -e "$d" && ! -L "$d" ]]; then
      mkdir -m 700 "$d" && MADE_SHOTS_DIRS="$d $MADE_SHOTS_DIRS" || ok=0
    fi
  done
  [[ -d "$SHOTS_DIR" && ! -L "$SHOTS_DIR" ]] && (umask 077; echo proof > "$SHOTS_DIR/.fence-proof") || ok=0
  for slug in builder art-director; do
    case "$slug" in builder) WHO="the Builder" ;; *) WHO="the Art director" ;; esac
    id="$(agent_id_of "$slug")"
    if [[ -z "$id" || ! -f "$CFG_POLICY/$id.json" ]]; then
      say SKIP "the page viewer checks for $WHO (no ${WHO#the } with a fence policy yet: run engine setup)"; continue
    fi
    RUN="$HERE/bin/claude"; AS="$id"
    stand_in "$CFG_PORT_VIEWER" /view/health
    if [[ -n "$NOT_ANSWERING" ]]; then
      say SKIP "whether $WHO can reach the page viewer (the page viewer is not running, and the proof could not stand in on port $CFG_PORT_VIEWER)"
    elif [[ "$state" == on ]]; then
      allowed "reach the page viewer while its switch is on, with its address and a token" \
        "test \"\$UUU_VIEWER_URL\" = $CFG_VIEWER_URL && test -n \"\$UUU_VIEWER_TOKEN\" && { $(reach "$CFG_PORT_VIEWER" /view/health); }"
    else
      blocked "reach the page viewer while its switch is off" "$(reach "$CFG_PORT_VIEWER" /view/health)"
      allowed "be given no page viewer address or token while its switch is off" 'test -z "${UUU_VIEWER_URL+x}${UUU_VIEWER_TOKEN+x}"'
    fi
    stand_in_stop
    preview_check
    if (( ok )); then
      blocked "read the home screen's pictures of pages" "ls $SHOTS_DIR >/dev/null || cat $SHOTS_DIR/.fence-proof >/dev/null || ls $STATE_DIR/home >/dev/null"
    else say FAIL "could not put a mark in the home screen's pictures of pages ($SHOTS_DIR)"; fi
    if [[ ! -d "$kit" || -L "$kit" ]]; then
      say SKIP "whether $WHO can read the site kit (not installed: run engine/playbooks/install.sh)"
    else
      allowed "read the site kit" \
        'ls "$UUU_PLAYBOOKS_DIR/site-kit" >/dev/null && for f in "$UUU_PLAYBOOKS_DIR"/site-kit/*; do cat "$f" >/dev/null || exit 1; done'
    fi
  done
  WHO="the Checker"
  id="$(agent_id_of checker)"
  if [[ -z "$id" || ! -f "$CFG_POLICY/$id.json" ]]; then
    say SKIP "the page viewer checks for the Checker (no Checker with a fence policy yet: run engine setup)"
  else
    RUN="$HERE/bin/codex"; AS="$id"
    stand_in "$CFG_PORT_VIEWER" /view/health
    if [[ -n "$NOT_ANSWERING" ]]; then
      say SKIP "whether the Checker can reach the page viewer (the page viewer is not running, and the proof could not stand in on port $CFG_PORT_VIEWER)"
    else
      blocked "reach the page viewer (its switch is $state)" "$(reach "$CFG_PORT_VIEWER" /view/health)"
    fi
    stand_in_stop
    preview_check
  fi
  remove_shots_mark
  AS=""
}
researcher_checks
narrow_key_checks
builder_web_check
remove_test_key
echo; echo "The page viewer and the preview (the Builder, the Art director, the Checker)"
viewer_checks

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
  local homes="$STATE_DIR/claude-home" own other n
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
  rm -f "$own/.fence-proof"
  # What the program loads from its own home as settings or instructions (fence_plan.py,
  # HOME_CONFIG_NAMES) cannot be left there for the agent's next run: in any spelling, nor
  # moved or linked in whole from its temp folder. Its sessions and own state still write.
  clear_home_plants "$own"
  blocked "leave settings, skills, hooks or memory in its own Claude home for its next run" \
    "cd $own && { echo x > settings.json || echo x > Settings.json || echo x > ſettings.json || echo x > .config.json || echo x > remote-settings.json || mkdir -p skills/x || mkdir ſkills || mkdir agents || mkdir commands || mkdir rules || mkdir hooks || mkdir plugins || mkdir output-styles || echo x > CLAUDE.md || mkdir -p projects/-fence-proof/memory || { mkdir -p tmp/.fence-proof-carry/x && mv tmp/.fence-proof-carry skills; } || ln -s tmp skills; }"
  for n in settings.json .config.json remote-settings.json skills agents commands rules hooks plugins output-styles CLAUDE.md projects/-fence-proof/memory; do
    if [[ -e "$own/$n" || -L "$own/$n" ]]; then say FAIL "$WHO left $n in its own Claude home"; fi
  done
  clear_home_plants "$own"
  allowed "still keep its sessions and the program's own state in its own Claude home" \
    "cd $own && mkdir -p projects/-fence-proof session-env/fence-proof && echo x > projects/-fence-proof/s.jsonl && echo x > session-env/fence-proof/x && echo x > .fence-proof-state.json"
  clear_home_plants "$own"
  rm -f "$POLICY_FILE"
  rm -rf "${STATE_DIR:?}/claude-home/$OTHER_ID"
  AS=""
}
claude_home_checks

# The same for what Codex loads from its home (config.toml, which paperclip writes before
# a run, its instructions, skills, prompts, rules, hooks and memories): in a Codex home of
# the proof's own, in the engine's Codex home folder, made here and removed again.
echo; echo "The Codex homes (nothing left in one for the agent's next run)"
codex_home_checks() {
  local ph="$STATE_DIR/codex-home/_proof-plant" n
  RUN="$HERE/bin/codex"; WHO="the Codex agent"; AS=""
  rm -rf "$ph"
  mkdir -m 700 "$ph" || { say FAIL "could not make a Codex home for the proof"; return; }
  CODEX_HOME="$ph" blocked "leave settings, instructions, skills or memories in its own Codex home for its next run" \
    'cd "$CODEX_HOME" && { echo x > config.toml || echo x > Config.toml || echo x > config.toml.paperclip-backup || echo x > AGENTS.md || echo x > instructions.md || mkdir -p skills/x || mkdir -p skills/.system/x || mkdir ſkills || mkdir prompts || mkdir rules || mkdir plugins || mkdir memories || echo x > hooks.json || echo x > .env || echo x > .ENV || { mkdir -p tmp/.fence-proof-carry/x && mv tmp/.fence-proof-carry skills; }; }'
  for n in config.toml config.toml.paperclip-backup AGENTS.md instructions.md skills prompts rules plugins memories hooks.json .env .ENV; do
    if [[ -e "$ph/$n" || -L "$ph/$n" ]]; then say FAIL "$WHO left $n in its own Codex home"; fi
  done
  CODEX_HOME="$ph" allowed "still keep its sessions and the program's own state in its own Codex home" \
    'cd "$CODEX_HOME" && mkdir -p sessions/fence-proof && echo x > sessions/fence-proof/r.jsonl && echo x > state_9.sqlite'
  rm -rf "${ph:?}"
}
codex_home_checks

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

# Whoever put them there, no task folder may hold program settings that the next
# agent's program there would load (PLAN-V5, K2a's names, in any letter case, down to
# two folders below a task folder). Looked for from outside the fence, by name only:
# no file is opened, no link followed, and only how many is said.
echo; echo "The task folders (no program settings for another agent's program to load)"
settings_check() {
  local n
  # Names are compared as this disk might take them: NFKC and case folded, so a
  # long s (U+017F) or another look-alike that the disk folds is seen too.
  n="$(within 60 /usr/bin/python3 -I -c "import os,sys,unicodedata
names={'.claude','claude.md','claude.local.md','.mcp.json','agents.md','agents.override.md','.codex','.agents'}
def walk(d,depth):
    n=0
    for e in os.scandir(d):
        if unicodedata.normalize('NFKC',e.name).casefold() in names: n+=1
        if depth<3 and e.is_dir(follow_symlinks=False): n+=walk(e.path,depth+1)
    return n
print(walk(sys.argv[1],1))" "$STATE_DIR/tasks" 2>/dev/null)" || n=""
  if [[ ! "$n" =~ ^[0-9]+$ ]]; then say FAIL "the task folders could not all be looked through for program settings"
  elif (( n == 0 )); then say PASS "the task folders hold no program settings"
  else say FAIL "the task folders hold $n program settings (files or folders named like CLAUDE.md, .claude or AGENTS.md, in any letter case or look-alike)"; fi
}
settings_check

echo
RESULT="holds"
if (( fail )); then RESULT="failed"; elif (( skipped )); then RESULT="holds-with-todo"; fi
/usr/bin/python3 -I "$HERE/proof_record.py" "$LINES" "$STATE_DIR/proof/last.json" "$RESULT" \
  || echo "NOTE  the result could not be saved to $STATE_DIR/proof/last.json"
if (( fail )); then echo "RESULT: the fence FAILED"; exit 1; fi
if (( skipped )); then echo "RESULT: the fence holds; something is still to do (see SKIP lines)"; exit 2; fi
echo "RESULT: the fence holds and the agents work inside it"
exit 0
