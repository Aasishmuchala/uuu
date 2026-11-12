#!/usr/bin/env python3
"""Says which doors a run may reach, and mints the run's door tokens. Runs outside
the fence, called by fence-run and fence_inputs.py (PLAN-V5, contracts K1 and K3).

  door_mode.py --for-run --agent ID   prints, for each door that is on, lists this
                                      agent and has a trusted secret, two lines:
                                      UUU_<DOOR>_URL=... and UUU_<DOOR>_TOKEN=...
                                      (DOOR is WEB, GENERATE or VIEWER); nothing
                                      for any other door
  door_mode.py --doors --agent ID     prints the ports of the doors that are on and
                                      list this agent, as JSON: [3130] or []

The switches are in <state>/doors/state.json, written by the home server only; no
file means every door is off, and a file that cannot be trusted or read means
every door is off for the fence (the doors refuse agents themselves). Which agents
a door serves is in engine/config.json (`doors`), never in the state folder.

Nothing here comes from the environment: the home folder and the config are found
the way model_mode.py finds them. A door's secret is read from its file and is
never put on a command line or in a message. Exit 78 and `fence: <reason>` only
for an id that is not an agent id (or an engine config that cannot be read).

Importable: read_state(cfg), doors_for(cfg, agent_id), for_run(cfg, agent_id, now).
"""
import json
import os
import re
import sys
import time

# fence-run starts this with python3 -I, which leaves even this script's own folder
# off the import path (and the agent's task folder, the current one, too): add it back.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_mode  # noqa: E402

REFUSED_EXIT = 78
USAGE_EXIT = 64
DOOR_TOKEN_SECONDS = 2 * 3600
# fullmatch everywhere: in Python "$" also matches before a final newline.
UUID = model_mode.UUID
SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
SECRET = re.compile(r"[0-9a-f]{64}")
# name, the word in the exported lines, the config key of its secret.
DOORS = (("web", "WEB", "webSecret"), ("generate", "GENERATE", "generateSecret"),
         ("viewer", "VIEWER", "viewerSecret"))

DEFAULTS = {
    "web": {"on": False, "allow": [], "block": [],
            "watchHosts": ["youtube.com", "youtu.be", "googlevideo.com", "ytimg.com",
                           "vimeo.com", "vimeocdn.com"],
            "search": "keyless", "perHour": 60, "perDay": 300},
    "generate": {"on": False, "dailyCredits": 300, "monthlyCredits": 1000, "autoUnderCredits": 0,
                 "paused": None,
                 "models": {"video": "gen4_turbo", "videoBest": "gen4.5", "still": "gen4_image",
                            "upscale": "magnific_precision_upscaler_v2"}},
    "viewer": {"on": False},
}

NOT_AN_ID = "that is not an agent id"


def refuse(message):
    sys.stderr.write("fence: %s\n" % message)
    sys.exit(REFUSED_EXIT)


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v >= 0 \
        and v != float("inf")


def _field(name, key, default, value):
    """The value when it has the default's kind; raises ValueError otherwise."""
    if key == "paused":
        if value is None or isinstance(value, (str, dict)):
            return value
    elif isinstance(default, bool):
        if isinstance(value, bool):
            return value
    elif isinstance(default, (int, float)):
        if _is_number(value):
            return value
    elif isinstance(default, str):
        if isinstance(value, str):
            return value
    elif isinstance(default, list):
        if isinstance(value, list) and all(isinstance(s, str) for s in value):
            return list(value)
    elif isinstance(default, dict):
        if isinstance(value, dict) and all(isinstance(v, str) for v in value.values()):
            merged = dict(default)
            merged.update(value)
            return merged
    raise ValueError("%s.%s" % (name, key))


def _defaults():
    return json.loads(json.dumps(DEFAULTS))


def read_state(cfg):
    """{"ok": True, "web": {...}, "generate": {...}, "viewer": {...}}, each field
    the file's or K1's default when missing; no file is every door off. {"ok": False}
    when the file is untrusted, not one JSON object, or a field has the wrong kind."""
    data = model_mode.read_json_object(cfg["paths"]["doorsState"])
    out = _defaults()
    out["ok"] = True
    if data is None:
        return out
    if data is False:
        return {"ok": False}
    try:
        for name in DEFAULTS:
            block = data.get(name)
            if block is None:
                continue
            if not isinstance(block, dict):
                raise ValueError(name)
            for key, default in DEFAULTS[name].items():
                if key in block:
                    out[name][key] = _field(name, key, default, block[key])
    except ValueError:
        return {"ok": False}
    return out


def slug_of(cfg, agent_id):
    """The agent's slug through ids.json (agents: {slug: id}); None when the id is
    not there once, or the file is missing or cannot be trusted."""
    if not isinstance(agent_id, str) or not UUID.fullmatch(agent_id):
        return None
    ids = model_mode.read_json_object(cfg["paths"]["ids"])
    agents = ids.get("agents") if isinstance(ids, dict) else None
    if not isinstance(agents, dict):
        return None
    slugs = [s for s, i in agents.items() if i == agent_id and isinstance(s, str) and SLUG.fullmatch(s)]
    return slugs[0] if len(slugs) == 1 else None


def _open_doors(cfg, agent_id):
    """(name, word, secret key) of each door that is on and lists this agent."""
    state = read_state(cfg)
    if not state["ok"]:
        return []
    on = [d for d in DOORS if state[d[0]]["on"] is True]
    if not on:
        return []
    slug = slug_of(cfg, agent_id)
    if slug is None:
        return []
    doors = cfg.get("doors") or {}
    return [d for d in on if slug in ((doors.get(d[0]) or {}).get("agents") or [])]


def doors_for(cfg, agent_id):
    """The ports of the doors that are on and list this agent; [] without an agent id."""
    if not agent_id:
        return []
    return [cfg["ports"][name] for name, _, _ in _open_doors(cfg, agent_id)]


def read_secret(cfg, key):
    text = model_mode.read_trusted(cfg["paths"][key])
    if not isinstance(text, str):
        return None
    if text.endswith("\n"):
        text = text[:-1]
    return text if SECRET.fullmatch(text) else None


def for_run(cfg, agent_id, now):
    """The lines for fence-run: a URL and a token for each open door with a secret."""
    lines = []
    for name, word, key in _open_doors(cfg, agent_id):
        secret = read_secret(cfg, key)
        if secret is None:
            continue
        token = model_mode.mint(secret, "a", agent_id, int(now) + DOOR_TOKEN_SECONDS)
        lines.append("UUU_%s_URL=%s" % (word, cfg["urls"][name]))
        lines.append("UUU_%s_TOKEN=%s" % (word, token))
    return lines


def usage():
    sys.stderr.write("usage: door_mode.py --for-run --agent ID | --doors --agent ID\n")
    return USAGE_EXIT


def main(argv, cfg=None, now=None):
    """cfg and now are for tests only; the command line never sets them."""
    if len(argv) != 3 or argv[0] not in ("--for-run", "--doors") or argv[1] != "--agent":
        return usage()
    action, agent_id = argv[0], argv[2]
    if not UUID.fullmatch(agent_id):
        refuse(NOT_AN_ID)
    if cfg is None:
        cfg = model_mode.load_engine_config(model_mode.owner_home())
    if now is None:
        now = time.time()
    if action == "--doors":
        sys.stdout.write(json.dumps(doors_for(cfg, agent_id), separators=(",", ":")) + "\n")
    else:
        sys.stdout.write("".join(line + "\n" for line in for_run(cfg, agent_id, now)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
