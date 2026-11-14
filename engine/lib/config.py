"""Loads engine/config.json. The JavaScript and bash loaders return the same values.

Standard library only (runs on /usr/bin/python3, 3.9).
  python3 config.py --shell   prints the bash lines that config.sh evals
  python3 config.py --json    prints the full config as JSON
"""
import json
import os
import re
import sys

ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PORT_KEYS = ["board", "gate", "relay", "home", "benchWeb", "benchSocketio",
             "benchRedisQueue", "benchRedisCache", "benchDb",
             "gateNarrow", "web", "generate", "viewer", "preview", "apps"]
# The doors (PLAN-V5 K1): each lists the agents, by slug, that may reach it.
DOOR_NAMES = ["web", "generate", "viewer"]
SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
# App Studio (K17): each app's own port lies in this range (not a config key).
APP_PORTS = {"first": 3171, "last": 3189}
PREVIEW_SITE_PORTS = 9
APP_NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,23}")


class ConfigError(Exception):
    pass


def _fail(what):
    raise ConfigError("engine config: " + what)


def _expand(p):
    home = os.path.expanduser("~")
    if p == "~":
        return home
    if p.startswith("~/"):
        return os.path.join(home, p[2:])
    return p


def _need(obj, dotted, kind):
    v = obj
    for part in dotted.split("."):
        if not isinstance(v, dict) or part not in v:
            _fail("missing key " + dotted)
        v = v[part]
    if kind == "array":
        ok = isinstance(v, list)
    elif kind == "number":
        ok = isinstance(v, (int, float)) and not isinstance(v, bool)
    else:
        ok = isinstance(v, str)
    if not ok:
        _fail("key %s must be a %s" % (dotted, kind))
    return v


def _need_doors(cfg):
    """`doors` holds exactly the three doors, each {"agents": [slug, ...]}."""
    d = cfg.get("doors")
    if not isinstance(d, dict):
        _fail("missing key doors")
    if sorted(d) != sorted(DOOR_NAMES):
        _fail("key doors must name " + ", ".join(DOOR_NAMES))
    for name in DOOR_NAMES:
        agents = _need(cfg, "doors.%s.agents" % name, "array")
        if not all(isinstance(s, str) and SLUG.fullmatch(s) for s in agents):
            _fail("key doors.%s.agents must list agent slugs" % name)
        # `app-<name>` is an app's name, never an agent's (the company file refuses it too).
        if any(s.startswith("app-") for s in agents):
            _fail("key doors.%s.agents names an app, not an agent (a name starting with app-)" % name)
        # Only the generation door serves apps; the list is optional.
        if "apps" in d[name]:
            if name != "generate":
                _fail("only the generation door serves apps")
            apps = d[name]["apps"]
            if not isinstance(apps, list) or not all(isinstance(s, str) and APP_NAME.fullmatch(s) for s in apps):
                _fail("key doors.generate.apps must list app names")


