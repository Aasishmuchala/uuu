"""The T38 attack on the planner (review of step 2, finding F3), turned round: a walled
Researcher run for one goal reads and writes that goal's research folder and no other
goal's (PLAN-V5 K10: it "works in <state>/tasks/research/<goal id>/ and nowhere else").
Before the fix the run's folder was the whole research folder and these failed.

Run: /usr/bin/python3 -I -m unittest discover -s engine/fence/tests -p 'test_research_reach.py'
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_fence_plan as base  # noqa: E402
fence_plan = base.fence_plan


class ResearchFolderReach(base.PlanTests):
    def reach(self, fs, path):
        readable = any(path == r or path.startswith(r + os.sep) for r in fs["allowRead"])
        writable = any(path == w or path.startswith(w + os.sep) for w in fs["allowWrite"])
        return readable, writable

    def test_one_goal_run_cannot_reach_another_goals_research(self):
        other_goal = os.path.join(self.research, "GOL-7", "research")
        os.makedirs(other_goal)
        fs = fence_plan.plan(self.walled_inputs())["filesystem"]
        self.assertEqual(self.reach(fs, os.path.join(other_goal, "notes.md")), (False, False))
        self.assertEqual(self.reach(fs, os.path.join(self.research, "GOL-7")), (False, False))
        self.assertEqual(self.reach(fs, self.research), (False, False))
        self.assertEqual(self.reach(fs, os.path.join(self.research, "new-goal.md")), (False, False))

    def test_it_reaches_its_own_goal(self):
        fs = fence_plan.plan(self.walled_inputs())["filesystem"]
        self.assertEqual(self.reach(fs, os.path.join(self.goal, "research", "notes.md")), (True, True))
        self.assertEqual(fs["allowWrite"][0], self.goal)

    def test_held_company_out_of_reach(self):
        os.makedirs(self.shared)
        fs = fence_plan.plan(self.walled_inputs())["filesystem"]
        for p in (self.task, os.path.join(self.S, "knowledge", "docs"), os.path.join(self.S, "doors"),
                  os.path.join(self.S, "secrets"), os.path.join(self.S, "lessons")):
            self.assertFalse(any(p == r or p.startswith(r + os.sep) or r.startswith(p + os.sep) for r in fs["allowRead"]), p)

    def test_the_whole_research_folder_is_not_a_walled_run_folder(self):
        self.refused(self.walled_inputs(taskFolder=self.research), "walled agent")


MINE = ("test_one_goal_run_cannot_reach_another_goals_research", "test_it_reaches_its_own_goal",
        "test_held_company_out_of_reach", "test_the_whole_research_folder_is_not_a_walled_run_folder")


def load_tests(loader, tests, pattern):
    # Only this file's four; the planner's own tests (inherited) run in test_fence_plan.py.
    return unittest.TestSuite(ResearchFolderReach(name) for name in MINE)


if __name__ == "__main__":
    unittest.main()
