"""Which doors a run may reach, and its door tokens (PLAN-V5, K1 and K3).
Every test uses a temp state folder through a temp config and made-up secrets.

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
import door_mode  # noqa: E402

RESEARCHER = "11111111-2222-4333-8444-555555555555"
ARTIST = "99999999-2222-4333-8444-555555555555"
SECRET = "a" * 64
OTHER_SECRET = "b" * 64
NOW = 1800000000 - 2 * 3600   # so the door token's exp is the golden 1800000000
GOLDEN_A = ("v1.a.11111111-2222-4333-8444-555555555555.1800000000."
            "f9e21b44fbf14fa08d3eb8407a21a75d9731bbd485b3988694859b691e777c91")


class DoorModeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="door-mode-"))
        self.addCleanup(shutil.rmtree, self.tmp)
        with open(os.path.join(ENGINE, "config.json")) as fh:
            raw = json.load(fh)
        raw["stateRoot"] = os.path.join(self.tmp, "state")
        path = os.path.join(self.tmp, "config.json")
        with open(path, "w") as fh:
            json.dump(raw, fh)
        self.cfg = config.load_config(path)
        self.paths = self.cfg["paths"]
        for d in (self.paths["doors"], self.paths["doorSecrets"]):
            os.makedirs(d, mode=0o700)
        self.write(self.paths["ids"], {"agents": {"researcher": RESEARCHER, "artist": ARTIST}}, 0o644)

    def write(self, path, body, mode=0o600):
        with open(path, "w") as fh:
            fh.write(body if isinstance(body, str) else json.dumps(body))
        os.chmod(path, mode)

    def state(self, web=True, generate=False, viewer=False, **extra):
        body = {"version": 1, "web": {"on": web}, "generate": {"on": generate},
                "viewer": {"on": viewer}, "changedAt": "2026-11-12T10:00:00.000Z"}
        body.update(extra)
        self.write(self.paths["doorsState"], body)

    def secrets(self, *names, secret=SECRET):
        for name in names:
            self.write(self.paths[name + "Secret"], secret + "\n")

    def run_main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        code = 0
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = door_mode.main(list(argv), cfg=self.cfg, now=NOW)
            except SystemExit as e:
                code = e.code
        return code, out.getvalue(), err.getvalue()

    def nothing(self, agent=RESEARCHER):
        self.assertEqual(self.run_main("--for-run", "--agent", agent), (0, "", ""))

    # --- the state file ----------------------------------------------------

    def test_no_state_file_prints_nothing(self):
        self.secrets("web", "generate", "viewer")
        self.nothing()
        st = door_mode.read_state(self.cfg)
        self.assertTrue(st["ok"])
        self.assertEqual([st[n]["on"] for n in ("web", "generate", "viewer")], [False, False, False])
        self.assertEqual(self.run_main("--doors", "--agent", RESEARCHER), (0, "[]\n", ""))

    def test_defaults_for_missing_fields(self):
        self.write(self.paths["doorsState"], {"version": 1, "web": {"on": True, "perDay": 10},
                                              "generate": {"models": {"video": "gen4.5"}}})
        st = door_mode.read_state(self.cfg)
        self.assertTrue(st["ok"])
        self.assertEqual(st["web"]["perDay"], 10)
        self.assertEqual(st["web"]["perHour"], 60)
        self.assertEqual(st["web"]["search"], "keyless")
        self.assertIn("youtube.com", st["web"]["watchHosts"])
        self.assertEqual(st["generate"]["models"]["video"], "gen4.5")
        self.assertEqual(st["generate"]["models"]["still"], "gen4_image")
        self.assertEqual(st["generate"]["dailyCredits"], 300)
        self.assertIsNone(st["generate"]["paused"])
        self.assertEqual(st["viewer"], {"on": False})

    def test_web_on_for_the_researcher_gives_the_two_lines(self):
        self.state(web=True)
        self.secrets("web")
        code, out, err = self.run_main("--for-run", "--agent", RESEARCHER)
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, "UUU_WEB_URL=http://127.0.0.1:3130\nUUU_WEB_TOKEN=%s\n" % GOLDEN_A)
        self.assertEqual(self.run_main("--doors", "--agent", RESEARCHER), (0, "[3130]\n", ""))
        self.assertEqual(door_mode.doors_for(self.cfg, RESEARCHER), [3130])

    def test_each_door_uses_its_own_secret(self):
        self.state(web=True, generate=True, viewer=True)
        self.secrets("web")
        self.secrets("generate", secret=OTHER_SECRET)
        self.write(self.paths["ids"], {"agents": {"researcher": RESEARCHER, "artist": ARTIST}}, 0o644)
        raw = dict(self.cfg["doors"])
        self.cfg["doors"] = {"web": {"agents": ["researcher"]}, "generate": {"agents": ["researcher"]},
                             "viewer": {"agents": ["researcher"]}}
        try:
            out = self.run_main("--for-run", "--agent", RESEARCHER)[1].splitlines()
            # the viewer has no secret: no lines for it, and the port is still listed
            self.assertEqual([l.split("=", 1)[0] for l in out],
                             ["UUU_WEB_URL", "UUU_WEB_TOKEN", "UUU_GENERATE_URL", "UUU_GENERATE_TOKEN"])
            self.assertEqual(out[1], "UUU_WEB_TOKEN=" + GOLDEN_A)
            self.assertNotEqual(out[3].split("=", 1)[1], GOLDEN_A)
            self.assertEqual(out[3].split("=", 1)[1],
                             door_mode.model_mode.mint(OTHER_SECRET, "a", RESEARCHER, 1800000000))
            self.assertEqual(door_mode.doors_for(self.cfg, RESEARCHER), [3130, 3140, 3150])
        finally:
            self.cfg["doors"] = raw

    def test_switch_off_prints_nothing(self):
        self.state(web=False)
        self.secrets("web")
        self.nothing()
        self.assertEqual(self.run_main("--doors", "--agent", RESEARCHER), (0, "[]\n", ""))

    def test_another_agent_with_the_switch_on_gets_nothing(self):
        self.state(web=True)
        self.secrets("web")
        self.nothing(ARTIST)
        self.nothing("00000000-0000-4000-8000-000000000000")
        self.assertEqual(self.run_main("--doors", "--agent", ARTIST), (0, "[]\n", ""))

    def test_doors_then_none(self):
        self.state(web=True)
        self.assertEqual(self.run_main("--doors", "--agent", RESEARCHER), (0, "[3130]\n", ""))
        self.state(web=False)
        self.assertEqual(self.run_main("--doors", "--agent", RESEARCHER), (0, "[]\n", ""))
        self.assertEqual(door_mode.doors_for(self.cfg, None), [])
        self.assertEqual(door_mode.doors_for(self.cfg, ""), [])

    def test_missing_or_bad_secret_prints_nothing(self):
        self.state(web=True)
        self.nothing()
        for body, mode in (("A" * 64 + "\n", 0o600), ("a" * 63 + "\n", 0o600),
                           (SECRET + "\n\n", 0o600), (SECRET + "\n", 0o622), (SECRET + "\n", 0o606)):
            self.write(self.paths["webSecret"], body, mode)
            self.nothing()
        os.unlink(self.paths["webSecret"])
        real = os.path.join(self.tmp, "secret-elsewhere")
        self.write(real, SECRET + "\n")
        os.symlink(real, self.paths["webSecret"])
        self.nothing()
        os.unlink(self.paths["webSecret"])
        # a secret without its newline is still the secret
        self.write(self.paths["webSecret"], SECRET)
        self.assertIn(GOLDEN_A, self.run_main("--for-run", "--agent", RESEARCHER)[1])

    def test_untrusted_state_prints_nothing(self):
        self.secrets("web")
        bad_bodies = ("{nope", "[]", "", json.dumps({"web": True}), json.dumps({"web": {"on": "yes"}}),
                      json.dumps({"web": {"on": True, "perDay": -1}}),
                      json.dumps({"web": {"on": True, "allow": "x"}}),
                      json.dumps({"web": {"on": True}, "generate": {"paused": 5}}))
        for body in bad_bodies:
            self.write(self.paths["doorsState"], body)
            self.nothing()
            self.assertEqual(door_mode.read_state(self.cfg), {"ok": False}, body)
            self.assertEqual(door_mode.doors_for(self.cfg, RESEARCHER), [])
        for mode in (0o620, 0o602, 0o666):
            self.state(web=True)
            os.chmod(self.paths["doorsState"], mode)
            self.nothing()
        self.state(web=True)
        real = os.path.join(self.tmp, "state-elsewhere.json")
        os.rename(self.paths["doorsState"], real)
        os.symlink(real, self.paths["doorsState"])
        self.nothing()
        os.unlink(self.paths["doorsState"])
        os.mkdir(self.paths["doorsState"])
        self.nothing()

    def test_untrusted_ids_prints_nothing(self):
        self.state(web=True)
        self.secrets("web")
        os.chmod(self.paths["ids"], 0o666)
        self.nothing()
        os.chmod(self.paths["ids"], 0o644)
        real = os.path.join(self.tmp, "ids-elsewhere.json")
        os.rename(self.paths["ids"], real)
        os.symlink(real, self.paths["ids"])
        self.nothing()
        os.unlink(self.paths["ids"])
        self.nothing()
        for body in ("{nope", json.dumps({"agents": [RESEARCHER]}),
                     json.dumps({"agents": {"researcher": RESEARCHER, "sales": RESEARCHER}}),
                     json.dumps({"agents": {"Researcher": RESEARCHER}})):
            self.write(self.paths["ids"], body, 0o644)
            self.nothing()

    def test_a_malformed_id_is_refused(self):
        self.state(web=True)
        self.secrets("web")
        for bad in ("researcher", "ABCDEF11-2222-4333-8444-555555555555", "../" + RESEARCHER,
                    RESEARCHER + "\n", ""):
            for action in ("--for-run", "--doors"):
                code, out, err = self.run_main(action, "--agent", bad)
                self.assertEqual((code, out), (78, ""))
                self.assertEqual(err, "fence: that is not an agent id\n")

    def test_usage(self):
        for argv in ((), ("--nope",), ("--for-run",), ("--for-run", RESEARCHER), ("--doors", "--agent"),
                     ("--for-run", "--agent", RESEARCHER, "x"), ("--token", "--agent", RESEARCHER)):
            code, out, _ = self.run_main(*argv)
            self.assertEqual((code, out), (64, ""), argv)

    def test_lines_fit_what_fence_run_accepts(self):
        import re
        self.state(web=True, generate=True, viewer=True)
        self.secrets("web", "generate", "viewer")
        self.cfg["doors"] = {"web": {"agents": ["researcher"]}, "generate": {"agents": ["researcher"]},
                             "viewer": {"agents": ["researcher"]}}
        out = self.run_main("--for-run", "--agent", RESEARCHER)[1].splitlines()
        self.assertEqual(len(out), 6)
        for line in out:
            self.assertRegex(line, re.compile(r"\AUUU_(WEB|GENERATE|VIEWER)_(URL|TOKEN)=[\x21-\x7e]{1,200}\Z"))

    def test_command_line_ignores_engine_config_and_home(self):
        # The environment cannot point the helper at this test's state: no token made
        # with this test's secret comes out of the command line.
        self.state(web=True)
        self.secrets("web")
        env = dict(os.environ, ENGINE_CONFIG=os.path.join(self.tmp, "config.json"),
                   HOME=os.path.join(self.tmp, "state"))
        r = subprocess.run(["/usr/bin/python3", "-I", os.path.join(FENCE, "door_mode.py"),
                            "--for-run", "--agent", RESEARCHER],
                           capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn(GOLDEN_A[:-64], r.stdout)
        for line in r.stdout.splitlines():
            if line.startswith("UUU_WEB_TOKEN="):
                exp = int(line.split(".")[3])
                self.assertNotEqual(line.split("=", 1)[1],
                                    door_mode.model_mode.mint(SECRET, "a", RESEARCHER, exp))


if __name__ == "__main__":
    unittest.main()
