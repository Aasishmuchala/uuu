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
from unittest import mock

FENCE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, FENCE)
import fence_inputs  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stub_board import StubBoard  # noqa: E402

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


class ModelModeInputTests(unittest.TestCase):
    """The planner's inputs carry the model mode (from model_mode.read_mode) and
    the relay's port (PLAN-V4, C5). The engine config is the real one, with the
    models state file moved into a temp folder."""

    def setUp(self):
        self.dir = os.path.realpath(tempfile.mkdtemp(prefix="fence-inputs-mode-"))
        sys.path.insert(0, os.path.join(os.path.dirname(FENCE), "lib"))
        import config as engine_config
        self.cfg = engine_config.load_config()
        self.cfg["paths"] = dict(self.cfg["paths"], modelsState=os.path.join(self.dir, "state.json"))

    def tearDown(self):
        shutil.rmtree(self.dir)

    def write_state(self, body, mode=0o600):
        path = self.cfg["paths"]["modelsState"]
        with open(path, "w") as fh:
            fh.write(body if isinstance(body, str) else json.dumps(body))
        os.chmod(path, mode)

    def run_main(self):
        out, err = io.StringIO(), io.StringIO()
        args = ["--tool", "claude", "--task-folder", os.path.join(self.dir, "t"),
                "--agent-home", os.path.join(self.dir, "h"), "--inner-tmp", os.path.join(self.dir, "h", "tmp")]
        with mock.patch.object(fence_inputs, "load_engine_config", lambda home: self.cfg), \
                mock.patch.object(fence_inputs, "owner_home", lambda: self.dir), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = fence_inputs.main(args)
            except SystemExit as e:
                code = e.code
        return code, out.getvalue(), err.getvalue()

    def test_no_state_file_is_plans(self):
        code, out, err = self.run_main()
        self.assertEqual(code, 0, err)
        inputs = json.loads(out.splitlines()[0])
        self.assertEqual(inputs["modelMode"], "plans")
        self.assertEqual(inputs["relayPort"], self.cfg["ports"]["relay"])

    def test_provider_file(self):
        self.write_state({"version": 1, "mode": "provider",
                          "picks": {"builder": {"model": "claude-fable-5-1", "source": "ranked"}}})
        code, out, err = self.run_main()
        self.assertEqual(code, 0, err)
        inputs = json.loads(out.splitlines()[0])
        self.assertEqual(inputs["modelMode"], "provider")
        self.assertEqual(inputs["relayPort"], 3120)

    def test_untrusted_state_file_refused(self):
        for body, mode in (({"version": 1, "mode": "provider"}, 0o666),
                           ({"version": 1, "mode": "provider"}, 0o620),
                           ("{nope", 0o600), ({"version": 1, "mode": "off"}, 0o600)):
            self.write_state(body, mode)
            code, out, err = self.run_main()
            self.assertEqual(code, 78, (body, mode))
            self.assertTrue(err.startswith("fence: "), err)
            self.assertEqual(out, "")


