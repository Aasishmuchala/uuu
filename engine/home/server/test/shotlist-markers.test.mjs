// PLAN-V5 T41b, lib/staged.mjs and lib/inbox.mjs: the film's marker lines (C7, C9, C11) and the shotlist card's place
// in the inbox merge. The new markers are not enumerable, so every list of the older markers is as it was; the
// batch line is written and read only for an id of the home server's own form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOTLIST_CHANGED, waitsOnOwner } from "../lib/inbox.mjs";
import { BATCH_ID, buildText, MARKERS, textOf } from "../lib/staged.mjs";
import { columnOf, taskCard, waitsForOwner } from "../lib/tasks.mjs";

const BATCH = `b${"0123456789abcdef0123"}`;

test("MARKERS gains the four film markers, not enumerable", () => {
  assert.equal(MARKERS.shotlistReady, "SHOTLIST READY:");
  assert.equal(MARKERS.shotlistAccepted, "SHOTLIST ACCEPTED:");
  assert.equal(MARKERS.clips, "CLIPS:");
  assert.equal(MARKERS.generationBatch, "Generation batch:");
  assert.deepEqual(Object.values(MARKERS).sort(), ["ANSWER:", "FOR:", "PLAN ACCEPTED", "PLAN FIRST", "PLAN READY:",
    "RESULT:", "ROUTINE:", "SIZE:", "STOPPED:", "VERDICT:"]);
  assert.match(BATCH, BATCH_ID);
});

test("buildText writes the batch line after Review: art and before Produce:, and textOf gives it back", () => {
  const args = {
    text: "Make 2 variations of tower.png with Runway.", to: "Artist", reads: ["brand/brand.md"], playbooks: ["aasish-design"],
    review: "art", produces: ["stills/*/v1.png"], job: "studio/variations-of-a-still",
  };
  const out = buildText({ ...args, batch: BATCH });
  assert.equal(out, [
    "FOR: Artist",
    "Make 2 variations of tower.png with Runway.",
    "",
    "Read first, from the company's files: brand/brand.md.",
    "Read first, from the playbooks: aasish-design.",
    "Review: art",
    `Generation batch: ${BATCH}`,
    "Produce: stills/*/v1.png in the goal's sub-folder.",
    "JOB: studio/variations-of-a-still",
  ].join("\n"));
  const t = textOf(out);
  assert.deepEqual(t, { text: "Make 2 variations of tower.png with Runway.", planFirst: false, for: "Artist", routine: null });
  assert.equal(t.batch, BATCH);
  assert.equal(t.job, "studio/variations-of-a-still");
  // Without review, the batch line still sits before Produce:.
  const plain = buildText({ text: "Make it larger.", produces: ["stills/*/u1.png"], job: "studio/a-larger-sharper-still", batch: BATCH, planFirst: true });
  assert.equal(plain, `Make it larger.\n\nGeneration batch: ${BATCH}\nProduce: stills/*/u1.png in the goal's sub-folder.\nJOB: studio/a-larger-sharper-still\n\nPLAN FIRST`);
  assert.equal(textOf(plain).batch, BATCH);
  assert.equal(textOf(plain).text, "Make it larger.");
  assert.equal(textOf(plain).planFirst, true);
});

test("every existing output is unchanged: no batch, a batch of any other form, and the older texts", () => {
  const args = { text: "Do X", to: "Marketer", reads: ["a.md"], produces: ["b.md"], job: "a/b", review: "art", playbooks: ["storycraft"], ask: true, planFirst: true };
  const before = buildText(args);
  for (const batch of [undefined, null, "", "b123", `B${"0".repeat(20)}`, `b${"0".repeat(21)}`, `b${"g".repeat(20)}`, `${BATCH}\nJOB: x/y`, 7]) {
    assert.equal(buildText({ ...args, batch }), before, String(batch));
  }
  assert.equal(textOf(before).batch, null);
  assert.deepEqual(textOf("Do X"), { text: "Do X", planFirst: false, for: null, routine: null });
  assert.equal(textOf("Do X").batch, null);
});

