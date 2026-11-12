"""The Claude wrapper (fence/bin/claude) gives each agent a Claude Code home of
its own, state/claude-home/<agent id>, and a run without an agent id
state/claude-home/_none, never the parent folder that holds the others. It
refuses a home that is a link, is not the owner's, or can be changed by others,
and an agent id that is malformed.

Each test runs a copy of the wrapper in a temp engine whose config puts the
state folder and paperclip's instance in the same temp folder. A stand-in
fence-run prints the home it was handed and CLAUDE_CONFIG_DIR, so no sandbox
and no model is ever started.

Run: /usr/bin/python3 -m unittest discover -s engine/fence/tests -p 'test_*.py'
"""
import hashlib
import hmac
import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
import unittest

FENCE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.dirname(FENCE)
AGENT_A = "11111111-2222-4333-8444-555555555555"
AGENT_B = "66666666-7777-4888-9999-aaaaaaaaaaaa"
STAND_IN = """#!/bin/bash
prev=""
for a in "$@"; do
  if [[ "$prev" == --agent-home ]]; then echo "agent-home=$a"; fi
  prev="$a"
done
echo "config-dir=${CLAUDE_CONFIG_DIR:-}"
"""


class ClaudeWrapperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="fence-claude-"))
        self.engine = os.path.join(self.tmp, "engine")
        os.makedirs(os.path.join(self.engine, "fence", "bin"))
        os.makedirs(os.path.join(self.engine, "lib"))
        self.claude = os.path.join(self.engine, "fence", "bin", "claude")
        shutil.copy2(os.path.join(FENCE, "bin", "claude"), self.claude)
        shutil.copy2(os.path.join(FENCE, "model_mode.py"), os.path.join(self.engine, "fence", "model_mode.py"))
        for name in ("config.py", "config.sh"):
            shutil.copy2(os.path.join(ENGINE, "lib", name), os.path.join(self.engine, "lib", name))
        fence_run = os.path.join(self.engine, "fence", "fence-run")
        with open(fence_run, "w") as fh:
            fh.write(STAND_IN)
        os.chmod(fence_run, 0o755)
        with open(os.path.join(ENGINE, "config.json"), encoding="utf-8") as fh:
            cfg = json.load(fh)
        self.state = os.path.join(self.tmp, "state")
        self.inst = os.path.join(self.tmp, "instance")
        cfg["stateRoot"] = self.state
        cfg["paperclip"]["instanceRoot"] = self.inst
        with open(os.path.join(self.engine, "config.json"), "w", encoding="utf-8") as fh:
            json.dump(cfg, fh)
        os.makedirs(self.inst)
        os.makedirs(self.state)
        env_file = os.path.join(self.state, "agent.env")
        with open(env_file, "w") as fh:
            fh.write("PROOF_ONLY=1\n")
        os.chmod(env_file, 0o600)
        self.homes = os.path.join(self.state, "claude-home")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_claude(self, args, agent_id=None):
        env = {k: v for k, v in os.environ.items()
               if k not in ("PAPERCLIP_AGENT_ID", "CLAUDE_CONFIG_DIR", "ENGINE_CONFIG")}
        if agent_id is not None:
            env["PAPERCLIP_AGENT_ID"] = agent_id
        return subprocess.run([self.claude] + args, cwd=self.tmp, env=env,
                              capture_output=True, text=True, timeout=60)

    def assert_home(self, r, home, config_dir=True):
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("agent-home=%s\n" % home, r.stdout)
        if config_dir:
            self.assertIn("config-dir=%s\n" % home, r.stdout)
        st = os.lstat(home)
        self.assertTrue(stat.S_ISDIR(st.st_mode))
        self.assertEqual(stat.S_IMODE(st.st_mode), 0o700)

    def test_each_agent_gets_its_own_home(self):
        for agent in (AGENT_A, AGENT_B):
            self.assert_home(self.run_claude(["-p", "hi"], agent), os.path.join(self.homes, agent))
        self.assertEqual(sorted(os.listdir(self.homes)), sorted([AGENT_A, AGENT_B]))

    def test_the_fence_check_uses_the_agents_home_too(self):
        r = self.run_claude(["--fence-check", "true"], AGENT_A)
        self.assert_home(r, os.path.join(self.homes, AGENT_A), config_dir=False)

    def test_a_run_without_an_agent_id_gets_none_never_the_parent(self):
        for args in (["-p", "hi"], ["--fence-check", "true"]):
            r = self.run_claude(args)
            self.assert_home(r, os.path.join(self.homes, "_none"), config_dir=(args[0] == "-p"))
            self.assertNotIn("agent-home=%s\n" % self.homes, r.stdout)
        r = self.run_claude(["-p", "hi"], "")
        self.assert_home(r, os.path.join(self.homes, "_none"))

    def test_an_existing_home_is_used_as_it_is(self):
        home = os.path.join(self.homes, AGENT_A)
        os.makedirs(home, mode=0o700)
        with open(os.path.join(home, "kept"), "w") as fh:
            fh.write("x")
        self.assert_home(self.run_claude(["-p", "hi"], AGENT_A), home)
        self.assertTrue(os.path.exists(os.path.join(home, "kept")))

    def refused(self, r, words):
        self.assertEqual(r.returncode, 78, r.stdout + r.stderr)
        self.assertNotIn("agent-home=", r.stdout)
        self.assertIn(words, r.stderr)

    def test_a_malformed_agent_id_is_refused(self):
        for bad in ("../other", "x", AGENT_B.upper(), AGENT_A + "/..", "_none", AGENT_A + "\n", " " + AGENT_A):
            self.refused(self.run_claude(["-p", "hi"], bad), "malformed")
        self.assertFalse(os.path.exists(self.homes) and os.listdir(self.homes))

    def test_a_linked_home_is_refused(self):
        os.makedirs(self.homes)
        other = os.path.join(self.homes, AGENT_B)
        os.makedirs(other, mode=0o700)
        os.symlink(other, os.path.join(self.homes, AGENT_A))
        self.refused(self.run_claude(["-p", "hi"], AGENT_A), "is a link")
        dangling = os.path.join(self.homes, "_none")
        os.symlink(os.path.join(self.tmp, "nowhere"), dangling)
        self.refused(self.run_claude(["-p", "hi"]), "is a link")
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "nowhere")))

    def test_a_linked_parent_is_refused(self):
        real = os.path.join(self.tmp, "elsewhere")
        os.makedirs(real)
        os.symlink(real, self.homes)
        self.refused(self.run_claude(["-p", "hi"], AGENT_A), "not a plain folder of yours")
        self.assertEqual(os.listdir(real), [])

    def test_a_home_that_is_not_a_folder_is_refused(self):
        os.makedirs(self.homes)
        with open(os.path.join(self.homes, AGENT_A), "w") as fh:
            fh.write("x")
        self.refused(self.run_claude(["-p", "hi"], AGENT_A), "not a folder of yours")

    def test_a_home_others_can_change_is_refused(self):
        home = os.path.join(self.homes, AGENT_A)
        os.makedirs(home)
        os.chmod(home, 0o777)
        self.refused(self.run_claude(["-p", "hi"], AGENT_A), "can be changed by others")

    def test_a_home_owned_by_someone_else_is_refused(self):
        # An ordinary user cannot make a folder someone else owns, so check that
        # the wrapper tests ownership, and that the same test fails on a folder
        # root owns.
        if os.getuid() == 0:
            self.skipTest("run as root")
        with open(self.claude) as fh:
            text = fh.read()
        self.assertIn('[[ -d "$AGENT_HOME" && -O "$AGENT_HOME" ]] || refuse', text)
        self.assertIn('[[ ! -L "$HOMES" && -d "$HOMES" && -O "$HOMES" ]] || refuse', text)
        r = subprocess.run(["/bin/bash", "-c", '[[ -d "$1" && -O "$1" ]]', "_", "/"], capture_output=True)
        self.assertNotEqual(r.returncode, 0)


