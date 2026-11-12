"""The fence planner: every row of the test-vector table in CONTRACTS 4.1, plus
the refusals that keep wrapper-given paths from opening up protected folders.

Run: /usr/bin/python3 -m unittest discover -s engine/fence/tests -p 'test_*.py'
"""
import fnmatch
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
import fence_plan  # noqa: E402
from fence_plan import Refused, plan  # noqa: E402

CONFIG = {
    "policyPortsAllowed": [8120],
    "readRootsAllowed": ["knowledge/docs", "lessons", "cad"],
    "claudeHosts": ["api.anthropic.com"],
    "codexHosts": ["chatgpt.com", "api.openai.com", "auth.openai.com"],
}


class PlanTests(unittest.TestCase):
    def setUp(self):
        # H is the home folder, S the state folder under it, I paperclip's instance.
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="fence-plan-"))
        self.H = os.path.join(self.tmp, "H")
        self.S = os.path.join(self.H, "S")
        self.I = os.path.join(self.H, "I")
        for d in ("tasks/company-work", "knowledge/docs", "lessons", "secrets/agents",
                  "claude-home/tmp"):
            os.makedirs(os.path.join(self.S, d))
        os.makedirs(os.path.join(self.H, "Documents"))
        os.makedirs(os.path.join(self.I, "workspaces", "w1"))
        os.makedirs(os.path.join(self.I, "isolated-workspaces", "x", "y"))
        self.task = os.path.join(self.S, "tasks", "company-work")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def inputs(self, **over):
        base = {
            "home": self.H, "uid": 501, "state": self.S, "taskFolder": self.task,
            "tool": "claude", "agentHome": os.path.join(self.S, "claude-home"),
            "innerTmp": os.path.join(self.S, "claude-home", "tmp"),
            "nodeRoot": os.path.join(self.H, "node"), "realClaudeDir": os.path.join(self.H, "cc"),
            "instanceRoot": self.I, "gatePort": 3110, "boardPort": 3100,
            "extraRead": [], "extraWrite": [], "policy": None, "config": dict(CONFIG),
        }
        base.update(over)
        return base

    def policy(self, **over):
        p = {
            "agentId": "d03db636-70c7-4bac-8e29-41665aa8e9a4", "slug": "bookkeeper",
            "localServices": [], "readFolders": [], "lessonsFile": None, "envFile": None,
            "taskFolder": "read-write",
        }
        p.update(over)
        return p

    def refused(self, inputs, text=None):
        with self.assertRaises(Refused) as cm:
            plan(inputs)
        if text:
            self.assertIn(text, str(cm.exception))
        return str(cm.exception)

    # Rows of the table, in order.

    def test_claude_no_policy(self):
        out = plan(self.inputs())
        self.assertEqual(out["network"]["allowedDomains"],
                         ["api.anthropic.com", "127.0.0.1:3110", "localhost:3110"])
        i = self.inputs()
        self.assertEqual(out["filesystem"]["allowWrite"], [self.task, i["agentHome"], i["innerTmp"]])
        self.assertIn(self.H, out["filesystem"]["denyRead"])
        self.assertIn("/private/tmp/claude-501", out["filesystem"]["denyRead"])
        self.assertIn("/tmp/claude-501", out["filesystem"]["denyRead"])
        self.assertEqual(out["filesystem"]["denyWrite"],
                         fence_plan.SANDBOX_OWN_TMP
                         + fence_plan._deny_entries([self.task, i["agentHome"], i["innerTmp"]]))
        self.assertEqual(out["network"]["deniedDomains"], [])
        self.assertNotIn("127.0.0.1:3100", out["network"]["allowedDomains"])

    def test_codex_hosts_first(self):
        out = plan(self.inputs(tool="codex"))
        self.assertEqual(out["network"]["allowedDomains"][:3],
                         ["chatgpt.com", "api.openai.com", "auth.openai.com"])
        self.assertEqual(out["network"]["allowedDomains"][3:], ["127.0.0.1:3110", "localhost:3110"])

    def test_home_documents_refused(self):
        self.refused(self.inputs(taskFolder=os.path.join(self.H, "Documents")),
                     "not an agent task folder")

    def test_folder_outside_home_refused(self):
        self.refused(self.inputs(taskFolder="/tmp/elsewhere"), "not an agent task folder")

    def test_state_itself_refused(self):
        self.refused(self.inputs(taskFolder=self.S), "not an agent task folder")

    def test_link_out_of_task_tree_refused(self):
        link = os.path.join(self.S, "tasks", "sneaky")
        os.symlink(os.path.join(self.H, "Documents"), link)
        self.refused(self.inputs(taskFolder=link), "not an agent task folder")

    def test_local_service_last(self):
        out = plan(self.inputs(policy=self.policy(localServices=["127.0.0.1:8120"])))
        self.assertEqual(out["network"]["allowedDomains"][-1], "127.0.0.1:8120")

    def test_board_port_refused(self):
        self.refused(self.inputs(policy=self.policy(localServices=["127.0.0.1:3100"])),
                     "policy for agent bookkeeper")
        # Even with no board port given, 3100 is not on the allowed list.
        i = self.inputs(policy=self.policy(localServices=["127.0.0.1:3100"]))
        del i["boardPort"]
        self.refused(i, "policy for agent bookkeeper")

    def test_local_service_one_plain_spelling(self):
        # The entry is compared as text by the sandbox, so only the one plain
        # spelling of an allowed port is accepted.
        for entry in ("127.0.0.1:08120", "127.0.0.1:8120\n", " 127.0.0.1:8120", "127.0.0.1:8120 ",
                      "127.0.0.1:0", "127.0.0.1:81200"):
            self.refused(self.inputs(policy=self.policy(localServices=[entry])),
                         "policy for agent bookkeeper")

    def test_outside_host_refused(self):
        self.refused(self.inputs(policy=self.policy(localServices=["example.com:443"])),
                     "policy for agent bookkeeper")
        self.refused(self.inputs(policy=self.policy(localServices=["localhost:8120"])),
                     "policy for agent bookkeeper")

    def test_read_folder_read_only(self):
        docs = os.path.join(self.S, "knowledge", "docs")
        out = plan(self.inputs(policy=self.policy(readFolders=[docs])))
        self.assertIn(docs, out["filesystem"]["allowRead"])
        self.assertNotIn(docs, out["filesystem"]["allowWrite"])

    def test_read_secrets_refused(self):
        self.refused(self.inputs(policy=self.policy(readFolders=[os.path.join(self.S, "secrets")])),
                     "policy for agent bookkeeper")

    def test_media_folder_read_only(self):
        media = os.path.join(self.S, "media")
        os.makedirs(media)
        cfg = dict(CONFIG, readRootsAllowed=CONFIG["readRootsAllowed"] + ["media"])
        out = plan(self.inputs(config=cfg, policy=self.policy(readFolders=[media])))
        self.assertIn(media, out["filesystem"]["allowRead"])
        self.assertNotIn(media, out["filesystem"]["allowWrite"])
        self.refused(self.inputs(config=cfg, policy=self.policy(
            readFolders=[os.path.join(self.S, "media", "..", "secrets")])), "policy for agent bookkeeper")
        self.refused(self.inputs(policy=self.policy(readFolders=[media])), "policy for agent bookkeeper")

    def test_missing_read_folder_skipped(self):
        cad = os.path.join(self.S, "cad")
        out = plan(self.inputs(policy=self.policy(readFolders=[cad])))
        self.assertNotIn(cad, out["filesystem"]["allowRead"])

    def test_lessons_file_read_and_write(self):
        f = os.path.join(self.S, "lessons", "builder.md")
        out = plan(self.inputs(policy=self.policy(lessonsFile=f)))
        self.assertIn(f, out["filesystem"]["allowRead"])
        self.assertIn(f, out["filesystem"]["allowWrite"])

    def test_lessons_file_elsewhere_refused(self):
        self.refused(self.inputs(policy=self.policy(lessonsFile=os.path.join(self.S, "secrets", "x"))),
                     "policy for agent bookkeeper")

    def test_task_folder_read_only(self):
        out = plan(self.inputs(policy=self.policy(taskFolder="read-only")))
        self.assertIn(self.task, out["filesystem"]["allowRead"])
        self.assertNotIn(self.task, out["filesystem"]["allowWrite"])

    def test_env_file_elsewhere_refused(self):
        self.refused(self.inputs(policy=self.policy(envFile=os.path.join(self.H, ".ssh", "id"))),
                     "policy for agent bookkeeper")

    # Beyond the table.

    def test_paperclip_trees_accepted(self):
        for t in (os.path.join(self.I, "workspaces", "w1"),
                  os.path.join(self.I, "isolated-workspaces", "x", "y")):
            out = plan(self.inputs(taskFolder=t))
            self.assertEqual(out["filesystem"]["allowWrite"][0], t)

    def test_tree_roots_refused(self):
        for t in (os.path.join(self.S, "tasks"), os.path.join(self.I, "workspaces")):
            self.refused(self.inputs(taskFolder=t), "not an agent task folder")

    def test_env_file_in_place_accepted_and_not_shared(self):
        env = os.path.join(self.S, "secrets", "agents", "bookkeeper.env")
        out = plan(self.inputs(policy=self.policy(envFile=env)))
        self.assertNotIn(env, out["filesystem"]["allowRead"])

    def test_read_folder_link_out_refused(self):
        link = os.path.join(self.S, "knowledge", "docs", "out")
        os.symlink(os.path.join(self.S, "secrets"), link)
        self.refused(self.inputs(policy=self.policy(readFolders=[link])), "leads outside")

    def test_lessons_link_out_refused(self):
        link = os.path.join(self.S, "lessons", "builder.md")
        os.symlink(os.path.join(self.S, "secrets", "agents"), link)
        self.refused(self.inputs(policy=self.policy(lessonsFile=link)), "policy for agent bookkeeper")

    def test_policy_unknown_or_missing_key_refused(self):
        p = self.policy()
        p["extra"] = 1
        self.refused(self.inputs(policy=p), "not one the fence knows")
        p = self.policy()
        del p["taskFolder"]
        self.refused(self.inputs(policy=p), "missing")
        self.refused(self.inputs(policy=self.policy(taskFolder="write")), "taskFolder")

    def test_extra_paths_cannot_open_protected_folders(self):
        for bad in (self.H, self.S, "/", os.path.join(self.S, "secrets", "agents"),
                    os.path.join(self.S, "policy"), os.path.join(self.I, "secrets", "master.key"),
                    os.path.join(self.S, "agent.env"), self.tmp):
            self.refused(self.inputs(extraRead=[bad]))
            self.refused(self.inputs(extraWrite=[bad]))
        self.refused(self.inputs(agentHome=self.H))

    def test_paperclip_private_folders_never_shared(self):
        # Inside paperclip's folder only skills/... and companies/... may be shared.
        os.makedirs(os.path.join(self.I, "db"))
        with open(os.path.join(self.I, ".env"), "w") as fh:
            fh.write("X=1")
        for bad in (os.path.join(self.I, ".env"), os.path.join(self.I, "db"),
                    os.path.join(self.I, "data", "x"), os.path.join(self.I, "workspaces", "w1"),
                    os.path.join(self.I, "logs"), os.path.join(self.I, "skills"),
                    os.path.join(self.I, "companies")):
            self.refused(self.inputs(extraRead=[bad]), "inside paperclip's own folders")
            self.refused(self.inputs(extraWrite=[bad]), "inside paperclip's own folders")
        self.refused(self.inputs(agentHome=os.path.join(self.I, "db")), "inside paperclip's own folders")
        self.refused(self.inputs(innerTmp=os.path.join(self.I, "logs")), "inside paperclip's own folders")

    def test_link_into_paperclip_database_refused(self):
        os.makedirs(os.path.join(self.I, "db"))
        link = os.path.join(self.tmp, "looks-harmless")
        os.symlink(os.path.join(self.I, "db"), link)
        self.refused(self.inputs(extraRead=[link]), "inside paperclip's own folders")
        # And through a link to paperclip's folder itself, as given.
        alias = os.path.join(self.tmp, "I-alias")
        os.symlink(self.I, alias)
        self.refused(self.inputs(instanceRoot=alias, extraRead=[os.path.join(self.I, "db")]),
                     "inside paperclip's own folders")

    def test_paperclip_skills_and_companies_shared(self):
        s = os.path.join(self.I, "skills", "c", "__versions__", "v1", "r1")
        c = os.path.join(self.I, "companies", "c", "codex-home", "auth.json")
        h = os.path.join(self.I, "companies", "c", "codex-home", "skill-runtimes", "a", "d")
        os.makedirs(s)
        os.makedirs(h)
        out = plan(self.inputs(agentHome=h, innerTmp=os.path.join(h, "tmp"),
                               extraRead=[s, c], extraWrite=[]))
        self.assertIn(s, out["filesystem"]["allowRead"])
        self.assertIn(c, out["filesystem"]["allowRead"])
        self.assertIn(h, out["filesystem"]["allowWrite"])

    # Rule 4: where each kind of handed-over path may lie at all.

    def test_engine_folder_is_the_planners_own(self):
        self.assertEqual(fence_plan.ENGINE, os.path.dirname(os.path.realpath(FENCE)))

    def test_agent_home_places(self):
        self.refused(self.inputs(agentHome=os.path.join(self.H, ".ssh"),
                                 innerTmp=os.path.join(self.H, ".ssh", "tmp")), "an agent home must lie")
        outside = os.path.join(self.tmp, "elsewhere")
        self.refused(self.inputs(agentHome=outside, innerTmp=os.path.join(outside, "tmp")),
                     "an agent home must lie")
        # Through a link in the state folder that leads out of it.
        os.makedirs(os.path.join(self.H, ".ssh"))
        os.symlink(os.path.join(self.H, ".ssh"), os.path.join(self.S, "sneaky-home"))
        self.refused(self.inputs(agentHome=os.path.join(self.S, "sneaky-home"),
                                 innerTmp=os.path.join(self.S, "claude-home", "tmp")), "an agent home must lie")
        for h in (os.path.join(self.S, "claude-home"), os.path.join(self.S, "codex-home"),
                  os.path.join(self.I, "companies", "c", "codex-home", "skill-runtimes", "a", "d")):
            os.makedirs(os.path.join(h, "tmp"), exist_ok=True)
            plan(self.inputs(agentHome=h, innerTmp=os.path.join(h, "tmp")))

    def test_temp_folder_places(self):
        self.refused(self.inputs(innerTmp=os.path.join(self.H, "Documents")), "a temp folder must lie")
        self.refused(self.inputs(innerTmp=os.path.join(self.H, "Documents", "paperclip-run-1")),
                     "a temp folder must lie")
        self.refused(self.inputs(innerTmp=os.path.join(self.tmp, "some-run")), "a temp folder must lie")
        run = os.path.join(self.tmp, "T", "paperclip-run-abc")
        os.makedirs(run)
        plan(self.inputs(innerTmp=run))
        # Seen through a link to the folder above (as /var/folders is to /private/var/folders).
        os.symlink(os.path.join(self.tmp, "T"), os.path.join(self.tmp, "T-alias"))
        plan(self.inputs(innerTmp=os.path.join(self.tmp, "T-alias", "paperclip-run-abc")))
        # Named like a run folder, but leading into the home folder.
        os.symlink(os.path.join(self.H, "Documents"), os.path.join(self.tmp, "paperclip-run-x"))
        self.refused(self.inputs(innerTmp=os.path.join(self.tmp, "paperclip-run-x")), "a temp folder must lie")

    def test_extra_write_places(self):
        for bad in (os.path.join(self.H, ".ssh"), "/opt/homebrew/bin", os.path.join(self.I, "skills", "x"),
                    os.path.join(self.H, ".codex", "config.toml")):
            self.refused(self.inputs(extraWrite=[bad]), "for writing")
        for good in (os.path.join(self.H, ".codex", "auth.json"),
                     os.path.join(self.S, "codex-home", "auth.json"),
                     os.path.join(self.I, "companies", "c", "codex-home", "auth.json")):
            plan(self.inputs(extraWrite=[good]))

    def test_extra_read_places_in_home(self):
        engine = os.path.join(self.H, "eng")
        os.makedirs(os.path.join(self.H, ".ssh"))
        os.symlink(os.path.join(self.H, ".ssh"), os.path.join(self.S, "looks-harmless"))
        with mock.patch.object(fence_plan, "ENGINE", engine):
            for bad in (os.path.join(self.H, ".ssh"), os.path.join(self.H, "Documents"),
                        os.path.join(engine, "gate"), os.path.join(engine, "fence"),
                        os.path.join(engine, "node_modules"), os.path.join(self.S, "looks-harmless")):
                self.refused(self.inputs(extraRead=[bad]), "outside the places agents may read")
            good = [os.path.join(self.S, "codex-home", "auth.json"), os.path.join(self.H, ".codex", "auth.json"),
                    os.path.join(self.I, "companies", "c", "agents", "a", "instructions"),
                    os.path.join(self.I, "companies", "c", "claude-prompt-cache", "k"),
                    os.path.join(self.I, "skills", "c", "__versions__", "v", "r"),
                    os.path.join(engine, "node_modules", "@openai"),
                    os.path.join(engine, "fence", "steady-pipes.py")]
            out = plan(self.inputs(extraRead=good))
            for g in good:
                self.assertIn(g, out["filesystem"]["allowRead"])
        # Outside the home folder an extra read keeps the earlier rules.
        plan(self.inputs(extraRead=[os.path.join(self.tmp, "outside", "x")]))

    # In the state folder only claude-home and codex-home are ever handed over.

    STATE_PLACES = ("books", "home", os.path.join("git", "config"), "run", "logs", "content",
                    "lessons", "ids.json", "tasks", "knowledge")

    def test_other_state_places_never_handed_over(self):
        for sub in self.STATE_PLACES:
            p = os.path.join(self.S, sub)
            self.refused(self.inputs(agentHome=p, innerTmp=os.path.join(p, "tmp")), "an agent home must lie")
            self.refused(self.inputs(innerTmp=p), "a temp folder must lie")
            self.refused(self.inputs(extraWrite=[p]), "for writing")
            self.refused(self.inputs(extraRead=[p]), "outside the places agents may read")
        # Named like a run folder, but in the state folder.
        self.refused(self.inputs(innerTmp=os.path.join(self.S, "paperclip-run-1")), "a temp folder must lie")

    def test_other_letter_case_never_opens_protected_places(self):
        # The disk ignores letter case, and so does the sandbox tool.
        up = self.S.upper()
        for bad in (os.path.join(self.S, "SECRETS"), os.path.join(self.S, "Secrets", "agents"),
                    os.path.join(self.S, "AGENT.ENV"), os.path.join(up, "policy"), os.path.join(up, "POLICY"),
                    os.path.join(up, "books"), os.path.join(self.H.upper(), "Documents")):
            self.refused(self.inputs(extraRead=[bad]))
            self.refused(self.inputs(extraWrite=[bad]))
            self.refused(self.inputs(policy=self.policy(readFolders=[bad])), "outside the folders agents may read")
            if bad != os.path.join(self.S, "Secrets", "agents"):
                self.refused(self.inputs(policy=self.policy(envFile=os.path.join(bad, "x.env"))),
                             "must be directly inside")
        # The key folder itself in another spelling is the same folder: accepted, and never shared.
        out = plan(self.inputs(policy=self.policy(envFile=os.path.join(self.S, "Secrets", "agents", "x.env"))))
        self.assertFalse(any("ecrets" in p for p in out["filesystem"]["allowRead"]))
        self.refused(self.inputs(agentHome=os.path.join(up, "BOOKS"), innerTmp=os.path.join(up, "BOOKS", "tmp")))
        self.refused(self.inputs(innerTmp=os.path.join(up, "Books")))

    def test_task_folder_in_other_letter_case(self):
        for bad in (os.path.join(self.S, "SECRETS"), os.path.join(self.S.upper(), "Secrets", "agents"),
                    os.path.join(self.S, "TASKS", "..", "secrets")):
            self.refused(self.inputs(taskFolder=bad), "not an agent task folder")
        os.symlink(os.path.join(self.S, "SECRETS"), os.path.join(self.S, "tasks", "company-work", "s"))
        self.refused(self.inputs(taskFolder=os.path.join(self.S, "tasks", "company-work", "s")),
                     "not an agent task folder")
        # A real task folder in another spelling is the same folder.
        plan(self.inputs(taskFolder=os.path.join(self.S.upper(), "TASKS", "company-work")))

    def test_live_shapes_accepted(self):
        agent = "d03db636-70c7-4bac-8e29-41665aa8e9a4"
        for h in (os.path.join(self.S, "claude-home"), os.path.join(self.S, "claude-home", agent),
                  os.path.join(self.S, "codex-home"),
                  os.path.join(self.I, "companies", "c", "codex-home", "skill-runtimes", "a", "d")):
            os.makedirs(os.path.join(h, "tmp"), exist_ok=True)
            plan(self.inputs(agentHome=h, innerTmp=os.path.join(h, "tmp")))
        run = tempfile.mkdtemp(prefix="paperclip-run-")
        self.addCleanup(shutil.rmtree, run, True)
        real = os.path.realpath(run)
        self.assertTrue(real.startswith("/private/var/folders/"), real)
        for t in (real, real[len("/private"):]):
            plan(self.inputs(innerTmp=t))
        engine = os.path.join(self.H, "eng")
        with mock.patch.object(fence_plan, "ENGINE", engine):
            reads = [os.path.join(self.S, "codex-home", "auth.json"), os.path.join(self.H, ".codex", "auth.json"),
                     os.path.join(self.I, "companies", "c", "codex-home", "auth.json"),
                     os.path.join(self.I, "skills", "c", "__versions__", "v", "r"),
                     os.path.join(engine, "node_modules", "@openai"),
                     os.path.join(engine, "fence", "steady-pipes.py")]
            writes = [os.path.join(self.H, ".codex", "auth.json"), os.path.join(self.S, "codex-home", "auth.json")]
            out = plan(self.inputs(extraRead=reads, extraWrite=writes))
        for p in reads + writes:
            self.assertIn(p, out["filesystem"]["allowRead"])
        for p in writes:
            self.assertIn(p, out["filesystem"]["allowWrite"])

    def test_extra_paths_listed(self):
        r = os.path.join(self.I, "companies", "c", "skills")
        w = os.path.join(self.H, ".codex", "auth.json")
        out = plan(self.inputs(extraRead=[r], extraWrite=[w]))
        self.assertIn(r, out["filesystem"]["allowRead"])
        self.assertIn(w, out["filesystem"]["allowRead"])
        self.assertIn(w, out["filesystem"]["allowWrite"])
        self.assertNotIn(r, out["filesystem"]["allowWrite"])

    def test_bad_inputs_refused(self):
        self.refused(self.inputs(tool="bash"), "tool")
        i = self.inputs()
        del i["gatePort"]
        self.refused(i, "incomplete")
        self.refused(self.inputs(taskFolder="relative/path"), "absolute")
        self.refused(self.inputs(gatePort=3100), "share a port")
        self.refused(None)

    def test_script_mode(self):
        script = os.path.join(FENCE, "fence_plan.py")
        r = subprocess.run([sys.executable, script], input=json.dumps(self.inputs()),
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        path = r.stdout.strip()
        self.assertTrue(path.startswith(os.path.join(self.S, "fences") + "/"))
        with open(path) as fh:
            self.assertEqual(json.load(fh), plan(self.inputs()))
        # A planted file of that name with other content is replaced, not trusted.
        with open(path, "w") as fh:
            fh.write('{"filesystem": {}}')
        r2 = subprocess.run([sys.executable, script], input=json.dumps(self.inputs()),
                            capture_output=True, text=True)
        self.assertEqual(r2.stdout.strip(), path)
        with open(path) as fh:
            self.assertEqual(json.load(fh), plan(self.inputs()))
        bad = subprocess.run([sys.executable, script],
                             input=json.dumps(self.inputs(taskFolder=self.H)),
                             capture_output=True, text=True)
        self.assertEqual(bad.returncode, fence_plan.REFUSED_EXIT)
        self.assertTrue(bad.stderr.startswith("fence: "))
        self.assertIn("not an agent task folder", bad.stderr)
        junk = subprocess.run([sys.executable, script], input="not json",
                              capture_output=True, text=True)
        self.assertEqual(junk.returncode, fence_plan.REFUSED_EXIT)

    # Provider mode (PLAN-V4, C5): the gate and the model relay, and no model host.

    PROVIDER_LIST = ["127.0.0.1:3110", "localhost:3110", "127.0.0.1:3120", "localhost:3120"]

    def provider(self, **over):
        base = {"modelMode": "provider", "relayPort": 3120}
        base.update(over)
        return self.inputs(**base)

    def test_provider_claude_no_policy(self):
        out = plan(self.provider())
        self.assertEqual(out["network"]["allowedDomains"], self.PROVIDER_LIST)
        self.assertEqual(out["network"]["deniedDomains"], [])
        # Only the network changes: the files are exactly those of plans mode.
        self.assertEqual(out["filesystem"], plan(self.inputs())["filesystem"])

    def test_provider_codex_no_policy(self):
        out = plan(self.provider(tool="codex"))
        self.assertEqual(out["network"]["allowedDomains"], self.PROVIDER_LIST)
        self.assertEqual(out["filesystem"], plan(self.inputs(tool="codex"))["filesystem"])

    def test_provider_local_service_last(self):
        for tool in ("claude", "codex"):
            out = plan(self.provider(tool=tool, policy=self.policy(localServices=["127.0.0.1:8120"])))
            self.assertEqual(out["network"]["allowedDomains"], self.PROVIDER_LIST + ["127.0.0.1:8120"])

    def test_provider_no_model_host(self):
        for tool in ("claude", "codex"):
            for policy in (None, self.policy(localServices=["127.0.0.1:8120"])):
                domains = plan(self.provider(tool=tool, policy=policy))["network"]["allowedDomains"]
                for host in CONFIG["claudeHosts"] + CONFIG["codexHosts"]:
                    self.assertFalse(any(host in d for d in domains), (tool, host, domains))
                self.assertTrue(all(d.startswith(("127.0.0.1:", "localhost:")) for d in domains), domains)

    def test_provider_bad_relay_port(self):
        i = self.provider()
        del i["relayPort"]
        self.refused(i, "the model relay")
        for bad in (0, 3110, 3100, -1, 65536, None, True, "3120", 3120.0):
            self.refused(self.provider(relayPort=bad), "the model relay")
        # With no board port given, the relay may not take the gate's port either.
        i = self.provider(relayPort=3110)
        del i["boardPort"]
        self.refused(i, "the model relay")

    def test_provider_needs_the_board_port(self):
        # An unknown board port is not a different one: without it the relay's
        # port could be the board's, so provider mode is refused outright.
        for port in (3120, 3100):
            i = self.provider(relayPort=port)
            del i["boardPort"]
            self.refused(i, "the model relay")

    def test_plans_mode_given_is_today(self):
        # Plans mode named outright is today's fence, whatever relay port comes with it.
        for port in (3120, None, 0, 3110, "x"):
            for tool in ("claude", "codex"):
                self.assertEqual(plan(self.inputs(tool=tool, modelMode="plans", relayPort=port)),
                                 plan(self.inputs(tool=tool)))

    def test_relay_port_never_a_local_service(self):
        # The relay's port is not in policyPortsAllowed, so no policy can name it ...
        self.assertNotIn(3120, CONFIG["policyPortsAllowed"])
        for i in (self.inputs(), self.provider()):
            i["policy"] = self.policy(localServices=["127.0.0.1:3120"])
            self.refused(i, "policy for agent bookkeeper")
        # ... and even an engine config that allowed it could not open it.
        cfg = dict(CONFIG, policyPortsAllowed=[8120, 3120])
        for over in ({"modelMode": "provider"}, {"modelMode": "plans"}):
            i = self.provider(config=cfg, policy=self.policy(localServices=["127.0.0.1:3120"]), **over)
            self.refused(i, "the model relay's port")

    def test_models_folder_guarded(self):
        models = os.path.join(self.S, "models")
        os.makedirs(models)
        for name in ("state.json", "relay-status.json"):
            with open(os.path.join(models, name), "w") as fh:
                fh.write("{}")
        os.symlink(models, os.path.join(self.tmp, "looks-harmless"))
        bad = [models, os.path.join(models, "state.json"), os.path.join(models, "relay-status.json"),
               os.path.join(self.S, "MODELS"), os.path.join(self.S.upper(), "Models", "state.json"),
               os.path.join(self.tmp, "looks-harmless"), os.path.join(self.tmp, "looks-harmless", "state.json")]
        for make in (self.inputs, self.provider):
            for p in bad:
                self.refused(make(extraRead=[p]), "refusing to share")
                self.refused(make(extraWrite=[p]), "refusing to share")
            self.refused(make(agentHome=models, innerTmp=os.path.join(models, "tmp")), "refusing to share")
            self.refused(make(innerTmp=models), "refusing to share")
            self.refused(make(policy=self.policy(readFolders=[models])), "policy for agent bookkeeper")
            self.refused(make(taskFolder=models), "not an agent task folder")
        self.assertIn("/models", self.refused(self.inputs(extraRead=[os.path.join(models, "state.json")])))

    def test_unknown_mode_refused(self):
        for bad in ("Provider", "PLANS", "", "off", None, 1, True, ["provider"], {"mode": "provider"}):
            self.refused(self.inputs(modelMode=bad, relayPort=3120),
                         "the fence was given a model mode it does not know")

    def test_script_mode_provider(self):
        script = os.path.join(FENCE, "fence_plan.py")
        r = subprocess.run([sys.executable, script], input=json.dumps(self.provider()),
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(r.stdout.strip()) as fh:
            self.assertEqual(json.load(fh)["network"]["allowedDomains"], self.PROVIDER_LIST)
        bad = subprocess.run([sys.executable, script], input=json.dumps(self.inputs(modelMode="other")),
                             capture_output=True, text=True)
        self.assertEqual(bad.returncode, fence_plan.REFUSED_EXIT)
        self.assertIn("fence: the fence was given a model mode it does not know", bad.stderr)

    # PLAN-V5, K2 (a), (c), (d), (f), with the corrections after T1: the deny list
    # on every root a run can write, the doors, the walled agent, folders by rule.

    KNOWN = [3111, 3130, 3140, 3150, 3160]

    @property
    def research(self):
        return os.path.join(self.S, "tasks", "research")

    @property
    def shared(self):
        return os.path.join(self.S, "knowledge", "shared")

    @property
    def playbooks(self):
        return os.path.join(self.S, "playbooks")

    def new(self, **over):
        base = {"narrowGatePort": 3111, "doorPortsKnown": list(self.KNOWN), "doorPorts": []}
        base.update(over)
        return self.inputs(**base)

    def walled(self, **over):
        p = self.policy(slug="researcher", walled=True)
        p.update(over)
        return p

    def walled_inputs(self, policy=None, **over):
        os.makedirs(self.research, exist_ok=True)
        base = {"taskFolder": self.research, "gatePort": 3111,
                "policy": policy if policy is not None else self.walled()}
        base.update(over)
        return self.new(**base)

    @staticmethod
    def denied(entries, path):
        # fnmatch's "*" also crosses "/", as the sandbox's "**" does.
        return any(fnmatch.fnmatchcase(path, e) for e in entries)

    def test_deny_names_at_top_and_nested(self):
        i = self.inputs()
        out = plan(i)
        deny = out["filesystem"]["denyWrite"]
        roots = [self.task, i["agentHome"], i["innerTmp"]]
        self.assertEqual(deny[:2], fence_plan.SANDBOX_OWN_TMP)
        deny = deny[2:]
        spellings = sum(len(fence_plan._any_case(n)) for n in fence_plan.CONFIG_NAMES)
        self.assertEqual(len(deny), len(roots) * spellings * 4)
        self.assertEqual(len(set(deny)), len(deny))
        ci = "[Cc][Ll][Aa][Uu][Dd][Ee].[Mm][Dd]"
        for root in roots:
            self.assertEqual([e for e in deny if e[:-len(ci)] in (root + "/", root + "/**/") and e.endswith(ci)],
                             ["%s/%s" % (root, ci), "%s/**/%s" % (root, ci)])
            for name in fence_plan.CONFIG_NAMES:
                for n in fence_plan._any_case(name):
                    for entry in ("%s/%s", "%s/%s/**", "%s/**/%s", "%s/**/%s/**"):
                        self.assertIn(entry % (root, n), deny)
                for spelling in (name, name.lower(), name.upper(), name.swapcase()):
                    for where in ("", "a/", "a/b/"):
                        self.assertTrue(self.denied(deny, "%s/%s%s" % (root, where, spelling)), spelling)
                        self.assertTrue(self.denied(deny, "%s/%s%s/x/y" % (root, where, spelling)), spelling)
            # Ordinary files, and the programs' own files in their homes, still write.
            for ok in ("notes.md", "a/b/out.txt", ".claude.json", "projects/-x-claude/s.jsonl",
                       "my.claude", "CLAUDE.md.txt", "x-AGENTS.md", "agents", "codex/x", "skills/s/SKILL.md"):
                self.assertFalse(self.denied(deny, "%s/%s" % (root, ok)), ok)
        # Nothing else changes: the rest of the settings are those of a planner without the list.
        for key in ("denyRead", "allowRead", "allowWrite"):
            self.assertEqual(out["filesystem"][key], plan(self.new())["filesystem"][key])

    def test_deny_list_same_for_read_only_task(self):
        ro = plan(self.inputs(policy=self.policy(taskFolder="read-only")))
        self.assertNotIn(self.task, ro["filesystem"]["allowWrite"])
        self.assertEqual(ro["filesystem"]["denyWrite"], plan(self.inputs())["filesystem"]["denyWrite"])

    def test_deny_list_covers_every_writable_root(self):
        f = os.path.join(self.S, "lessons", "builder.md")
        w = os.path.join(self.H, ".codex", "auth.json")
        for tool in ("claude", "codex"):
            for mode in ({}, {"modelMode": "provider", "relayPort": 3120}):
                out = plan(self.inputs(tool=tool, extraWrite=[w], policy=self.policy(lessonsFile=f), **mode))
                deny = out["filesystem"]["denyWrite"]
                for root in out["filesystem"]["allowWrite"] + [self.task]:
                    for name in fence_plan.CONFIG_NAMES:
                        for n in fence_plan._any_case(name):
                            self.assertIn("%s/**/%s" % (root, n), deny)

    def test_door_port_added_after_gate(self):
        p = self.policy(localServices=["127.0.0.1:8120"])
        out = plan(self.new(policy=p, doorPorts=[3130]))
        self.assertEqual(out["network"]["allowedDomains"],
                         ["api.anthropic.com", "127.0.0.1:3110", "localhost:3110", "127.0.0.1:3130",
                          "127.0.0.1:8120"])
        out = plan(self.new(policy=p, doorPorts=[3130, 3150], modelMode="provider", relayPort=3120))
        self.assertEqual(out["network"]["allowedDomains"],
                         self.PROVIDER_LIST + ["127.0.0.1:3130", "127.0.0.1:3150", "127.0.0.1:8120"])
        self.assertNotIn("localhost:3130", out["network"]["allowedDomains"])
        # Without a door, the doors' ports appear nowhere.
        domains = plan(self.new(policy=p))["network"]["allowedDomains"]
        self.assertFalse(any(d.endswith(":%d" % k) for d in domains for k in self.KNOWN), domains)

    def test_door_needs_policy(self):
        self.refused(self.new(doorPorts=[3130]), "fence policy")
        # A port that is not a door's is never opened as one.
        self.refused(self.new(policy=self.policy(), doorPorts=[8120]), "door port")
        i = self.inputs(policy=self.policy(), doorPorts=[3130])
        self.refused(i, "door port")

    def test_policy_may_not_name_a_door_port(self):
        cfg = dict(CONFIG, policyPortsAllowed=[8120] + self.KNOWN)
        for port in self.KNOWN:
            self.refused(self.new(config=cfg, policy=self.policy(localServices=["127.0.0.1:%d" % port])),
                         "a door's port")
        plan(self.new(config=cfg, policy=self.policy(localServices=["127.0.0.1:8120"])))

    def test_bad_door_port(self):
        p = self.policy()
        for bad in (0, 3110, 3100, 3120, 3111, -1, 65536, "3130", True, None, 3130.0):
            self.refused(self.new(policy=p, doorPorts=[bad], relayPort=3120,
                                  doorPortsKnown=self.KNOWN + [3110, 3100, 3120, 1]), "door port")
        self.refused(self.new(policy=p, doorPorts=3130), "not a list")
        self.refused(self.new(policy=p, doorPortsKnown="3130"), "not a list")
        self.refused(self.new(policy=p, doorPortsKnown=[0]), "door port")
        for bad in (0, 3100, 3120, "3111", True, 70000):
            self.refused(self.new(narrowGatePort=bad, relayPort=3120), "narrow gate")

    def test_doors_folder_guarded(self):
        doors = os.path.join(self.S, "doors")
        os.makedirs(doors)
        with open(os.path.join(doors, "state.json"), "w") as fh:
            fh.write("{}")
        os.symlink(doors, os.path.join(self.tmp, "looks-harmless"))
        bad = [doors, os.path.join(doors, "state.json"), os.path.join(self.S, "DOORS"),
               os.path.join(self.tmp, "looks-harmless"), os.path.join(self.tmp, "looks-harmless", "state.json")]
        for p in bad:
            self.refused(self.new(extraRead=[p]), "refusing to share")
            self.refused(self.new(extraWrite=[p]), "refusing to share")
        self.refused(self.new(agentHome=doors, innerTmp=os.path.join(doors, "tmp")), "refusing to share")
        self.refused(self.new(innerTmp=doors), "refusing to share")
        self.refused(self.new(taskFolder=doors), "not an agent task folder")

    def test_walled_ok(self):
        for d in (self.shared, self.playbooks):
            os.makedirs(d)
        i = self.walled_inputs()
        out = plan(i)
        fs = out["filesystem"]
        self.assertEqual(fs["allowRead"], [self.research, i["agentHome"], i["innerTmp"], i["nodeRoot"],
                                           os.path.join(self.H, ".local", "bin"), i["realClaudeDir"],
                                           self.playbooks, self.shared])
        self.assertEqual(fs["allowWrite"], [self.research, i["agentHome"], i["innerTmp"]])
        self.assertEqual(fs["denyWrite"],
                         fence_plan.SANDBOX_OWN_TMP + fence_plan._deny_entries(fs["allowWrite"]))
        self.assertEqual(out["network"]["allowedDomains"], ["api.anthropic.com", "127.0.0.1:3111", "localhost:3111"])
        for company in (self.task, os.path.join(self.S, "knowledge", "docs"), os.path.join(self.S, "lessons")):
            self.assertFalse(any(fence_plan._inside(p, company) for p in fs["allowRead"]), company)
        # Its door, and provider mode, change only the network.
        out = plan(self.walled_inputs(doorPorts=[3130], modelMode="provider", relayPort=3120))
        self.assertEqual(out["network"]["allowedDomains"],
                         ["127.0.0.1:3111", "localhost:3111", "127.0.0.1:3120", "localhost:3120", "127.0.0.1:3130"])
        self.assertEqual(out["filesystem"], fs)

    def test_walled_refusals(self):
        self.refused(self.walled_inputs(taskFolder=self.task), "walled")
        os.makedirs(os.path.join(self.research, "STH-1"))
        self.refused(self.walled_inputs(taskFolder=os.path.join(self.research, "STH-1")), "walled")
        shutil.rmtree(self.research)
        os.symlink(self.task, self.research)
        self.refused(self.new(taskFolder=self.research, gatePort=3111, policy=self.walled()))
        os.remove(self.research)
        self.refused(self.walled_inputs(gatePort=3110), "narrow gate")
        i = self.walled_inputs()
        del i["narrowGatePort"]
        self.refused(i, "narrow gate")
        docs = os.path.join(self.S, "knowledge", "docs")
        for over in ({"localServices": ["127.0.0.1:8120"]}, {"readFolders": [docs]},
                     {"envFile": os.path.join(self.S, "secrets", "agents", "r.env")},
                     {"lessonsFile": os.path.join(self.S, "lessons", "r.md")},
                     {"taskFolder": "read-only"}):
            self.refused(self.walled_inputs(policy=self.walled(**over)), "walled agent")
        for bad in ("yes", 1, None, [True]):
            self.refused(self.walled_inputs(policy=self.walled(walled=bad)), "walled must be")

    def test_rule_folders(self):
        p = self.policy()
        self.assertEqual(plan(self.new(policy=p))["filesystem"], plan(self.inputs(policy=p))["filesystem"])
        for d in (self.playbooks, self.research, self.shared):
            os.makedirs(d)
        fs = plan(self.new(policy=p))["filesystem"]
        self.assertEqual(fs["allowRead"][-2:], [self.playbooks, self.research])
        self.assertNotIn(self.shared, fs["allowRead"])
        for d in (self.playbooks, self.research, self.shared):
            self.assertFalse(any(fence_plan._inside(d, w) or fence_plan._inside(w, d) for w in fs["allowWrite"]), d)
        # Never for a run without a policy.
        fs = plan(self.new())["filesystem"]
        for d in (self.playbooks, self.research, self.shared):
            self.assertNotIn(d, fs["allowRead"])
        # A link is left out, wherever it leads.
        shutil.rmtree(self.playbooks)
        os.symlink(os.path.join(self.S, "knowledge", "docs"), self.playbooks)
        fs = plan(self.new(policy=p))["filesystem"]
        self.assertNotIn(self.playbooks, fs["allowRead"])
        self.assertNotIn(os.path.join(self.S, "knowledge", "docs"), fs["allowRead"])
        os.remove(self.playbooks)
        with open(self.playbooks, "w") as fh:
            fh.write("not a folder")
        self.assertNotIn(self.playbooks, plan(self.new(policy=p))["filesystem"]["allowRead"])

    def test_research_folder_never_another_agents_task(self):
        os.makedirs(os.path.join(self.research, "STH-1"))
        for t in (self.research, os.path.join(self.research, "STH-1")):
            self.refused(self.new(taskFolder=t), "Researcher's folder")
            self.refused(self.new(taskFolder=t, policy=self.policy()), "Researcher's folder")

    def test_not_walled_with_narrow_gate_refused(self):
        self.refused(self.new(gatePort=3111), "only a walled agent")
        self.refused(self.new(gatePort=3111, policy=self.policy()), "only a walled agent")
        self.refused(self.new(gatePort=3111, policy=self.policy(walled=False)), "only a walled agent")

    def test_unknown_policy_key_still_refused(self):
        for key in ("Walled", "walls", "doors", "readFolders2"):
            p = self.policy()
            p[key] = True
            self.refused(self.new(policy=p), "not one the fence knows")
        p = self.walled()
        del p["readFolders"]
        self.refused(self.walled_inputs(policy=p), "missing")

    def test_old_policy_without_walled_unchanged(self):
        for tool in ("claude", "codex"):
            for mode in ({}, {"modelMode": "provider", "relayPort": 3120}):
                for p in (None, self.policy(), self.policy(localServices=["127.0.0.1:8120"]),
                          self.policy(taskFolder="read-only")):
                    old = plan(self.inputs(tool=tool, policy=p, **mode))
                    self.assertEqual(plan(self.new(tool=tool, policy=p, **mode)), old)
                    if p is not None:
                        q = dict(p, walled=False)
                        self.assertEqual(plan(self.new(tool=tool, policy=q, **mode)), old)


    # The review of step 1: the sandbox tool allows writes to its own temp folder
    # (/private/tmp/claude) in every profile, and could carry a folder of program
    # settings into a task folder by one mv or ln -s. Closed as a whole folder.

    def every_kind_of_run(self):
        yield self.inputs()
        yield self.inputs(tool="codex", policy=self.policy(taskFolder="read-only"))
        yield self.inputs(modelMode="provider", relayPort=3120, policy=self.policy(localServices=["127.0.0.1:8120"]))
        yield self.walled_inputs()

    def test_sandbox_temp_folder_closed(self):
        for i in self.every_kind_of_run():
            fs = plan(i)["filesystem"]
            for p in ("/private/tmp/claude", "/tmp/claude"):
                self.assertIn(p, fs["denyWrite"])
                self.assertIn(p, fs["denyRead"])
                self.assertEqual([r for r in fs["allowRead"] + fs["allowWrite"] if fence_plan._inside(r, p)], [])


    # The review of step 1: this disk also folds U+017F LONG S onto "s" (and the
    # Kelvin sign onto "k"), which a [Ss] set does not match. fold-probe.py in the
    # T1 prototype found no other character it folds onto a letter of the names.

    def test_long_s_spellings_denied(self):
        i = self.inputs()
        deny = plan(i)["filesystem"]["denyWrite"]
        for root in (self.task, i["agentHome"], i["innerTmp"]):
            for bad in (".agent\u017f", ".AGENT\u017f/skills/x/SKILL.md", "AGENT\u017f.md", "a/b/agent\u017f.md",
                        ".mcp.j\u017fon", "AGENT\u017f.override.md", "a/.agent\u017f", "AGENTS.md", ".mcp.json"):
                self.assertTrue(self.denied(deny, "%s/%s" % (root, bad)), bad)
            for ok in ("\u017ftory.txt", "note\u017f.md", "a/.agentſx", "AGENT\u017f.txt"):
                self.assertFalse(self.denied(deny, "%s/%s" % (root, ok)), ok)
            # Each long s stands alone in its entry, never inside a [...] set.
            for e in deny:
                self.assertNotIn("[\u017f", e)
                self.assertNotIn("\u017f]", e)
        # Four entries more per root for each name holding one s.
        with_s = [n for n in fence_plan.CONFIG_NAMES if "s" in n.lower()]
        self.assertEqual(len(deny), 2 + 3 * 4 * (len(fence_plan.CONFIG_NAMES) + len(with_s)))

    def test_every_folded_spelling_of_two_letters(self):
        self.assertEqual(fence_plan._any_case("ss"),
                         ["[Ss][Ss]", "[Ss]\u017f", "\u017f[Ss]", "\u017f\u017f"])
        self.assertEqual(fence_plan._any_case("k.md"), ["[Kk].[Mm][Dd]", "\u212a.[Mm][Dd]"])
        self.assertEqual(fence_plan._any_case(".codex"), [".[Cc][Oo][Dd][Ee][Xx]"])


    # The review of step 1: a walled run reads no other run's temp folder.

    TEMP_AREAS = ["/private/var/folders", "/var/folders", "/private/tmp", "/tmp"]

    def test_walled_reads_no_temp_area(self):
        run = tempfile.mkdtemp(prefix="paperclip-run-")
        self.addCleanup(shutil.rmtree, run, True)
        run = os.path.realpath(run)
        for over in ({}, {"innerTmp": run}, {"tool": "codex", "modelMode": "provider", "relayPort": 3120}):
            fs = plan(self.walled_inputs(**over))["filesystem"]
            for area in self.TEMP_AREAS:
                self.assertIn(area, fs["denyRead"])
            # Its own temp folder stays readable and writable beneath the deny.
            if over.get("innerTmp"):
                self.assertIn(run, fs["allowRead"])
                self.assertIn(run, fs["allowWrite"])
        # Everyone else's reads are as before.
        for i in (self.inputs(), self.inputs(policy=self.policy())):
            fs = plan(i)["filesystem"]
            for area in self.TEMP_AREAS:
                self.assertNotIn(area, fs["denyRead"])


if __name__ == "__main__":
    unittest.main()
