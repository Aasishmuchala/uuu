"""The second look at the review of step 2, its findings 1 and 4, turned round
(the attack tests were .router/evidence/v5/t38/second-look/f3_agent_home.py and
f3_goal_lookup.py; both showed the defects, these show them gone):

- Every agent's own home (CLAUDE_CONFIG_DIR, CODEX_HOME) refuses, at its top and
  in every spelling this disk takes, the names its program loads from there as
  settings or instructions (fence_plan.HOME_CONFIG_NAMES), whatever kind of run;
  what the program itself writes there, and such names deeper down, still write.
- A walled run keeps one Claude home per goal, <state>/claude-home/<agent id>/<goal>,
  and can neither read nor write another goal's, nor the folder above them.
- A board answer nested past Python's stack is no answer: the goal lookup fails
  closed with one plain line and exit 78, never a traceback.

The planner's lists are checked as they are; then the real sandbox tool runs each
plant under the settings the planner wrote, when it can start here.

Run: /usr/bin/python3 -I -m unittest discover -s engine/fence/tests -p 'test_agent_home.py'
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FENCE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import test_fence_plan as base  # noqa: E402
from stub_board import StubBoard  # noqa: E402
fence_plan = base.fence_plan
Refused = fence_plan.Refused

AGENT = "d03db636-70c7-4bac-8e29-41665aa8e9a4"
SRT = os.path.join(os.path.dirname(FENCE), "node_modules", ".bin", "srt")
NODE_BIN = os.path.expanduser("~/.nvm/versions/node/v24.13.0/bin")

# What a run might plant in the Claude home for the next run to load, in the spellings
# the disk takes for them (letter case, the long s, the Kelvin sign), and by a move,
# a link or a hard link from its temp folder.
CLAUDE_PLANTS = ["settings.json", "Settings.json", "SETTINGS.JSON", "ſettings.json", "settings.local.json",
                 ".config.json", "remote-settings.json", "skills/x/SKILL.md", "SKILLS/x/SKILL.md",
                 "ſkills/x/SKILL.md", "sKills/x/SKILL.md", "agents/x.md", "Agents/x.md",
                 "commands/x.md", "output-styles/x.md", "rules/x.md", "hooks/x.sh", "plugins/x/plugin.json",
                 "cowork_plugins/x", "workflows/x.md", "routines/x.md", "agent-memory/x/MEMORY.md",
                 "projects/-x/memory/MEMORY.md", "projects/-x/MEMORY/MEMORY.md", "mcp-skill-archives/x",
                 "scheduled_tasks.json", "launch.json", "loop.md", "daemon.json", "daemon/x", "jobs/x",
                 "local/claude", "ide/1.lock", "CLAUDE.md", "claude.md", "CLAUDE.local.md", ".mcp.json",
                 ".claude/settings.json"]
# What the program itself writes there in a run, and names like those above deeper down.
CLAUDE_WRITES = [".claude.json", ".claude.json.tmp.1", "backups/.claude.json.backup.1", "projects/-x/s.jsonl",
                 "projects/-x/s/subagents/agent-1.jsonl", "projects/-x/s/tool-results/t.txt", "sessions/1.json",
                 "session-env/s/sessionstart-hook-0.sh", "shell-snapshots/snapshot-zsh-1.sh",
                 "file-history/s/h@v1", "todos/s.json", "plans/p.md", "tasks/s/1.json", "debug/s.txt",
                 "statsig/x", "telemetry/x", "cache/x", "policy-limits.json", "policy-limits.json.signature.json",
                 ".last-cleanup", "tmp/x", "tmp/repo/.git/hooks/pre-commit", "tmp/pkg/skills/x/SKILL.md",
                 "tmp/settings.json", "tmp/agents/x.md", "projects/-x/s/settings.json", "notes/skills/x"]
# Moved, linked or hard-linked into place whole, from the temp folder.
CLAUDE_MOVES = [("mv-file", "mv tmp/carry/f settings.json"), ("mv-folder", "mv tmp/carry/sk skills"),
                ("symlink", "ln -s tmp/carry/sk skills"), ("hardlink", "ln tmp/carry/f settings.json"),
                ("mv-memory", "mkdir -p projects/-y && mv tmp/carry/m projects/-y/memory")]
CODEX_MOVES = [("mv-file", "mv tmp/carry/f config.toml"), ("mv-folder", "mv tmp/carry/sk skills"),
               ("symlink", "ln -s tmp/carry/sk prompts"), ("hardlink", "ln tmp/carry/f config.toml.paperclip-backup"),
               ("mv-memory", "mv tmp/carry/m memories")]
CODEX_PLANTS = ["config.toml", "Config.toml", "config.toml.paperclip-backup", "config.json", "managed_config.toml",
                "requirements.toml", "instructions.md", "prompts/x.md", "skills/x/SKILL.md",
                "skills/.system/x/SKILL.md", "ſkills/x/SKILL.md", "plugins/x", "hooks.json", "hooks/x",
                "rules/default.rules", "memories/memory_summary.md", "agents/x.toml", "AGENTS.md",
                "AGENTS.override.md", ".codex/config.toml", ".agents/skills/x/SKILL.md"]
CODEX_WRITES = ["sessions/2026/11/13/rollout-1.jsonl", "archived_sessions/x.jsonl", "state_5.sqlite",
                "state_5.sqlite-wal", "logs_2.sqlite", "cache/x", "models_cache.json", "installation_id",
                ".sandbox_migration", "shell_snapshots/x.sh", "thread-writer-locks/x", "log/codex.log",
                "history.jsonl", "version.json", "auth.json", "tmp/x", "tmp/repo/.git/hooks/pre-commit"]


def writable(fs, path):
    return any(path == w or path.startswith(w + os.sep) for w in fs["allowWrite"]) \
        and not base.PlanTests.denied(fs["denyWrite"], path)


class HomeNamesTests(base.PlanTests):
    def home(self, *parts):
        h = os.path.join(self.S, *parts)
        os.makedirs(os.path.join(h, "tmp"), exist_ok=True)
        return h

    def claude_runs(self):
        """Every kind of Claude run, each with the home it would have."""
        h = self.home("claude-home", AGENT)
        yield h, self.inputs(agentHome=h, innerTmp=os.path.join(h, "tmp"))
        yield h, self.new(agentHome=h, innerTmp=os.path.join(h, "tmp"), policy=self.policy(),
                          modelMode="provider", relayPort=3120)
        yield h, self.inputs(agentHome=h, innerTmp=os.path.join(h, "tmp"), policy=self.policy(taskFolder="read-only"))
        n = self.home("claude-home", "_none")
        yield n, self.inputs(agentHome=n, innerTmp=os.path.join(n, "tmp"))
        w = self.walled_home(AGENT)
        yield w, self.walled_inputs()

    def test_the_claude_home_refuses_what_the_program_loads(self):
        for home, i in self.claude_runs():
            fs = fence_plan.plan(i)["filesystem"]
            self.assertIn(home, fs["allowWrite"])
            for name in CLAUDE_PLANTS:
                self.assertFalse(writable(fs, os.path.join(home, name)), (home, name))
            for name in CLAUDE_WRITES:
                self.assertTrue(writable(fs, os.path.join(home, name)), (home, name))

    def test_the_codex_home_refuses_what_the_program_loads(self):
        for home in (self.home("codex-home"), self.home("codex-home", "provider-mode"),
                     os.path.join(self.I, "companies", "c", "codex-home", "skill-runtimes", "a", "d")):
            os.makedirs(os.path.join(home, "tmp"), exist_ok=True)
            for mode in ({}, {"modelMode": "provider", "relayPort": 3120}):
                fs = fence_plan.plan(self.inputs(tool="codex", agentHome=home, innerTmp=os.path.join(home, "tmp"),
                                                 **mode))["filesystem"]
                for name in CODEX_PLANTS:
                    self.assertFalse(writable(fs, os.path.join(home, name)), (home, name))
                for name in CODEX_WRITES:
                    self.assertTrue(writable(fs, os.path.join(home, name)), (home, name))

    def test_each_program_has_its_own_list_and_only_in_its_home(self):
        h = self.home("claude-home", AGENT)
        fs = fence_plan.plan(self.inputs(agentHome=h, innerTmp=os.path.join(h, "tmp")))["filesystem"]
        # Codex's names are nothing to the Claude program, and the task folder keeps every
        # name but those of the task-folder list (CONFIG_NAMES).
        for name in ("config.toml", "prompts/x.md", "memories/x"):
            self.assertTrue(writable(fs, os.path.join(h, name)), name)
        for name in ("settings.json", "skills/x/SKILL.md", "agents/x.md", "commands/x.md", "rules/x.md",
                     "hooks/x", "plugins/x", "projects/-x/memory/MEMORY.md", "config.toml"):
            self.assertTrue(writable(fs, os.path.join(self.task, name)), name)
        c = self.home("codex-home")
        fs = fence_plan.plan(self.inputs(tool="codex", agentHome=c, innerTmp=os.path.join(c, "tmp")))["filesystem"]
        for name in ("settings.json", "commands/x.md", "projects/-x/memory/MEMORY.md"):
            self.assertTrue(writable(fs, os.path.join(c, name)), name)

    def test_the_entries_are_the_home_lists_at_the_top_of_the_home(self):
        h = self.home("claude-home", AGENT)
        deny = fence_plan.plan(self.inputs(agentHome=h, innerTmp=os.path.join(h, "tmp")))["filesystem"]["denyWrite"]
        want = fence_plan._home_deny_entries([h], fence_plan.HOME_CONFIG_NAMES["claude"])
        self.assertEqual(deny[-len(want):], want)
        self.assertEqual(len(set(deny)), len(deny))
        for e in want:
            self.assertTrue(e.startswith(h + "/") and "/**/" not in e, e)
            self.assertNotIn("[ſ", e)
            self.assertNotIn("ſ]", e)
        # A home reached through a link is denied as given and as it really is.
        os.symlink(h, os.path.join(self.S, "claude-home", "alias"))
        alias = os.path.join(self.S, "claude-home", "alias")
        fs = fence_plan.plan(self.inputs(agentHome=alias, innerTmp=os.path.join(h, "tmp")))["filesystem"]
        for root in (alias, h):
            self.assertTrue(self.denied(fs["denyWrite"], os.path.join(root, "settings.json")), root)


class WalledHomeTests(base.PlanTests):
    def test_a_walled_run_has_its_goals_own_home(self):
        i = self.walled_inputs()
        fs = fence_plan.plan(i)["filesystem"]
        home = self.walled_home(AGENT)
        self.assertEqual(i["agentHome"], home)
        self.assertEqual(fs["allowWrite"], [self.goal, home, os.path.join(home, "tmp")])
        parent, other = os.path.dirname(home), self.walled_home(AGENT, "GOL-7")
        for path in (parent, os.path.join(parent, "x"), other, os.path.join(other, ".claude.json"),
                     os.path.join(self.S, "claude-home"), os.path.join(self.S, "claude-home", "_none")):
            self.assertFalse(any(path == r or path.startswith(r + os.sep) for r in fs["allowRead"] + fs["allowWrite"]),
                             path)
        # Paperclip's own folder for the run serves as its temp folder too.
        run = os.path.realpath(tempfile.mkdtemp(prefix="paperclip-run-"))
        self.addCleanup(shutil.rmtree, run, True)
        self.assertEqual(fence_plan.plan(self.walled_inputs(innerTmp=run))["filesystem"]["allowWrite"],
                         [self.goal, home, run])

    def test_a_walled_run_with_any_other_home_is_refused(self):
        # The second look's case first: the one home of the agent, shared by every goal.
        agent_home = os.path.join(self.S, "claude-home", AGENT)
        os.makedirs(os.path.join(agent_home, "tmp"), exist_ok=True)
        self.refused(self.walled_inputs(agentHome=agent_home, innerTmp=os.path.join(agent_home, "tmp")),
                     "its goal's own")
        others = [self.walled_home(AGENT, "GOL-7"), self.walled_home("0741e40b-fd9c-43ca-8f69-fc2abdd86a6d"),
                  os.path.join(self.S, "claude-home", "_none"), os.path.join(self.S, "claude-home"),
                  os.path.join(self.walled_home(AGENT), "deeper"), self.walled_home(AGENT, "sth-12"),
                  os.path.join(self.S, "codex-home", AGENT, self.GOAL),
                  os.path.join(self.I, "companies", "c", "codex-home", AGENT, self.GOAL)]
        for home in others:
            with self.subTest(home=home):
                self.refused(self.walled_inputs(agentHome=home, innerTmp=os.path.join(home, "tmp")), "home")
        # Reached through a link, even one that leads to its own.
        real = self.walled_home(AGENT)
        os.makedirs(real)
        os.symlink(os.path.dirname(real), os.path.join(self.S, "claude-home", "alias"))
        aliased = os.path.join(self.S, "claude-home", "alias", self.GOAL)
        self.refused(self.walled_inputs(agentHome=aliased, innerTmp=os.path.join(real, "tmp")), "home")
        shutil.rmtree(real)
        os.symlink(self.walled_home(AGENT, "GOL-7"), real)
        self.refused(self.walled_inputs(), "home")
        os.remove(real)
        # A policy whose agent id is not the board's shape has no home.
        self.refused(self.walled_inputs(policy=self.walled(agentId="../x")), "home")

    def test_a_walled_runs_temp_folder_is_in_its_home_or_paperclips(self):
        home = self.walled_home(AGENT)
        for tmp in (os.path.join(self.S, "claude-home", AGENT, "tmp"), os.path.join(self.walled_home(AGENT, "GOL-7"), "tmp"),
                    os.path.join(self.S, "claude-home", "_none", "tmp"), home):
            with self.subTest(tmp=tmp):
                self.refused(self.walled_inputs(innerTmp=tmp), "temp folder")
        fence_plan.plan(self.walled_inputs(innerTmp=os.path.join(home, "tmp", "deeper")))

    def test_a_walled_run_is_on_the_claude_program_only(self):
        for mode in ({}, {"modelMode": "provider", "relayPort": 3120}):
            self.refused(self.walled_inputs(tool="codex", **mode), "Claude program")


@unittest.skipUnless(os.path.exists(SRT), "the sandbox tool is not installed")
class UnderTheSandboxTests(base.PlanTests):
    """The planner's settings, written as fence_plan.py writes them, under the real sandbox tool."""

    def sandboxed(self, settings, cwd, script):
        path = os.path.join(self.tmp, "settings.json")
        with open(path, "w") as fh:
            json.dump(settings, fh)
        env = dict(os.environ, PATH=NODE_BIN + ":" + os.environ.get("PATH", "/usr/bin:/bin"), TMPDIR="/tmp")
        p = subprocess.run([SRT, "-s", path, "--", "/bin/sh", "-c", "echo FENCE_UP; " + script], cwd=cwd,
                           capture_output=True, text=True, timeout=90, env=env)
        if "FENCE_UP" not in p.stdout:
            self.skipTest("the sandbox tool could not start here: %s" % p.stderr[-300:])
        return p.stdout

    @staticmethod
    def tries(home, plants, writes, moves):
        q = lambda s: "'" + s.replace("'", "'\\''") + "'"  # noqa: E731
        lines = ["cd %s || exit 9" % q(home), "mkdir -p tmp/carry/sk/x tmp/carry/m && echo x > tmp/carry/f"]
        for n in plants:
            lines.append("(mkdir -p \"$(dirname %s)\" && echo x > %s) 2>/dev/null && echo WROTE:%s || echo REFUSED:%s"
                         % (q(n), q(n), q(n), q(n)))
        for label, cmd in moves:
            lines.append("(%s) 2>/dev/null && echo WROTE:%s || echo REFUSED:%s" % (cmd, label, label))
        for n in writes:
            lines.append("(mkdir -p \"$(dirname %s)\" && echo x > %s) 2>/dev/null && echo WROTE:%s || echo REFUSED:%s"
                         % (q(n), q(n), q(n), q(n)))
        return "; ".join(lines)

    def check(self, out, plants, writes, moves):
        for n in plants + [label for label, _ in moves]:
            self.assertIn("REFUSED:%s\n" % n, out, n)
        for n in writes:
            self.assertIn("WROTE:%s\n" % n, out, n)

    def test_a_claude_agents_home(self):
        home = os.path.join(self.S, "claude-home", AGENT)
        os.makedirs(os.path.join(home, "tmp"))
        out = fence_plan.plan(self.inputs(agentHome=home, innerTmp=os.path.join(home, "tmp")))
        got = self.sandboxed(out, self.task, self.tries(home, CLAUDE_PLANTS, CLAUDE_WRITES, CLAUDE_MOVES))
        self.check(got, CLAUDE_PLANTS, CLAUDE_WRITES, CLAUDE_MOVES)
        for n in ("settings.json", "skills", "agents", "ſkills", "projects/-x/memory", "projects/-y/memory"):
            self.assertFalse(os.path.lexists(os.path.join(home, n)), n)

    def test_a_codex_agents_home(self):
        home = os.path.join(self.S, "codex-home")
        os.makedirs(os.path.join(home, "tmp"))
        out = fence_plan.plan(self.inputs(tool="codex", agentHome=home, innerTmp=os.path.join(home, "tmp")))
        got = self.sandboxed(out, self.task, self.tries(home, CODEX_PLANTS, CODEX_WRITES, CODEX_MOVES))
        self.check(got, CODEX_PLANTS, CODEX_WRITES, CODEX_MOVES)
        for n in ("config.toml", "skills", "prompts", "memories"):
            self.assertFalse(os.path.lexists(os.path.join(home, n)), n)

    def test_a_walled_run_reaches_only_its_goals_home(self):
        i = self.walled_inputs()
        home = i["agentHome"]
        os.makedirs(os.path.join(home, "tmp"))
        other = self.walled_home(AGENT, "GOL-7")
        os.makedirs(other)
        with open(os.path.join(other, ".claude.json"), "w") as fh:
            fh.write("{}")
        parent = os.path.dirname(home)
        out = fence_plan.plan(i)
        script = self.tries(home, CLAUDE_PLANTS, CLAUDE_WRITES, CLAUDE_MOVES) + "; " + "; ".join(
            "(%s) >/dev/null 2>&1 && echo REACHED:%s || echo REFUSED:%s" % (cmd, label, label) for label, cmd in (
                ("read-other", "cat %s/.claude.json" % other), ("list-other", "ls %s" % other),
                ("write-other", "echo x > %s/settings.local" % other), ("list-parent", "ls %s" % parent),
                ("write-parent", "echo x > %s/x" % parent), ("make-goal", "mkdir %s/GOL-8" % parent)))
        got = self.sandboxed(out, self.goal, script)
        self.check(got, CLAUDE_PLANTS, CLAUDE_WRITES, CLAUDE_MOVES)
        for label in ("read-other", "list-other", "write-other", "list-parent", "write-parent", "make-goal"):
            self.assertIn("REFUSED:%s\n" % label, got, label)
        self.assertEqual(sorted(os.listdir(other)), [".claude.json"])
        self.assertEqual(sorted(os.listdir(parent)), ["GOL-7", self.GOAL])