class DoorsAndWalledInputTests(unittest.TestCase):
    """PLAN-V5, K2 (c) and (d): the doors a run may reach and a walled agent's
    folder and gate. The engine config is the real one, with every state file
    moved into a temp folder."""

    def setUp(self):
        self.dir = os.path.realpath(tempfile.mkdtemp(prefix="fence-inputs-doors-"))
        os.chmod(self.dir, 0o755)
        sys.path.insert(0, os.path.join(os.path.dirname(FENCE), "lib"))
        import config as engine_config
        self.cfg = engine_config.load_config()
        j = lambda *p: os.path.join(self.dir, *p)  # noqa: E731
        self.cfg["paths"] = dict(self.cfg["paths"], state=self.dir, policy=j("policy"), ids=j("ids.json"),
                                 modelsState=j("models", "state.json"), doorsState=j("doors", "state.json"))
        os.makedirs(j("policy"), mode=0o755)
        os.chmod(j("policy"), 0o755)
        # The board is a stand-in: the run's task (STH-12's child) is this agent's.
        self.board = StubBoard().start()
        self.cfg["ports"] = dict(self.cfg["ports"], board=self.board.port)
        top, mine = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002", self.TASK
        self.board.issues[mine] = {"id": mine, "parentId": top, "identifier": "STH-13", "assigneeAgentId": AGENT}
        self.board.issues[top] = {"id": top, "parentId": None, "identifier": "STH-12", "assigneeAgentId": None}

    def tearDown(self):
        self.board.stop()
        shutil.rmtree(self.dir)

    def write(self, path, body, mode=0o600):
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        with open(path, "w") as fh:
            fh.write(json.dumps(body))
        os.chmod(path, mode)

    def agent(self, slug, **over):
        p = {"agentId": AGENT, "slug": slug, "localServices": [], "readFolders": [], "lessonsFile": None,
             "envFile": None, "taskFolder": "read-write"}
        p.update(over)
        self.write(os.path.join(self.dir, "policy", AGENT + ".json"), p, 0o644)
        self.write(self.cfg["paths"]["ids"], {"agents": {slug: AGENT}})

    def web_on(self):
        self.write(self.cfg["paths"]["doorsState"], {"version": 1, "web": {"on": True}})

    TASK = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001"
    KEY = "pcp_run_key_" + "q" * 40

    def run_main(self, agent_id=AGENT, task_id=None, key=None, expect=0, inner_tmp=None):
        out, err = io.StringIO(), io.StringIO()
        args = ["--tool", "claude", "--task-folder", os.path.join(self.dir, "tasks", "company-work"),
                "--agent-home", os.path.join(self.dir, "h"),
                "--inner-tmp", inner_tmp or os.path.join(self.dir, "h", "tmp"),
                "--agent-id", agent_id, "--task-id", self.TASK if task_id is None else task_id]
        self.assertNotIn(self.KEY, " ".join(args))      # the key is never an argument
        env = {} if key == "" else {"PAPERCLIP_API_KEY": key or self.KEY}
        with mock.patch.object(fence_inputs, "load_engine_config", lambda home: self.cfg), \
                mock.patch.object(fence_inputs, "owner_home", lambda: self.dir), \
                mock.patch.dict(os.environ, env), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = fence_inputs.main(args)
            except SystemExit as e:
                code = e.code
        self.assertNotIn(self.KEY, out.getvalue() + err.getvalue())
        self.assertEqual(code, expect, err.getvalue())
        if expect:
            return out.getvalue(), err.getvalue()
        lines = out.getvalue().split("\n")
        self.assertEqual(len(lines), 8, lines)    # seven lines, each ended by a newline
        self.assertEqual(lines[7], "")
        return json.loads(lines[0]), lines[1:7]

    def test_no_doors_file_no_door(self):
        self.agent("researcher")
        inputs, rest = self.run_main()
        self.assertEqual(inputs["doorPorts"], [])
        self.assertEqual(inputs["doorPortsKnown"], [3111, 3130, 3140, 3150, 3160, 3170] + list(range(3171, 3190)))
        self.assertEqual(inputs["narrowGatePort"], 3111)
        self.assertEqual(inputs["gatePort"], 3110)
        self.assertEqual(inputs["taskFolder"], os.path.join(self.dir, "tasks", "company-work"))
        self.assertEqual(rest, ["", "", "", "", "", ""])
        # Everyone but a walled agent keeps the home and temp folder the wrapper named.
        self.assertEqual((inputs["agentHome"], inputs["innerTmp"]),
                         (os.path.join(self.dir, "h"), os.path.join(self.dir, "h", "tmp")))

    def test_web_on_for_the_policys_slug(self):
        self.agent("researcher")
        self.web_on()
        self.assertEqual(self.run_main()[0]["doorPorts"], [3130])
        self.agent("builder")
        self.assertEqual(self.run_main()[0]["doorPorts"], [])
        # Without an agent id there is no policy and no door.
        self.agent("researcher")
        self.assertEqual(self.run_main(agent_id="")[0]["doorPorts"], [])

    def test_walled_policy(self):
        self.agent("researcher", walled=True)
        self.web_on()
        inputs, rest = self.run_main()
        goal = os.path.join(self.dir, "tasks", "research", "STH-12")
        self.assertEqual(inputs["taskFolder"], goal)
        self.assertEqual(inputs["gatePort"], 3111)
        self.assertEqual(inputs["doorPorts"], [3130])
        # Its Claude home is its goal's own, whatever home the wrapper named, with its temp folder in it.
        home = os.path.join(self.dir, "claude-home", AGENT, "STH-12")
        self.assertEqual(rest, ["", "", goal, "http://127.0.0.1:3111", home, os.path.join(home, "tmp")])
        self.assertEqual((inputs["agentHome"], inputs["innerTmp"]), (home, os.path.join(home, "tmp")))
        # The board was asked at its own address, for the task and its parent, with the run's key.
        self.assertEqual(self.board.seen, [("/api/issues/" + self.TASK, "Bearer " + self.KEY),
                                           ("/api/issues/aaaaaaaa-bbbb-4ccc-8ddd-000000000002", "Bearer " + self.KEY)])
        self.assertEqual(inputs["boardPort"], self.board.port)
        # Only true walls an agent in; the planner refuses any other value.
        # Paperclip's own temp folder for the run is kept.
        run_tmp = os.path.join(self.dir, "T", "paperclip-run-abc")
        os.makedirs(run_tmp)
        inputs, rest = self.run_main(inner_tmp=run_tmp)
        self.assertEqual((inputs["agentHome"], inputs["innerTmp"]), (home, run_tmp))
        self.assertEqual(rest[4:], [home, run_tmp])
        self.agent("researcher", walled="yes")
        inputs, rest = self.run_main()
        self.assertEqual((inputs["gatePort"], rest[2:]), (3110, ["", "", "", ""]))
        self.assertEqual(inputs["agentHome"], os.path.join(self.dir, "h"))

    def test_an_ordinary_agent_never_asks_the_board(self):
        self.agent("builder")
        inputs, rest = self.run_main(task_id="", key="")
        self.assertEqual((inputs["taskFolder"], rest[2:]),
                         (os.path.join(self.dir, "tasks", "company-work"), ["", "", "", ""]))
        self.agent("researcher", walled=False)
        self.run_main()
        self.assertEqual(self.board.seen, [])

    def test_a_walled_run_that_cannot_prove_its_goal_is_refused_with_one_line(self):
        self.agent("researcher", walled=True)
        cases = (("no task id", dict(task_id="")), ("a bad task id", dict(task_id="STH-13")),
                 ("no key", dict(key="")), ("a task of another agent", None), ("a task the board has not got", dict(task_id="aaaaaaaa-bbbb-4ccc-8ddd-0000000000ff")))
        for name, over in cases:
            with self.subTest(name):
                if over is None:
                    self.board.issues[self.TASK]["assigneeAgentId"] = "0741e40b-fd9c-43ca-8f69-fc2abdd86a6d"
                out, err = self.run_main(expect=78, **(over or {}))
                self.assertEqual(out, "")                        # nothing is handed on
                self.assertTrue(err.startswith("fence: ") and err.count("\n") == 1, err)
                self.board.issues[self.TASK]["assigneeAgentId"] = AGENT