test("textOf ignores a malformed batch id, a batch line with no JOB line, and a second batch line", () => {
  const bad = textOf("Do X\n\nReview: art\nGeneration batch: b123\nProduce: a.md in the goal's sub-folder.\nJOB: a/b");
  assert.equal(bad.batch, null);
  assert.equal(bad.text, "Do X\n\nReview: art\nGeneration batch: b123", "a line not taken stays in the text");
  const noJob = textOf(`Do X\n\nGeneration batch: ${BATCH}`);
  assert.equal(noJob.batch, null);
  assert.equal(noJob.text, `Do X\n\nGeneration batch: ${BATCH}`);
  const twice = textOf(`Do X\n\nGeneration batch: ${BATCH}\nGeneration batch: ${BATCH}\nJOB: a/b`);
  assert.equal(twice.batch, BATCH);
  assert.equal(twice.text, `Do X\n\nGeneration batch: ${BATCH}`);
  // Read from the bottom up, as every line of the block: a Produce: line above the batch line is out of order and
  // stays in the text.
  const order = textOf(`Do X\n\nProduce: a.md in the goal's sub-folder.\nGeneration batch: ${BATCH}\nJOB: a/b`);
  assert.equal(order.batch, BATCH);
  assert.equal(order.text, "Do X\n\nProduce: a.md in the goal's sub-folder.");
  // An owner's text that only quotes a batch keeps it as words.
  assert.equal(textOf(`Use Generation batch: ${BATCH} please`).batch, null);
});

test("a shotlist card offering approve waits for the owner; one offering only Send all back does not", () => {
  const card = (actions, extra = {}) => ({ id: "staged:shotlist:g1", source: "goal", kind: "shotlist", actions: actions.map((id) => ({ id })), link: { page: "tasks", id: "g1" }, ...extra });
  assert.equal(waitsOnOwner(card(["approve", "another", "send_back"])), true);
  assert.equal(waitsOnOwner(card(["send_back"])), false);
  assert.equal(waitsOnOwner(card(["approve"], { id: "goal:g1" })), false, "only the staged source's card");
  assert.equal(waitsOnOwner(card(["approve"], { source: "board" })), false);
  assert.equal(SHOTLIST_CHANGED, "This shotlist or its cost changed since you looked. Read it again.");
});

test("a blocked film with its shotlist card reads waiting for you, not Failed, beside the board's own blocked item", () => {
  const goal = { id: "g1", identifier: null, title: "A film of the lake house", status: "blocked", description: "Make a film." };
  const step = { id: "s1", parentId: "g1", status: "done", assigneeAgentId: null, createdAt: "2026-11-13T09:00:00Z" };
  const tctx = (needsYou) => ({
    needsYou, accepted: () => false, stepsOf: (id) => (id === "g1" ? [step] : []), comments: new Map(), agents: new Map(), roles: [], routines: new Map(),
    liveByIssue: new Map(), config: {},
  });
  const problem = { id: "board:a1", source: "board", kind: "problem", taskId: "g1" };
  const card = { id: "staged:shotlist:g1", source: "goal", kind: "shotlist", taskId: "g1", actions: [{ id: "approve" }, { id: "another" }, { id: "send_back" }] };
  const waiting = tctx([problem, card]);
  assert.equal(waitsForOwner(goal, waiting), true);
  assert.equal(columnOf(goal, waiting), "pending_review");
  assert.deepEqual(taskCard(goal, waiting).stage, { id: "work", label: "Work: waiting for you" });
  const onlyBack = tctx([problem, { ...card, actions: [{ id: "send_back" }] }]);
  assert.equal(waitsForOwner(goal, onlyBack), false);
  assert.equal(columnOf(goal, onlyBack), "failed");
});