class FenceRunHomeTests(unittest.TestCase):
    """fence-run, called directly (its self-check, the art and CAD checks), never
    hands over the folder that holds every Claude agent's home. The live check
    is the proof's section on the agents' own Claude homes."""

    def setUp(self):
        with open(os.path.join(FENCE, "fence-run")) as fh:
            self.text = fh.read()

    def test_default_home_is_none(self):
        self.assertIn('AGENT_HOME="$CFG_STATE/claude-home/_none"', self.text)
        self.assertNotIn('AGENT_HOME="$CFG_STATE/claude-home";', self.text)

    def test_parent_folder_is_refused(self):
        guard = self.text[self.text.index('_homes="$(cd "$CFG_STATE/claude-home"'):]
        self.assertIn('case "$_homes/" in "$_home_real"/*) refuse', guard)
        self.assertLess(self.text.index('_homes="$(cd'), self.text.index("fence_inputs.py\" --tool"))

    def test_proof_checks_the_agents_own_homes(self):
        with open(os.path.join(FENCE, "prove.sh")) as fh:
            text = fh.read()
        self.assertIn("write in another agent's Claude home", text)
        self.assertIn("write in its own Claude home", text)


SECRET = "0123456789abcdef" * 4
PICK = "claude-fable-5-1"
MODEL_VARS = ("ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
              "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL")