class NestedAnswerTests(unittest.TestCase):
    """Finding 4: an answer under the size cap but nested deeper than Python's stack."""
    TASK = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001"
    KEY = "pcp_run_key_" + "q" * 40

    def setUp(self):
        self.board = StubBoard().start()
        self.addCleanup(self.board.stop)

    def lookup_in_a_child(self):
        # As fence-run runs it: its own python3 -I, so the exit code and stderr are what fence-run sees.
        code = ("import sys; sys.path.insert(0, %r); import fence_inputs; "
                "fence_inputs.goal_identifier(%r, %r, %r, %d)" % (FENCE, self.TASK, AGENT, self.KEY, self.board.port))
        return subprocess.run(["/usr/bin/python3", "-I", "-c", code], capture_output=True, text=True, timeout=60)

    def test_a_deeply_nested_answer_fails_closed_with_one_plain_line(self):
        for body in (b"[" * 200000, b'{"a":' * 50000, b"[" * 5000 + b"]" * 5000,
                     b'{"id":' + b"[" * 100000):
            with self.subTest(body=body[:12]):
                self.assertLess(len(body), 256 * 1024)
                self.board.special = {self.TASK: ("raw", body)}
                p = self.lookup_in_a_child()
                self.assertEqual(p.returncode, 78, p.stderr[-300:])
                self.assertTrue(p.stderr.startswith("fence: ") and p.stderr.count("\n") == 1, p.stderr[-300:])
                self.assertNotIn("Traceback", p.stderr)
                self.assertNotIn(self.KEY, p.stderr + p.stdout)
                self.assertEqual(p.stdout, "")

    def test_the_same_answer_in_process_is_no_answer(self):
        sys.path.insert(0, FENCE)
        import fence_inputs
        self.board.special = {self.TASK: ("raw", b"[" * 200000)}
        self.assertIsNone(fence_inputs._board_get(self.board.port, "/api/issues/" + self.TASK, self.KEY))
        # And a good answer after it still reads.
        self.board.special = {}
        self.board.issues[self.TASK] = {"id": self.TASK, "parentId": None, "identifier": "STH-1",
                                        "assigneeAgentId": AGENT}
        self.assertEqual(fence_inputs.goal_identifier(self.TASK, AGENT, self.KEY, self.board.port), "STH-1")


