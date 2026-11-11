// V60e: a task blocked on purpose (a question or a plan waits for the owner) shows no second, board
// "blocked" problem item. Failed runs, other tasks and items without a task are never dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createActor, mergeInbox } from "../lib/inbox.mjs";

const ctx = { log() {} };
function item(id, source, kind, taskId, rawKind) {
  const i = { id, source, kind, when: "2026-11-11T09:00:00Z", severity: "normal", actions: [{ id: "go", label: "Go", style: "plain" }], link: taskId ? { page: "goals", id: taskId } : null };
  if (rawKind) Object.defineProperty(i, "_raw", { enumerable: false, value: { sourceKind: rawKind } });
  return i;
}
const blocked = (id, task, k = "blocker_attention") => item(`board:${id}`, "board", "problem", task, k);
const failed = (id, task) => item(`board:${id}`, "board", "problem", task, "failed_run");
// A question that can be answered and a plan that can be accepted: only those wait for the owner (F1b).
const offering = (i, action) => Object.assign(i, { actions: [{ id: action, label: action, style: "primary" }, { id: "go", label: "Go", style: "plain" }] });
const question = (id, task) => offering(item(`board:${id}`, "board", "question", task, "issue_thread_interaction"), "answer");
const plan = (task) => offering(item(`staged:plan:${task}`, "goal", "approval", task), "accept");
const src = (id, items) => ({ id, list: async () => ({ items }), act: async () => ({ message: "ok" }) });
const ids = async (sources) => (await mergeInbox(ctx, sources)).items.map((i) => i.id).sort();

test("blocked problem + question for the same task: the problem is dropped", async () => {
  assert.deepEqual(await ids([src("board", [blocked("b1", "A"), question("q1", "A")])]), ["board:q1"]);
  assert.deepEqual(await ids([src("board", [blocked("b1", "A", "recovery_action"), question("q1", "A")])]), ["board:q1"]);
});
test("blocked problem + staged plan item: dropped", async () => {
  assert.deepEqual(await ids([src("board", [blocked("b1", "A")]), src("goals", [plan("A")])]), ["staged:plan:A"]);
});
test("blocked problem alone is kept", async () => {
  assert.deepEqual(await ids([src("board", [blocked("b1", "A")])]), ["board:b1"]);
});
test("failed-run problem + question: both kept", async () => {
  assert.deepEqual(await ids([src("board", [failed("f1", "A"), question("q1", "A")])]), ["board:f1", "board:q1"]);
});
test("blocked problem for task A + question for task B: both kept; no task: kept", async () => {
  assert.deepEqual(await ids([src("board", [blocked("b1", "A"), question("q1", "B"), blocked("b2", null)])]), ["board:b1", "board:b2", "board:q1"]);
  assert.deepEqual(await ids([src("board", [blocked("b2", null), question("q2", null)])]), ["board:b2", "board:q2"]);
});
test("counts match the list; actions: kept works, dropped is no longer waiting", async () => {
  const sources = [src("board", [blocked("b1", "A"), question("q1", "A"), failed("f1", "B")])];
  const m = await mergeInbox(ctx, sources);
  assert.equal(m.counts.total, 2);
  assert.deepEqual(m.counts.bySource, { board: 2 });
  assert.equal(m.owners.has("board:b1"), false);
  const act = createActor(sources);
  assert.equal((await act(ctx, { id: "board:q1", action: "go" })).ok, true);
  await assert.rejects(act(ctx, { id: "board:b1", action: "go" }), (e) => e.status === 404 && e.message === "This item is no longer waiting for you.");
});
