#!/usr/bin/env python3
"""Gathers the inputs of the fence planner for one run. Called by fence-run,
outside the fence, after fence-run has cleared every inherited FENCE_*, UUU_*
and ENGINE_CONFIG variable.

  fence_inputs.py --tool claude|codex --task-folder DIR --agent-home DIR
                  --inner-tmp DIR [--agent-id ID] [--task-id ID]
                  [--read PATH]... [--write PATH]...

Prints five lines: the planner's inputs as one line of JSON, then the policy's
lessons file (or an empty line), then the policy's env file (or an empty line),
then, for a walled agent only (PLAN-V5, K2d), the folder to work in (the one
folder of the goal the run's task belongs to, under tasks/research) and the
narrow gate's address (two empty lines for everyone else). fence-run uses the
last four only after the planner has accepted them.

A walled run's goal is not in the folder it was started in (paperclip starts
every run in one shared folder), so it is asked of the board itself: the run's
task id (--task-id, from PAPERCLIP_TASK_ID) is read at the board's own address
with the run's own key (PAPERCLIP_API_KEY, from the environment, never an
argument), the task must be assigned to this agent, and the parent links are
followed (at most four steps) to the top task, whose identifier names the
folder. Nothing an agent wrote decides it. Any failure refuses the run.

Nothing here comes from the environment: the home folder is the one macOS has on
record for this user (not $HOME), and every port and path comes from
engine/config.json. The model mode comes from model_mode.py, the doors this
run may reach from door_mode.py (the switches and the config's agent lists). A
policy is found by the agent's id alone and must pass the file checks of
CONTRACTS section 4 before it is used. Exit 78 on any refusal.
"""
import http.client
import json
import os
import pwd
import re
import signal
import stat
import sys
import threading

# fence-run starts this with python3 -I, which leaves even this script's own folder
# off the import path (and the agent's task folder, the current one, too): add it back.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_mode  # noqa: E402
import door_mode  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REFUSED_EXIT = 78
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
NO_POLICY = "no fence policy for this agent. Run: engine setup"
# A goal's identifier as the board makes it ("STH-12"), and nothing else.
IDENTIFIER = re.compile(r"[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}")
# The run's own key: printable, no spaces, so it cannot break out of a header line.
RUN_KEY = re.compile(r"[!-~]{1,4096}")
BOARD_SECONDS = 5          # for each question to the board
BOARD_ANSWER_CAP = 256 * 1024
MOST_STEPS_UP = 4          # parent links followed to the top task


def refuse(message):
    sys.stderr.write("fence: %s\n" % message)
    sys.exit(REFUSED_EXIT)


def owner_home():
    return os.path.realpath(pwd.getpwuid(os.getuid()).pw_dir)


def load_engine_config(home):
    # The loader expands "~" with $HOME. Point it at the real home folder first,
    # so a HOME handed in by whoever started us cannot move the state folder.
    os.environ["HOME"] = home
    os.environ.pop("ENGINE_CONFIG", None)
    sys.path.insert(0, os.path.join(os.path.dirname(HERE), "lib"))
    try:
        import config as engine_config
        return engine_config.load_config()
    except Exception as e:  # ConfigError, or a broken file
        refuse("the engine config could not be read (%s)" % e)


def safe_owned(path, what, want_file):
    """The file or folder must be ours, not a link, and not writable by others."""
    try:
        st = os.lstat(path)
    except OSError:
        return False
    if stat.S_ISLNK(st.st_mode):
        refuse("%s is a link; the fence only trusts a plain file. Run: engine setup" % what)
    if want_file and not stat.S_ISREG(st.st_mode):
        refuse("%s is not a plain file. Run: engine setup" % what)
    if not want_file and not stat.S_ISDIR(st.st_mode):
        refuse("%s is not a folder. Run: engine setup" % what)
    if st.st_uid != os.getuid() or st.st_mode & 0o022:
        refuse("%s can be changed by someone other than you, so it is not trusted. Run: engine setup" % what)
    return True


