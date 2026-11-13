#!/usr/bin/env python3
"""Works out the fence for one run.

plan(inputs) is a pure function: it reads no environment variable and writes no
file. It only looks at the file system to resolve links and to see which
folders exist. Anything it does not like raises Refused, so the run never starts.

Run as a script (by fence-run, outside the fence) it reads the inputs as one JSON
document on stdin, writes the settings for the sandbox tool to
<state>/fences/<first 20 hex of the content's SHA-256>.json and prints that path.
On Refused it prints `fence: <message>` to stderr and exits 78.

Kept in its own file because bash 3.2 (the macOS one) miscounts quotes in a
heredoc inside "$( )". Standard library only (runs on /usr/bin/python3, 3.9).
"""
import hashlib
import json
import os
import re
import sys

REFUSED_EXIT = 78
TOOLS = ("claude", "codex")
# plans: the Claude and Codex plans, through their own hosts. provider: every
# model call goes through the model relay on 127.0.0.1, and no model host is
# reachable at all (PLAN-V4, C5).
MODEL_MODES = ("plans", "provider")
POLICY_KEYS = ("agentId", "slug", "localServices", "readFolders", "lessonsFile",
               "envFile", "taskFolder")
# The one key a policy may carry beyond those (PLAN-V5, K2d): a walled agent.
POLICY_OPTIONAL_KEYS = ("walled",)
# Names the Claude program and Codex load as settings, instructions, skills or
# hooks from the folder they work in (PLAN-V5, K2a, as the T1 prototype found
# them). No run may write one anywhere it can write, so nothing is left there
# for another agent's program, or its own next run, to load.
CONFIG_NAMES = (".claude", "CLAUDE.md", "CLAUDE.local.md", ".mcp.json", "AGENTS.md",
                "AGENTS.override.md", ".codex", ".agents")
# Names each program loads from its own home (CLAUDE_CONFIG_DIR, CODEX_HOME) as
# settings, instructions, skills, hooks or servers, and never writes there itself
# in a run: a run that left one there would steer every later run of that agent
# (the second look at the review of step 2). Read from the installed programs:
# Claude Code 2.1.268 (its own sandbox keeps its commands from writing these) and
# Codex 0.156.1 with paperclip's Codex adapter around it. Denied at the top of the
# agent home only, which is where the programs read them; a folder of such a name
# deeper down (a git hooks folder in the temp folder) is nothing to them and must
# still write. The names of CONFIG_NAMES are denied there too, at any depth.
# What the programs do write stays open: Claude's .claude.json, projects/
# (sessions), sessions/, session-env/, shell-snapshots/, file-history/, backups/,
# todos/, plans/, debug/, statsig/, policy-limits.json, .last-cleanup; Codex's
# sessions/, its .sqlite files, cache/, models_cache.json, installation_id,
# shell_snapshots/, log/; and the temp folder. The MCP servers .claude.json could
# name are switched off by the Claude wrapper (--strict-mcp-config).
HOME_CONFIG_NAMES = {
    "claude": (
        # Settings: hooks, environment, commands that fetch a key, plugins. The
        # legacy .config.json is read instead of .claude.json when it is there;
        # remote-settings.json is the cache of managed settings, the top layer.
        "settings.json", "settings.local.json", ".config.json", "remote-settings.json",
        # Instructions and extensions of the program's user, and memory read into
        # every later run (auto memory is kept per working folder under projects/).
        "skills", "agents", "commands", "output-styles", "rules", "workflows", "routines",
        "hooks", "plugins", "cowork_plugins", "mcp-skill-archives", "agent-memory",
        "projects/*/memory",
        # Prompts and commands the program runs by itself, an install of its own,
        # and the files that tell it which local editor server to connect to.
        "scheduled_tasks.json", "launch.json", "loop.md", "daemon.json", "daemon", "jobs",
        "local", "ide"),
    "codex": (
        # Settings (paperclip writes config.toml before a run, outside the fence, and
        # puts the .paperclip-backup copy back as config.toml if a run is cut short).
        "config.toml", "config.toml.paperclip-backup", "config.json", "managed_config.toml",
        "requirements.toml",
        # Instructions, skills, plugins, hooks, rules for commands, and memories.
        "instructions.md", "prompts", "skills", "plugins", "hooks", "hooks.json", "rules",
        "memories", "agents",
        # Read into the program's own environment at every start (all but CODEX_*):
        # a planted BASH_ENV or PATH would steer every later run (review of step 3).
        ".env"),
}
# The board's id of an agent.
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# The sandbox tool's own temp folder. Every profile it builds allows writes
# under it (and so its creation), outside every root the planner knows; a
# folder of program settings built there could be moved or linked into a task
# folder whole. Closed for every run, for reading and for writing; fence-run
# gives the command a temp folder of its own (review of step 1).
SANDBOX_OWN_TMP = ["/private/tmp/claude", "/tmp/claude"]
# The system's temp areas, where other runs keep their temp folders: a walled
# run may not read them (its own temp folder is opened again by allowRead).
TEMP_AREAS = ["/private/var/folders", "/var/folders", "/private/tmp", "/tmp"]
# The engine folder: two levels above this file, never taken from the inputs.
ENGINE = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
PATH_INPUTS = ("home", "state", "taskFolder", "agentHome", "innerTmp", "nodeRoot",
               "realClaudeDir", "instanceRoot")