def load_config(path=None):
    path = path or os.environ.get("ENGINE_CONFIG") or os.path.join(ENGINE_DIR, "config.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        _fail("cannot read " + path)
    try:
        cfg = json.loads(text)
    except ValueError:
        _fail(path + " is not valid JSON")
    if not isinstance(cfg, dict):
        _fail(path + " must hold an object")

    _need(cfg, "stateRoot", "string")
    _need(cfg, "node24", "string")
    for k in PORT_KEYS:
        _need(cfg, "ports." + k, "number")
    _need(cfg, "bench.site", "string")
    _need(cfg, "bench.company", "string")
    _need(cfg, "bench.abbr", "string")
    _need(cfg, "paperclip.instanceRoot", "string")
    _need(cfg, "paperclip.companyName", "string")
    _need(cfg, "fence.realClaude", "string")
    for k in ["claudeHosts", "codexHosts", "policyPortsAllowed", "readRootsAllowed"]:
        _need(cfg, "fence." + k, "array")
    _need_doors(cfg)
    _need(cfg, "minFreeDiskGb", "number")

    cfg["stateRoot"] = _expand(cfg["stateRoot"])
    cfg["node24"] = _expand(cfg["node24"])
    cfg["paperclip"]["instanceRoot"] = _expand(cfg["paperclip"]["instanceRoot"])
    cfg["fence"]["realClaude"] = _expand(cfg["fence"]["realClaude"])

    p = cfg["ports"]
    host = "http://127.0.0.1"
    cfg["engineDir"] = ENGINE_DIR
    cfg["urls"] = {
        "board": "%s:%d" % (host, p["board"]),
        "gate": "%s:%d" % (host, p["gate"]),
        "relay": "%s:%d" % (host, p["relay"]),
        "home": "%s:%d" % (host, p["home"]),
        "bench": "%s:%d" % (host, p["benchWeb"]),
        "gateNarrow": "%s:%d" % (host, p["gateNarrow"]),
        "web": "%s:%d" % (host, p["web"]),
        "generate": "%s:%d" % (host, p["generate"]),
        "viewer": "%s:%d" % (host, p["viewer"]),
        "preview": "%s:%d" % (host, p["preview"]),
    }
    cfg["urls"]["apps"] = "%s:%d" % (host, p["apps"])
    cfg["appPorts"] = dict(APP_PORTS)
    # The preview serves each load on the nine ports after its own (viewer/preview.mjs SITE_PORT_COUNT).
    cfg["previewPorts"] = {"first": p["preview"] + 1, "last": p["preview"] + PREVIEW_SITE_PORTS}
    cfg["doors"]["generate"].setdefault("apps", [])
    s = cfg["stateRoot"]
    j = os.path.join
    cfg["paths"] = {
        "state": s,
        "logs": j(s, "logs"),
        "run": j(s, "run"),
        "secrets": j(s, "secrets"),
        "agentSecrets": j(s, "secrets", "agents"),
        "policy": j(s, "policy"),
        "ids": j(s, "ids.json"),
        "tasks": j(s, "tasks"),
        "projectFolder": j(s, "tasks", "company-work"),
        "agentFolders": j(s, "tasks", "agents"),
        "proofFolder": j(s, "tasks", "_proof"),
        "quotaFolder": j(s, "tasks", "_quota"),
        "knowledgeDocs": j(s, "knowledge", "docs"),
        "lessons": j(s, "lessons"),
        "contentDrafts": j(s, "content", "drafts"),
        "homeData": j(s, "home"),
        "cad": j(s, "cad"),
        "cadPython": j(s, "cad", "venv", "bin", "python"),
        "proofLast": j(s, "proof", "last.json"),
        "fences": j(s, "fences"),
        "claudeHome": j(s, "claude-home"),
        "codexHome": j(s, "codex-home"),
        "books": j(s, "books"),
        "benchOwnerKey": j(s, "secrets", "bench-owner-api.txt"),
        "models": j(s, "models"),
        "modelsState": j(s, "models", "state.json"),
        "relayStatus": j(s, "models", "relay-status.json"),
        "providerSecrets": j(s, "secrets", "provider"),
        "providerKey": j(s, "secrets", "provider", "omega-key"),
        "relaySecret": j(s, "secrets", "provider", "relay-secret"),
        "playbooks": j(s, "playbooks"),
        "research": j(s, "tasks", "research"),
        "sharedBrain": j(s, "knowledge", "shared"),
        "doors": j(s, "doors"),
        "doorsState": j(s, "doors", "state.json"),
        "doorSecrets": j(s, "secrets", "doors"),
        "webSecret": j(s, "secrets", "doors", "web-secret"),
        "generateSecret": j(s, "secrets", "doors", "generate-secret"),
        "viewerSecret": j(s, "secrets", "doors", "viewer-secret"),
        "runwayKey": j(s, "secrets", "doors", "runway-key"),
        "searchKey": j(s, "secrets", "doors", "search-key"),
        "webVisits": j(s, "doors", "web-visits.jsonl"),
        "ledger": j(s, "doors", "generate-ledger.jsonl"),
        "batches": j(s, "doors", "batches"),
        "doorWork": j(s, "doors", "work"),
        "webStatus": j(s, "doors", "web-status.json"),
        "generateStatus": j(s, "doors", "generate-status.json"),
        "viewerStatus": j(s, "doors", "viewer-status.json"),
        "appsCode": os.path.normpath(j(ENGINE_DIR, "..", "apps")),
        "apps": j(s, "apps"),
        "appsState": j(s, "apps", "state.json"),
        "appsStatus": j(s, "apps", "host-status.json"),
        "appsRun": j(s, "run", "apps"),
        "appsLogs": j(s, "logs", "apps"),
        "allowances": j(s, "doors", "allowances"),
        "higgsfieldAuth": j(s, "secrets", "doors", "higgsfield-oauth.json"),
    }
    return cfg


def _q(value):
    return "'" + str(value).replace("'", "'\\''") + "'"


def shell_lines(cfg):
    p = cfg["ports"]
    u = cfg["urls"]
    pa = cfg["paths"]
    pairs = [
        ("CFG_ENGINE_DIR", cfg["engineDir"]),
        ("CFG_STATE", cfg["stateRoot"]),
        ("CFG_NODE24", cfg["node24"]),
        ("CFG_PORT_BOARD", p["board"]),
        ("CFG_PORT_GATE", p["gate"]),
        ("CFG_PORT_RELAY", p["relay"]),
        ("CFG_PORT_HOME", p["home"]),
        ("CFG_PORT_BENCH_WEB", p["benchWeb"]),
        ("CFG_PORT_BENCH_SOCKETIO", p["benchSocketio"]),
        ("CFG_PORT_BENCH_REDIS_QUEUE", p["benchRedisQueue"]),
        ("CFG_PORT_BENCH_REDIS_CACHE", p["benchRedisCache"]),
        ("CFG_PORT_BENCH_DB", p["benchDb"]),
        ("CFG_BOARD_URL", u["board"]),
        ("CFG_GATE_URL", u["gate"]),
        ("CFG_RELAY_URL", u["relay"]),
        ("CFG_HOME_URL", u["home"]),
        ("CFG_BENCH_URL", u["bench"]),
        ("CFG_BENCH_SITE", cfg["bench"]["site"]),
        ("CFG_INSTANCE_ROOT", cfg["paperclip"]["instanceRoot"]),
        ("CFG_REAL_CLAUDE", cfg["fence"]["realClaude"]),
        ("CFG_MIN_FREE_GB", cfg["minFreeDiskGb"]),
        ("CFG_LOGS", pa["logs"]),
        ("CFG_RUN", pa["run"]),
        ("CFG_SECRETS", pa["secrets"]),
        ("CFG_POLICY", pa["policy"]),
        ("CFG_TASKS", pa["tasks"]),
        ("CFG_PROJECT_FOLDER", pa["projectFolder"]),
        # Paths only: no script ever reads these files' contents into a variable.
        ("CFG_MODELS_STATE", pa["modelsState"]),
        ("CFG_PROVIDER_KEY", pa["providerKey"]),
        ("CFG_RELAY_SECRET", pa["relaySecret"]),
        ("CFG_PORT_GATE_NARROW", p["gateNarrow"]),
        ("CFG_PORT_WEB", p["web"]),
        ("CFG_PORT_GENERATE", p["generate"]),
        ("CFG_PORT_VIEWER", p["viewer"]),
        ("CFG_PORT_PREVIEW", p["preview"]),
        ("CFG_GATE_NARROW_URL", u["gateNarrow"]),
        ("CFG_WEB_URL", u["web"]),
        ("CFG_GENERATE_URL", u["generate"]),
        ("CFG_VIEWER_URL", u["viewer"]),
        ("CFG_PREVIEW_URL", u["preview"]),
        ("CFG_DOORS_STATE", pa["doorsState"]),
        ("CFG_PLAYBOOKS", pa["playbooks"]),
        ("CFG_RESEARCH", pa["research"]),
        ("CFG_PORT_APPS", p["apps"]),
        ("CFG_APPS_URL", u["apps"]),
        ("CFG_APP_PORT_FIRST", cfg["appPorts"]["first"]),
        ("CFG_APP_PORT_LAST", cfg["appPorts"]["last"]),
        ("CFG_APPS", pa["apps"]),
        ("CFG_APPS_CODE", pa["appsCode"]),
        ("CFG_APPS_STATE", pa["appsState"]),
        ("CFG_APPS_RUN", pa["appsRun"]),
        ("CFG_APPS_LOGS", pa["appsLogs"]),
    ]
    return "\n".join("%s=%s" % (k, _q(v)) for k, v in pairs)


def main(argv):
    mode = argv[1] if len(argv) > 1 else "--json"
    if mode not in ("--shell", "--json"):
        sys.stderr.write("usage: config.py --shell | --json\n")
        return 64
    try:
        cfg = load_config()
    except ConfigError as e:
        sys.stderr.write(str(e) + "\n")
        return 1
    if mode == "--shell":
        print(shell_lines(cfg))
    else:
        print(json.dumps(cfg, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
