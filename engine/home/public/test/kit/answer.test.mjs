// The kit's answer view (CONTRACTS-V3 28, M50, M55, M63): splitMarks, the marks glued to their word, and the
// answer's states. Split out of kit-c and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, elements, textOf, byClass, mount, unmount } from "./_dom.mjs";
import { SHAPES, shape } from "./_fixtures.mjs";
import { css, newSheetTest } from "./_rules.mjs";

const answer = await import(pathToFileURL(join(KIT, "answer.js")).href);
const kit = { answer };

// ---- splitMarks ----

test("splitMarks: the pinned vector", () => {
  assert.deepEqual(kit.answer.splitMarks("A [1] b [2][3]."), [{ text: "A " }, { mark: 1 }, { text: " b " }, { mark: 2 }, { mark: 3 }, { text: "." }]);
});

test("splitMarks: text with no marks is one piece; nothing gives nothing", () => {
  assert.deepEqual(kit.answer.splitMarks("No marks here, only [brackets]."), [{ text: "No marks here, only [brackets]." }]);
  assert.deepEqual(kit.answer.splitMarks(""), []);
  assert.deepEqual(kit.answer.splitMarks(undefined), []);
  assert.deepEqual(kit.answer.splitMarks(42), []);
});

test("splitMarks: [0], [13] and [01] stay text; [12] is a mark", () => {
  assert.deepEqual(kit.answer.splitMarks("a [0] b"), [{ text: "a [0] b" }]);
  assert.deepEqual(kit.answer.splitMarks("a [13] b"), [{ text: "a [13] b" }]);
  assert.deepEqual(kit.answer.splitMarks("a [01] b"), [{ text: "a [01] b" }]);
  assert.deepEqual(kit.answer.splitMarks("[0][12][13]"), [{ text: "[0]" }, { mark: 12 }, { text: "[13]" }]);
  assert.deepEqual(kit.answer.splitMarks("[123]"), [{ text: "[123]" }]);
});

test("splitMarks runs in linear time on a long hostile text", () => {
  const long = "[".repeat(200000) + "1]" + "x [99] ".repeat(20000);
  const t = Date.now();
  const parts = kit.answer.splitMarks(long);
  assert.ok(Date.now() - t < 500, "fast");
  assert.equal(parts.filter((p) => p.mark).length, 1);
});

// ---- AnswerView ----

test("AnswerView: the shape's answer with marks, the label, a found source as a link and a missing one as text", { skip: SHAPES ? false : "no shapes" }, async () => {
  installDom();
  const ask = shape("ask");
  const root = await mount(kit.answer.AnswerView, { ask });
  const text = textOf(root);
  assert.match(text, /What is our returns policy/);
  assert.match(text, /Answered from your files\. Not checked\./);
  assert.match(text, /2 sources/);
  assert.match(text, /not in your files/);
  assert.match(text, /Not in your files/);
  assert.match(text, /When the policy last changed\./);
  assert.equal(byClass(root, "k-answer__mark").length, 3, "three marks: [1], [1] and [2]");
  const links = elements(root).filter((e) => e.localName === "a").map((a) => a.getAttribute("href"));
  assert.ok(links.length >= 2, "the found source and its marks are links");
  assert.ok(links.every((h) => h.startsWith("#/files")), "links go to Files only");
  const missing = byClass(root, "k-answer__source--missing");
  assert.equal(missing.length, 1);
  assert.equal(elements(missing[0]).some((e) => e.localName === "a"), false, "a source not found is plain text");
  // M55 (M50 F17): a source is named by its own file name; its folder stays off screen.
  assert.match(textOf(missing[0]), /custom-orders\.md/);
  assert.doesNotMatch(textOf(missing[0]), /policies\//);
  unmount(root);
});

test("AnswerView: reading, became a task, could not be read", async () => {
  installDom();
  const base = { id: "e1", identifier: "STH-19", question: "Do we deliver?", askedAt: "2026-11-12T08:00:00.000Z", taskId: "e1" };
  let root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "reading", answer: null } });
  assert.match(textOf(root), /Reading your files\. This takes a minute or two\./);
  unmount(root);
  // M63: other work ahead in the Chief of staff's line: its turn, and no time promised.
  root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "reading", answer: null, queue: { ahead: 3 } } });
  assert.match(textOf(root), /Waiting its turn: 3 tasks are ahead of it\./);
  assert.doesNotMatch(textOf(root), /minute/);
  unmount(root);
  root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "reading", answer: null, queue: { ahead: 1 } } });
  assert.match(textOf(root), /Waiting its turn: 1 task is ahead of it\./);
  unmount(root);
  root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "reading", answer: null, queue: { ahead: 0 } } });
  assert.match(textOf(root), /Reading your files\. This takes a minute or two\./, "nothing ahead: the words of section 25");
  unmount(root);
  root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "became_task", answer: null } });
  assert.match(textOf(root), /became a task/);
  assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/tasks/STH-19"));
  unmount(root);
  root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "answered", answer: { text: "Yes [1].", sources: [{ n: 1, path: "a.md", found: true, link: { page: "files", id: "YS5tZA" } }], notInFiles: [], wellFormed: false } } });
  assert.match(textOf(root), /Answered\. The sources could not be read\./);
  assert.match(textOf(root), /Yes \[1\]\./, "the text is shown with no marks");
  assert.equal(byClass(root, "k-answer__mark").length, 0);
  unmount(root);
});

test("citation marks stay with the word before them and the stop after them (M50 F7, M18-28)", () => {
  const parts = answer.glueMarks(answer.splitMarks("for a full refund [1]. Custom orders cannot be returned [1][2]."));
  assert.deepEqual(parts, [
    { text: "for a full " }, { word: "refund", marks: [1], after: "." },
    { text: " Custom orders cannot be " }, { word: "returned", marks: [1, 2], after: "." },
  ]);
  assert.deepEqual(answer.glueMarks(answer.splitMarks("[1] first")), [{ word: "", marks: [1], after: "" }, { text: " first" }]);
  assert.deepEqual(answer.glueMarks([]), []);
  const marks = css("kit/answer.css");
  assert.match(marks, /\.k-answer__glue\s*\{\s*white-space: nowrap;/);
  assert.doesNotMatch(marks, /vertical-align: super/);
});

newSheetTest("answer");