# A goal's folder name, as the board makes a goal's identifier (PLAN-V5, K10).
GOAL = re.compile(r"[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}")


class Refused(Exception):
    pass


def _same(a, b):
    """The disk ignores letter case, so every comparison of paths does too."""
    return a.casefold() == b.casefold()


def _inside(path, root):
    """True when path is root or lies under it, in any letter case. Both must be
    normalised absolute paths."""
    path, root = path.casefold(), root.casefold().rstrip("/") or "/"
    if root == "/":
        return True
    return path == root or path.startswith(root + "/")


def _strictly_inside(path, root):
    return not _same(path, root) and _inside(path, root)


def _real(path):
    return os.path.realpath(path)


def _check_text(name, value):
    if not isinstance(value, str) or not value:
        raise Refused("the fence was given no %s" % name)
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise Refused("the fence was given a %s with a control character in it" % name)
    return value


def _check_abs(name, value):
    _check_text(name, value)
    if not os.path.isabs(value):
        raise Refused("the fence was given a %s that is not an absolute path" % name)
    return os.path.normpath(value)


def _dedupe(items):
    out = []
    for item in items:
        if item not in out:
            out.append(item)
    return out


# Characters other than its two cases that this disk folds onto a letter (the
# review of step 1; .router/prototypes/v5/p1/fold-probe.py tried every code
# point and found these two only). A [Ss] set does not match them, so each is
# spelt out as a literal of its own.
DISK_FOLDS = {"s": ["\u017f"], "k": ["\u212a"]}    # LONG S, KELVIN SIGN


def _any_case(name):
    """Every spelling the disk takes for name, as glob patterns: each letter as a
    two-letter set ([Cc]), because the disk ignores letter case, and once more
    for every combination of the characters of DISK_FOLDS, each kept outside
    any set. The first is the plain letter-set form."""
    spellings = [""]
    for c in name:
        options = ["[%s%s]" % (c.upper(), c.lower())] if c.isalpha() else [c]
        options += DISK_FOLDS.get(c.lower(), [])
        spellings = [s + o for s in spellings for o in options]
    return spellings


def _deny_entries(roots):
    """Four entries per spelling of each name for each root a run can write: the
    name at the top, inside it, at any depth, and inside it at any depth. All
    three writable roots (task folder, agent home, temp folder) need them: a
    folder built in one and moved whole into another keeps what it holds (T1:
    only its own name is checked)."""
    out = []
    for root in roots:
        for name in CONFIG_NAMES:
            for n in _any_case(name):
                out += ["%s/%s" % (root, n), "%s/%s/**" % (root, n),
                        "%s/**/%s" % (root, n), "%s/**/%s/**" % (root, n)]
    return out


def _home_deny_entries(roots, names):
    """Two entries per spelling of each name a program loads from its own home, at
    the top of the agent home (as given and as resolved): the name, and inside it.
    Same spellings as _deny_entries: letter sets and the disk's folds."""
    out = []
    for root in roots:
        for name in names:
            for n in _any_case(name):
                out += ["%s/%s" % (root, n), "%s/%s/**" % (root, n)]
    return out


def _port(value):
    """A whole number 1 to 65535 (not a bool), else None."""
    if isinstance(value, int) and not isinstance(value, bool) and 0 < value < 65536:
        return value
    return None