class CodexHomeTests(unittest.TestCase):
    """The Codex home is writable inside the fence, and codex_home.py runs outside
    it before the next run. Nothing the agent can plant there may widen the fence:
    skill links only into this company's part of paperclip's skills folder, the
    login chain only through auth.json files in the places it is kept."""
    SCRIPT = os.path.join(FENCE, "codex_home.py")
    CO = "11111111-1111-4111-8111-111111111111"
    AG = "22222222-2222-4222-8222-222222222222"
    OTHER = "33333333-3333-4333-8333-333333333333"

    def setUp(self):
        # The live shape: run home -> company home -> engine home -> ~/.codex/auth.json.
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="codex-home-"))
        self.state = os.path.join(self.tmp, "S")
        self.inst = os.path.join(self.tmp, "I")
        self.home = os.path.join(self.tmp, "home")
        self.owner = os.path.join(self.home, ".codex")
        os.makedirs(os.path.join(self.state, "codex-home"))
        os.makedirs(self.owner)
        self.touch(os.path.join(self.owner, "auth.json"))
        os.symlink(os.path.join(self.owner, "auth.json"), os.path.join(self.state, "codex-home", "auth.json"))
        self.co_home = co_home = os.path.join(self.inst, "companies", self.CO, "codex-home")
        self.run_home = os.path.join(co_home, "skill-runtimes", self.AG, "abc")
        os.makedirs(os.path.join(self.run_home, "skills"))
        os.symlink(os.path.join(self.state, "codex-home", "auth.json"), os.path.join(co_home, "auth.json"))
        os.symlink(os.path.join(co_home, "auth.json"), os.path.join(self.run_home, "auth.json"))
        skill = os.path.join(self.inst, "skills", self.CO, "__versions__", "v1", "r1")
        os.makedirs(skill)
        os.symlink(skill, os.path.join(self.run_home, "skills", "paperclip"))
        self.skill = skill
        # paperclip's own private things, which no agent may ever be given.
        self.touch(os.path.join(self.inst, ".env"), "PRIVATE_MARK=1")
        os.makedirs(os.path.join(self.inst, "db"))
        os.makedirs(os.path.join(self.inst, "companies", self.OTHER, "codex-home"))
        self.touch(os.path.join(self.inst, "companies", self.OTHER, "codex-home", "auth.json"))

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def touch(self, path, text="{}"):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(text)

    def run_script(self, home, company=None):
        """Runs the helper in this process with its home folder pointed at the
        made-up one (the real helper takes it from the user database)."""
        import codex_home
        out, err = io.StringIO(), io.StringIO()
        args = [home, self.state, self.inst, self.CO if company is None else company, self.AG]
        with mock.patch.object(codex_home, "owner_home", lambda: self.home, create=True), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = codex_home.main(args)
            except SystemExit as e:
                code = e.code
        return subprocess.CompletedProcess(args, code, out.getvalue(), err.getvalue())

    def plant_skill(self, target, name="sneaky"):
        os.symlink(target, os.path.join(self.run_home, "skills", name))

    def relink(self, link, target):
        os.remove(link)
        os.symlink(target, link)

    def assert_refused(self, r, text):
        self.assertEqual(r.returncode, 78, r.stdout)
        self.assertIn(text, r.stderr)
        self.assertEqual(r.stdout, "")
        self.assertNotIn("PRIVATE_MARK", r.stderr)

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
        r = subprocess.run([sys.executable, self.SCRIPT, self.owner, self.state, self.inst, self.CO, self.AG],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 78)
        self.assertIn("refusing Codex home", r.stderr)

    def test_script_mode_with_login_file_in_engine_home(self):
        # Run as a script (its home folder the real one): a chain ending in the
        # engine's own login file needs no home folder at all.
        engine_login = os.path.join(self.state, "codex-home", "auth.json")
        os.remove(engine_login)
        self.touch(engine_login)
        r = subprocess.run([sys.executable, self.SCRIPT, self.run_home, self.state, self.inst, self.CO, self.AG],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("write\t%s" % engine_login, r.stdout.splitlines())
        self.assertIn("read\t%s" % self.skill, r.stdout.splitlines())

    # Rule 1: skill links.

    def test_skill_pointing_elsewhere_refused(self):
        self.plant_skill(self.owner)
        self.assert_refused(self.run_script(self.run_home), "sneaky")

    def test_skill_to_paperclip_env_file_refused(self):
        self.plant_skill(os.path.join(self.inst, ".env"))
        r = self.run_script(self.run_home)
        self.assert_refused(r, "the Codex skill sneaky points outside paperclip's skills folder")
        self.assertNotIn(".env", r.stderr)

    def test_skill_to_paperclip_database_refused(self):
        self.plant_skill(os.path.join(self.inst, "db"))
        self.assert_refused(self.run_script(self.run_home), "sneaky")

    def test_skill_to_another_company_login_file_refused(self):
        self.plant_skill(os.path.join(self.inst, "companies", self.OTHER, "codex-home", "auth.json"))
        self.assert_refused(self.run_script(self.run_home), "sneaky")

    def test_skill_of_another_company_refused(self):
        other = os.path.join(self.inst, "skills", self.OTHER, "x")
        os.makedirs(other)
        self.plant_skill(other)
        self.assert_refused(self.run_script(self.run_home), "sneaky")
        # Without a company id, any skill in paperclip's skills folder is still fine.
        self.assertEqual(self.run_script(self.run_home, company="").returncode, 0)

    def test_skill_roots_refused(self):
        for target in (os.path.join(self.inst, "skills"), os.path.join(self.inst, "skills", self.CO)):
            self.plant_skill(target, "root")
            self.assert_refused(self.run_script(self.run_home), "root")
            os.remove(os.path.join(self.run_home, "skills", "root"))

    def test_skill_link_to_link_ending_outside_refused(self):
        hop = os.path.join(self.inst, "skills", self.CO, "hop")
        os.symlink(os.path.join(self.inst, "db"), hop)
        self.plant_skill(hop)
        self.assert_refused(self.run_script(self.run_home), "sneaky")

    def test_no_company_still_only_skills_folder(self):
        self.plant_skill(os.path.join(self.inst, "db"))
        self.assert_refused(self.run_script(self.run_home, company=""), "sneaky")

    # Rule 2: the login chain.

    def test_login_link_to_other_file_name_refused(self):
        self.touch(os.path.join(self.owner, "config.toml"))
        self.relink(os.path.join(self.run_home, "auth.json"), os.path.join(self.owner, "config.toml"))
        self.assert_refused(self.run_script(self.run_home), "login file")

    def test_login_link_to_paperclip_env_file_refused(self):
        self.relink(os.path.join(self.run_home, "auth.json"), os.path.join(self.inst, ".env"))
        r = self.run_script(self.run_home)
        self.assert_refused(r, "login file")
        self.assertNotIn(".env", r.stderr)

    def test_login_link_to_auth_json_elsewhere_refused(self):
        elsewhere = os.path.join(self.inst, "data", "auth.json")
        self.touch(elsewhere)
        self.relink(os.path.join(self.run_home, "auth.json"), elsewhere)
        self.assert_refused(self.run_script(self.run_home), "login file")
        # Nor further down the chain, nor one folder below ~/.codex.
        self.relink(os.path.join(self.run_home, "auth.json"), os.path.join(self.co_home, "auth.json"))
        self.relink(os.path.join(self.state, "codex-home", "auth.json"), elsewhere)
        self.assert_refused(self.run_script(self.run_home), "login file")
        deeper = os.path.join(self.owner, "sub", "auth.json")
        self.touch(deeper)
        self.relink(os.path.join(self.state, "codex-home", "auth.json"), deeper)
        self.assert_refused(self.run_script(self.run_home), "login file")

    def test_login_file_in_home_cannot_lead_on(self):
        elsewhere = os.path.join(self.tmp, "elsewhere", "auth.json")
        self.touch(elsewhere)
        self.relink(os.path.join(self.owner, "auth.json"), elsewhere)
        self.assert_refused(self.run_script(self.run_home), "login file")

    def test_login_chain_ending_in_engine_home_accepted(self):
        engine_login = os.path.join(self.state, "codex-home", "auth.json")
        os.remove(engine_login)
        self.touch(engine_login)
        r = self.run_script(self.run_home)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("write\t%s" % engine_login, r.stdout.splitlines())


class ClaudeSkillsTests(unittest.TestCase):
    """The Claude wrapper shares what the skill links in paperclip's prompt
    bundle point at (T16b: without it Claude loaded no `paperclip` skill)."""
    SCRIPT = os.path.join(FENCE, "claude_skills.py")
    CO = "11111111-1111-4111-8111-111111111111"

    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="claude-skills-"))
        self.inst = os.path.join(self.tmp, "I")
        self.bundle = os.path.join(self.inst, "companies", self.CO, "claude-prompt-cache", "abc")
        self.links = os.path.join(self.bundle, ".claude", "skills")
        os.makedirs(self.links)
        self.skill = os.path.join(self.inst, "skills", self.CO, "__versions__", "v1", "r1")
        os.makedirs(self.skill)
        os.symlink(self.skill, os.path.join(self.links, "paperclip"))
        self.outside = os.path.join(self.tmp, "owner-claude")
        os.makedirs(self.outside)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_script(self, add_dir):
        return subprocess.run([sys.executable, self.SCRIPT, add_dir, self.inst],
                              capture_output=True, text=True)

    def test_skill_targets_listed(self):
        r = self.run_script(self.bundle)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.splitlines(), [self.skill])

    def test_no_skills_folder_prints_nothing(self):
        other = os.path.join(self.inst, "companies", self.CO, "claude-prompt-cache", "empty")
        os.makedirs(other)
        r = self.run_script(other)
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_dangling_link_skipped(self):
        os.symlink(os.path.join(self.inst, "skills", "gone"), os.path.join(self.links, "gone"))
        r = self.run_script(self.bundle)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.splitlines(), [self.skill])

    def test_skill_pointing_elsewhere_refused(self):
        os.symlink(self.outside, os.path.join(self.links, "sneaky"))
        r = self.run_script(self.bundle)
        self.assertEqual(r.returncode, 78)
        self.assertIn("points outside paperclip's folders", r.stderr)
        self.assertEqual(r.stdout, "")

    def test_wrapper_shares_skill_targets(self):
        with open(os.path.join(FENCE, "bin", "claude")) as fh:
            text = fh.read()
        self.assertIn("claude_skills.py", text)
        self.assertIn("--add-dir) share_dir", text)
        self.assertIn('--add-dir=*) share_dir', text)


