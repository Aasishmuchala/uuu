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
POLICY_KEYS = ("agentId", "slug", "localServices", "readFolders", "lessonsFile",
               "envFile", "taskFolder")
# The engine folder: two levels above this file, never taken from the inputs.
ENGINE = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
PATH_INPUTS = ("home", "state", "taskFolder", "agentHome", "innerTmp", "nodeRoot",
               "realClaudeDir", "instanceRoot")


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


def _check_policy(policy, state, config, board_port):
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
        if key not in POLICY_KEYS:
            raise bad("the key %s is not one the fence knows" % key)
    if not isinstance(policy["agentId"], str) or not policy["agentId"]:
        raise bad("agentId is missing")

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
    return {"domains": domains, "reads": reads, "lessons": lessons,
            "taskReadOnly": task_mode == "read-only"}


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
    extra_read, extra_write = [], []
    for key, out in (("extraRead", extra_read), ("extraWrite", extra_write)):
        if not isinstance(inputs[key], list):
            raise Refused("the fence was given %s that is not a list" % key)
        for p in inputs[key]:
            out.append(_check_abs("extra path", p))

    deny = [home, "/private/tmp/claude-%d" % uid, "/tmp/claude-%d" % uid]

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

    extras = {"domains": [], "reads": [], "lessons": None, "taskReadOnly": False}
    if inputs["policy"] is not None:
        extras = _check_policy(inputs["policy"], state, config, board_port)

    read = [task, agent_home, inner_tmp, node_root, os.path.join(home, ".local", "bin"),
            claude_dir] + extra_read + extra_write + extras["reads"]
    write = [agent_home, inner_tmp] + extra_write
    if not extras["taskReadOnly"]:
        write = [task] + write
    if extras["lessons"]:
        read.append(extras["lessons"])
        write.append(extras["lessons"])
    domains = list(hosts) + ["127.0.0.1:%d" % gate_port, "localhost:%d" % gate_port] + extras["domains"]
    return {
        "filesystem": {"denyRead": deny, "allowRead": _dedupe(read),
                       "allowWrite": _dedupe(write), "denyWrite": []},
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
