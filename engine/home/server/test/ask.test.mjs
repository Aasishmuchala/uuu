// Ask the brain (CONTRACTS-V3 33.4, 33.5): POST /api/ask, GET /api/ask, GET /api/ask/:id, the `answer` key
// of GET /api/tasks/:id and the Needs-you item of an answered question, on the version 3 seed and on
// made-up tasks. A task is a question only by its `ask:` record; a source is a link only when the brain
// lists that file.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { IDS_V3 } from "../../../test/stubs/seed.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { MARKERS } from "../lib/staged.mjs";
import { forgetComments } from "../lib/tasks.mjs";
import { actAsSeen, call, writes } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const OPTIONS = { routes: ["ask", "task", "inbox"], inbox: ["goals"] };
const STH = (n) => IDS_V3.issues[`STH-${n}`];
const RETURNS_TOKEN = Buffer.from("returns-policy.md").toString("base64url");
const GOOD = "# Answer\nWe deliver free inside the city [1].\n## Sources\n1. returns-policy.md - Returns\n## Not in the files\nNone.\n";

let h;
before(async () => { h = await startV2(OPTIONS); });
after(async () => { await h?.close(); });

const get = (path) => call(h.url, "GET", path);
const post = (path, body) => call(h.url, "POST", path, { body });
const decisions = () => JSON.parse(readFileSync(join(h.state, "home", "decisions.json"), "utf8"));
const issueOf = (id) => h.board.state.issues.find((i) => i.id === id);
const writeAnswer = (identifier, text) => {
  const dir = join(h.config.paths.projectFolder, identifier);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "answer.md"), text);
};
// A new question through the route, then its task set to `status` on the stub board.
async function askNew(text, status) {
  const r = await post("/api/ask", { text });
  assert.equal(r.status, 201, r.text);
  if (status) issueOf(r.json.ask.id).status = status;
  return r.json.ask;
}
const inboxItem = async (taskId) => (await get("/api/inbox")).json.items.find((i) => i.id === `goal:${taskId}`);

test("POST /api/ask sends one issue to the Chief of staff whose text ends ASK, then writes the record", async () => {
  const before = writes(h.board).length;
  const r = await post("/api/ask", { text: "  Do we deliver on Sundays?  " });
  assert.equal(r.status, 201, r.text);
  const sent = writes(h.board).slice(before);
  assert.deepEqual(sent, [`POST /api/companies/${IDS_V3.company}/issues`]);
  const issue = issueOf(r.json.ask.id);
  assert.equal(issue.description, "Do we deliver on Sundays?\n\nASK");
  assert.ok(issue.description.endsWith(`\n${MARKERS.ask}`));
  assert.equal(issue.title, "Do we deliver on Sundays?");
  assert.equal(issue.assigneeAgentId, IDS_V3.agents["chief-of-staff"]);
  assert.equal(issue.status, "todo");
  const at = decisions()[`ask:${issue.id}`];
  assert.ok(typeof at === "string" && Number.isFinite(Date.parse(at)));
  const ask = r.json.ask;
  assert.deepEqual(sameShape(readShape("ask"), ask), []);
  assert.equal(ask.state, "reading");
  assert.equal(ask.plainState, "Reading your files");
  assert.equal(ask.question, "Do we deliver on Sundays?");
  assert.equal(ask.answer, null);
  assert.equal(ask.taskId, issue.id);
});

test("POST /api/ask refuses empty and too-long text and writes nothing", async () => {
  const before = writes(h.board).length;
  const count = Object.keys(decisions()).length;
  for (const body of [{}, { text: "" }, { text: "   " }, { text: 42 }]) {
    const r = await post("/api/ask", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error.code, "empty_text");
  }
  const long = await post("/api/ask", { text: "x".repeat(2001) });
  assert.equal(long.status, 400);
  assert.equal(long.json.error.code, "text_too_long");
  assert.equal(writes(h.board).length, before);
  assert.equal(Object.keys(decisions()).length, count);
  const most = await post("/api/ask", { text: "y".repeat(2000) });
  assert.equal(most.status, 201);
});

test("the record is written only after the board answered", async () => {
  const count = Object.keys(decisions()).length;
  const company = h.board.state.companies[0];
  const saved = company.id;
  company.id = "gone";                      // the board now answers 404 for the company
  try {
    const r = await post("/api/ask", { text: "Will this be lost?" });
    assert.notEqual(r.status, 201);
  } finally {
    company.id = saved;
  }
  assert.equal(Object.keys(decisions()).length, count);
});

