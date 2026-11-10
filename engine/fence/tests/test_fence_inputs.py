"""How fence-run finds an agent's policy (CONTRACTS section 4, step 2) and how
the Codex wrapper checks the Codex home it is given.

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
sys.path.insert(0, FENCE)
import fence_inputs  # noqa: E402

AGENT = "00000000-0000-4000-8000-0000000000aa"


class PolicyFileTests(unittest.TestCase):
    def setUp(self):
        self.dir = os.path.realpath(tempfile.mkdtemp(prefix="fence-inputs-"))
        os.chmod(self.dir, 0o755)
        self.path = os.path.join(self.dir, AGENT + ".json")

    def tearDown(self):
        shutil.rmtree(self.dir)

    def write(self, body, mode=0o644):
        with open(self.path, "w") as fh:
            fh.write(body if isinstance(body, str) else json.dumps(body))
        os.chmod(self.path, mode)

    def refused(self, agent_id=AGENT):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as cm:
            fence_inputs.read_policy(agent_id, self.dir)
        self.assertEqual(cm.exception.code, 78)
        return err.getvalue()

    def test_good_policy(self):
        self.write({"agentId": AGENT, "slug": "proof"})
        self.assertEqual(fence_inputs.read_policy(AGENT, self.dir)["slug"], "proof")

    def test_missing_policy(self):
        self.assertIn("no fence policy for this agent. Run: engine setup", self.refused())

    def test_not_a_uuid(self):
        self.assertIn("no fence policy", self.refused("../../etc/passwd"))

    def test_wrong_agent_id(self):
        self.write({"agentId": "00000000-0000-4000-8000-0000000000bb", "slug": "proof"})
        self.assertIn("no fence policy", self.refused())

    def test_bad_json(self):
        self.write("{nope")
        self.assertIn("no fence policy", self.refused())

    def test_writable_by_others(self):
        self.write({"agentId": AGENT, "slug": "proof"}, mode=0o666)
        self.assertIn("changed by someone other than you", self.refused())
        self.write({"agentId": AGENT, "slug": "proof"}, mode=0o664)
        self.assertIn("changed by someone other than you", self.refused())

    def test_folder_writable_by_others(self):
        self.write({"agentId": AGENT, "slug": "proof"})
        os.chmod(self.dir, 0o777)
        self.assertIn("changed by someone other than you", self.refused())

    def test_link_refused(self):
        real = os.path.join(self.dir, "real.json")
        with open(real, "w") as fh:
            json.dump({"agentId": AGENT, "slug": "proof"}, fh)
        os.symlink(real, self.path)
        self.assertIn("is a link", self.refused())


class CodexHomeTests(unittest.TestCase):
    SCRIPT = os.path.join(FENCE, "codex_home.py")
    CO = "11111111-1111-4111-8111-111111111111"
    AG = "22222222-2222-4222-8222-222222222222"

    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="codex-home-"))
        self.state = os.path.join(self.tmp, "S")
        self.inst = os.path.join(self.tmp, "I")
        self.owner = os.path.join(self.tmp, "owner-codex")
        os.makedirs(os.path.join(self.state, "codex-home"))
        os.makedirs(self.owner)
        with open(os.path.join(self.owner, "auth.json"), "w") as fh:
            fh.write("{}")
        os.symlink(os.path.join(self.owner, "auth.json"), os.path.join(self.state, "codex-home", "auth.json"))
        co_home = os.path.join(self.inst, "companies", self.CO, "codex-home")
        self.run_home = os.path.join(co_home, "skill-runtimes", self.AG, "abc")
        os.makedirs(os.path.join(self.run_home, "skills"))
        os.symlink(os.path.join(self.state, "codex-home", "auth.json"), os.path.join(co_home, "auth.json"))
        os.symlink(os.path.join(co_home, "auth.json"), os.path.join(self.run_home, "auth.json"))
        skill = os.path.join(self.inst, "skills", self.CO, "paperclip")
        os.makedirs(skill)
        os.symlink(skill, os.path.join(self.run_home, "skills", "paperclip"))
        self.skill = skill

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_script(self, home):
        return subprocess.run([sys.executable, self.SCRIPT, home, self.state, self.inst, self.CO, self.AG],
                              capture_output=True, text=True)

    def test_paperclip_home_chain_and_skills(self):
        r = self.run_script(self.run_home)
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = [l.split("\t") for l in r.stdout.splitlines()]
        self.assertEqual(lines[0], ["home", self.run_home])
        reads = [p for k, p in lines if k == "read"]
        writes = [p for k, p in lines if k == "write"]
        self.assertEqual(len([p for p in reads if p.endswith("auth.json")]), 3)
        self.assertIn(self.skill, reads)
        self.assertEqual(writes, [os.path.join(self.owner, "auth.json")])

    def test_engine_home_accepted(self):
        r = self.run_script(os.path.join(self.state, "codex-home"))
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_other_home_refused(self):
        r = self.run_script(self.owner)
        self.assertEqual(r.returncode, 78)
        self.assertIn("refusing Codex home", r.stderr)

    def test_skill_pointing_elsewhere_refused(self):
        os.symlink(self.owner, os.path.join(self.run_home, "skills", "sneaky"))
        r = self.run_script(self.run_home)
        self.assertEqual(r.returncode, 78)


if __name__ == "__main__":
    unittest.main()