class ZshTempTests(unittest.TestCase):
    """zsh writes here-documents under TMPPREFIX (default /tmp/zsh, closed by
    the fence). T16b: the Checker's first check failed on it. The live check is
    the proof line "use a here-document in zsh"."""

    def read(self, *parts):
        with open(os.path.join(FENCE, *parts)) as fh:
            return fh.read()

    def test_fence_run_points_zsh_at_the_inner_temp_folder(self):
        text = self.read("fence-run")
        inner_env = text[text.index("INNER_ENV=("):]
        inner_env = inner_env[:inner_env.index(")\n")]
        self.assertIn('TMPPREFIX="$INNER_TMP/zsh"', inner_env)

    def test_codex_shell_keeps_tmpprefix(self):
        text = self.read("bin", "codex")
        names = text[text.index("EXTRA_NAMES='"):].split("\n", 1)[0]
        self.assertIn('"TMPPREFIX"', names)

    def test_proof_checks_a_here_document(self):
        self.assertIn("use a here-document in zsh", self.read("prove.sh"))


class ProofSettingsNamesTests(unittest.TestCase):
    """The review of step 1: the proof tries the sandbox tool's own temp folder,
    and its look through the task folders sees names as this disk folds them."""

    def read(self):
        with open(os.path.join(FENCE, "prove.sh"), encoding="utf-8") as fh:
            return fh.read()

    def test_proof_tries_the_sandbox_tools_temp_folder(self):
        text = self.read()
        self.assertIn('blocked "use the sandbox tool\'s own temp folder to carry files in"', text)
        for attempt in ("mkdir -p /private/tmp/claude/", "mkdir -p /tmp/claude/", "ln -s \"$PWD\" /private/tmp/claude/"):
            self.assertIn(attempt, text)
        self.assertIn("mkdir .agent\u017f", text)

    def test_proof_sees_folded_names(self):
        text = self.read()
        start = text.index('n="$(within 60 /usr/bin/python3 -I -c "') + len('n="$(within 60 /usr/bin/python3 -I -c "')
        code = text[start:text.index('" "$STATE_DIR/tasks"', start)]
        tmp = os.path.realpath(tempfile.mkdtemp(prefix="proof-names-"))
        self.addCleanup(shutil.rmtree, tmp)

        def count():
            r = subprocess.run(["/usr/bin/python3", "-I", "-c", code, tmp], capture_output=True, text=True, timeout=30)
            self.assertEqual(r.returncode, 0, r.stderr)
            return int(r.stdout)
        os.makedirs(os.path.join(tmp, "t1", "a"))
        for ok in ("notes.md", "a/\u017ftory.txt", "AGENTS.txt", "a/my.claude"):
            open(os.path.join(tmp, "t1", ok), "w").close()
        self.assertEqual(count(), 0)
        bad = [".agent\u017f", "a/AGENT\u017f.md", ".mcp.j\u017fon", "\uff23LAUDE.md", "a/.CODEX"]
        for name in bad:
            os.makedirs(os.path.join(tmp, "t1", name))
        self.assertEqual(count(), len(bad))
        # Three levels below the task tree, as the find it replaces; a link is not followed.
        os.makedirs(os.path.join(tmp, "t1", "a", "b", "CLAUDE.md"))
        os.symlink(os.path.join(tmp, "t1"), os.path.join(tmp, "loop"))
        self.assertEqual(count(), len(bad))


if __name__ == "__main__":
    unittest.main()
