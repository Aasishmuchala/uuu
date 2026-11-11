// V60d: a task the Chief of staff blocked on purpose (a question or a plan waits for the owner) is not
// a failure, even when the board lists its own "blocked" problem item for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { columnOf, taskCard, waitsForOwner } from "../lib/tasks.mjs";

const GOAL = { id: "g1", identifier: null, title: "Plan the launch", status: "blocked", description: "Plan the launch.\n\nPLAN FIRST" };
const STEP = { id: "s1", parentId: "g1", status: "done", assigneeAgentId: null, createdAt: "2026-11-11T09:00:00Z" };

function tctxWith(needsYou) {
  return {
    needsYou,
    accepted: () => false,
    stepsOf: (id) => (id === "g1" ? [STEP] : []),
    comments: new Map(),
    agents: new Map(),
    roles: [],
    routines: new Map(),
    liveByIssue: new Map(),
    config: {},
  };
}

const boardProblem = { id: "board:a1", source: "board", kind: "problem", taskId: "g1" };
// Each offers what the owner can do (F1b: only a question that can be answered or accepted waits for the owner).
const ANSWER = [{ id: "answer" }];
const stagedQuestion = { id: "staged:unclear:g1:abcd1234", source: "goal", kind: "question", taskId: "g1", actions: ANSWER };
const stagedPlan = { id: "staged:plan:g1", source: "goal", kind: "approval", taskId: "g1", actions: [{ id: "accept" }] };
const boardQuestion = { id: "board:q1", source: "board", kind: "question", taskId: "g1", actions: ANSWER };

test("blocked with the board's problem item and nothing for the owner to answer: Failed", () => {
  const tctx = tctxWith([boardProblem]);
  assert.equal(waitsForOwner(GOAL, tctx), false);
  assert.equal(columnOf(GOAL, tctx), "failed");
  assert.equal(taskCard(GOAL, tctx).stage.label, "Work");
});

for (const [name, item] of [["a staged question", stagedQuestion], ["a staged plan to accept", stagedPlan], ["a board question card", boardQuestion]]) {
  test(`blocked with the board's problem item and ${name}: waiting for the owner, not Failed`, () => {
    const tctx = tctxWith([boardProblem, item]);
    assert.equal(waitsForOwner(GOAL, tctx), true);
    assert.equal(columnOf(GOAL, tctx), "pending_review");
    const card = taskCard(GOAL, tctx);
    assert.equal(card.column, "pending_review");
    assert.deepEqual(card.stage, { id: "work", label: "Work: waiting for you" });
    assert.equal(card.waitingForYou, true);
  });
}

test("blocked with no items at all: pending review, plain stage", () => {
  const tctx = tctxWith([]);
  assert.equal(columnOf(GOAL, tctx), "pending_review");
  const card = taskCard(GOAL, tctx);
  assert.deepEqual(card.stage, { id: "work", label: "Work" });
  assert.equal(card.waitingForYou, false);
});

test("an item for another task, or a staged problem item, does not count as waiting for the owner", () => {
  const other = { ...stagedQuestion, taskId: "g2" };
  const stopped = { id: "staged:stopped:g1", source: "goal", kind: "problem", taskId: "g1" };
  const tctx = tctxWith([boardProblem, other, stopped]);
  assert.equal(waitsForOwner(GOAL, tctx), false);
  assert.equal(columnOf(GOAL, tctx), "failed");
});

test("a task that is not blocked keeps its plain stage label", () => {
  const goal = { ...GOAL, status: "in_progress" };
  const tctx = tctxWith([stagedQuestion]);
  assert.equal(columnOf(goal, tctx), "in_progress");
  assert.equal(taskCard(goal, tctx).stage.label, "Work");
});