class ProofChecksTests(unittest.TestCase):
    """The live proof (engine prove) tries the same against the real wrappers and programs."""

    def test_the_proof_tries_the_homes(self):
        with open(os.path.join(FENCE, "prove.sh"), encoding="utf-8") as fh:
            text = fh.read()
        for check in ("leave settings, skills, hooks or memory in its own Claude home for its next run",
                      "still keep its sessions and the program's own state in its own Claude home",
                      "leave settings, instructions, skills or memories in its own Codex home for its next run",
                      "still keep its sessions and the program's own state in its own Codex home",
                      "use its goal's own Claude home",
                      "read or write another goal's Claude home, or list the homes of its goals",
                      "the Researcher answers from inside the fence and keeps its session in its goal's own Claude home"):
            self.assertIn(check, text)
        for attempt in ("echo x > ſettings.json", "mkdir ſkills", "mkdir -p projects/-fence-proof/memory",
                        "mv tmp/.fence-proof-carry skills", "echo x > config.toml.paperclip-backup"):
            self.assertIn(attempt, text)


def load_tests(loader, tests, pattern):
    # Only this file's own; the planner's tests (inherited) run in test_fence_plan.py.
    suite = unittest.TestSuite()
    for cls in (HomeNamesTests, WalledHomeTests, UnderTheSandboxTests, NestedAnswerTests, ProofChecksTests):
        suite.addTests(cls(name) for name in loader.getTestCaseNames(cls) if name in vars(cls))
    return suite


if __name__ == "__main__":
    unittest.main()