# Every credential, profile, header and cloud-switch name the installed Claude
# Code (2.1.268) reads, from the prototype (PLAN-V4, T1, findings.json claude.unset).
UNSET = ("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
         "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR", "OPENAI_API_KEY",
         "ANTHROPIC_PROFILE", "ANTHROPIC_CONFIG_DIR", "ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_BETAS",
         "ANTHROPIC_UNIX_SOCKET", "ANTHROPIC_API_HOST", "ANTHROPIC_IDENTITY_TOKEN", "ANTHROPIC_IDENTITY_TOKEN_FILE",
         "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_MANTLE",
         "CLAUDE_CODE_USE_ANTHROPIC_AWS", "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD", "CLAUDE_CODE_USE_GATEWAY",
         "CLAUDE_CODE_GATEWAY_TOKEN", "CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR",
         "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_BEDROCK_MANTLE_BASE_URL", "ANTHROPIC_VERTEX_BASE_URL",
         "ANTHROPIC_FOUNDRY_BASE_URL", "ANTHROPIC_AWS_BASE_URL", "ANTHROPIC_GOOGLE_CLOUD_BASE_URL",
         "ANTHROPIC_AWS_API_KEY", "ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_FOUNDRY_AUTH_TOKEN", "AWS_BEARER_TOKEN_BEDROCK")
# PLAN-V5, K2b as T1 found it: after paperclip's own arguments, in either mode.
NO_WEB = ["--disallowedTools", "WebSearch", "WebFetch"]
ENV_STAND_IN = """#!/bin/bash
env | LC_ALL=C sort | sed 's/^/env:/'
for a in "$@"; do echo "arg=$a"; done
"""


