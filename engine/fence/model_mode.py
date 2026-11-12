#!/usr/bin/env python3
"""Says which models a run uses, and mints the run's token for the model relay.
Runs outside the fence, called by the Claude and Codex wrappers, fence_inputs.py
and prove.sh (PLAN-V4, contracts C2, C3 and C6).

  model_mode.py --mode                  prints plans or provider
  model_mode.py --for-run --agent ID    prints four lines: the mode, the relay's
                                        address, the agent's pick, a fresh token
                                        (in plans mode: plans and three empty lines)
  model_mode.py --token --agent ID      prints a token for any well-formed agent id

Nothing here comes from the environment: the home folder is the one macOS has on
record for this user (not $HOME), and every path comes from engine/config.json
(never ENGINE_CONFIG). The relay's secret is read from its file and is never put
on a command line or in a message. Exit 78 and `fence: <reason>` on a refusal.

Importable: read_mode(cfg), mint(secret, kind, subject, exp).
"""
import hashlib
import hmac
import json
import os
import pwd
import re
import stat
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REFUSED_EXIT = 78
USAGE_EXIT = 64
MAX_BYTES = 1024 * 1024
AGENT_TOKEN_SECONDS = 6 * 3600
# fullmatch everywhere: in Python "$" also matches before a final newline.
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
MODEL = re.compile(r"[a-z0-9.-]{1,80}")
SECRET = re.compile(r"[0-9a-f]{64}")
SLUG = re.compile(r"[a-z0-9-]{1,80}")
MODES = ("plans", "provider")

NOT_IN_COMPANY = "this agent is not in the company yet. Run: engine setup"
NO_PICK = "no model is picked for this agent. Open Settings on the home screen"
NO_SECRET = "the model relay has no secret yet. Run: engine start"
STATE_UNREADABLE = ("the model settings file cannot be trusted or read, so no agent runs. "
                    "Open Settings on the home screen and save again")
IDS_UNTRUSTED = "the list of the company's agents cannot be trusted or read. Run: engine setup"


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


def read_trusted(path):
    """The text of a file that passes the trust rule of C2: a regular file (not a
    link), owned by this user, no write bit for group or others, at most 1 MB.
    None when there is no file; False when there is one but it is not trusted."""
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return None
    except OSError:
        return False
    if not trusted_stat(st):
        return False
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return False
    try:
        # The same file we looked at, still passing the rule.
        fst = os.fstat(fd)
        if not trusted_stat(fst) or (fst.st_dev, fst.st_ino) != (st.st_dev, st.st_ino):
            return False
        data = b""
        while len(data) <= MAX_BYTES:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            data += chunk
        if len(data) > MAX_BYTES:
            return False
    finally:
        os.close(fd)
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return False


def trusted_stat(st):
    return (stat.S_ISREG(st.st_mode) and st.st_uid == os.getuid()
            and not st.st_mode & 0o022 and st.st_size <= MAX_BYTES)


def read_json_object(path):
    """None when there is no file; False when untrusted or not one JSON object."""
    text = read_trusted(path)
    if text is None or text is False:
        return text
    try:
        value = json.loads(text)
    except ValueError:
        return False
    return value if isinstance(value, dict) else False


def read_state(cfg):
    """The models state file: {"mode": ..., "picks": {...}}. No file means plans.
    Refuses (exit 78) when the file is untrusted, not JSON, or its mode unknown."""
    state = read_json_object(cfg["paths"]["modelsState"])
    if state is None:
        return {"mode": "plans", "picks": {}}
    if state is False or state.get("mode") not in MODES:
        refuse(STATE_UNREADABLE)
    picks = state.get("picks")
    return {"mode": state["mode"], "picks": picks if isinstance(picks, dict) else {}}


def read_mode(cfg):
    """plans or provider. Refuses (exit 78) on a file that cannot be used."""
    return read_state(cfg)["mode"]


def pick_for(state, slug):
    entry = state["picks"].get(slug)
    model = entry.get("model") if isinstance(entry, dict) else None
    if not isinstance(model, str) or not MODEL.fullmatch(model):
        return None
    return model


def slug_for(cfg, agent_id):
    """The agent's slug through ids.json (agents: {slug: id})."""
    if not UUID.fullmatch(agent_id):
        refuse(NOT_IN_COMPANY)
    ids = read_json_object(cfg["paths"]["ids"])
    if ids is None:
        refuse(NOT_IN_COMPANY)
    if ids is False:
        refuse(IDS_UNTRUSTED)
    agents = ids.get("agents")
    if not isinstance(agents, dict):
        refuse(IDS_UNTRUSTED)
    slugs = [s for s, i in agents.items() if i == agent_id and isinstance(s, str) and SLUG.fullmatch(s)]
    if len(slugs) != 1:
        refuse(NOT_IN_COMPANY)
    return slugs[0]


def read_secret(cfg):
    text = read_trusted(cfg["paths"]["relaySecret"])
    if not isinstance(text, str):
        return None
    if text.endswith("\n"):
        text = text[:-1]
    return text if SECRET.fullmatch(text) else None


def mint(secret, kind, subject, exp):
    """v1.<kind>.<subject>.<exp>.<mac>, the mac the lower-case hex HMAC-SHA256 of
    the text before it, keyed with the secret's 64 characters as ASCII bytes."""
    if not isinstance(secret, str) or not SECRET.fullmatch(secret):
        raise ValueError("the relay secret is malformed")
    if kind not in ("a", "t"):
        raise ValueError("the token kind must be a or t")
    if not isinstance(subject, str) or not subject or "." in subject:
        raise ValueError("the token subject is malformed")
    if isinstance(exp, bool) or not isinstance(exp, int) or exp <= 0:
        raise ValueError("the token expiry must be whole Unix seconds")
    text = "v1.%s.%s.%d" % (kind, subject, exp)
    mac = hmac.new(secret.encode("ascii"), text.encode("ascii"), hashlib.sha256).hexdigest()
    return "%s.%s" % (text, mac)


def agent_token(cfg, agent_id, now):
    secret = read_secret(cfg)
    if secret is None:
        refuse(NO_SECRET)
    return mint(secret, "a", agent_id, int(now) + AGENT_TOKEN_SECONDS)


def for_run(cfg, agent_id, now):
    state = read_state(cfg)
    if state["mode"] == "plans":
        return ["plans", "", "", ""]
    slug = slug_for(cfg, agent_id)
    model = pick_for(state, slug)
    if model is None:
        refuse(NO_PICK)
    return ["provider", cfg["urls"]["relay"], model, agent_token(cfg, agent_id, now)]


def usage():
    sys.stderr.write("usage: model_mode.py --mode | --for-run --agent ID | --token --agent ID\n")
    return USAGE_EXIT


def main(argv, cfg=None, now=None):
    """cfg and now are for tests only; the command line never sets them."""
    if not argv or argv[0] not in ("--mode", "--for-run", "--token"):
        return usage()
    action = argv[0]
    agent_id = None
    if action == "--mode":
        if len(argv) != 1:
            return usage()
    elif len(argv) != 3 or argv[1] != "--agent":
        return usage()
    else:
        agent_id = argv[2]
    if cfg is None:
        cfg = load_engine_config(owner_home())
    if now is None:
        now = time.time()
    if action == "--mode":
        lines = [read_mode(cfg)]
    elif action == "--for-run":
        lines = for_run(cfg, agent_id, now)
    else:
        if not UUID.fullmatch(agent_id):
            refuse("that is not an agent id")
        lines = [agent_token(cfg, agent_id, now)]
    sys.stdout.write("".join(line + "\n" for line in lines))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
