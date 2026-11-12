"""Python run outside the fence never imports a module from the current folder.

The board starts both wrappers (and through them fence-run) with the agent's task
folder as the current folder, and the proof used to run from its own task folder:
folders an agent can write. `python3 -c` puts the current folder first on its
import path, so a planted json.py would run with the owner's rights. Every
unfenced python3 in these scripts is started with -I (isolated: no current folder,
no PYTHON* variables, no user site folder), and the proof runs from `/`.

Run: /usr/bin/python3 -m unittest discover -s engine/fence/tests -p 'test_no_cwd_imports.py'
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

FENCE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.dirname(FENCE)
AGENT_A = "11111111-2222-4333-8444-555555555555"
PLANTED = ("json", "re", "hmac", "os", "pwd", "hashlib", "stat")
# Unfenced scripts: every python3 in them must carry -I. The one exception is
# steady-pipes.py in bin/codex, which runs inside the fence (no owner's rights).
SCRIPTS = ("fence/bin/claude", "fence/bin/codex", "fence/fence-run", "fence/prove.sh",
           "fence/login-wizard.sh", "lib/config.sh")
STAND_IN = """#!/bin/bash
for a in "$@"; do echo "arg=$a"; done
"""


def plant(folder, mark):
    """Modules that, if imported, leave a mark and stop the run."""
    for name in PLANTED:
        with open(os.path.join(folder, name + ".py"), "w") as fh:
            fh.write("open(%r, 'a').write(%r)\nraise SystemExit(99)\n" % (mark, name + "\n"))


class StaticTests(unittest.TestCase):
    def test_every_unfenced_python3_is_isolated(self):
        for rel in SCRIPTS:
            with open(os.path.join(ENGINE, rel), encoding="utf-8") as fh:
                for n, line in enumerate(fh, 1):
                    for m in re.finditer(r"/usr/bin/python3(\s+\S+)?", line):
                        if "steady-pipes.py" in line and rel == "fence/bin/codex":
                            continue
                        self.assertEqual((m.group(1) or "").strip(), "-I", "%s:%d: %s" % (rel, n, line.strip()))

    def test_the_proof_runs_from_a_folder_agents_cannot_write(self):
        with open(os.path.join(FENCE, "prove.sh"), encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn('mkdir -p "$WS" && cd / || exit 1', text)
        self.assertNotIn('cd "$WS" ||', text)
        # Fenced calls go into the task folder in a subshell only.
        self.assertIn('inside() { (cd "$WS" && ', text)
        # The provider-mode answer checks get a folder of their own, removed again.
        self.assertEqual(text.count('once="$(mktemp -d "$STATE_DIR/tasks/_proof-answer.XXXXXX")"'), 2)
        self.assertEqual(text.count('rm -rf "$once"'), 2)

    def test_helpers_start_isolated_from_a_planted_folder(self):
        # Each helper the scripts start with -I, from a folder full of planted
        # modules: it gets as far as its own refusal or usage line, and imports
        # nothing planted (fence_inputs.py still finds model_mode beside it).
        tmp = tempfile.mkdtemp(prefix="fence-cwd-")
        try:
            mark = os.path.join(tmp, "MARK")
            plant(tmp, mark)
            for name, want in (("fence_inputs.py", 78), ("model_mode.py", 64), ("codex_home.py", 78),
                               ("fence_plan.py", 78)):
                r = subprocess.run(["/usr/bin/python3", "-I", os.path.join(FENCE, name)], cwd=tmp,
                                   input="", capture_output=True, text=True, timeout=30)
                self.assertEqual(r.returncode, want, name + ": " + r.stderr)
                self.assertNotIn("Error", r.stderr, name)
                self.assertFalse(os.path.exists(mark), name)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_isolation_is_what_stops_the_import(self):
        # The test above means something: without -I the planted module runs.
        tmp = tempfile.mkdtemp(prefix="fence-cwd-")
        try:
            mark = os.path.join(tmp, "MARK")
            plant(tmp, mark)
            bare = subprocess.run(["/usr/bin/python3", "-c", "import json"], cwd=tmp, capture_output=True)
            self.assertEqual(bare.returncode, 99)
            os.remove(mark)
            iso = subprocess.run(["/usr/bin/python3", "-I", "-c", "import json,re,hmac"], cwd=tmp,
                                 capture_output=True)
            self.assertEqual(iso.returncode, 0)
            self.assertFalse(os.path.exists(mark))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class WrapperTests(unittest.TestCase):
    """Both wrappers, run from a task folder full of planted modules, in both modes."""

    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="fence-cwd-"))
        self.engine = os.path.join(self.tmp, "engine")
        os.makedirs(os.path.join(self.engine, "fence", "bin"))
        os.makedirs(os.path.join(self.engine, "lib"))
        for name in ("claude", "codex"):
            shutil.copy2(os.path.join(FENCE, "bin", name), os.path.join(self.engine, "fence", "bin", name))
        for name in ("codex_home.py", "model_mode.py", "claude_skills.py"):
            shutil.copy2(os.path.join(FENCE, name), os.path.join(self.engine, "fence", name))
        for name in ("config.py", "config.sh"):
            shutil.copy2(os.path.join(ENGINE, "lib", name), os.path.join(self.engine, "lib", name))
        fence_run = os.path.join(self.engine, "fence", "fence-run")
        with open(fence_run, "w") as fh:
            fh.write(STAND_IN)
        os.chmod(fence_run, 0o755)
        program = os.path.join(self.engine, "node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex")
        os.makedirs(os.path.dirname(program))
        with open(program, "w") as fh:
            fh.write("#!/bin/sh\nexit 0\n")
        os.chmod(program, 0o755)
        with open(os.path.join(ENGINE, "config.json"), encoding="utf-8") as fh:
            cfg = json.load(fh)
        self.state = os.path.join(self.tmp, "state")
        cfg["stateRoot"] = self.state
        cfg["paperclip"]["instanceRoot"] = os.path.join(self.tmp, "instance")
        with open(os.path.join(self.engine, "config.json"), "w", encoding="utf-8") as fh:
            json.dump(cfg, fh)
        os.makedirs(os.path.join(self.tmp, "instance"))
        os.makedirs(self.state)
        self.write_private(os.path.join(self.state, "agent.env"), "PROOF_ONLY=1\n")
        self.task = os.path.join(self.tmp, "task")
        os.makedirs(self.task)
        self.mark = os.path.join(self.tmp, "IMPORTED")
        plant(self.task, self.mark)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write_private(self, path, text):
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        with open(path, "w") as fh:
            fh.write(text)
        os.chmod(path, 0o600)

    def provider(self):
        self.write_private(os.path.join(self.state, "models", "state.json"), json.dumps(
            {"version": 1, "mode": "provider", "picks": {"builder": {"model": "claude-fable-5-1"},
                                                         "checker": {"model": "claude-gpt-6-1-sol"}}}))
        self.write_private(os.path.join(self.state, "ids.json"),
                           json.dumps({"agents": {"builder": AGENT_A, "checker": AGENT_A.replace("1", "7")}}))
        self.write_private(os.path.join(self.state, "secrets", "provider", "relay-secret"), "c" * 64 + "\n")

    def run_wrapper(self, name, args, agent_id):
        env = {k: v for k, v in os.environ.items()
               if k not in ("PAPERCLIP_AGENT_ID", "CODEX_HOME", "ENGINE_CONFIG", "CLAUDE_CONFIG_DIR")}
        env["PAPERCLIP_AGENT_ID"] = agent_id
        return subprocess.run([os.path.join(self.engine, "fence", "bin", name)] + args, cwd=self.task,
                              env=env, capture_output=True, text=True, timeout=60)

    def check_both(self):
        for name, args, agent in (("claude", ["-p", "hi"], AGENT_A),
                                  ("codex", ["exec", "--json", "-"], AGENT_A.replace("1", "7")),
                                  ("claude", ["--fence-check", "true"], AGENT_A),
                                  ("codex", ["--fence-check", "true"], AGENT_A)):
            r = self.run_wrapper(name, args, agent)
            self.assertEqual(r.returncode, 0, "%s %s: %s" % (name, args, r.stderr))
            self.assertIn("arg=", r.stdout)
            self.assertFalse(os.path.exists(self.mark), "%s imported a planted module" % name)

    def test_plans_mode_imports_nothing_from_the_task_folder(self):
        self.check_both()

    def test_provider_mode_imports_nothing_from_the_task_folder(self):
        self.provider()
        self.check_both()


if __name__ == "__main__":
    unittest.main()
