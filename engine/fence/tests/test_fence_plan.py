"""The fence planner: every row of the test-vector table in CONTRACTS 4.1, plus
the refusals that keep wrapper-given paths from opening up protected folders.

Run: /usr/bin/python3 -m unittest discover -s engine/fence/tests -p 'test_*.py'
"""
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
        self.assertEqual(out["filesystem"]["denyWrite"], [])
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


if __name__ == "__main__":
    unittest.main()
