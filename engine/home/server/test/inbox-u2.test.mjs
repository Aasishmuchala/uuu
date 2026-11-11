// U2: a held task shows one item ("A task stopped"), not also the board's "run failed" item; its page says "Stopped".
import { test } from "node:test";
import assert from "node:assert/strict";
import { createActor, mergeInbox } from "../lib/inbox.mjs";
import { columnOf, taskCard } from "../lib/tasks.mjs";

const ctx = { log() {} };
function item(id, kind, taskId, rawKind) {
  const i = { id, source: "board", kind, when: "2026-11-11T09:00:00Z", severity: "normal", actions: [{ id: "go", label: "Go", style: "plain" }], link: { page: "goals", id: taskId } };
  Object.defineProperty(i, "_raw", { enumerable: false, value: { sourceKind: rawKind } });
  return i;
}
const held = (task) => item(`board:hold:${task}`, "problem", task, "execution_hold");
const failed = (id, task) => item(`board:${id}`, "problem", task, "failed_run");
const src = (items) => ({ id: "board", list: async () => ({ items }), act: async () => ({ message: "ok" }) });
const ids = async (items) => (await mergeInbox(ctx, [src(items)])).items.map((i) => i.id).sort();

test("held task + failed run for the same task: only the held item remains", async () => {
  assert.deepEqual(await ids([held("A"), failed("f1", "A")]), ["board:hold:A"]);
});
test("failed run alone is kept", async () => {
  assert.deepEqual(await ids([failed("f1", "A")]), ["board:f1"]);
});
test("held task A + failed run on task B: both kept", async () => {
  assert.deepEqual(await ids([held("A"), failed("f1", "B")]), ["board:f1", "board:hold:A"]);
});
test("counts match, and an action on the dropped item says it is no longer waiting", async () => {
  const sources = [src([held("A"), failed("f1", "A")])];
  const m = await mergeInbox(ctx, sources);
  assert.equal(m.counts.total, 1);
  assert.deepEqual(m.counts.bySource, { board: 1 });
  await assert.rejects(createActor(sources)(ctx, { id: "board:f1", action: "go" }),
    (e) => e.status === 404 && e.message === "This item is no longer waiting for you.");
});

const GOAL = { id: "g1", identifier: null, title: "Pay bills", status: "blocked", description: "Pay bills." };
const tctx = (needsYou) => ({
  needsYou, accepted: () => false, stepsOf: () => [{ id: "s1", parentId: "g1", status: "done", createdAt: "2026-11-11T09:00:00Z" }],
  comments: new Map(), agents: new Map(), roles: [], routines: new Map(), liveByIssue: new Map(), config: {},
});
test("a held task is in the Failed column with the stage text Stopped", () => {
  const t = tctx([{ ...held("g1"), taskId: "g1" }]);
  assert.equal(columnOf(GOAL, t), "failed");
  assert.deepEqual(taskCard(GOAL, t).stage, { id: "work", label: "Stopped" });
});
test("a blocked task that is not held keeps its stage text", () => {
  assert.equal(taskCard(GOAL, tctx([])).stage.label, "Work");
});
