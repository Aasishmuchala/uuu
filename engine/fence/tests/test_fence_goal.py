"""Review of step 2, finding F3 (PLAN-V5 K10): a walled Researcher run works in
the one folder of the goal its task belongs to, and the goal comes from the
board, never from the run's words. Run against a small stand-in board.

Run: /usr/bin/python3 -I -m unittest discover -s engine/fence/tests -p 'test_fence_goal.py'
"""
import contextlib
import io
import os
import sys
import unittest

FENCE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, FENCE)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fence_inputs  # noqa: E402
from stub_board import StubBoard  # noqa: E402

AGENT = "6a95fa8f-7273-45f2-b81f-9f87c2949a55"
OTHER = "0741e40b-fd9c-43ca-8f69-fc2abdd86a6d"
KEY = "pcp_run_key_" + "q" * 40


def uid(n):
    return "aaaaaaaa-bbbb-4ccc-8ddd-%012x" % n


class GoalTests(unittest.TestCase):
    def setUp(self):
        self.board = StubBoard().start()
        self.addCleanup(self.board.stop)

    def issue(self, n, parent=None, ident=None, assignee=AGENT):
        self.board.issues[uid(n)] = {"id": uid(n), "parentId": uid(parent) if parent else None,
                                     "identifier": ident or "STH-%d" % n, "assigneeAgentId": assignee}

    def chain(self, length):
        """Task 1 is the run's; task `length` is the top. Each is the next one's child."""
        for n in range(1, length + 1):
            self.issue(n, parent=n + 1 if n < length else None, ident="STH-%d" % (100 + n),
                       assignee=AGENT if n == 1 else OTHER)

    def ask(self, task=None, key=KEY, agent=AGENT):
        return fence_inputs.goal_identifier(uid(1) if task is None else task, agent, key, self.board.port)

    def refused(self, *args, **kw):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as cm:
            self.ask(*args, **kw)
        self.assertEqual(cm.exception.code, 78)
        text = err.getvalue()
        self.assertTrue(text.startswith("fence: ") and text.count("\n") == 1, text)
        self.assertNotIn(KEY, text)
        return text

    def test_a_good_chain_gives_the_top_tasks_identifier(self):
        self.chain(3)
        self.assertEqual(self.ask(), "STH-103")
        # Only the issue questions, each by id, each with the run's own key as the bearer token.
        self.assertEqual(self.board.seen, [("/api/issues/" + uid(n), "Bearer " + KEY) for n in (1, 2, 3)])

    def test_a_task_that_is_itself_the_goal(self):
        self.issue(1, ident="STH-7")
        self.assertEqual(self.ask(), "STH-7")
        self.assertEqual(len(self.board.seen), 1)

    def test_four_steps_up_are_followed_and_five_are_not(self):
        self.chain(5)
        self.assertEqual(self.ask(), "STH-105")
        self.board.seen.clear()
        self.chain(6)
        self.assertIn("four steps", self.refused())
        self.assertEqual(len(self.board.seen), 5)         # it stopped asking at the fifth step

    def test_another_agents_task_is_refused(self):
        self.chain(2)
        self.board.issues[uid(1)]["assigneeAgentId"] = OTHER
        self.refused()
        self.board.issues[uid(1)]["assigneeAgentId"] = None
        self.refused()
        del self.board.issues[uid(1)]["assigneeAgentId"]
        self.refused()
        # A parent may be anyone's: only the run's own task must be this agent's.
        self.chain(2)
        self.assertEqual(self.ask(), "STH-102")

    def test_a_loop_is_refused(self):
        self.issue(1, parent=2)
        self.issue(2, parent=3, assignee=OTHER)
        self.issue(3, parent=2, assignee=OTHER)
        self.refused()
        self.issue(1, parent=1)
        self.refused()

    def test_the_board_not_giving_a_clean_200_is_refused(self):
        self.chain(2)
        for kind, arg in (("status", 404), ("status", 500), ("status", 401), ("status", 204),
                          ("raw", b"not json"), ("raw", b"[]"), ("raw", b'"x"'), ("raw", b""),
                          ("raw", b"\xff\xfe{}")):
            with self.subTest(kind=kind, arg=arg):
                self.board.special = {uid(1): (kind, arg)}
                self.refused()
        # The same on a parent.
        self.board.special = {uid(2): ("status", 404)}
        self.refused()

    def test_an_answer_that_never_comes_is_refused_in_time(self):
        self.chain(2)
        self.board.special = {uid(1): ("slow", 4)}
        fence_inputs.BOARD_SECONDS, saved = 1, fence_inputs.BOARD_SECONDS
        try:
            import time
            t = time.monotonic()
            self.refused()
            self.assertLess(time.monotonic() - t, 3.5)
        finally:
            fence_inputs.BOARD_SECONDS = saved

    def test_an_answer_over_the_cap_is_refused(self):
        self.chain(2)
        self.board.special = {uid(1): ("big", 2 * 1024 * 1024)}
        self.refused()
        self.board.special = {uid(1): ("big", fence_inputs.BOARD_ANSWER_CAP)}      # just over once padded
        self.refused()

    def test_a_redirect_is_not_followed(self):
        self.chain(2)
        self.issue(9, ident="STH-9")
        self.board.special = {uid(1): ("redirect", "/api/issues/" + uid(9))}
        self.refused()
        self.assertEqual([p for p, _ in self.board.seen], ["/api/issues/" + uid(1)])

    def test_an_answer_about_another_task_is_refused(self):
        self.chain(2)
        self.board.issues[uid(1)]["id"] = uid(9)
        self.refused()

    def test_a_bad_identifier_is_refused(self):
        for bad in ("sth-12", "STH-0", "STH-012", "STH-", "-12", "STH12", "STH-12\n", "STH-12 ", " STH-12",
                    "STH-1234567890", "ABCDEFGHIJK-1", "1STH-1", "ST_H-1", "STH-12/../x", "../STH-12", "STH-１２",
                    "", None, 12, ["STH-12"], {"a": 1}):
            with self.subTest(identifier=bad):
                self.issue(1, ident="x")
                self.board.issues[uid(1)]["identifier"] = bad
                self.refused()
        del self.board.issues[uid(1)]["identifier"]
        self.refused()
        # A good one at the edges of the pattern.
        for good in ("S-1", "ABCDEFGHIJ-999999999", "A1B2-30"):
            self.board.issues[uid(1)]["identifier"] = good
            self.assertEqual(self.ask(), good)

    def test_a_bad_parent_id_is_refused(self):
        self.issue(1, ident="STH-1")
        for bad in ("STH-5", "../x", uid(2).upper(), 7, "", ["x"]):
            with self.subTest(parent=bad):
                self.board.issues[uid(1)]["parentId"] = bad
                self.refused()
        self.assertEqual([p for p, _ in self.board.seen], ["/api/issues/" + uid(1)] * 6)

    def test_no_task_id_or_key_is_refused_and_asks_nothing(self):
        self.chain(2)
        for task in ("", None, "STH-12", "../x", uid(1).upper(), uid(1) + "\n", uid(1)[:-1], "x" * 500):
            with self.subTest(task=task):
                self.refused(task="" if task is None else task)
        for key in ("", None, "has space", "tab\t", "new\nline", "x" * 5000, "ключ"):
            with self.subTest(key=key):
                self.refused(key=key)
        self.assertEqual(self.board.seen, [])

    def test_a_board_that_is_down_is_refused(self):
        self.chain(2)
        self.board.stop()
        self.board.stop = lambda: None            # already stopped; cleanup runs it again
        self.refused()


if __name__ == "__main__":
    unittest.main()
