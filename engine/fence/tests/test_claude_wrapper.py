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
import json
import os
import shutil
import stat
import subprocess
import tempfile
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


if __name__ == "__main__":
    unittest.main()