def read_policy(agent_id, policy_dir):
    if not UUID.match(agent_id):
        refuse(NO_POLICY)
    if not safe_owned(policy_dir, "the fence policy folder", False):
        refuse(NO_POLICY)
    path = os.path.join(policy_dir, agent_id + ".json")
    if not safe_owned(path, "the fence policy for this agent", True):
        refuse(NO_POLICY)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            policy = json.load(fh)
    except (OSError, ValueError):
        refuse(NO_POLICY)
    if not isinstance(policy, dict) or policy.get("agentId") != agent_id:
        refuse(NO_POLICY)
    return policy


def parse_args(argv):
    opts = {"tool": None, "task": None, "agentHome": None, "innerTmp": None,
            "agentId": "", "taskId": "", "read": [], "write": []}
    names = {"--tool": "tool", "--task-folder": "task", "--agent-home": "agentHome",
             "--inner-tmp": "innerTmp", "--agent-id": "agentId", "--task-id": "taskId"}
    i = 0
    while i < len(argv):
        flag = argv[i]
        if i + 1 >= len(argv):
            refuse("fence_inputs.py: %s needs a value" % flag)
        value = argv[i + 1]
        if flag in names:
            opts[names[flag]] = value
        elif flag == "--read":
            opts["read"].append(value)
        elif flag == "--write":
            opts["write"].append(value)
        else:
            refuse("fence_inputs.py: unknown option %s" % flag)
        i += 2
    for key in ("tool", "task", "agentHome", "innerTmp"):
        if not opts[key]:
            refuse("fence_inputs.py: missing %s" % key)
    return opts


def _board_get(port, path, key):
    """GET path at the board's own address with the run's key as the bearer token:
    5 seconds in all, no redirect followed, at most BOARD_ANSWER_CAP bytes. Returns
    the parsed JSON object, or None for any failure. The key is only ever put in
    the request's header; no message made here holds it."""
    conn = None
    use_alarm = threading.current_thread() is threading.main_thread() and hasattr(signal, "setitimer")

    def too_slow(signum, frame):
        raise TimeoutError("too slow")

    old = None
    try:
        if use_alarm:   # a hard stop, so an answer dripped slowly cannot stretch the limit
            old = signal.signal(signal.SIGALRM, too_slow)
            signal.setitimer(signal.ITIMER_REAL, BOARD_SECONDS)
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=BOARD_SECONDS)
        conn.request("GET", path, headers={"Authorization": "Bearer " + key, "Accept": "application/json",
                                           "Connection": "close"})
        resp = conn.getresponse()
        if resp.status != 200:
            return None
        declared = resp.getheader("Content-Length")
        if declared is not None and (not declared.isdigit() or int(declared) > BOARD_ANSWER_CAP):
            return None
        body = resp.read(BOARD_ANSWER_CAP + 1)
        if len(body) > BOARD_ANSWER_CAP:
            return None
        doc = json.loads(body.decode("utf-8"))
        return doc if isinstance(doc, dict) else None
    except (OSError, ValueError, http.client.HTTPException, TimeoutError):
        return None
    finally:
        if use_alarm:
            signal.setitimer(signal.ITIMER_REAL, 0)
            if old is not None:
                signal.signal(signal.SIGALRM, old)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def goal_identifier(task_id, agent_id, key, port):
    """The identifier of the goal (the top task) of the run's task, from the board.
    Refuses (exit 78) on anything that is not exactly right: no task id, no key, a
    task that is not this agent's, a loop, more than four steps up, an answer that
    is late, large, not 200 or about another task, or an identifier of the wrong
    shape. Never widens."""
    if not task_id or not UUID.match(task_id):
        refuse("a walled agent's run must name its task, and this run named none the fence can use")
    if not RUN_KEY.fullmatch(key or ""):
        refuse("a walled agent's run must carry its own key to the board, and this run has none the fence can use")
    seen = {task_id}
    current, steps = task_id, 0
    while True:
        doc = _board_get(port, "/api/issues/" + current, key)
        if doc is None:
            refuse("the board did not confirm this run's task in time, so the Researcher's folder cannot be chosen")
        if doc.get("id") != current:
            refuse("the board's answer was not about this run's task")
        if current == task_id and doc.get("assigneeAgentId") != agent_id:
            refuse("this run's task is not assigned to this agent")
        parent = doc.get("parentId")
        if parent is None:
            ident = doc.get("identifier")
            if not isinstance(ident, str) or not IDENTIFIER.fullmatch(ident):
                refuse("the goal of this run's task has no usable identifier")
            return ident
        if not isinstance(parent, str) or not UUID.match(parent):
            refuse("this run's task has a parent the fence cannot use")
        if parent in seen:
            refuse("this run's task has parents that lead back to themselves")
        steps += 1
        if steps > MOST_STEPS_UP:
            refuse("this run's task is more than four steps below its goal")
        seen.add(parent)
        current = parent


