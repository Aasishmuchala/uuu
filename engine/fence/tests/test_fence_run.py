"""fence-run's part of PLAN-V5 (K2d, K2e, T15): the exported paths, the doors'
lines, the walled agent's folder and gate address, and an ordinary run that is
today's run apart from the two new paths.

Each test runs a copy of fence-run in a temp engine whose config puts the state
folder and paperclip's instance in the same temp folder. Stand-ins take the
place of fence_inputs.py, fence_plan.py, door_mode.py and the sandbox tool; each
records what it was given, so no sandbox, no program and no planner is started.
The door token is made up.

Run: /usr/bin/python3 -m unittest discover -s engine/fence/tests -p 'test_fence_run.py'
"""
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest

FENCE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.dirname(FENCE)
AGENT = "11111111-2222-4333-8444-555555555555"
TOKEN = "v1.a.%s.1799999999.%s" % (AGENT, "d" * 64)
DOOR_LINES = "UUU_WEB_URL=http://127.0.0.1:3130\nUUU_WEB_TOKEN=%s\n" % TOKEN

# Each stand-in finds the test's answers and writes its records beside itself.
INPUTS_STAND_IN = """import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
json.dump({"argv": sys.argv[1:], "env": sorted(os.environ)}, open(os.path.join(here, "inputs-given"), "w"))
sys.stdout.write(open(os.path.join(here, "inputs-answer")).read())
"""
PLAN_STAND_IN = """import os, sys
here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, "plan-given"), "w").write(sys.stdin.read())
path = os.path.join(here, "settings.json")
open(path, "w").write("{}")
print(path)
"""
DOORS_STAND_IN = """import json, os, stat, sys
here = os.path.dirname(os.path.abspath(__file__))
st, null = os.fstat(0), os.stat("/dev/null")
json.dump({"argv": sys.argv[1:], "stdinNull": stat.S_ISCHR(st.st_mode) and st.st_rdev == null.st_rdev},
          open(os.path.join(here, "doors-given"), "w"))
answer = os.path.join(here, "doors-answer")
sys.stdout.write(open(answer).read() if os.path.exists(answer) else "")
code = os.path.join(here, "doors-exit")
sys.exit(int(open(code).read()) if os.path.exists(code) else 0)
"""
SRT_STAND_IN = """#!/bin/bash
echo "cwd=$(pwd -P)"
env | LC_ALL=C sort | sed 's/^/env:/'
for a in "$@"; do echo "arg=$a"; done
"""
# Today's command around the program (fence-run before PLAN-V5), for an ordinary run.
INNER = ["env", "-u", "PAPERCLIP_LISTEN_HOST", "-u", "PAPERCLIP_LISTEN_PORT", "-u", "OPENAI_API_KEY",
         "-u", "ANTHROPIC_API_KEY"]