test("the seed's STH-19 is answered: source 1 found and linked, source 2 not", async () => {
  const r = await get(`/api/ask/${STH(19)}`);
  assert.equal(r.status, 200, r.text);
  const ask = r.json;
  assert.deepEqual(sameShape(readShape("ask"), ask), []);
  assert.equal(ask.identifier, "STH-19");
  assert.equal(ask.question, "What is our returns policy, and when did it last change?");
  assert.equal(ask.state, "answered");
  assert.equal(ask.plainState, "Answered");
  assert.equal(ask.answer.text, "Customers can return an unused item within 14 days for a full refund [1]. Custom orders cannot be returned [1][2].");
  assert.deepEqual(ask.answer.sources, [
    { n: 1, path: "returns-policy.md", note: "Returns", found: true, link: { page: "files", id: RETURNS_TOKEN }, title: "returns-policy.md" },
    { n: 2, path: "policies/custom-orders.md", note: "", found: false, link: null, title: null },
  ]);
  assert.deepEqual(ask.answer.notInFiles, ["When the policy last changed."]);
  assert.equal(ask.answer.checked, false);
  assert.equal(ask.answer.wellFormed, true);
  assert.equal(ask.needsYou.inboxId, `goal:${STH(19)}`);
  assert.equal(ask.needsYou.action, "acknowledge");
  assert.equal(ask.needsYou.label, "Got it");
  assert.equal(typeof ask.needsYou.version, "string");
  assert.equal((await get("/api/ask/STH-19")).json.id, STH(19), "the identifier works too");
});

test("the seed's STH-22 is still being read", async () => {
  const r = await get("/api/ask/STH-22");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.state, "reading");
  assert.equal(r.json.plainState, "Reading your files");
  assert.equal(r.json.answer, null);
  assert.equal(r.json.needsYou, null);
});

test("a task without an ask: record is not a question, even with ASK in its text or an answer file", async () => {
  for (const id of ["STH-8", "nope", STH(20)]) {
    const r = await get(`/api/ask/${encodeURIComponent(id)}`);
    assert.equal(r.status, 404, id);
    assert.equal(r.json.error.code, "ask_not_found");
  }
  // STH-25 is finished and not accepted: give it an answer file and the line ASK; it stays a plain result.
  const issue = issueOf(STH(25));
  const was = issue.description;
  issue.description = `${was}\n\nASK`;
  writeAnswer("STH-25", GOOD);
  try {
    assert.equal((await get(`/api/ask/${STH(25)}`)).status, 404);
    const t = (await get("/api/tasks/STH-25")).json;
    assert.equal(t.task.ask, false);
    assert.equal(t.answer, null);
    const item = await inboxItem(STH(25));
    assert.ok(item.title.startsWith("Finished: "), item.title);
    assert.deepEqual(item.actions.map((a) => a.label), ["Accept", "Send back"]);
  } finally {
    issue.description = was;
  }
});

test("a question with a step became a task; a finished one with no answer file too", async () => {
  const withStep = await askNew("Please redo the price list.");
  const parent = issueOf(withStep.id);
  h.board.state.issues.push({ ...parent, id: randomUUID(), parentId: parent.id, identifier: "STH-901", title: "Redo the prices", description: "Redo", createdAt: new Date().toISOString() });
  const a = (await get(`/api/ask/${withStep.id}`)).json;
  assert.equal(a.state, "became_task");
  assert.equal(a.plainState, "Became a task");
  assert.equal(a.answer, null);

  const noFile = await askNew("Make me a flyer.", "done");
  const b = (await get(`/api/ask/${noFile.id}`)).json;
  assert.equal(b.state, "became_task");
  assert.equal(b.answer, null);
});

test("a blocked question needs you; a cancelled one is stopped", async () => {
  const blocked = await askNew("Which supplier do we use for hinges?", "blocked");
  const a = (await get(`/api/ask/${blocked.id}`)).json;
  assert.equal(a.state, "needs_you");
  assert.equal(a.plainState, "Needs you");
  const cancelled = await askNew("Never mind this one.", "cancelled");
  const b = (await get(`/api/ask/${cancelled.id}`)).json;
  assert.equal(b.state, "stopped");
  assert.equal(b.plainState, "Stopped");
  assert.equal(b.answer, null);
});

test("a made-up answered question: found sources link, path tricks stay words", async () => {
  const q = await askNew("Do we charge for delivery in the city?", "done");
  const id = issueOf(q.id).identifier;
  writeAnswer(id, "# Answer\nNo [1]. See [2] and [3].\n## Sources\n1. returns-policy.md - Returns\n2. ../secrets - keys\n3. /etc/passwd\n## Not in the files\n- The price outside the city.\n");
  const a = (await get(`/api/ask/${q.id}`)).json;
  assert.equal(a.state, "answered");
  assert.deepEqual(a.answer.sources.map((s) => [s.path, s.found, s.link]), [
    ["returns-policy.md", true, { page: "files", id: RETURNS_TOKEN }],
    ["../secrets", false, null],
    ["/etc/passwd", false, null],
  ]);
  assert.deepEqual(a.answer.notInFiles, ["The price outside the city."]);
  assert.equal(typeof a.answer.at, "string");
});

