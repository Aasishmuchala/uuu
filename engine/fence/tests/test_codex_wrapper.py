"""The Codex wrapper (fence/bin/codex) in both model modes (PLAN-V4, C6, with the
prototype's correction). Plans mode is today's run, untouched. Provider mode
points Codex at the model relay: the three -c settings go right after `exec`
(Codex drops every -c given before `exec` when `exec` has -c of its own), the
value after --model or -m becomes the agent's pick, and the relay token travels
only in ENGINE_RELAY_TOKEN. The quota check (app-server) is left as today.

Each test runs a copy of the wrapper in a temp engine whose config puts the
state folder and paperclip's instance in the same temp folder, with the real
codex_home.py and model_mode.py beside it. A stand-in fence-run prints the
arguments it was handed, one per line, and the named variables, so no sandbox
and no model is ever started. The secret and the token are made up.

Run: /usr/bin/python3 -m unittest discover -s engine/fence/tests -p 'test_codex_wrapper.py'
"""
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest

FENCE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.dirname(FENCE)
AGENT_A = "11111111-2222-4333-8444-555555555555"
AGENT_B = "66666666-7777-4888-9999-aaaaaaaaaaaa"
SECRET = "b" * 64
PICK = "claude-gpt-6-1-sol"
CODEX_BIN = "node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex"
STAND_IN = """#!/bin/bash
for a in "$@"; do echo "arg=$a"; done
echo "token=${ENGINE_RELAY_TOKEN-<unset>}"
echo "codex-home=${CODEX_HOME:-}"
echo "cwd=$(pwd -P)"
"""
# What paperclip's adapter sends for a run (codex-args.js and execute.js): its
# own -c in front, `exec --json`, the sandbox -c after exec, --model, then `-`.
PAPERCLIP_ARGS = [
    "-c", "features.shell_snapshot=false",
    "-c", 'shell_environment_policy.inherit="all"',
    "-c", "shell_environment_policy.ignore_default_excludes=true",
    "-c", 'shell_environment_policy.include_only=["PATH","HOME"]',
    "exec", "--json", "-c", 'sandbox_mode="workspace-write"',
    "-c", "sandbox_workspace_write.network_access=true",
    "--model", "gpt-x", "-",
]
SETTINGS = [
    "-c", 'model_provider="uuu-relay"',
    "-c", 'model_providers.uuu-relay={name="Model relay",base_url="http://127.0.0.1:3120/v1",'
          'env_key="ENGINE_RELAY_TOKEN",wire_api="responses",requires_openai_auth=false,'
          'supports_websockets=false}',
    "-c", 'model="%s"' % PICK,
]


class CodexWrapperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="fence-codex-"))
        self.engine = os.path.join(self.tmp, "engine")
        os.makedirs(os.path.join(self.engine, "fence", "bin"))
        os.makedirs(os.path.join(self.engine, "lib"))
        self.codex = os.path.join(self.engine, "fence", "bin", "codex")
        shutil.copy2(os.path.join(FENCE, "bin", "codex"), self.codex)
        for name in ("codex_home.py", "model_mode.py"):
            shutil.copy2(os.path.join(FENCE, name), os.path.join(self.engine, "fence", name))
        for name in ("config.py", "config.sh"):
            shutil.copy2(os.path.join(ENGINE, "lib", name), os.path.join(self.engine, "lib", name))
        fence_run = os.path.join(self.engine, "fence", "fence-run")
        with open(fence_run, "w") as fh:
            fh.write(STAND_IN)
        os.chmod(fence_run, 0o755)
        program = os.path.join(self.engine, CODEX_BIN)
        os.makedirs(os.path.dirname(program))
        with open(program, "w") as fh:
            fh.write("#!/bin/sh\nexit 0\n")
        os.chmod(program, 0o755)
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

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write_private(self, path, text):
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        with open(path, "w") as fh:
            fh.write(text)
        os.chmod(path, 0o600)

    def provider(self, mode="provider", picks=None):
        """A state folder in the given mode, AGENT_A as the checker, a secret."""
        if picks is None:
            picks = {"checker": {"model": PICK, "source": "ranked"}}
        self.write_private(os.path.join(self.state, "models", "state.json"),
                           json.dumps({"version": 1, "mode": mode, "picks": picks}))
        self.write_private(os.path.join(self.state, "ids.json"),
                           json.dumps({"agents": {"checker": AGENT_A, "builder": AGENT_B}}))
        self.write_private(os.path.join(self.state, "secrets", "provider", "relay-secret"), SECRET + "\n")

    def run_codex(self, args, agent_id=None, extra_env=None):
        env = {k: v for k, v in os.environ.items()
               if k not in ("PAPERCLIP_AGENT_ID", "CODEX_HOME", "ENGINE_CONFIG", "ENGINE_RELAY_TOKEN")}
        if agent_id is not None:
            env["PAPERCLIP_AGENT_ID"] = agent_id
        env.update(extra_env or {})
        return subprocess.run([self.codex] + args, cwd=self.tmp, env=env,
                              capture_output=True, text=True, timeout=60)

    def ok(self, r):
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        args = [line[4:] for line in r.stdout.splitlines() if line.startswith("arg=")]
        token = [line[6:] for line in r.stdout.splitlines() if line.startswith("token=")][0]
        return args, token

    def program_args(self, args):
        """What the wrapper hands Codex: everything after the program's path."""
        return args[args.index(os.path.join(self.engine, CODEX_BIN)) + 1:]

    def refused(self, r, words):
        self.assertEqual(r.returncode, 78, r.stdout + r.stderr)
        self.assertNotIn("arg=", r.stdout)
        self.assertIn("fence: ", r.stderr)
        self.assertIn(words, r.stderr)

    # Plans mode

    def test_plans_mode_is_todays_run(self):
        # No state file, and a state file in plans mode: the same arguments and
        # environment as the wrapper gave before provider mode existed.
        before = self.ok(self.run_codex(PAPERCLIP_ARGS, AGENT_A))
        self.provider(mode="plans")
        after = self.ok(self.run_codex(PAPERCLIP_ARGS, AGENT_A))
        self.assertEqual(before, after)
        args, token = after
        self.assertEqual(token, "<unset>")
        prog = self.program_args(args)
        self.assertNotIn('model_provider="uuu-relay"', prog)
        self.assertIn("--model", prog)
        self.assertEqual(prog[prog.index("--model") + 1], "gpt-x")
        include = [a for a in prog if a.startswith("shell_environment_policy.include_only=")][0]
        self.assertTrue(include.startswith('shell_environment_policy.include_only=["PATH","HOME","HTTP_PROXY"'))
        self.assertEqual(prog, [include if a.startswith("shell_environment_policy.include_only=") else a
                                for a in PAPERCLIP_ARGS])

    def test_plans_mode_drops_an_inherited_relay_token(self):
        args, token = self.ok(self.run_codex(PAPERCLIP_ARGS, AGENT_A,
                                             {"ENGINE_RELAY_TOKEN": "made-up-inherited"}))
        self.assertEqual(token, "<unset>")

    def test_plans_mode_without_an_agent_id_still_runs(self):
        self.provider(mode="plans")
        args, token = self.ok(self.run_codex(PAPERCLIP_ARGS))
        self.assertEqual(token, "<unset>")

    # Provider mode

    def test_provider_settings_come_right_after_exec_once(self):
        self.provider()
        args, _ = self.ok(self.run_codex(PAPERCLIP_ARGS, AGENT_A))
        prog = self.program_args(args)
        i = prog.index("exec")
        self.assertEqual(prog[i + 1:i + 7], SETTINGS)
        self.assertEqual(prog.count('model_provider="uuu-relay"'), 1)
        self.assertEqual(sum(a.startswith("model_providers.uuu-relay=") for a in prog), 1)
        # Paperclip's own arguments keep their order around them.
        self.assertEqual(prog[:7], PAPERCLIP_ARGS[:7])
        self.assertEqual(i, PAPERCLIP_ARGS.index("exec"))
        self.assertEqual(prog[i + 7:i + 9], ["--json", "-c"])
        self.assertEqual(prog[-1], "-")

    def test_provider_token_verifies_and_is_on_no_command_line(self):
        self.provider()
        r = self.run_codex(PAPERCLIP_ARGS, AGENT_A)
        args, token = self.ok(r)
        parts = token.split(".")
        self.assertEqual(parts[:3], ["v1", "a", AGENT_A])
        text = ".".join(parts[:4])
        mac = hmac.new(SECRET.encode("ascii"), text.encode("ascii"), hashlib.sha256).hexdigest()
        self.assertTrue(hmac.compare_digest(parts[4], mac))
        self.assertGreater(int(parts[3]), time.time() + 5 * 3600)
        self.assertFalse(any(token in a for a in args))
        self.assertNotIn(token, r.stderr)

    def test_provider_model_flags_become_the_pick(self):
        self.provider()
        for given, want in ((["--model", "gpt-x"], ["--model", PICK]),
                            (["-m", "gpt-x"], ["-m", PICK]),
                            (["--model=gpt-x"], ["--model=%s" % PICK]),
                            (["-m=gpt-x"], ["-m=%s" % PICK])):
            args, _ = self.ok(self.run_codex(["exec", "--json"] + given + ["-"], AGENT_A))
            prog = self.program_args(args)
            self.assertEqual(prog[7:-1], ["--json"] + want, given)
            self.assertNotIn("gpt-x", " ".join(prog))
        # A -c value that reads like a flag is a value, not a flag.
        args, _ = self.ok(self.run_codex(["exec", "-c", "--model", "keep", "-"], AGENT_A))
        self.assertEqual(self.program_args(args)[7:], ["-c", "--model", "keep", "-"])

    def test_provider_include_only_rewrite_still_happens(self):
        self.provider()
        args, _ = self.ok(self.run_codex(PAPERCLIP_ARGS, AGENT_A))
        include = [a for a in self.program_args(args) if a.startswith("shell_environment_policy.include_only=")]
        self.assertEqual(len(include), 1)
        self.assertIn('"HTTP_PROXY"', include[0])
        self.assertIn('"UUU_*"', include[0])
        self.assertNotIn("ENGINE_RELAY_TOKEN", include[0])

    def test_provider_resume_keeps_the_settings_in_front_of_resume(self):
        # Paperclip resumes with `exec ... resume <session id> -`.
        self.provider()
        args, _ = self.ok(self.run_codex(PAPERCLIP_ARGS[:-1] + ["resume", "sess-1", "-"], AGENT_A))
        prog = self.program_args(args)
        i = prog.index("exec")
        self.assertEqual(prog[i + 1:i + 7], SETTINGS)
        self.assertLess(i + 7, prog.index("resume"))
        self.assertEqual(prog[-3:], ["resume", "sess-1", "-"])

    def test_provider_without_exec_is_refused(self):
        self.provider()
        self.refused(self.run_codex(["--json", "-"], AGENT_A), "has no exec")
        # `exec` given only as an option's value does not count.
        self.refused(self.run_codex(["-p", "exec", "-"], AGENT_A), "has no exec")

    def test_provider_without_an_agent_id_is_refused(self):
        self.provider()
        for agent in (None, ""):
            self.refused(self.run_codex(PAPERCLIP_ARGS, agent),
                         "the provider is on, and a run without an agent id has no model. "
                         "The proof passes a real agent's id.")

    def test_provider_agent_without_a_pick_or_not_in_company_is_refused(self):
        self.provider()
        self.refused(self.run_codex(PAPERCLIP_ARGS, AGENT_B), "no model is picked for this agent")
        self.refused(self.run_codex(PAPERCLIP_ARGS, "99999999-2222-4333-8444-555555555555"),
                     "this agent is not in the company yet")

    def test_an_unreadable_state_file_is_refused(self):
        self.provider()
        path = os.path.join(self.state, "models", "state.json")
        os.chmod(path, 0o666)
        self.refused(self.run_codex(PAPERCLIP_ARGS, AGENT_A), "cannot be trusted or read")

    def test_provider_quota_check_is_left_as_today(self):
        self.provider()
        quota = ["-s", "read-only", "-a", "on-request", "app-server"]
        for agent in (None, AGENT_A):
            r = self.run_codex(quota, agent)
            args, token = self.ok(r)
            self.assertEqual(token, "<unset>")
            self.assertEqual(self.program_args(args), quota)
            self.assertIn("cwd=%s\n" % os.path.join(self.state, "tasks", "_quota"), r.stdout)

    def test_provider_version_question_is_left_as_today(self):
        self.provider()
        args, token = self.ok(self.run_codex(["--version"]))
        self.assertEqual(token, "<unset>")
        self.assertEqual(self.program_args(args), ["--version"])

    def test_fence_check_works_without_an_agent_id_in_either_mode(self):
        for mode in ("plans", "provider"):
            self.provider(mode=mode)
            r = self.run_codex(["--fence-check", "true"])
            args, token = self.ok(r)
            self.assertEqual(token, "<unset>")
            self.assertEqual(args[-2:], ["-c", "true"])
            self.assertNotIn('model_provider="uuu-relay"', args)


if __name__ == "__main__":
    unittest.main()
