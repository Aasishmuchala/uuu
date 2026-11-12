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
COMPANY = "aaaaaaaa-1111-4111-8111-0000000000c0"
CODEX_BIN = "node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex"
STAND_IN = """#!/bin/bash
for a in "$@"; do echo "arg=$a"; done
echo "token=${ENGINE_RELAY_TOKEN-<unset>}"
echo "claude-login=${CLAUDE_CODE_OAUTH_TOKEN-<unset>}${ANTHROPIC_AUTH_TOKEN-<unset>}${ANTHROPIC_BASE_URL-<unset>}"
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
# PLAN-V5, K2b as T1 found them: right after `exec` (after SETTINGS), in either mode.
FLAGS = ["-c", "project_doc_max_bytes=0", "-c", 'web_search="disabled"']


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
        # Apart from the two settings right after exec, today's arguments exactly.
        i = prog.index("exec")
        self.assertEqual(prog[i + 1:i + 5], FLAGS)
        prog = prog[:i + 1] + prog[i + 5:]
        self.assertEqual(prog, [include if a.startswith("shell_environment_policy.include_only=") else a
                                for a in PAPERCLIP_ARGS])

    def test_plans_mode_drops_an_inherited_relay_token(self):
        args, token = self.ok(self.run_codex(PAPERCLIP_ARGS, AGENT_A,
                                             {"ENGINE_RELAY_TOKEN": "made-up-inherited"}))
        self.assertEqual(token, "<unset>")

    def test_an_inherited_claude_login_never_reaches_codex(self):
        # In either mode: Codex's shell tool gets the program's whole environment,
        # so a Claude login the board happened to inherit must be gone before it.
        inherited = {"CLAUDE_CODE_OAUTH_TOKEN": "made-up-login", "ANTHROPIC_AUTH_TOKEN": "made-up-token",
                     "ANTHROPIC_BASE_URL": "http://127.0.0.1:1"}
        for mode in ("plans", "provider"):
            self.provider(mode=mode)
            r = self.run_codex(PAPERCLIP_ARGS, AGENT_A, inherited)
            self.ok(r)
            self.assertIn("claude-login=<unset><unset><unset>", r.stdout)
            self.assertNotIn("made-up", r.stdout + r.stderr)

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
        self.assertEqual(prog[i + 7:i + 11], FLAGS)
        self.assertEqual(prog[i + 11:i + 13], ["--json", "-c"])
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
            self.assertEqual(prog[11:-1], ["--json"] + want, given)
            self.assertNotIn("gpt-x", " ".join(prog))
        # A -c value that reads like a flag is a value, not a flag.
        args, _ = self.ok(self.run_codex(["exec", "-c", "--model", "keep", "-"], AGENT_A))
        self.assertEqual(self.program_args(args)[11:], ["-c", "--model", "keep", "-"])

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

    # The Codex login (in provider mode never shared with the fence)

    def login_chain(self, shape):
        """Lays out a login as the real Mac has it, for an agent's Codex home inside
        the engine's shared one. Returns that home."""
        shared = os.path.join(self.state, "codex-home")
        home = os.path.join(shared, "agent-x")
        os.makedirs(home)
        managed = os.path.join(self.inst, "companies", "aaaaaaaa-1111-4111-8111-0000000000c0", "codex-home")
        os.makedirs(managed)
        if shape == "plain":
            self.write_private(os.path.join(home, "auth.json"), '{"marker":"made-up"}')
        elif shape == "link":
            self.write_private(os.path.join(shared, "auth.json"), '{"marker":"made-up"}')
            os.symlink(os.path.join(shared, "auth.json"), os.path.join(home, "auth.json"))
        else:  # a chain of two links
            self.write_private(os.path.join(managed, "auth.json"), '{"marker":"made-up"}')
            os.symlink(os.path.join(managed, "auth.json"), os.path.join(shared, "auth.json"))
            os.symlink(os.path.join(shared, "auth.json"), os.path.join(home, "auth.json"))
        return home

    def shared_paths(self, args):
        """The --read and --write paths handed to fence-run, in order."""
        fence = args[:args.index("--")] if "--" in args else args
        return [(fence[i], fence[i + 1]) for i in range(len(fence) - 1) if fence[i] in ("--read", "--write")]

    def test_provider_mode_shares_no_codex_login(self):
        for shape in ("link", "chain", "managed"):
            with self.subTest(shape=shape):
                self.tearDown(); self.setUp()
                home = self.managed_home() if shape == "managed" else self.login_chain(shape)
                extra_env = {"CODEX_HOME": home, "PAPERCLIP_COMPANY_ID": COMPANY}
                self.provider(mode="plans")
                plans = self.shared_paths(self.ok(self.run_codex(PAPERCLIP_ARGS, AGENT_A, extra_env))[0])
                self.provider()
                for extra in (PAPERCLIP_ARGS, ["--fence-check", "true"]):
                    args, _ = self.ok(self.run_codex(extra, AGENT_A, extra_env))
                    paths = self.shared_paths(args)
                    self.assertFalse([p for _, p in paths if "auth.json" in p], (shape, paths))
                    # Everything else that plans mode shares is still shared.
                    self.assertEqual(paths, [kp for kp in plans if not kp[1].endswith("/auth.json")])
                    self.assertTrue(os.path.islink(os.path.join(home, "auth.json")))
                # Plans mode still shares the login chain as before.
                want = {"link": 2, "chain": 3, "managed": 3}[shape]
                self.assertEqual(len([p for _, p in plans if p.endswith("/auth.json")]), want, plans)

    def managed_home(self):
        """A home as paperclip makes one for a Checker run: under the company's
        codex-home, its auth.json a link to the company's, which links to the
        engine's shared login (a made-up file here)."""
        company_home = os.path.join(self.inst, "companies", COMPANY, "codex-home")
        home = os.path.join(company_home, "skill-runtimes", AGENT_A, "d1gest")
        os.makedirs(home)
        shared = os.path.join(self.state, "codex-home")
        self.write_private(os.path.join(shared, "auth.json"), '{"marker":"made-up"}')
        os.symlink(os.path.join(shared, "auth.json"), os.path.join(company_home, "auth.json"))
        os.symlink(os.path.join(company_home, "auth.json"), os.path.join(home, "auth.json"))
        return home

    def test_provider_mode_refuses_a_login_file_in_the_agents_own_home(self):
        # A plain auth.json in the home the run uses would be readable in the fence.
        for home in (self.login_chain("plain"), self.managed_home()):
            login = os.path.join(home, "auth.json")
            if os.path.islink(login):
                os.remove(login)
                self.write_private(login, '{"marker":"made-up"}')
            extra_env = {"CODEX_HOME": home, "PAPERCLIP_COMPANY_ID": COMPANY}
            self.provider(mode="plans")
            self.ok(self.run_codex(PAPERCLIP_ARGS, AGENT_A, extra_env))
            self.provider()
            for extra in (PAPERCLIP_ARGS, ["--fence-check", "true"]):
                self.refused(self.run_codex(extra, AGENT_A, extra_env),
                             "a Codex login sits in this agent's own Codex home")
            # Never deleted.
            self.assertTrue(os.path.isfile(login) and not os.path.islink(login))

    def mode_flips(self, first, second):
        """A stand-in model_mode.py whose --mode answers `first` and whose next
        answer (--mode or --for-run) is `second`."""
        count = os.path.join(self.tmp, "mode-calls")
        stand_in = ("import os, sys\n"
                    "p = %r\n"
                    "n = int(open(p).read()) if os.path.exists(p) else 0\n"
                    "open(p, 'w').write(str(n + 1))\n"
                    "mode = %r if n == 0 else %r\n"
                    "if sys.argv[1] == '--for-run' and mode == 'provider':\n"
                    "    t = 'v1.a.%s.9999999999.' + 'c' * 64\n"
                    "    print('provider\\nhttp://127.0.0.1:3120\\n%s\\n' + t)\n"
                    "elif sys.argv[1] == '--for-run':\n"
                    "    print('plans\\n\\n\\n')\n"
                    "else:\n"
                    "    print(mode)\n") % (count, first, second, AGENT_A, PICK)
        with open(os.path.join(self.engine, "fence", "model_mode.py"), "w") as fh:
            fh.write(stand_in)
        return count

    def test_a_mode_switch_while_starting_is_refused(self):
        for first, second in (("plans", "provider"), ("provider", "plans")):
            for agent in (AGENT_A, None):
                with self.subTest(first=first, second=second, agent=agent):
                    count = self.mode_flips(first, second)
                    if os.path.exists(count):
                        os.remove(count)
                    self.refused(self.run_codex(PAPERCLIP_ARGS, agent),
                                 "the model mode changed while this run was starting")
        # The control: the same stand-in answering the same mode twice runs.
        for mode in ("plans", "provider"):
            count = self.mode_flips(mode, mode)
            if os.path.exists(count):
                os.remove(count)
            self.ok(self.run_codex(PAPERCLIP_ARGS, AGENT_A))

    def test_provider_mode_swaps_the_shared_home_for_an_empty_one(self):
        # The engine's shared home holds the login file itself: in provider mode a
        # run that would use it gets an empty folder inside it instead.
        shared = os.path.join(self.state, "codex-home")
        self.write_private(os.path.join(shared, "auth.json"), '{"marker":"made-up"}')
        self.provider(mode="plans")
        r = self.run_codex(PAPERCLIP_ARGS, AGENT_A)
        self.ok(r)
        self.assertIn("codex-home=%s\n" % shared, r.stdout)
        self.provider()
        for extra in (PAPERCLIP_ARGS, ["--fence-check", "true"]):
            r = self.run_codex(extra, AGENT_A)
            args, _ = self.ok(r)
            self.assertIn("codex-home=%s\n" % os.path.join(shared, "provider-mode"), r.stdout)
            self.assertEqual(args[args.index("--agent-home") + 1], os.path.join(shared, "provider-mode"))
            self.assertFalse([p for _, p in self.shared_paths(args) if "auth.json" in p])
        self.assertEqual(os.stat(os.path.join(shared, "provider-mode")).st_mode & 0o777, 0o700)

    def test_fence_check_works_without_an_agent_id_in_either_mode(self):
        for mode in ("plans", "provider"):
            self.provider(mode=mode)
            r = self.run_codex(["--fence-check", "true"])
            args, token = self.ok(r)
            self.assertEqual(token, "<unset>")
            self.assertEqual(args[-2:], ["-c", "true"])
            self.assertNotIn('model_provider="uuu-relay"', args)

    # The program flags (PLAN-V5, K2b as T1 found them)

    def test_flags_right_after_exec_once_in_either_mode(self):
        for mode in ("plans", "provider"):
            self.provider(mode=mode)
            for given in (PAPERCLIP_ARGS, PAPERCLIP_ARGS[:-1] + ["resume", "sess-1", "-"]):
                args, _ = self.ok(self.run_codex(given, AGENT_A))
                prog = self.program_args(args)
                i = prog.index("exec") + (7 if mode == "provider" else 1)
                self.assertEqual(prog[i:i + 4], FLAGS, mode)
                self.assertEqual(prog.count("project_doc_max_bytes=0"), 1, mode)
                self.assertEqual(prog.count('web_search="disabled"'), 1, mode)
                self.assertEqual(i + 4, prog.index("--json"))

    def test_no_flags_without_exec(self):
        self.provider(mode="plans")
        for given in (["--version"], ["-s", "read-only", "-a", "on-request", "app-server"], ["-p", "exec", "-"]):
            args, _ = self.ok(self.run_codex(given, AGENT_A))
            self.assertEqual(self.program_args(args), given)
        args, _ = self.ok(self.run_codex(["--fence-check", "true"], AGENT_A))
        self.assertNotIn("project_doc_max_bytes=0", args)

    def test_include_only_names_the_new_exports(self):
        args, _ = self.ok(self.run_codex(PAPERCLIP_ARGS, AGENT_A))
        include = [a for a in self.program_args(args) if a.startswith("shell_environment_policy.include_only=")][0]
        for name in ("UUU_PLAYBOOKS_DIR", "UUU_RESEARCH_DIR", "UUU_BRAND_PY", "UUU_BRAND_CHECK",
                     "UUU_WEB_URL", "UUU_WEB_TOKEN", "UUU_GENERATE_TOKEN", "UUU_VIEWER_TOKEN"):
            self.assertIn('"%s"' % name, include)


if __name__ == "__main__":
    unittest.main()