test("an answer file that does not parse is answered with wellFormed false and no sources", async () => {
  const q = await askNew("What colour is our logo?", "done");
  const id = issueOf(q.id).identifier;
  writeAnswer(id, "Green [1].\n## Sources\n1. brand/brand.md - Brand\n");
  const a = (await get(`/api/ask/${q.id}`)).json;
  assert.equal(a.state, "answered");
  assert.equal(a.answer.wellFormed, false);
  assert.deepEqual(a.answer.sources, []);
  assert.ok(!a.answer.text.includes("[1]"));
  const item = await inboxItem(q.id);
  assert.ok(item.title.startsWith("Finished: "), "a file that does not parse keeps the plain result item");
});

test("checked is true only when the question's tree has a passing round", async () => {
  const q = await askNew("Are our prices on the site right?", "done");
  writeAnswer(issueOf(q.id).identifier, GOOD);
  assert.equal((await get(`/api/ask/${q.id}`)).json.answer.checked, false);
  h.board.state.comments.push({
    id: randomUUID(), issueId: q.id, body: "VERDICT: PASS - all good\n# Check: round 1\n## Questions\n1. Is it right? YES - yes\n## Actions\nNone.\n## Anything unclear\nNone.\nVerdict: PASS",
    authorAgentId: IDS_V3.agents.checker, authorUserId: null, createdAt: new Date().toISOString(),
  });
  forgetComments(q.id);
  assert.equal((await get(`/api/ask/${q.id}`)).json.answer.checked, true);
});

test("GET /api/ask lists the questions newest first, at most 20, each of shape ask", async () => {
  const r = await get("/api/ask");
  assert.equal(r.status, 200, r.text);
  const { asks } = r.json;
  assert.ok(asks.length >= 2 && asks.length <= 20, String(asks.length));
  for (const a of asks) assert.deepEqual(sameShape(readShape("ask"), a), [], a.identifier);
  const ids = asks.map((a) => a.id);
  const times = asks.map((a) => a.askedAt);
  assert.deepEqual([...times].sort().reverse(), times);
  assert.ok(!ids.includes(STH(20)) && !ids.includes(STH(8)));
  for (let i = 0; i < 20; i += 1) await post("/api/ask", { text: `Question number ${i}?` });
  const many = (await get("/api/ask")).json.asks;
  assert.equal(many.length, 20);
  assert.equal(many[0].question, "Question number 19?");
});

test("the task route carries the question's answer; other tasks carry null", async () => {
  const t = (await get("/api/tasks/STH-19")).json;
  assert.deepEqual(sameShape(readShape("task"), t), []);
  assert.equal(t.task.ask, true);
  const ask = (await get(`/api/ask/${STH(19)}`)).json;
  assert.deepEqual(t.answer, ask.answer);
  assert.equal(t.acceptance.accept.label, "Got it");
  const other = (await get("/api/tasks/STH-8")).json;
  assert.equal(other.answer, null);
  assert.deepEqual(sameShape(readShape("task"), other), []);
  assert.equal((await get("/api/tasks/STH-22")).json.answer, null, "an open question has no answer yet");
});

test("the Needs-you item of STH-19 has the pinned labels and still carries a version", async () => {
  const item = await inboxItem(STH(19));
  assert.ok(item, "STH-19 waits in Needs you");
  assert.equal(item.title, "Answer: What is our returns policy, and when did it last change?");
  assert.equal(item.summary, "Customers can return an unused item within 14 days for a full refund [1]. Custom orders cannot be returned [1][2].");
  assert.deepEqual(item.details, [{ label: "Checked", value: "Not checked" }, { label: "From", value: "1 of your files" }]);
  assert.deepEqual(item.actions.map((a) => [a.id, a.label, a.style, a.needsNote]), [
    ["acknowledge", "Got it", "primary", false], ["reopen", "Ask again", "plain", true],
  ]);
  assert.equal(typeof item.version, "string");
  assert.ok(item.version.length > 0);
  assert.equal(item.source, "goal");
  assert.equal(item.kind, "result");
  assert.deepEqual(item.link, { page: "tasks", id: STH(19) });
});

test("a long question and answer are cut in the Needs-you item", async () => {
  const long = `${"How long is a long question ".repeat(5)}?`;
  const q = await askNew(long, "done");
  writeAnswer(issueOf(q.id).identifier, `# Answer\n${"word ".repeat(100)}[1]\n## Sources\n1. returns-policy.md\n`);
  const item = await inboxItem(q.id);
  assert.ok(item.title.startsWith("Answer: How long"));
  assert.ok(item.title.length <= "Answer: ".length + 60);
  assert.ok(item.title.endsWith("…"));
  assert.ok(item.summary.length <= 200);
});

test("Got it acknowledges the answer through the one inbox route", async () => {
  const q = await askNew("Is the shop open on Diwali?", "done");
  writeAnswer(issueOf(q.id).identifier, GOOD);
  const before = (await get(`/api/ask/${q.id}`)).json;
  assert.equal(before.needsYou.label, "Got it");
  const r = await actAsSeen(h.url, { id: before.needsYou.inboxId, action: "acknowledge", version: before.needsYou.version });
  assert.equal(r.status, 200, r.text);
  const after = (await get(`/api/ask/${q.id}`)).json;
  assert.equal(after.needsYou, null);
  assert.equal(after.state, "answered");
});