def _rule_folder(path):
    """A folder given by rule (PLAN-V5, K2f) is shared only when it is a plain
    folder whose real path is itself: never a link, never through one."""
    try:
        if os.path.islink(path) or not os.path.isdir(path):
            return None
    except OSError:
        return None
    return path if _real(path) == path else None


def _check_reach(name, path, home, state, instance_root, guarded, protected_files):
    """A path the wrappers hand over (agent home, temp folder, extra read or write)
    may never open up the folders the fence protects."""
    if path == "/":
        raise Refused("refusing to share %s with an agent: it is the whole disk" % name)
    for top in (home, state, instance_root):
        if _inside(top, path):
            raise Refused("refusing to share %s with an agent: it holds folders the fence protects (%s)"
                          % (name, path))
    for root in guarded:
        if _inside(path, root):
            raise Refused("refusing to share %s with an agent: it is inside %s" % (name, root))
    for f in protected_files:
        if _same(path, f):
            raise Refused("refusing to share %s with an agent: it is %s" % (name, f))
    # Inside paperclip's folder only its skills and company folders are ever shared,
    # never its database, its private settings file, its logs or other workspaces.
    for root in _dedupe([instance_root, _real(instance_root)]):
        if _inside(path, root) and not any(
                _strictly_inside(path, os.path.join(root, sub)) for sub in ("skills", "companies")):
            raise Refused("refusing to share %s with an agent: it is inside paperclip's own folders (%s)"
                          % (name, path))


def _check_place(kind, name, path, home, state, instance_root, agent_home):
    """Where each kind of handed-over path may lie at all (the backstop behind the
    wrappers). Called on the path as given and as resolved; both must pass.
    In the state folder only the two agent-home trees are ever handed over."""
    roots = _dedupe([instance_root, _real(instance_root)])
    homes = [os.path.join(s, h) for s in _dedupe([state, _real(state)]) for h in ("claude-home", "codex-home")]
    in_state = _inside(path, state) or _inside(path, _real(state))
    is_or_in_homes = any(_inside(path, h) for h in homes)
    in_homes = any(_strictly_inside(path, h) for h in homes)
    in_companies = any(_strictly_inside(path, os.path.join(r, "companies")) for r in roots)
    in_skills = any(_strictly_inside(path, os.path.join(r, "skills")) for r in roots)
    in_home = _inside(path, home) or _inside(path, _real(home))
    codex_login = any(_same(path, os.path.join(h, ".codex", "auth.json")) for h in _dedupe([home, _real(home)]))
    if kind == "agentHome":
        if not (is_or_in_homes or in_companies):
            raise Refused("refusing to share %s with an agent: an agent home must lie in the engine's "
                          "claude-home or codex-home or in a paperclip company folder (%s)" % (name, path))
    elif kind == "innerTmp":
        in_agent_home = _inside(path, agent_home) or _inside(path, _real(agent_home))
        run_tmp = not in_home and not in_state and os.path.basename(path).startswith("paperclip-run-")
        if not (in_agent_home or in_homes or run_tmp):
            raise Refused("refusing to share %s with an agent: a temp folder must lie in the agent home, "
                          "the engine's claude-home or codex-home, or be paperclip's own run folder (%s)"
                          % (name, path))
    elif kind == "write":
        if not (in_homes or in_companies or codex_login):
            raise Refused("refusing to share %s with an agent for writing: it is not a place agents may "
                          "write (%s)" % (name, path))
    elif kind == "read" and (in_home or in_state):
        engine_ok = _inside(path, os.path.join(ENGINE, "node_modules", "@openai")) \
            or _same(path, os.path.join(ENGINE, "fence", "steady-pipes.py"))
        if not (in_homes or in_companies or in_skills or codex_login or engine_ok):
            raise Refused("refusing to share %s with an agent: it is in the home or state folder, outside "
                          "the places agents may read (%s)" % (name, path))


