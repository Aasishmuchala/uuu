// M63 item 40 (second half): the owner's answer to an agent's question card is shown in the task's conversation, as
// the owner's own message in its place in time. The board keeps such an answer as a record of the question, not as a
// comment, so the home server keeps the owner's words when the owner answers (lib/owner-text.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { PICKED, ownerAnswersOf, recordOwnerAnswer } from "../lib/owner-text.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const I = IDS.issues; // STH-4 is a step of the goal STH-1
const IID = "9b000000-0000-4000-8000-000000000063";
const TEXT_Q = { version: 1, questions: [{ id: "q", prompt: "Which unit should the books use?", selectionMode: "single", required: true, allowOther: true,
  options: [{ id: "paperclip_text_answer", label: "Type an answer", freeText: true }] }] };

function seed() {
  const s = boardSeed();
  s.attention = s.attention.filter((a) => a.sourceKind !== "issue_thread_interaction");
  const at = new Date(Date.now() - 10 * 60000).toISOString();
  s.attention.push({
    companyId: IDS.company, sourceKind: "issue_thread_interaction", id: `issue_thread_interaction:interaction:${IID}`,
    subject: { kind: "interaction", id: IID, title: "Which unit?", status: "pending", metadata: { kind: "ask_user_questions", issueId: I["STH-4"], createdByAgentId: IDS.agents.builder } },
    whyNow: "An agent asked.", decisionVerbs: [], severity: "medium", dismissalKey: `attention:interaction:${IID}`,
    relatedIssue: { kind: "issue", id: I["STH-4"], title: "Task STH-4", identifier: "STH-4", status: "in_progress", metadata: {} },
    originAgentName: null, activityAt: at, createdAt: at, updatedAt: at,
  });
  s.threadInteractions = [{ id: IID, companyId: IDS.company, issueId: I["STH-4"], kind: "ask_user_questions", status: "pending", title: "Which unit?",
    payload: TEXT_Q, result: null, createdByAgentId: IDS.agents.builder, createdAt: at, updatedAt: at }];
  return s;
}

test("the owner's answer to a question card is the owner's own message in the task's conversation, in its place", async () => {
  const h = await startV2({ routes: ["inbox", "task"], inbox: ["board"], boardSeed: seed() });
  try {
    const before = (await call(h.url, "GET", `/api/tasks/${I["STH-1"]}`)).json.conversation;
    const r = await actAsSeen(h.url, { id: `board:issue_thread_interaction:interaction:${IID}`, action: "answer", note: "Use Nos,​ and say so." });
    assert.equal(r.status, 200, r.text);
    const after = (await call(h.url, "GET", `/api/tasks/${I["STH-1"]}`)).json.conversation;
    assert.equal(after.length, before.length + 1);
    const mine = after.filter((m) => m.who.slug === "you" && m.text === "Use Nos, and say so.");
    assert.equal(mine.length, 1, JSON.stringify(after.slice(-3)));
    assert.equal(mine[0].kind, "note");
    // In time order: after everything said before it.
    const times = after.map((m) => Date.parse(m.at)).filter(Number.isFinite);
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    assert.equal(after.at(-1).text, "Use Nos, and say so.");
  } finally {
    await h.close();
  }
});

test("recordOwnerAnswer keeps only the owner's typed words; a choice's label (the agent's word) is never copied", () => {
  const data = new Map();
  const d = { get: (k) => (data.has(k) ? data.get(k) : null), set: (k, v) => data.set(k, v) };
  recordOwnerAnswer(d, "s1", ["", ""]);
  recordOwnerAnswer(d, "s1", ["Blue‮ please", "Blue please"]);
  recordOwnerAnswer(d, "s1", ["x".repeat(5000)]);
  const list = ownerAnswersOf(d, "s1");
  assert.deepEqual(list.map((e) => e.text.slice(0, 20)), [PICKED.slice(0, 20), "Blue please", "x".repeat(20)]);
  assert.ok(list[2].text.length <= 2000);
  assert.equal(recordOwnerAnswer(d, "", ["a"]), null);
  assert.deepEqual(ownerAnswersOf(d, "nothing"), []);
});