class ProviderModeTests(unittest.TestCase):
    """Provider mode (PLAN-V4, C6 as corrected by T1): the login file is never
    opened, no credential but the relay token reaches the program, every model
    variable and --model name the pick. The temp state holds a state.json, an
    ids.json and a relay secret, all made up; the stand-in fence-run prints the
    environment and the arguments it was handed."""

    def setUp(self):
        ClaudeWrapperTests.setUp(self)
        fence_run = os.path.join(self.engine, "fence", "fence-run")
        with open(fence_run, "w") as fh:
            fh.write(ENV_STAND_IN)
        with open(os.path.join(self.state, "agent.env"), "w") as fh:
            fh.write("CLAUDE_CODE_OAUTH_TOKEN=made-up-oauth-login\nPROOF_ONLY=1\n")
        self.write(os.path.join(self.state, "ids.json"),
                   {"agents": {"chief-of-staff": AGENT_A, "checker": AGENT_B}})
        self.write(os.path.join(self.state, "secrets", "provider", "relay-secret"), SECRET + "\n")
        self.set_state("provider")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, path, body, mode=0o600):
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        with open(path, "w") as fh:
            fh.write(body if isinstance(body, str) else json.dumps(body))
        os.chmod(path, mode)

    def set_state(self, mode, picks=None):
        if picks is None:
            picks = {"chief-of-staff": {"model": PICK, "source": "ranked"}}
        self.write(os.path.join(self.state, "models", "state.json"),
                   {"version": 1, "mode": mode, "picks": picks})

    def run_claude(self, args, agent_id=None, extra=None):
        env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": os.environ.get("HOME", "/"), "LANG": "C"}
        env.update(extra or {})
        if agent_id is not None:
            env["PAPERCLIP_AGENT_ID"] = agent_id
        return subprocess.run([self.claude] + args, cwd=self.tmp, env=env,
                              capture_output=True, text=True, timeout=60)

    def seen(self, r):
        self.assertEqual(r.returncode, 0, r.stderr)
        env, args = {}, []
        for line in r.stdout.splitlines():
            if line.startswith("env:"):
                k, _, v = line[4:].partition("=")
                env[k] = v
            elif line.startswith("arg="):
                args.append(line[4:])
        return env, args

    def refused(self, r, words):
        self.assertEqual(r.returncode, 78, r.stdout + r.stderr)
        self.assertNotIn("arg=", r.stdout)
        self.assertIn(words, r.stderr)

    def test_the_claude_login_never_reaches_the_program(self):
        env, _ = self.seen(self.run_claude(["-p", "hi"], AGENT_A, {"CLAUDE_CODE_OAUTH_TOKEN": "made-up-inherited"}))
        self.assertNotIn("CLAUDE_CODE_OAUTH_TOKEN", env)
        self.assertNotIn("PROOF_ONLY", env)
        for value in env.values():
            self.assertNotIn("made-up", value)

    def test_the_login_file_is_not_opened_at_all(self):
        env_file = os.path.join(self.state, "agent.env")
        os.chmod(env_file, 0o666)  # plans mode refuses this file; provider mode never looks
        self.seen(self.run_claude(["-p", "hi"], AGENT_A))
        os.remove(env_file)
        os.symlink(os.path.join(self.tmp, "nowhere"), env_file)
        self.seen(self.run_claude(["-p", "hi"], AGENT_A))
        os.remove(env_file)
        env, _ = self.seen(self.run_claude(["-p", "hi"], AGENT_A))
        self.assertEqual(env["CLAUDE_CONFIG_DIR"], os.path.join(self.homes, AGENT_A))
        self.assertEqual(env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"], "1")

    def test_relay_address_and_a_valid_agent_token(self):
        before = int(time.time())
        r = self.run_claude(["-p", "hi"], AGENT_A)
        env, args = self.seen(r)
        self.assertEqual(env["ANTHROPIC_BASE_URL"], "http://127.0.0.1:3120")
        token = env["ANTHROPIC_AUTH_TOKEN"]
        parts = token.split(".")
        self.assertEqual(parts[:3], ["v1", "a", AGENT_A])
        exp = int(parts[3])
        self.assertTrue(before + 6 * 3600 <= exp <= int(time.time()) + 6 * 3600)
        self.assertLessEqual(exp, int(time.time()) + 7 * 3600)
        mac = hmac.new(SECRET.encode("ascii"), ".".join(parts[:4]).encode("ascii"), hashlib.sha256).hexdigest()
        self.assertTrue(hmac.compare_digest(parts[4], mac))
        # The token is in the environment only: not an argument, not in a message.
        self.assertFalse(any(token in a for a in args))
        self.assertNotIn(token, r.stderr)
        self.assertNotIn(SECRET, r.stdout + r.stderr)

    def test_every_model_variable_is_the_pick(self):
        env, _ = self.seen(self.run_claude(["-p", "hi"], AGENT_A, {"ANTHROPIC_MODEL": "sonnet"}))
        for name in MODEL_VARS:
            self.assertEqual(env.get(name), PICK, name)
        self.assertNotIn("CLAUDE_CODE_DISABLE_WEB_FETCH", env)

    def test_model_argument_becomes_the_pick(self):
        cases = [
            (["--model", "sonnet", "-p", "hi"], ["--model", PICK, "-p", "hi"]),
            (["-p", "hi", "--model=opus"], ["-p", "hi", "--model=" + PICK]),
            (["-p", "hi"], ["-p", "hi", "--model", PICK]),
            ([], ["--model", PICK]),
            (["-p", "hi", "--model"], ["-p", "hi", "--model", PICK]),
            (["-p", "--model sonnet"], ["-p", "--model sonnet", "--model", PICK]),
        ]
        for given, wanted in cases:
            _, args = self.seen(self.run_claude(given, AGENT_A))
            self.assertEqual(args[-len(wanted) - 3:-3], wanted, given)
            self.assertEqual(args[-3:], NO_WEB)

    def test_every_listed_name_and_pattern_is_gone(self):
        self.assertEqual(len(UNSET), 34)
        extra = {name: "made-up-" + name for name in UNSET}
        extra.update({"ANTHROPIC_SOMETHING_NEW": "x", "CLAUDE_CODE_USE_SOMETHING": "1",
                      "CLAUDE_CODE_OAUTH_SOMETHING": "x", "CLAUDE_CODE_GATEWAY_X": "x",
                      "CLAUDE_CODE_API_KEY_X": "x", "AWS_BEARER_TOKEN_OTHER": "x",
                      "ANTHROPIC_BASE_URL": "https://api.anthropic.com", "ANTHROPIC_AUTH_TOKEN": "made-up-inherited",
                      "KEEP_ME": "kept"})
        env, _ = self.seen(self.run_claude(["-p", "hi"], AGENT_A, extra))
        for name in UNSET + ("ANTHROPIC_SOMETHING_NEW", "CLAUDE_CODE_USE_SOMETHING", "CLAUDE_CODE_OAUTH_SOMETHING",
                             "CLAUDE_CODE_GATEWAY_X", "CLAUDE_CODE_API_KEY_X", "AWS_BEARER_TOKEN_OTHER"):
            self.assertNotIn(name, env)
        self.assertEqual(env["ANTHROPIC_BASE_URL"], "http://127.0.0.1:3120")
        self.assertTrue(env["ANTHROPIC_AUTH_TOKEN"].startswith("v1.a." + AGENT_A + "."))
        self.assertEqual(env["KEEP_ME"], "kept")
        self.assertEqual(sorted(k for k in env if k.startswith("ANTHROPIC_")),
                         sorted(["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"] + [m for m in MODEL_VARS if m.startswith("ANTHROPIC_")]))

    def test_inherited_key_profile_and_bedrock_are_gone(self):
        env, _ = self.seen(self.run_claude(["-p", "hi"], AGENT_A, {
            "ANTHROPIC_API_KEY": "made-up-key", "ANTHROPIC_PROFILE": "work", "CLAUDE_CODE_USE_BEDROCK": "1"}))
        for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_PROFILE", "CLAUDE_CODE_USE_BEDROCK"):
            self.assertNotIn(name, env)

    def test_a_run_without_an_agent_id_is_refused(self):
        for agent in (None, ""):
            self.refused(self.run_claude(["-p", "hi"], agent),
                         "fence: the provider is on, and a run without an agent id has no model. "
                         "The proof passes a real agent's id.")

    def test_the_fence_check_needs_no_id_and_no_token(self):
        for agent in (None, AGENT_B):
            env, args = self.seen(self.run_claude(["--fence-check", "true"], agent))
            self.assertNotIn("ANTHROPIC_AUTH_TOKEN", env)
            self.assertEqual(args[-2:], ["-c", "true"])

    def test_an_agent_without_a_pick_is_refused(self):
        self.refused(self.run_claude(["-p", "hi"], AGENT_B), "fence: no model is picked for this agent")

    def test_an_agent_not_in_the_company_is_refused(self):
        self.refused(self.run_claude(["-p", "hi"], "99999999-2222-4333-8444-555555555555"),
                     "fence: this agent is not in the company yet")

    def test_no_relay_secret_is_refused(self):
        os.remove(os.path.join(self.state, "secrets", "provider", "relay-secret"))
        self.refused(self.run_claude(["-p", "hi"], AGENT_A), "fence: the model relay has no secret yet")

    def test_an_untrusted_state_file_is_refused_in_either_mode(self):
        path = os.path.join(self.state, "models", "state.json")
        for agent in (AGENT_A, None):
            os.chmod(path, 0o666)
            self.refused(self.run_claude(["-p", "hi"], agent), "fence: the model settings file cannot be trusted")
        self.set_state("plans")
        os.chmod(path, 0o620)
        self.refused(self.run_claude(["-p", "hi"], AGENT_A), "fence: the model settings file cannot be trusted")

    def test_plans_mode_is_as_before(self):
        # With a state file in plans mode, and with none: the login file is
        # sourced, the arguments pass untouched, nothing points at the relay.
        for has_file in (True, False):
            if has_file:
                self.set_state("plans")
            else:
                os.remove(os.path.join(self.state, "models", "state.json"))
            for agent in (AGENT_A, AGENT_B, None):
                env, args = self.seen(self.run_claude(["--model", "sonnet", "-p", "hi"], agent,
                                                      {"ANTHROPIC_PROFILE": "work"}))
                self.assertEqual(env["CLAUDE_CODE_OAUTH_TOKEN"], "made-up-oauth-login")
                self.assertEqual(env["ANTHROPIC_PROFILE"], "work")
                self.assertNotIn("ANTHROPIC_BASE_URL", env)
                self.assertNotIn("ANTHROPIC_AUTH_TOKEN", env)
                self.assertNotIn("ANTHROPIC_MODEL", env)
                self.assertEqual(args[-7:-3], ["--model", "sonnet", "-p", "hi"])
                self.assertEqual(args[-3:], NO_WEB)
        os.remove(os.path.join(self.state, "agent.env"))
        r = self.run_claude(["-p", "hi"], AGENT_A)
        self.assertEqual(r.returncode, 78)
        self.assertIn("No agent login yet", r.stderr)

    # The program flags (PLAN-V5, K2b as T1 found them)

    def paperclip_args(self):
        return ["--print", "--output-format", "stream-json", "--verbose", "--model", "sonnet",
                "--max-turns", "30", "--add-dir", os.path.join(self.tmp, "nowhere")]

    def test_no_web_flag_comes_last_once_in_either_mode(self):
        for mode in ("plans", "provider"):
            self.set_state(mode)
            given = self.paperclip_args()
            _, args = self.seen(self.run_claude(given, AGENT_A))
            self.assertEqual(args[-3:], NO_WEB, mode)
            self.assertEqual(args.count("--disallowedTools"), 1, mode)
            self.assertNotIn("--setting-sources", args, mode)
            if mode == "plans":
                self.assertEqual(args[args.index("--print"):], given + NO_WEB)
            # Already there at the end: not added again.
            _, again = self.seen(self.run_claude(given + NO_WEB, AGENT_A))
            self.assertEqual(again.count("--disallowedTools"), 1, mode)
            self.assertEqual(again[-3:], NO_WEB, mode)

    def test_no_web_flag_not_on_version_help_or_fence_check(self):
        for mode in ("provider", "plans"):
            self.set_state(mode)
            for given in (["--version"], ["-v"], ["--help"], ["-h"]):
                _, args = self.seen(self.run_claude(given, AGENT_A))
                self.assertIn(given[0], args)
                self.assertNotIn("--disallowedTools", args)
        _, args = self.seen(self.run_claude(["--fence-check", "true"], AGENT_A))
        self.assertNotIn("--disallowedTools", args)
        # A run with no arguments at all still gets it.
        _, args = self.seen(self.run_claude([], AGENT_A))
        self.assertEqual(args[-3:], NO_WEB)


if __name__ == "__main__":
    unittest.main()