def _check_policy(policy, state, config, board_port, relay_port=None, door_ports_known=()):
    """Checks one fence policy (CONTRACTS section 4) and returns what it adds."""
    if not isinstance(policy, dict):
        raise Refused("the fence policy is not a JSON object")
    slug = policy.get("slug")
    if not isinstance(slug, str) or not re.match(r"^[a-z0-9][a-z0-9-]{0,62}$", slug):
        raise Refused("policy for agent (no readable name): the slug is missing or malformed")

    def bad(what):
        return Refused("policy for agent %s: %s" % (slug, what))

    for key in POLICY_KEYS:
        if key not in policy:
            raise bad("the key %s is missing" % key)
    for key in policy:
        if key not in POLICY_KEYS + POLICY_OPTIONAL_KEYS:
            raise bad("the key %s is not one the fence knows" % key)
    if not isinstance(policy["agentId"], str) or not policy["agentId"]:
        raise bad("agentId is missing")
    walled = policy.get("walled", False)
    if not isinstance(walled, bool):
        raise bad("walled must be true or false")

    # Local services: only 127.0.0.1 and only the ports the engine allows.
    allowed_ports = set()
    for p in config["policyPortsAllowed"]:
        if not isinstance(p, int) or isinstance(p, bool):
            raise bad("the engine config lists a port that is not a number")
        allowed_ports.add(p)
    services = policy["localServices"]
    if not isinstance(services, list):
        raise bad("localServices must be a list")
    domains = []
    for entry in services:
        # The whole string, in its one plain spelling: no leading zero, no trailing newline.
        m = re.fullmatch(r"127\.0\.0\.1:([1-9][0-9]{0,4})", entry) if isinstance(entry, str) else None
        if not m:
            raise bad("localServices may only name 127.0.0.1:<port>, not %r" % (entry,))
        port = int(m.group(1))
        if board_port is not None and port == board_port:
            raise bad("localServices may never name the board's port %d" % port)
        if relay_port is not None and port == relay_port:
            raise bad("localServices may never name the model relay's port %d" % port)
        if port in door_ports_known:
            raise bad("localServices may never name a door's port %d" % port)
        if port not in allowed_ports:
            raise bad("localServices names port %d, which the engine does not allow" % port)
        domains.append(entry)

    # Read-only folders: each must lie inside one of the allowed roots in state.
    roots = []
    for r in config["readRootsAllowed"]:
        if not isinstance(r, str) or not r or os.path.isabs(r) or ".." in r.split("/"):
            raise bad("the engine config lists a read root that is not a plain folder in state")
        roots.append(os.path.normpath(os.path.join(state, r)))
    folders = policy["readFolders"]
    if not isinstance(folders, list):
        raise bad("readFolders must be a list")
    reads = []
    for entry in folders:
        if not isinstance(entry, str) or not os.path.isabs(entry) \
                or any(ord(c) < 32 for c in entry):
            raise bad("readFolders may only hold absolute folders, not %r" % (entry,))
        lexical = os.path.normpath(entry)
        if not any(_inside(lexical, r) for r in roots):
            raise bad("the folder %s is outside the folders agents may read" % entry)
        if not os.path.lexists(lexical):
            continue    # not made yet: skipped
        real = _real(lexical)
        if not any(_inside(real, r) for r in roots):
            raise bad("the folder %s leads outside the folders agents may read" % entry)
        if not os.path.isdir(real):
            raise bad("%s is not a folder" % entry)
        reads.append(real)

    def one_file(key, parent):
        value = policy[key]
        if value is None:
            return None
        if not isinstance(value, str) or not os.path.isabs(value) \
                or any(ord(c) < 32 for c in value):
            raise bad("%s must be an absolute file path or null" % key)
        lexical = os.path.normpath(value)
        if not _same(os.path.dirname(lexical), parent) or os.path.basename(lexical) in ("", ".", ".."):
            raise bad("%s must be directly inside %s" % (key, parent))
        if os.path.lexists(lexical):
            if not _same(os.path.dirname(_real(lexical)), parent):
                raise bad("%s leads outside %s" % (key, parent))
            if not os.path.isfile(lexical):
                raise bad("%s is not a plain file" % key)
        return lexical

    lessons = one_file("lessonsFile", os.path.join(state, "lessons"))
    one_file("envFile", os.path.join(state, "secrets", "agents"))

    task_mode = policy["taskFolder"]
    if task_mode not in ("read-write", "read-only"):
        raise bad("taskFolder must be read-write or read-only")
    # A walled agent (PLAN-V5, K2d) gets nothing of the company through its policy.
    if walled:
        if services:
            raise bad("a walled agent may reach no local service")
        if folders:
            raise bad("a walled agent may read no folder of the company")
        if policy["lessonsFile"] is not None:
            raise bad("a walled agent has no lessons file")
        if policy["envFile"] is not None:
            raise bad("a walled agent has no key file")
        if task_mode != "read-write":
            raise bad("a walled agent's task folder is read-write")
    return {"domains": domains, "reads": reads, "lessons": lessons,
            "taskReadOnly": task_mode == "read-only", "walled": walled}