class FenceRunTests(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="fence-run-"))
        self.engine = os.path.join(self.tmp, "engine")
        self.fence = os.path.join(self.engine, "fence")
        os.makedirs(os.path.join(self.fence, "bin"))
        os.makedirs(os.path.join(self.engine, "lib"))
        self.fence_run = os.path.join(self.fence, "fence-run")
        shutil.copy2(os.path.join(FENCE, "fence-run"), self.fence_run)
        for name in ("config.py", "config.sh"):
            shutil.copy2(os.path.join(ENGINE, "lib", name), os.path.join(self.engine, "lib", name))
        for name, text in (("fence_inputs.py", INPUTS_STAND_IN), ("fence_plan.py", PLAN_STAND_IN),
                           ("door_mode.py", DOORS_STAND_IN)):
            with open(os.path.join(self.fence, name), "w") as fh:
                fh.write(text)
        srt = os.path.join(self.engine, "node_modules", ".bin", "srt")
        os.makedirs(os.path.dirname(srt))
        with open(srt, "w") as fh:
            fh.write(SRT_STAND_IN)
        os.chmod(srt, 0o755)
        with open(os.path.join(ENGINE, "config.json"), encoding="utf-8") as fh:
            cfg = json.load(fh)
        self.state = os.path.join(self.tmp, "state")
        cfg["stateRoot"] = self.state
        cfg["paperclip"]["instanceRoot"] = os.path.join(self.tmp, "instance")
        with open(os.path.join(self.engine, "config.json"), "w", encoding="utf-8") as fh:
            json.dump(cfg, fh)
        self.gate = "http://127.0.0.1:%d" % cfg["ports"]["gate"]
        self.narrow = "http://127.0.0.1:%d" % cfg["ports"]["gateNarrow"]
        self.task = os.path.join(self.state, "tasks", "company-work", "STH-1")
        self.research = os.path.join(self.state, "tasks", "research")
        self.goal = os.path.join(self.research, "STH-12")
        os.makedirs(self.task)
        os.makedirs(self.research, mode=0o755)
        self.answer()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def answer(self, work="", narrow=""):
        """What the stand-in fence_inputs.py prints: five lines, as the real one."""
        with open(os.path.join(self.fence, "inputs-answer"), "w") as fh:
            fh.write('{"x":1}\n\n\n%s\n%s\n' % (work, narrow))

    def doors(self, text, code=0):
        with open(os.path.join(self.fence, "doors-answer"), "w") as fh:
            fh.write(text)
        with open(os.path.join(self.fence, "doors-exit"), "w") as fh:
            fh.write(str(code))

    def given(self, name):
        path = os.path.join(self.fence, name)
        if not os.path.exists(path):
            return None
        with open(path) as fh:
            return json.load(fh)

    def run_fence(self, agent=AGENT, extra=None):
        env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": os.environ.get("HOME", "/"), "LANG": "C"}
        if agent is not None:
            env["PAPERCLIP_AGENT_ID"] = agent
        env.update(extra or {})
        return subprocess.run([self.fence_run, "--", "/bin/echo", "hi"], cwd=self.task, env=env,
                              capture_output=True, text=True, timeout=60)

    def seen(self, r):
        self.assertEqual(r.returncode, 0, r.stderr)
        env, args, cwd = {}, [], None
        for line in r.stdout.splitlines():
            if line.startswith("env:"):
                k, _, v = line[4:].partition("=")
                env[k] = v
            elif line.startswith("arg="):
                args.append(line[4:])
            elif line.startswith("cwd="):
                cwd = line[4:]
        return env, args, cwd

    def refused(self, r, words=None):
        self.assertEqual(r.returncode, 78, r.stdout + r.stderr)
        self.assertNotIn("arg=", r.stdout)
        self.assertIn("fence: ", r.stderr)
        if words:
            self.assertIn(words, r.stderr)
        self.assertNotIn(TOKEN, r.stdout + r.stderr)

    def uuu(self, env):
        return {k: v for k, v in env.items() if k.startswith("UUU_")}

    def test_exports_appear_and_the_brand_ones_only_when_both_files_exist(self):
        base = {"UUU_KNOWLEDGE_DIR": os.path.join(self.state, "knowledge", "docs"),
                "UUU_PLAYBOOKS_DIR": os.path.join(self.state, "playbooks"),
                "UUU_RESEARCH_DIR": self.research}
        env, _, _ = self.seen(self.run_fence())
        self.assertEqual(self.uuu(env), base)
        python = os.path.join(self.state, "art", "venv", "bin", "python")
        check = os.path.join(self.state, "art", "tools", "brandcheck.py")
        os.makedirs(os.path.dirname(python))
        open(python, "w").close()
        env, _, _ = self.seen(self.run_fence())
        self.assertEqual(self.uuu(env), base)
        os.makedirs(os.path.dirname(check))
        open(check, "w").close()
        env, _, _ = self.seen(self.run_fence())
        self.assertEqual(self.uuu(env), dict(base, UUU_BRAND_PY=python, UUU_BRAND_CHECK=check))
        os.remove(python)
        env, _, _ = self.seen(self.run_fence())
        self.assertEqual(self.uuu(env), base)

    def test_an_ordinary_run_is_todays_run_but_for_the_two_paths(self):
        for agent in (AGENT, None):
            env, args, cwd = self.seen(self.run_fence(agent))
            self.assertEqual(cwd, self.task)
            inner_tmp = os.path.join(self.state, "claude-home", "_none", "tmp")
            self.assertEqual(args, ["-s", os.path.join(self.fence, "settings.json"), "--"] + INNER + [
                "TMPDIR=" + inner_tmp, "CLAUDE_CODE_TMPDIR=" + inner_tmp, "TMPPREFIX=" + inner_tmp + "/zsh",
                "NO_PROXY=", "no_proxy=", "PAPERCLIP_API_URL=" + self.gate,
                "PAPERCLIP_RUNTIME_API_URL=" + self.gate, "/bin/echo", "hi"])
            self.assertEqual(env["PAPERCLIP_API_URL"], self.gate)
            self.assertEqual(env["PAPERCLIP_RUNTIME_API_URL"], self.gate)
            self.assertEqual(sorted(self.uuu(env)), ["UUU_KNOWLEDGE_DIR", "UUU_PLAYBOOKS_DIR", "UUU_RESEARCH_DIR"])
            self.assertEqual(self.given("inputs-given")["argv"][:4], ["--tool", "claude", "--task-folder", self.task])

    def test_door_lines_are_exported_and_door_mode_runs_isolated(self):
        self.doors(DOOR_LINES)
        r = self.run_fence()
        env, args, _ = self.seen(r)
        self.assertEqual(env["UUU_WEB_URL"], "http://127.0.0.1:3130")
        self.assertEqual(env["UUU_WEB_TOKEN"], TOKEN)
        self.assertFalse([a for a in args if TOKEN in a])
        self.assertNotIn(TOKEN, r.stderr)
        self.assertEqual(self.given("doors-given"), {"argv": ["--for-run", "--agent", AGENT], "stdinNull": True})
        with open(self.fence_run) as fh:
            self.assertIn('/usr/bin/python3 -I "$HERE/door_mode.py" --for-run --agent "$AGENT_ID" </dev/null',
                          fh.read())

    def test_no_agent_id_asks_for_no_doors(self):
        self.doors(DOOR_LINES)
        env, _, _ = self.seen(self.run_fence(None))
        self.assertIsNone(self.given("doors-given"))
        self.assertNotIn("UUU_WEB_TOKEN", env)

    def test_a_door_line_of_another_shape_is_refused(self):
        bad = [
            "UUU_WEB_TOKEN=v1.a b",              # a space
            "UUU_WEB_TOKEN=v1=a",                # a second =
            "UUU_WEB_KEY=x",                     # a name outside the pattern
            "UUU_BENCH_URL=http://127.0.0.1:1",
            "uuu_web_url=http://127.0.0.1:3130",
            "PATH=/tmp",
            " UUU_WEB_URL=http://127.0.0.1:3130",
            "UUU_WEB_URL=",
            "UUU_WEB_URL=\tx",
            "UUU_WEB_TOKEN=" + "x" * 201,
            "UUU_WEB_TOKEN=café",
            "UUU_WEB_URL=http://127.0.0.1:3130\n\nUUU_WEB_TOKEN=x",
            "UUU_WEB_TOKEN=x\nUUU_WEB_TOKEN=y",  # one name twice
        ]
        for line in bad:
            with self.subTest(line=line):
                self.doors("UUU_GENERATE_TOKEN=%s\n%s\n" % (TOKEN, line))
                self.refused(self.run_fence())
        self.doors("UUU_WEB_TOKEN=" + "x" * 200 + "\n")
        self.seen(self.run_fence())

    def test_door_mode_refusing_refuses_the_run(self):
        self.doors(DOOR_LINES, code=78)
        self.refused(self.run_fence(), "the doors for this run could not be worked out")
        self.doors("", code=1)
        self.refused(self.run_fence())

    def test_an_inherited_door_token_is_cleared_before_anything_is_read(self):
        inherited = {"UUU_WEB_TOKEN": "made-up-inherited", "UUU_WEB_URL": "http://127.0.0.1:1",
                     "UUU_PLAYBOOKS_DIR": "/tmp/elsewhere"}
        env, _, _ = self.seen(self.run_fence(extra=inherited))
        self.assertNotIn("UUU_WEB_TOKEN", env)
        self.assertNotIn("UUU_WEB_URL", env)
        self.assertEqual(env["UUU_PLAYBOOKS_DIR"], os.path.join(self.state, "playbooks"))
        self.assertFalse([k for k in self.given("inputs-given")["env"] if k.startswith("UUU_")])

    def test_a_walled_run_changes_folder_and_gate_address(self):
        self.answer(self.goal, self.narrow)
        self.doors(DOOR_LINES)
        env, args, cwd = self.seen(self.run_fence())
        self.assertEqual(cwd, self.goal)
        self.assertEqual(env["PAPERCLIP_API_URL"], self.narrow)
        self.assertEqual(env["PAPERCLIP_RUNTIME_API_URL"], self.narrow)
        self.assertIn("PAPERCLIP_API_URL=" + self.narrow, args)
        self.assertIn("PAPERCLIP_RUNTIME_API_URL=" + self.narrow, args)
        self.assertFalse([a for a in args if self.gate in a])
        self.assertEqual(env["UUU_KNOWLEDGE_DIR"], os.path.join(self.state, "knowledge", "shared"))
        self.assertNotIn("UUU_RESEARCH_DIR", env)
        self.assertEqual(env["UUU_PLAYBOOKS_DIR"], os.path.join(self.state, "playbooks"))
        self.assertEqual(env["UUU_WEB_TOKEN"], TOKEN)
        # The goal's folder is made when missing: a plain folder of the owner's, closed to others.
        self.assertEqual(stat.S_IMODE(os.stat(self.goal).st_mode), 0o700)
        os.rmdir(self.goal)
        _, _, cwd = self.seen(self.run_fence())
        self.assertEqual(cwd, self.goal)
        self.assertEqual(stat.S_IMODE(os.stat(self.goal).st_mode), 0o700)
        # The research folder too, when it is not there yet; and a goal folder left open is closed.
        shutil.rmtree(self.research)
        _, _, cwd = self.seen(self.run_fence())
        self.assertEqual(cwd, self.goal)
        os.chmod(self.goal, 0o755)
        self.seen(self.run_fence())
        self.assertEqual(stat.S_IMODE(os.stat(self.goal).st_mode), 0o700)

    def test_the_task_id_goes_to_fence_inputs_and_the_key_only_by_the_environment(self):
        key = "pcp_secret_key_%s" % ("k" * 30)
        task = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        self.seen(self.run_fence(extra={"PAPERCLIP_TASK_ID": task, "PAPERCLIP_API_KEY": key}))
        given = self.given("inputs-given")
        self.assertEqual(given["argv"][given["argv"].index("--task-id") + 1], task)
        self.assertNotIn(key, " ".join(given["argv"]))
        self.assertIn("PAPERCLIP_API_KEY", given["env"])
        # Whatever is not the board's id shape goes on as nothing.
        for bad in ("", "../x", "STH-12", task.upper(), task + "\n", task[:-1], "x" * 400, "$(id)"):
            with self.subTest(task=bad):
                self.seen(self.run_fence(extra={"PAPERCLIP_TASK_ID": bad, "PAPERCLIP_API_KEY": key}))
                given = self.given("inputs-given")
                self.assertEqual(given["argv"][given["argv"].index("--task-id") + 1], "")
                self.assertNotIn(key, " ".join(given["argv"]))
        self.seen(self.run_fence())
        given = self.given("inputs-given")
        self.assertEqual(given["argv"][given["argv"].index("--task-id") + 1], "")
        # Nothing the run is given shows the key on the sandbox tool's command line.
        _, args, _ = self.seen(self.run_fence(extra={"PAPERCLIP_TASK_ID": task, "PAPERCLIP_API_KEY": key}))
        self.assertNotIn(key, " ".join(args))

    def test_a_walled_folder_that_is_not_one_goals_is_refused(self):
        tasks = os.path.join(self.state, "tasks")
        elsewhere = os.path.join(self.tmp, "elsewhere")
        os.makedirs(elsewhere)
        os.symlink(elsewhere, os.path.join(tasks, "linked"))
        os.makedirs(os.path.join(tasks, "open"))
        os.chmod(os.path.join(tasks, "open"), 0o777)
        os.makedirs(os.path.join(self.research, "GOL-7"))
        os.symlink(os.path.join(self.research, "GOL-7"), os.path.join(self.research, "LNK-1"))
        os.symlink(elsewhere, os.path.join(self.research, "LNK-2"))
        for work in (elsewhere, os.path.join(self.state, "knowledge"), tasks, tasks + "/", self.research,
                     self.research + "/", os.path.join(self.research, "GOL-7", "deeper"),
                     os.path.join(self.research, "sth-12"), os.path.join(self.research, "STH-0"),
                     os.path.join(self.research, "STH-12", ".."), os.path.join(self.research, "STH-12", "..", "GOL-7"),
                     os.path.join(self.research, "LNK-1"), os.path.join(self.research, "LNK-2"),
                     os.path.join(self.research, "LNK-2", "STH-1"),
                     os.path.join(tasks, "company-work", "STH-12"),
                     tasks + "/../research/STH-12", tasks + "/research/./STH-12", tasks + "//research/STH-12",
                     tasks + "/research//STH-12",
                     os.path.join(tasks, "linked"), os.path.join(tasks, "linked", "STH-12"),
                     os.path.join(tasks, "open"), "research", "STH-12"):
            with self.subTest(work=work):
                self.answer(work, self.narrow)
                self.refused(self.run_fence())
        # Nothing was made through a link, and no other goal's folder was touched.
        self.assertEqual(os.listdir(elsewhere), [])
        self.assertEqual(os.listdir(os.path.join(self.research, "GOL-7")), [])
        # A research folder that is itself a link is not used to make a goal's folder in.
        shutil.rmtree(self.research)
        os.symlink(elsewhere, self.research)
        self.answer(self.goal, self.narrow)
        self.refused(self.run_fence())
        self.assertEqual(os.listdir(elsewhere), [])
        os.remove(self.research)
        os.makedirs(self.research, mode=0o777)
        os.chmod(self.research, 0o777)
        self.refused(self.run_fence())
        os.chmod(self.research, 0o755)
        for narrow in ("http://127.0.0.1:3111/x", "http://localhost:3111", "https://127.0.0.1:3111",
                       "http://127.0.0.1:311111", "http://10.0.0.1:3111"):
            with self.subTest(narrow=narrow):
                self.answer(self.goal, narrow)
                self.refused(self.run_fence())
        for work, narrow in ((self.goal, ""), ("", self.narrow)):
            self.answer(work, narrow)
            self.refused(self.run_fence(), "only half")

    def test_no_token_in_the_fence_calls_log(self):
        self.doors(DOOR_LINES)
        self.seen(self.run_fence())
        self.answer(self.goal, self.narrow)
        self.seen(self.run_fence())
        with open(os.path.join(self.state, "logs", "fence-calls.log")) as fh:
            lines = fh.read().splitlines()
        self.assertEqual(len(lines), 2)
        for line in lines:
            self.assertNotIn(TOKEN, line)
            self.assertNotIn("UUU_", line)
            # The log line stays as it is: time, tool, the folder it was started in, agent id.
            self.assertRegex(line, r"^\S+ claude cwd=%s agent=%s$" % (re.escape(self.task), AGENT))


if __name__ == "__main__":
    unittest.main()
