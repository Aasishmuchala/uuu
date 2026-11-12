"""How a run learns its mode, its model and its relay token (PLAN-V4, C2, C3, C6).
Every test uses a temp state folder through a temp config and a made-up secret.

Run: /usr/bin/python3 -m unittest discover -s engine/fence/tests -p 'test_*.py'
"""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

FENCE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.dirname(FENCE)
sys.path.insert(0, FENCE)
sys.path.insert(0, os.path.join(ENGINE, "lib"))
import config  # noqa: E402
import model_mode  # noqa: E402

AGENT = "11111111-2222-4333-8444-555555555555"
OTHER = "99999999-2222-4333-8444-555555555555"
SECRET = "a" * 64
NOW = 1800000000 - 6 * 3600   # so the agent token's exp is the golden 1800000000
GOLDEN_A = ("v1.a.11111111-2222-4333-8444-555555555555.1800000000."
            "f9e21b44fbf14fa08d3eb8407a21a75d9731bbd485b3988694859b691e777c91")
GOLDEN_T = ("v1.t.checker.1800000000."
            "5f754436db7e15338f63a36b71aafd8c170fa61a9ef88140e05eebcc380e4597")


class ModelModeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="model-mode-"))
        self.addCleanup(shutil.rmtree, self.tmp)
        with open(os.path.join(ENGINE, "config.json")) as fh:
            raw = json.load(fh)
        raw["stateRoot"] = os.path.join(self.tmp, "state")
        path = os.path.join(self.tmp, "config.json")
        with open(path, "w") as fh:
            json.dump(raw, fh)
        self.cfg = config.load_config(path)
        self.paths = self.cfg["paths"]
        for d in (self.paths["models"], self.paths["providerSecrets"]):
            os.makedirs(d, mode=0o700)

    def write(self, path, body, mode=0o600):
        with open(path, "w") as fh:
            fh.write(body if isinstance(body, str) else json.dumps(body))
        os.chmod(path, mode)

    def provider(self, picks=None, mode="provider"):
        if picks is None:
            picks = {"builder": {"model": "claude-fable-5-1", "source": "ranked"}}
        self.write(self.paths["modelsState"], {"version": 1, "mode": mode, "picks": picks})
        self.write(self.paths["ids"], {"agents": {"builder": AGENT, "checker": OTHER}}, 0o644)
        self.write(self.paths["relaySecret"], SECRET + "\n")

    def run_main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        code = 0
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = model_mode.main(list(argv), cfg=self.cfg, now=NOW)
            except SystemExit as e:
                code = e.code
        return code, out.getvalue(), err.getvalue()

    def refused(self, *argv):
        code, out, err = self.run_main(*argv)
        self.assertEqual(code, 78, err)
        self.assertEqual(out, "")
        self.assertTrue(err.startswith("fence: "), err)
        self.assertNotIn(SECRET, err)
        return err

    # --- the token -------------------------------------------------------

    def test_golden_vectors(self):
        self.assertEqual(model_mode.mint(SECRET, "a", AGENT, 1800000000), GOLDEN_A)
        self.assertEqual(model_mode.mint(SECRET, "t", "checker", 1800000000), GOLDEN_T)

    def test_mint_refuses_bad_input(self):
        for args in (("A" * 64, "a", AGENT, 1), ("a" * 63, "a", AGENT, 1), (SECRET, "x", AGENT, 1),
                     (SECRET, "a", "", 1), (SECRET, "a", "a.b", 1), (SECRET, "a", AGENT, "1"),
                     (SECRET, "a", AGENT, True), (SECRET, "a", AGENT, 0)):
            with self.assertRaises(ValueError):
                model_mode.mint(*args)

    # --- the mode --------------------------------------------------------

    def test_no_file_is_plans(self):
        self.assertEqual(model_mode.read_mode(self.cfg), "plans")
        self.assertEqual(self.run_main("--mode"), (0, "plans\n", ""))

    def test_plans_for_run_gives_four_lines_three_empty(self):
        self.assertEqual(self.run_main("--for-run", "--agent", AGENT), (0, "plans\n\n\n\n", ""))
        self.provider(mode="plans")
        self.assertEqual(self.run_main("--for-run", "--agent", AGENT), (0, "plans\n\n\n\n", ""))

    def test_provider_for_run(self):
        self.provider()
        code, out, err = self.run_main("--for-run", "--agent", AGENT)
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out.split("\n"),
                         ["provider", "http://127.0.0.1:3120", "claude-fable-5-1", GOLDEN_A, ""])
        self.assertEqual(self.run_main("--mode"), (0, "provider\n", ""))

    def test_token_for_any_well_formed_id(self):
        self.provider(mode="plans")
        self.assertEqual(self.run_main("--token", "--agent", AGENT), (0, GOLDEN_A + "\n", ""))
        unknown = "00000000-0000-4000-8000-000000000000"
        code, out, _ = self.run_main("--token", "--agent", unknown)
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("v1.a.%s.1800000000." % unknown))
        self.assertIn("not an agent id", self.refused("--token", "--agent", "builder"))

    # --- the refusals of C6 ----------------------------------------------

    def test_malformed_id(self):
        self.provider()
        for bad in ("builder", "ABCDEF11-2222-4333-8444-555555555555", "../" + AGENT, AGENT + "\n", ""):
            self.assertIn(model_mode.NOT_IN_COMPANY, self.refused("--for-run", "--agent", bad))

    def test_id_not_in_company(self):
        self.provider()
        err = self.refused("--for-run", "--agent", "00000000-0000-4000-8000-000000000000")
        self.assertIn("this agent is not in the company yet. Run: engine setup", err)
        os.unlink(self.paths["ids"])
        self.assertIn(model_mode.NOT_IN_COMPANY, self.refused("--for-run", "--agent", AGENT))

    def test_no_pick(self):
        self.provider(picks={"checker": {"model": "claude-gpt-6-1-sol", "source": "ranked"}})
        err = self.refused("--for-run", "--agent", AGENT)
        self.assertIn("no model is picked for this agent. Open Settings on the home screen", err)

    def test_pick_failing_the_model_pattern(self):
        for model in ("Claude-Fable", "claude fable", "x" * 81, "", 5, None, "a;rm -rf /",
                      "claude-fable-5-1\n"):
            self.provider(picks={"builder": {"model": model, "source": "owner"}})
            self.assertIn(model_mode.NO_PICK, self.refused("--for-run", "--agent", AGENT))
        self.provider(picks={"builder": "claude-fable-5-1"})
        self.assertIn(model_mode.NO_PICK, self.refused("--for-run", "--agent", AGENT))

    def test_missing_or_bad_secret(self):
        self.provider()
        os.unlink(self.paths["relaySecret"])
        err = self.refused("--for-run", "--agent", AGENT)
        self.assertIn("the model relay has no secret yet. Run: engine start", err)
        self.assertIn(model_mode.NO_SECRET, self.refused("--token", "--agent", AGENT))
        for body, mode in (("A" * 64 + "\n", 0o600), ("a" * 63 + "\n", 0o600),
                           (SECRET + "\n\n", 0o600), (SECRET + "\n", 0o622)):
            self.write(self.paths["relaySecret"], body, mode)
            self.assertIn(model_mode.NO_SECRET, self.refused("--for-run", "--agent", AGENT))
        # a secret without its newline is still the secret
        self.write(self.paths["relaySecret"], SECRET)
        self.assertEqual(self.run_main("--token", "--agent", AGENT)[1], GOLDEN_A + "\n")

    # --- state.json and ids.json that cannot be trusted --------------------

    def state_refused(self):
        for argv in (("--mode",), ("--for-run", "--agent", AGENT)):
            self.assertIn(model_mode.STATE_UNREADABLE, self.refused(*argv))

    def test_state_link_refused(self):
        self.provider()
        real = os.path.join(self.tmp, "elsewhere.json")
        os.rename(self.paths["modelsState"], real)
        os.symlink(real, self.paths["modelsState"])
        self.state_refused()

    def test_state_group_or_other_writable_refused(self):
        for mode in (0o620, 0o602, 0o666):
            self.provider()
            os.chmod(self.paths["modelsState"], mode)
            self.state_refused()

    def test_state_not_json_or_other_mode_refused(self):
        self.provider()
        for body in ("{nope", "[]", '"provider"', json.dumps({"mode": "Provider"}),
                     json.dumps({"mode": "off"}), json.dumps({"picks": {}}), ""):
            self.write(self.paths["modelsState"], body)
            self.state_refused()

    def test_state_not_a_file_or_too_big_refused(self):
        self.provider()
        os.unlink(self.paths["modelsState"])
        os.mkdir(self.paths["modelsState"])
        self.state_refused()
        os.rmdir(self.paths["modelsState"])
        big = {"mode": "plans", "pad": "x" * (1024 * 1024)}
        self.write(self.paths["modelsState"], big)
        self.state_refused()

    def test_ids_untrusted_refused(self):
        self.provider()
        os.chmod(self.paths["ids"], 0o666)
        self.assertIn(model_mode.IDS_UNTRUSTED, self.refused("--for-run", "--agent", AGENT))
        self.provider()
        real = os.path.join(self.tmp, "ids-elsewhere.json")
        os.rename(self.paths["ids"], real)
        os.symlink(real, self.paths["ids"])
        self.assertIn(model_mode.IDS_UNTRUSTED, self.refused("--for-run", "--agent", AGENT))
        os.unlink(self.paths["ids"])
        self.write(self.paths["ids"], "{nope", 0o644)
        self.assertIn(model_mode.IDS_UNTRUSTED, self.refused("--for-run", "--agent", AGENT))
        self.write(self.paths["ids"], {"agents": [AGENT]}, 0o644)
        self.assertIn(model_mode.IDS_UNTRUSTED, self.refused("--for-run", "--agent", AGENT))

    def test_two_slugs_for_one_id_refused(self):
        self.provider()
        self.write(self.paths["ids"], {"agents": {"builder": AGENT, "sales": AGENT}}, 0o644)
        self.assertIn(model_mode.NOT_IN_COMPANY, self.refused("--for-run", "--agent", AGENT))

    # --- the command line --------------------------------------------------

    def test_usage(self):
        for argv in ((), ("--nope",), ("--mode", "x"), ("--for-run",), ("--for-run", AGENT),
                     ("--token", "--agent"), ("--for-run", "--agent", AGENT, "x")):
            code, out, _ = self.run_main(*argv)
            self.assertEqual((code, out), (64, ""), argv)

    def test_command_line_ignores_engine_config_and_home(self):
        # A config (or HOME) pointing at this test's provider-mode state must not
        # be honoured from the environment: the real engine config is used. That
        # state is not under this test's control, so the check is only that no
        # token made with this test's secret comes out.
        self.provider()
        env = dict(os.environ, ENGINE_CONFIG=os.path.join(self.tmp, "config.json"),
                   HOME=os.path.join(self.tmp, "state"))
        r = subprocess.run(["/usr/bin/python3", os.path.join(FENCE, "model_mode.py"),
                            "--for-run", "--agent", AGENT],
                           capture_output=True, text=True, env=env)
        self.assertIn(r.returncode, (0, 78))
        lines = r.stdout.split("\n")
        if len(lines) > 3 and lines[3].startswith("v1.a.%s." % AGENT):
            exp = int(lines[3].split(".")[3])
            self.assertNotEqual(lines[3], model_mode.mint(SECRET, "a", AGENT, exp))


if __name__ == "__main__":
    unittest.main()