def plan(inputs):
    """Returns the sandbox settings for one run, or raises Refused."""
    if not isinstance(inputs, dict):
        raise Refused("the fence was given no inputs")
    for key in PATH_INPUTS + ("uid", "tool", "gatePort", "extraRead", "extraWrite",
                              "policy", "config"):
        if key not in inputs:
            raise Refused("the fence was given incomplete inputs (no %s)" % key)
    home = _check_abs("home folder", inputs["home"])
    state = _check_abs("state folder", inputs["state"])
    agent_home = _check_abs("agent home", inputs["agentHome"])
    inner_tmp = _check_abs("temp folder", inputs["innerTmp"])
    node_root = _check_abs("Node folder", inputs["nodeRoot"])
    claude_dir = _check_abs("Claude Code folder", inputs["realClaudeDir"])
    instance_root = _check_abs("paperclip folder", inputs["instanceRoot"])
    task_given = _check_abs("working folder", inputs["taskFolder"])
    uid = inputs["uid"]
    if not isinstance(uid, int) or isinstance(uid, bool) or uid < 0:
        raise Refused("the fence was given no user id")
    tool = inputs["tool"]
    if tool not in TOOLS:
        raise Refused("the fence does not know the tool %r" % (tool,))
    gate_port = inputs["gatePort"]
    if not isinstance(gate_port, int) or isinstance(gate_port, bool) or not 0 < gate_port < 65536:
        raise Refused("the fence was given no gate port")
    board_port = inputs.get("boardPort")
    if board_port is not None and (not isinstance(board_port, int) or isinstance(board_port, bool)):
        raise Refused("the fence was given a board port that is not a number")
    if board_port is not None and board_port == gate_port:
        raise Refused("the gate and the board cannot share a port")
    config = inputs["config"]
    if not isinstance(config, dict):
        raise Refused("the fence was given no config")
    for key in ("policyPortsAllowed", "readRootsAllowed", "claudeHosts", "codexHosts"):
        if not isinstance(config.get(key), list):
            raise Refused("the fence config has no %s list" % key)
    hosts = config["claudeHosts"] if tool == "claude" else config["codexHosts"]
    for h in hosts:
        if not isinstance(h, str) or not re.match(r"^[a-z0-9.-]+$", h) or h in ("localhost",) \
                or re.match(r"^[0-9.]+$", h):
            raise Refused("the fence config lists a model host that is not a plain host name")
    # No model mode given means plans, today's fence.
    model_mode = inputs.get("modelMode", "plans")
    if not isinstance(model_mode, str) or model_mode not in MODEL_MODES:
        raise Refused("the fence was given a model mode it does not know")
    relay_port = inputs.get("relayPort")
    relay_ok = isinstance(relay_port, int) and not isinstance(relay_port, bool) \
        and 0 < relay_port < 65536 and relay_port != gate_port and relay_port != board_port
    if model_mode == "provider" and not relay_ok:
        raise Refused("the fence was given no usable port for the model relay")
    # In provider mode the relay's port must be known not to be the board's, so
    # the board's port has to be given: an unknown port is not a different one.
    if model_mode == "provider" and board_port is None:
        raise Refused("the fence was given no board port, so the model relay cannot be told from the board")
    extra_read, extra_write = [], []
    for key, out in (("extraRead", extra_read), ("extraWrite", extra_write)):
        if not isinstance(inputs[key], list):
            raise Refused("the fence was given %s that is not a list" % key)
        for p in inputs[key]:
            out.append(_check_abs("extra path", p))

    # The narrow gate (PLAN-V5, K2d): a walled agent's only way to the board.
    narrow_port = inputs.get("narrowGatePort")
    if narrow_port is not None and (_port(narrow_port) is None or narrow_port in (board_port, relay_port)):
        raise Refused("the fence was given a narrow gate port it cannot use")
    # Doors (PLAN-V5, K2c). A missing key is no door. doorPortsKnown is every new
    # port (the narrow gate's too): no policy may name one; doorPorts are the
    # doors this run may reach, each one of them, never the gate, board or relay.
    door_ports_known, door_ports = [], []
    for key, out in (("doorPortsKnown", door_ports_known), ("doorPorts", door_ports)):
        given = inputs.get(key, [])
        if not isinstance(given, list):
            raise Refused("the fence was given %s that is not a list" % key)
        for p in given:
            if _port(p) is None:
                raise Refused("the fence was given a door port it cannot use (%r)" % (p,))
            out.append(p)
    for p in door_ports:
        if p in (gate_port, board_port, relay_port, narrow_port) or p not in door_ports_known:
            raise Refused("the fence was given a door port it cannot use (%d)" % p)
    if door_ports and inputs["policy"] is None:
        raise Refused("a door can only be opened for an agent with a fence policy")

    deny = [home, "/private/tmp/claude-%d" % uid, "/tmp/claude-%d" % uid] + SANDBOX_OWN_TMP

    # The task folder: only inside the engine's own task tree or paperclip's two
    # trees (a default folder per agent, a folder per task). Never the root of a
    # tree, and never anything else, inside the home folder or out of it.
    task = _real(task_given)
    trees = [os.path.join(state, "tasks"), os.path.join(instance_root, "workspaces"),
             os.path.join(instance_root, "isolated-workspaces")]
    trees = [_real(t) for t in trees]
    if not any(_strictly_inside(task, t) for t in trees):
        raise Refused("refusing to run in %s: it is not an agent task folder" % task)
    for d in deny + [state, instance_root]:
        if _inside(_real(d), task) or _inside(d, task):
            raise Refused("refusing to run in %s: it holds folders the fence protects" % task)

    # Paths the wrappers hand over must not open up what the fence protects.
    guarded = [os.path.join(state, "secrets"), os.path.join(state, "policy"),
               os.path.join(state, "fences"), os.path.join(state, "proof"),
               os.path.join(state, "models"), os.path.join(state, "doors"),
               os.path.join(instance_root, "secrets"),
               "/private/tmp/claude-%d" % uid, "/tmp/claude-%d" % uid]
    protected_files = [os.path.join(state, "agent.env")]
    for kind, name, p in [("agentHome", "the agent home", agent_home), ("innerTmp", "the temp folder", inner_tmp)] + \
            [("read", "an extra folder", p) for p in extra_read] + \
            [("write", "an extra folder", p) for p in extra_write]:
        _check_reach(name, p, home, state, instance_root, guarded, protected_files)
        _check_place(kind, name, p, home, state, instance_root, agent_home)
        if _real(p) != p:
            _check_reach(name, _real(p), home, state, instance_root, guarded, protected_files)
            _check_place(kind, name, _real(p), home, state, instance_root, agent_home)

    extras = {"domains": [], "reads": [], "lessons": None, "taskReadOnly": False, "walled": False}
    if inputs["policy"] is not None:
        extras = _check_policy(inputs["policy"], state, config, board_port,
                               relay_port if relay_ok else None, door_ports_known)

    # The Researcher's folder: a walled agent works there and nowhere else; no
    # other agent ever writes in it (they may read it, below).
    real_state = _real(state)
    research = os.path.join(real_state, "tasks", "research")
    if extras["walled"]:
        # Exactly one goal's folder directly under the Researcher's folder, named as
        # the board names a goal (capital letters, so no other letter case), as given
        # (no "..", no link anywhere in it) and as it really is.
        goal = os.path.basename(task_given)
        ok = (GOAL.fullmatch(goal) is not None
              and task_given == inputs["taskFolder"]
              and _same(os.path.dirname(task_given), research)
              and _same(_real(research), research)
              and task == _real(task_given) and task_given == task
              and not os.path.islink(task_given))
        if not ok:
            raise Refused("refusing to run a walled agent in %s: it works only in one goal's folder directly under %s"
                          % (task, research))
        if narrow_port is None or gate_port != narrow_port:
            raise Refused("a walled agent reaches the board only through the narrow gate")
        # One Claude home per goal (the second look at the review of step 2): what a
        # run of one goal leaves in its home (its sessions, the program's own state) is
        # never read by a run of another goal. Exactly <state>/claude-home/<agent
        # id>/<goal>, as given and as it really is; its temp folder lies in it, or is
        # paperclip's own folder for the run. Codex's home is paperclip's, one per
        # agent, so a walled agent runs only on the Claude program.
        if tool != "claude":
            raise Refused("a walled agent runs only on the Claude program, whose home the fence keeps one per goal")
        agent_id = inputs["policy"]["agentId"]
        want = os.path.join(real_state, "claude-home", agent_id, goal)
        if not (UUID.fullmatch(agent_id) and agent_home == want and _real(agent_home) == agent_home
                and not os.path.islink(agent_home)):
            raise Refused("refusing to run a walled agent with the home %s: its home is its goal's own (%s)"
                          % (agent_home, want))
        in_own_home = _strictly_inside(inner_tmp, agent_home) and _strictly_inside(_real(inner_tmp), agent_home)
        run_tmp = all(os.path.basename(p).startswith("paperclip-run-") and not _inside(p, home)
                      and not _inside(p, state) and not _inside(p, real_state) for p in (inner_tmp, _real(inner_tmp)))
        if not (in_own_home or run_tmp):
            raise Refused("refusing to run a walled agent with the temp folder %s: it lies neither in its goal's "
                          "own home nor in paperclip's folder for the run" % inner_tmp)
        deny = deny + TEMP_AREAS
    else:
        if narrow_port is not None and gate_port == narrow_port:
            raise Refused("only a walled agent goes through the narrow gate")
        for r in _dedupe([research, os.path.join(state, "tasks", "research")]):
            if _inside(task, r) or _inside(task_given, r):
                raise Refused("refusing to run in %s: it is the Researcher's folder" % task)

    # Folders by rule, not by policy (PLAN-V5, K2f): read-only, only for a run
    # with a policy, only when each is a plain folder whose real path is itself.
    rule_reads = []
    if inputs["policy"] is not None:
        names = [("playbooks",)] + ([("knowledge", "shared")] if extras["walled"] else [("tasks", "research")])
        for parts in names:
            p = _rule_folder(os.path.join(real_state, *parts))
            if p:
                rule_reads.append(p)

    read = [task, agent_home, inner_tmp, node_root, os.path.join(home, ".local", "bin"),
            claude_dir] + extra_read + extra_write + extras["reads"] + rule_reads
    write = [agent_home, inner_tmp] + extra_write
    if not extras["taskReadOnly"]:
        write = [task] + write
    if extras["lessons"]:
        read.append(extras["lessons"])
        write.append(extras["lessons"])
    write = _dedupe(write)
    # Every root a run can write, as given and as resolved, the task folder even
    # when it is read-only (K2a, widened by T1 to the home and the temp folder).
    deny_roots = _dedupe([r for w in [task] + write for r in (w, _real(w))])
    # And the agent home's own names, for the tool that loads them from there.
    home_deny = _home_deny_entries(_dedupe([agent_home, _real(agent_home)]), HOME_CONFIG_NAMES[tool])
    domains = ["127.0.0.1:%d" % gate_port, "localhost:%d" % gate_port]
    if model_mode == "provider":
        # The relay holds the key; the agent reaches no model host itself.
        domains = domains + ["127.0.0.1:%d" % relay_port, "localhost:%d" % relay_port]
    else:
        domains = list(hosts) + domains
    # Doors in their one spelling, after the gate and before the policy's services.
    domains = domains + ["127.0.0.1:%d" % p for p in door_ports] + extras["domains"]
    return {
        "filesystem": {"denyRead": deny, "allowRead": _dedupe(read),
                       "allowWrite": write,
                       "denyWrite": SANDBOX_OWN_TMP + _deny_entries(deny_roots) + home_deny},
        "network": {"allowedDomains": _dedupe(domains), "deniedDomains": []},
    }


def write_settings(settings, state):
    """Writes the settings, named after their own content, so two different fences
    (Claude and Codex, say) never overwrite each other's rules. A file that is
    already there is used only when its content is exactly the same."""
    text = json.dumps(settings, indent=1)
    folder = os.path.join(state, "fences")
    os.makedirs(folder, exist_ok=True)
    out = os.path.join(folder, hashlib.sha256(text.encode()).hexdigest()[:20] + ".json")
    try:
        with open(out, "r", encoding="utf-8") as fh:
            same = fh.read() == text and not os.path.islink(out)
    except OSError:
        same = False
    if not same:
        tmp = "%s.%d.tmp" % (out, os.getpid())
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, 0o644)
        os.replace(tmp, out)
    return out


def main():
    try:
        try:
            inputs = json.load(sys.stdin)
        except ValueError:
            raise Refused("the fence was given inputs that are not JSON")
        settings = plan(inputs)
        print(write_settings(settings, os.path.normpath(inputs["state"])))
    except Refused as e:
        sys.stderr.write("fence: %s\n" % e)
        return REFUSED_EXIT
    return 0


if __name__ == "__main__":
    sys.exit(main())