def main(argv):
    opts = parse_args(argv)
    home = owner_home()
    cfg = load_engine_config(home)
    state = os.path.realpath(cfg["paths"]["state"])
    policy = None
    if opts["agentId"]:
        policy = read_policy(opts["agentId"], cfg["paths"]["policy"])
    fence = cfg["fence"]
    ports = cfg["ports"]
    # A walled agent works in its goal's folder under the Researcher's folder
    # whatever folder it was started in, and reaches the board only through the
    # narrow gate. The goal comes from the board, never from the run's words.
    walled = policy is not None and policy.get("walled") is True
    work_folder = ""
    if walled:
        goal = goal_identifier(opts["taskId"], opts["agentId"], os.environ.get("PAPERCLIP_API_KEY", ""),
                               ports["board"])
        work_folder = os.path.join(state, "tasks", "research", goal)
    inputs = {
        "home": home,
        "uid": os.getuid(),
        "state": state,
        "taskFolder": work_folder or opts["task"],
        "tool": opts["tool"],
        "agentHome": os.path.realpath(opts["agentHome"]),
        "innerTmp": os.path.realpath(opts["innerTmp"]),
        "nodeRoot": os.path.realpath(cfg["node24"]),
        "realClaudeDir": os.path.dirname(os.path.realpath(fence["realClaude"])),
        "instanceRoot": os.path.realpath(cfg["paperclip"]["instanceRoot"]),
        "gatePort": ports["gateNarrow"] if walled else ports["gate"],
        "boardPort": ports["board"],
        # plans or provider; a models file that cannot be trusted refuses the run.
        "modelMode": model_mode.read_mode(cfg),
        "relayPort": ports["relay"],
        "narrowGatePort": ports["gateNarrow"],
        # The doors that are on and list this agent; [] without an agent id.
        "doorPorts": door_mode.doors_for(cfg, opts["agentId"]),
        "doorPortsKnown": [ports[k] for k in ("gateNarrow", "web", "generate", "viewer", "preview")],
        # Not resolved: the Codex login chain needs each link itself to be readable.
        "extraRead": [os.path.normpath(os.path.abspath(p)) for p in opts["read"]],
        "extraWrite": [os.path.normpath(os.path.abspath(p)) for p in opts["write"]],
        "policy": policy,
        "config": {k: fence[k] for k in ("policyPortsAllowed", "readRootsAllowed",
                                         "claudeHosts", "codexHosts")},
    }
    lessons = env_file = ""
    if policy is not None:
        lessons = policy.get("lessonsFile") or ""
        env_file = policy.get("envFile") or ""
    for value in (lessons, env_file):
        if not isinstance(value, str) or "\n" in value or "\r" in value:
            refuse("policy for agent %s: a file path in it is malformed" % policy.get("slug"))
    print(json.dumps(inputs, separators=(",", ":")))
    print(lessons)
    print(env_file)
    print(work_folder)
    print(cfg["urls"]["gateNarrow"] if walled else "")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
