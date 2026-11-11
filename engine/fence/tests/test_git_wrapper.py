"""The engine's git (fence/bin/git), first on the board's PATH: it never opens a
repository in a folder an agent can write to, so a program named in a made-up
repository there never runs; a normal repository elsewhere still works.

Each test runs a copy of the wrapper in a temp engine whose config puts the
state folder and paperclip's instance in the same temp folder.

Run: /usr/bin/python3 -m unittest discover -s engine/fence/tests -p 'test_*.py'
"""
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest

FENCE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.dirname(FENCE)
PLAIN_GIT = "/usr/bin/git"


def clean_env(**extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_") and k != "ENGINE_CONFIG"}
    env.update(extra)
    return env


class GitWrapperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="fence-git-"))
        self.engine = os.path.join(self.tmp, "engine")
        os.makedirs(os.path.join(self.engine, "fence", "bin"))
        os.makedirs(os.path.join(self.engine, "lib"))
        self.git = os.path.join(self.engine, "fence", "bin", "git")
        shutil.copy2(os.path.join(FENCE, "bin", "git"), self.git)
        shutil.copy2(os.path.join(ENGINE, "lib", "config.py"), os.path.join(self.engine, "lib", "config.py"))
        with open(os.path.join(ENGINE, "config.json"), encoding="utf-8") as fh:
            cfg = json.load(fh)
        self.state = os.path.join(self.tmp, "state")
        self.inst = os.path.join(self.tmp, "instance")
        cfg["stateRoot"] = self.state
        cfg["paperclip"]["instanceRoot"] = self.inst
        self.config = os.path.join(self.engine, "config.json")
        with open(self.config, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh)
        self.task = os.path.join(self.state, "tasks", "company-work")
        self.ws = os.path.join(self.inst, "workspaces", "w1")
        self.iso = os.path.join(self.inst, "isolated-workspaces", "x", "y")
        self.elsewhere = os.path.join(self.tmp, "elsewhere")
        for d in (self.task, self.ws, self.iso, self.elsewhere):
            os.makedirs(d)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_git(self, git, args, cwd=None, env=None):
        return subprocess.run([git] + args, cwd=cwd or self.tmp, env=env or clean_env(),
                              capture_output=True, text=True, timeout=60)

    def plant_bare(self, folder):
        """What an agent can write in its task folder: a repository laid out
        directly in it, whose file-watcher setting names a program of its own."""
        mark = os.path.join(folder, "MARKED")
        os.makedirs(os.path.join(folder, "objects"), exist_ok=True)
        os.makedirs(os.path.join(folder, "refs", "heads"), exist_ok=True)
        with open(os.path.join(folder, "HEAD"), "w") as fh:
            fh.write("ref: refs/heads/main\n")
        prog = os.path.join(folder, "watch.sh")
        with open(prog, "w") as fh:
            fh.write("#!/bin/sh\necho ran > '%s'\n" % mark)
        os.chmod(prog, 0o755)
        with open(os.path.join(folder, "config"), "w") as fh:
            fh.write("[core]\n\trepositoryformatversion = 0\n\tbare = false\n"
                     "\tworktree = %s\n\tfsmonitor = %s\n" % (folder, prog))
        return mark

    def plant_gitfile(self, folder):
        """A `.git` file pointing at a repository in a subfolder, with a clean
        filter for a tracked file: git status runs the filter to compare it."""
        src = os.path.join(self.tmp, "src")
        os.makedirs(src)
        env = clean_env(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
        for args in (["init", "-q"], ["config", "user.name", "a"], ["config", "user.email", "a@b"]):
            self.run_git(PLAIN_GIT, args, cwd=src, env=env)
        with open(os.path.join(src, "f.txt"), "w") as fh:
            fh.write("hi\n")
        self.run_git(PLAIN_GIT, ["add", "f.txt"], cwd=src, env=env)
        self.run_git(PLAIN_GIT, ["commit", "-qm", "x"], cwd=src, env=env)
        repo = os.path.join(folder, "evil")
        shutil.copytree(os.path.join(src, ".git"), repo)
        shutil.rmtree(os.path.join(repo, "hooks"), ignore_errors=True)
        mark = os.path.join(folder, "MARKED")
        prog = os.path.join(repo, "f.sh")
        with open(prog, "w") as fh:
            fh.write("#!/bin/sh\necho ran > '%s'\ncat\n" % mark)
        os.chmod(prog, 0o755)
        with open(os.path.join(repo, "config"), "a") as fh:
            fh.write('[filter "x"]\n\tclean = %s\n' % prog)
        with open(os.path.join(folder, ".git"), "w") as fh:
            fh.write("gitdir: evil\n")
        with open(os.path.join(folder, ".gitattributes"), "w") as fh:
            fh.write("f.txt filter=x\n")
        f = os.path.join(folder, "f.txt")
        with open(f, "w") as fh:
            fh.write("ho\n")   # same size, older time: git must read it
        os.utime(f, (1577836800, 1577836800))
        return mark

    def status(self, git, folder, env=None):
        return self.run_git(git, ["-C", folder, "status", "--porcelain=v1", "--untracked-files=all"],
                            env=env or clean_env(GIT_OPTIONAL_LOCKS="0"))

    def test_plain_git_runs_the_planted_program(self):
        # The attack is real; without this the other tests would prove nothing.
        mark = self.plant_bare(self.task)
        self.status(PLAIN_GIT, self.task)
        self.assertTrue(os.path.exists(mark))
        other = os.path.join(self.elsewhere, "g")
        os.makedirs(other)
        mark2 = self.plant_gitfile(other)
        self.status(PLAIN_GIT, other)
        self.assertTrue(os.path.exists(mark2))

    def test_planted_repository_in_every_task_tree_is_refused(self):
        for folder in (self.task, self.ws, self.iso):
            mark = self.plant_bare(folder)
            r = self.status(self.git, folder)
            self.assertEqual(r.returncode, 128, folder)
            self.assertIn("not a git repository", r.stderr)
            self.assertFalse(os.path.exists(mark), folder)
            # started in the folder, without -C, as the board also does
            r = self.run_git(self.git, ["rev-parse", "--show-toplevel"], cwd=folder)
            self.assertEqual(r.returncode, 128, folder)
            self.assertFalse(os.path.exists(mark), folder)

    def test_gitfile_with_a_filter_in_a_task_folder_is_refused(self):
        sub = os.path.join(self.task, "sub")
        os.makedirs(sub)
        mark = self.plant_gitfile(sub)
        r = self.status(self.git, sub)
        self.assertEqual(r.returncode, 128)
        self.assertFalse(os.path.exists(mark))

    def test_every_way_of_naming_a_task_folder_is_refused(self):
        mark = self.plant_bare(self.task)
        link = os.path.join(self.elsewhere, "link")
        os.symlink(self.task, link)
        cases = [
            (["-C", link, "status"], None, None),
            (["-C", self.elsewhere, "-C", "link", "status"], None, None),
            (["-c", "x.y=1", "-C", self.task, "status"], None, None),
            (["--git-dir=%s" % self.task, "status"], None, None),
            (["--git-dir", self.task, "--work-tree", self.elsewhere, "status"], None, None),
            (["--work-tree=%s" % self.task, "status"], None, None),
            (["status"], None, {"GIT_DIR": self.task}),
            (["status"], None, {"GIT_WORK_TREE": self.task}),
            (["status"], self.elsewhere, {"GIT_DIR": "link"}),
        ]
        for args, cwd, extra in cases:
            r = self.run_git(self.git, args, cwd=cwd or self.elsewhere, env=clean_env(**(extra or {})))
            self.assertEqual(r.returncode, 128, (args, extra, r.stderr))
            self.assertIn("agents can write to", r.stderr, (args, extra))
        self.assertFalse(os.path.exists(mark))

    def assert_refused(self, cases, mark, text="agents can write to"):
        for args, cwd, extra in cases:
            r = self.run_git(self.git, args, cwd=cwd or self.elsewhere, env=clean_env(**(extra or {})))
            self.assertEqual(r.returncode, 128, (args, cwd, extra, r.stderr))
            self.assertIn(text, r.stderr, (args, cwd, extra))
        self.assertFalse(os.path.exists(mark))

    def test_other_letter_case_is_refused(self):
        # The disk ignores letter case: .../TASKS/x is the same folder as .../tasks/x.
        mark = self.plant_bare(self.task)
        upper = self.task.upper()
        mixed = "".join(c.upper() if n % 2 else c.lower() for n, c in enumerate(self.task))
        self.assertTrue(os.path.isdir(upper) and os.path.isdir(mixed))
        cases = []
        for name in (upper, mixed):
            cases += [
                (["status"], name, None),
                (["-C", name, "status"], None, None),
                (["--git-dir=%s" % name, "status"], None, None),
                (["--git-dir", name, "status"], None, None),
                (["status"], None, {"GIT_DIR": name}),
                (["status"], None, {"GIT_WORK_TREE": name}),
            ]
        cases.append((["-C", self.ws.upper(), "status"], None, None))
        self.assert_refused(cases, mark)

    def test_other_names_of_the_disk_are_refused(self):
        mark = self.plant_bare(self.task)
        data = "/System/Volumes/Data" + self.task
        self.assertTrue(os.path.isdir(data))
        self.assert_refused([(["-C", data, "status"], None, None),
                             (["status"], None, {"GIT_DIR": data})], mark)
        st = os.stat(self.task)
        vol = "/.vol/%d/%d" % (st.st_dev, st.st_ino)
        self.assert_refused([(["-C", vol, "status"], None, None),
                             (["--git-dir=%s" % vol, "status"], None, None),
                             (["-C", "/.vol/1/2", "status"], None, None)], mark, "by number")

    def test_relative_chain_ending_inside_is_refused(self):
        mark = self.plant_bare(self.task)
        self.assert_refused([(["-C", self.elsewhere, "-C", "../STATE", "-C", "Tasks", "-C", "company-work",
                               "status"], self.tmp, None)], mark)

    def test_link_outside_pointing_inside_is_refused(self):
        mark = self.plant_bare(self.task)
        link = os.path.join(self.elsewhere, "case-link")
        os.symlink(self.task.upper(), link)
        self.assert_refused([(["-C", link, "status"], None, None),
                             (["status"], link, None),
                             (["status"], None, {"GIT_DIR": link})], mark)

    def test_planted_bare_repository_elsewhere_is_refused_by_git(self):
        folder = os.path.join(self.elsewhere, "b")
        os.makedirs(folder)
        mark = self.plant_bare(folder)
        r = self.status(self.git, folder)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("cannot use bare repository", r.stderr)
        self.assertFalse(os.path.exists(mark))

    def test_a_normal_repository_elsewhere_still_works(self):
        repo = os.path.join(self.elsewhere, "repo")
        os.makedirs(repo)
        env = clean_env(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
        for args in (["init", "-q"], ["config", "user.name", "a"], ["config", "user.email", "a@b"]):
            self.assertEqual(self.run_git(self.git, args, cwd=repo, env=env).returncode, 0, args)
        with open(os.path.join(repo, "a.txt"), "w") as fh:
            fh.write("a\n")
        self.assertEqual(self.run_git(self.git, ["add", "a.txt"], cwd=repo, env=env).returncode, 0)
        self.assertEqual(self.run_git(self.git, ["commit", "-qm", "one"], cwd=repo, env=env).returncode, 0)
        with open(os.path.join(repo, "b.txt"), "w") as fh:
            fh.write("b\n")
        r = self.run_git(self.git, ["-C", repo, "status", "--porcelain=v1", "--untracked-files=all"], env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, "?? b.txt\n")
        r = self.run_git(self.git, ["rev-parse", "--show-toplevel"], cwd=repo, env=env)
        self.assertEqual(r.stdout.strip(), repo)

    def test_this_checkout_still_works_and_is_fast(self):
        repo = os.path.dirname(ENGINE)
        start = time.monotonic()
        r = subprocess.run("'%s' status --short | head -1" % self.git, shell=True, cwd=repo,
                           env=clean_env(), capture_output=True, text=True, timeout=60)
        took = time.monotonic() - start
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stderr, "")
        self.assertLess(took, 0.5)

    def test_finds_a_real_git(self):
        r = self.run_git(self.git, ["--version"])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("git version "), r.stdout)
        r = self.run_git(self.git, ["--exec-path"])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(r.stdout.strip(), "git")) or
                        os.path.isdir(r.stdout.strip()), r.stdout)

    def test_python_does_not_import_from_the_folder_git_runs_in(self):
        folder = os.path.join(self.elsewhere, "py")
        os.makedirs(folder)
        mark = os.path.join(folder, "MARKED")
        for name in ("json.py", "config.py", "os.py", "pwd.py"):
            with open(os.path.join(folder, name), "w") as fh:
                fh.write("open(%r, 'w').write('ran')\n" % mark)
        r = self.run_git(self.git, ["--version"], cwd=folder)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(os.path.exists(mark))

    def test_config_from_the_environment_is_ignored(self):
        # ENGINE_CONFIG must not move the task folders out of the wrapper's sight.
        other = os.path.join(self.tmp, "other.json")
        with open(self.config, encoding="utf-8") as fh:
            cfg = json.load(fh)
        cfg["stateRoot"] = os.path.join(self.tmp, "nowhere")
        with open(other, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh)
        mark = self.plant_bare(self.task)
        r = self.status(self.git, self.task, env=clean_env(ENGINE_CONFIG=other))
        self.assertEqual(r.returncode, 128)
        self.assertFalse(os.path.exists(mark))

    def test_unreadable_config_refuses_every_git(self):
        with open(self.config, "w") as fh:
            fh.write("{ not json")
        r = self.run_git(self.git, ["--version"], cwd=self.elsewhere)
        self.assertEqual(r.returncode, 128)
        self.assertIn("engine config could not be read", r.stderr)


if __name__ == "__main__":
    unittest.main()
