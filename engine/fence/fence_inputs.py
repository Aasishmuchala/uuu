#!/usr/bin/env python3
"""Gathers the inputs of the fence planner for one run. Called by fence-run,
outside the fence, after fence-run has cleared every inherited FENCE_*, UUU_*
and ENGINE_CONFIG variable.

  fence_inputs.py --tool claude|codex --task-folder DIR --agent-home DIR
                  --inner-tmp DIR [--agent-id ID] [--read PATH]... [--write PATH]...

Prints three lines: the planner's inputs as one line of JSON, then the policy's
lessons file (or an empty line), then the policy's env file (or an empty line).
fence-run uses the last two only after the planner has accepted them.

Nothing here comes from the environment: the home folder is the one macOS has on
record for this user (not $HOME), and every port and path comes from
engine/config.json. The model mode comes from model_mode.py. A policy is found by the agent's id alone and must pass the
file checks of CONTRACTS section 4 before it is used. Exit 78 on any refusal.
"""
import json
import os
import pwd
import re
import stat
import sys

# fence-run starts this with python3 -I, which leaves even this script's own folder
# off the import path (and the agent's task folder, the current one, too): add it back.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_mode  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REFUSED_EXIT = 78
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
NO_POLICY = "no fence policy for this agent. Run: engine setup"


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
            "agentId": "", "read": [], "write": []}
    names = {"--tool": "tool", "--task-folder": "task", "--agent-home": "agentHome",
             "--inner-tmp": "innerTmp", "--agent-id": "agentId"}
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


def main(argv):
    opts = parse_args(argv)
    home = owner_home()
    cfg = load_engine_config(home)
    state = os.path.realpath(cfg["paths"]["state"])
    policy = None
    if opts["agentId"]:
        policy = read_policy(opts["agentId"], cfg["paths"]["policy"])
    fence = cfg["fence"]
    inputs = {
        "home": home,
        "uid": os.getuid(),
        "state": state,
        "taskFolder": opts["task"],
        "tool": opts["tool"],
        "agentHome": os.path.realpath(opts["agentHome"]),
        "innerTmp": os.path.realpath(opts["innerTmp"]),
        "nodeRoot": os.path.realpath(cfg["node24"]),
        "realClaudeDir": os.path.dirname(os.path.realpath(fence["realClaude"])),
        "instanceRoot": os.path.realpath(cfg["paperclip"]["instanceRoot"]),
        "gatePort": cfg["ports"]["gate"],
        "boardPort": cfg["ports"]["board"],
        # plans or provider; a models file that cannot be trusted refuses the run.
        "modelMode": model_mode.read_mode(cfg),
        "relayPort": cfg["ports"]["relay"],
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
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
