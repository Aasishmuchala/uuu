// V60a: what the live trials showed wrong in Needs you.
//   1. a question raised through the board's question interaction is answered as the board takes it
//   4. an action whose source could not be read says so (502), never "no longer waiting"
//   5. an answer whose write landed is a success, and is never written twice
//  12. staged questions: only lines ending in "?", only the newest, gone after a newer round or answer
//  17. content drafts: listed only after the task's check passed; a send-back makes one marked fix task
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardSeed, IDS, IDS_V2 } from "../../../test/stubs/seed.mjs";
import { boardOff } from "../lib/board.mjs";
import { HomeError } from "../lib/errors.mjs";
import { createActor } from "../lib/inbox.mjs";
import { forgetComments } from "../lib/tasks.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import boardSource, { answersFor, questionsOf } from "../inbox/board.mjs";
import stagedSource from "../inbox/staged.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(HERE, "fixtures-v60a", "sales-question.json"), "utf8"));
const PAPERCLIP = join(HERE, "..", "..", "..", "node_modules", "@paperclipai");

const inbox = async (h) => (await call(h.url, "GET", "/api/inbox")).json;
const actOn = (h, id, action, note) => actAsSeen(h.url, note === undefined ? { id, action } : { id, action, note });
const writesSince = (h, n) => h.board.requests.slice(n).filter((r) => r.method !== "GET");

// ---- 1. the board's question interaction ----

// The live question (Sales on STH-26) moved into the stub seed's company and STH-1, plus any more records.
function questionSeed(extra = []) {
  const moved = JSON.parse(JSON.stringify({ a: FIXTURE.attentionItem, r: FIXTURE.interaction })
    .replaceAll(FIXTURE.interaction.companyId, IDS.company).replaceAll(FIXTURE.interaction.issueId, IDS.issues["STH-1"]));
  const s = boardSeed();
  s.attention.push(moved.a);
  s.threadInteractions = [moved.r];
  for (const { attention, record } of extra) { s.attention.push(attention); s.threadInteractions.push(record); }
  return s;
}
const LIVE_ID = `board:${FIXTURE.attentionItem.id}`;
const LIVE_QID = FIXTURE.interaction.payload.questions[0].id;

// The board's own validators, when installed: true when the board would take `body` for `record`.
async function boardTakes(record, body) {
  const v = join(PAPERCLIP, "shared", "dist", "validators", "issue.js");
  const q = join(PAPERCLIP, "server", "dist", "vendor", "paperclip-runner", "contracts", "question-set.js");
  if (!existsSync(v) || !existsSync(q)) return null;
  const { respondIssueThreadInteractionSchema } = await import(v);
  const { parsePaperclipQuestionResponse } = await import(q);
  if (!respondIssueThreadInteractionSchema.safeParse(body).success) return false;
  const answers = {};
  for (const c of record.payload.questionSet?.questions || []) {
    const a = body.answers.find((x) => x.questionId === c.id);
    if (!a) continue;
    const storage = record.payload.questions.find((x) => x.id === c.id);
    const free = new Set((storage?.options || []).filter((o) => o.freeText).map((o) => o.id));
    answers[c.id] = c.answerMode === "text"
      ? (a.otherText != null ? { text: a.otherText } : {})
      : { selectedOptionIds: a.optionIds.filter((o) => !free.has(o)), ...(a.otherText != null ? { customText: a.otherText } : {}) };
  }
  const set = record.payload.questionSet && {
    ...record.payload.questionSet,
    questions: record.payload.questionSet.questions.map((c) => {
      const storage = record.payload.questions.find((x) => x.id === c.id);
      return c.answerMode !== "text" && !c.customAnswer && (storage?.allowOther || storage?.options.some((o) => o.freeText))
        ? { ...c, customAnswer: { enabled: true } } : c;
    }),
  };
  if (!set) return true;
  try { parsePaperclipQuestionResponse(set, { schema: "paperclip.question_response.v1", answers }); return true; } catch { return false; }
}

const startBoard = (seed) => startV2({ routes: ["inbox"], inbox: ["board"], boardSeed: seed });

test("the live Sales question: its text is shown, only Answer (and Hide) is offered, and the note goes as the answer", async () => {
  const h = await startBoard(questionSeed());
  try {
    const item = (await inbox(h)).items.find((i) => i.id === LIVE_ID);
    assert.equal(item.kind, "question");
    assert.equal(item.raisedBy, "Sales");
    assert.deepEqual(item.actions.map((a) => [a.id, a.label, a.style, a.needsNote]), [["answer", "Answer", "primary", true], ["dismiss", "Hide", "plain", false]]);
    assert.ok(item.details.some((d) => d.label === "Question" && d.value.startsWith("CRM-LEAD-2026-00001 (Asha Rao, trial)")));
    assert.deepEqual(item.questions.map((q) => [q.id, q.mode, q.required, q.options.length, q.allowText]), [[LIVE_QID, "text", true, 0, true]]);
    for (const action of ["accept", "reject"]) {
      const r = await actOn(h, LIVE_ID, action);
      assert.equal(r.status, 400, `${action} is not offered`);
      assert.equal(r.json.error.code, "bad_action");
    }
    const n = h.board.requests.length;
    const r = await actOn(h, LIVE_ID, "answer", "  I set the lead to Qualified myself.  ");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const w = writesSince(h, n);
    assert.equal(w.length, 1);
    assert.equal(`${w[0].method} ${w[0].path}`, `POST /api/issues/${IDS.issues["STH-1"]}/interactions/${FIXTURE.interaction.id}/respond`);
    assert.deepEqual(w[0].body, { answers: [{ questionId: LIVE_QID, optionIds: [], otherText: "I set the lead to Qualified myself." }] });
    const real = await boardTakes(FIXTURE.interaction, w[0].body);
    if (real !== null) assert.equal(real, true, "the board's own validators take it");
    // gone, and a second answer writes nothing
    assert.ok(!(await inbox(h)).items.some((i) => i.id === LIVE_ID));
    const again = await actOn(h, LIVE_ID, "answer", "I set the lead to Qualified myself.");
    assert.ok([404, 409].includes(again.status));
    assert.equal(writesSince(h, n).length, 1);
  } finally { await h.close(); }
});

// Three questions: one choice, several choices, and written words, as the board's form holds them.
const SET_ID = "9a000000-0000-4000-8000-000000000001";
function threeQuestions() {
  const record = {
    id: SET_ID, companyId: IDS.company, issueId: IDS.issues["STH-1"], kind: "ask_user_questions", status: "pending",
    title: "Two choices and a note", createdAt: "2026-11-11T08:00:00.000Z", updatedAt: "2026-11-11T08:00:00.000Z", result: null,
    payload: {
      version: 1,
      questions: [
        { id: "stage", prompt: "Which stage is the lead at?", selectionMode: "single", required: true, allowOther: true,
          options: [{ id: "new", label: "New" }, { id: "qualified", label: "Qualified" }, { id: "paperclip_custom_answer", label: "Other", freeText: true }] },
        { id: "channels", prompt: "Where should we follow up?", selectionMode: "multi", required: false,
          options: [{ id: "phone", label: "Phone" }, { id: "email", label: "Email" }] },
        { id: "notes", prompt: "Anything to add?", selectionMode: "single", required: true, allowOther: true,
          options: [{ id: "paperclip_text_answer", label: "Type an answer", freeText: true }] },
      ],
      questionSet: {
        schema: "paperclip.question_set.v1",
        questions: [
          { id: "stage", prompt: "Which stage is the lead at?", required: true, answerMode: "single_select", options: [{ id: "new", label: "New" }, { id: "qualified", label: "Qualified" }], customAnswer: { enabled: true } },
          { id: "channels", prompt: "Where should we follow up?", required: false, answerMode: "multi_select", options: [{ id: "phone", label: "Phone" }, { id: "email", label: "Email" }] },
          { id: "notes", prompt: "Anything to add?", required: true, answerMode: "text" },
        ],
      },
    },
  };
  const attention = {
    ...JSON.parse(JSON.stringify(FIXTURE.attentionItem)),
    id: `issue_thread_interaction:interaction:${SET_ID}`, dismissalKey: `attention:interaction:${SET_ID}`,
    subject: { kind: "interaction", id: SET_ID, companyId: IDS.company, title: "Two choices and a note", status: "pending", metadata: { kind: "ask_user_questions", issueId: IDS.issues["STH-1"] } },
    relatedIssue: null, companyId: IDS.company, originAgentName: "Sales",
  };
  return { attention, record };
}

test("several questions: each is shown with its choices, and each gets its own answer in the board's form", async () => {
  const { attention, record } = threeQuestions();
  const h = await startBoard(questionSeed([{ attention, record }]));
  const id = `board:${attention.id}`;
  try {
    const item = (await inbox(h)).items.find((i) => i.id === id);
    assert.deepEqual(item.details.map((d) => d.label), ["Question 1", "Choices", "Question 2", "Choices", "Question 3"]);
    assert.equal(item.details[1].value, "New · Qualified");
    assert.deepEqual(item.questions.map((q) => [q.id, q.mode, q.required, q.options.map((o) => o.id).join(), q.allowText]), [
      ["stage", "single", true, "new,qualified", true],
      ["channels", "multi", false, "phone,email", false],
      ["notes", "text", true, "", true],
    ]);
    const n = h.board.requests.length;
    // a required question left out: refused plainly, nothing written
    const missing = await actOn(h, id, "answer", JSON.stringify({ answers: { stage: { optionIds: ["qualified"] } } }));
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.code, "needs_answer");
    // a choice and words for a one-choice question: refused
    const both = await actOn(h, id, "answer", JSON.stringify({ answers: { stage: { optionIds: ["new"], text: "x" }, notes: { text: "y" } } }));
    assert.equal(both.status, 400);
    assert.equal(writesSince(h, n).length, 0);
    const note = { answers: { stage: { optionIds: ["qualified"] }, channels: { optionIds: ["phone", "email"] }, notes: { text: "Call after 5." } } };
    const r = await actOn(h, id, "answer", JSON.stringify(note));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const w = writesSince(h, n);
    assert.equal(w.length, 1);
    assert.deepEqual(w[0].body, { answers: [
      { questionId: "stage", optionIds: ["qualified"] },
      { questionId: "channels", optionIds: ["phone", "email"] },
      { questionId: "notes", optionIds: [], otherText: "Call after 5." },
    ] });
    const real = await boardTakes(record, w[0].body);
    if (real !== null) assert.equal(real, true, "the board's own validators take it");
  } finally { await h.close(); }
});

test("answersFor: plain words go to every question that takes words; choices only questions need a choice", () => {
  const { record } = threeQuestions();
  const qs = questionsOf(record);
  assert.deepEqual(answersFor(qs, "Qualified, call after 5"), [
    { questionId: "stage", optionIds: [], otherText: "Qualified, call after 5" },
    { questionId: "notes", optionIds: [], otherText: "Qualified, call after 5" },
  ]);
  assert.throws(() => answersFor(qs, JSON.stringify({ answers: { stage: { optionIds: ["nope"] }, notes: { text: "x" } } })), /not offered/);
  assert.throws(() => answersFor(qs, JSON.stringify({ answers: { channels: { text: "x" }, stage: { optionIds: ["new"] }, notes: { text: "x" } } })), /not written words/);
  assert.throws(() => answersFor(qs, ""), /needs your answer/);
});

test("a stuck step raised by nobody shows the agent the task is assigned to", async () => {
  const s = boardSeed();
  s.attention.push({
    companyId: IDS.company, sourceKind: "blocker_attention", id: "blocker_attention:bx-1",
    subject: { kind: "issue", id: IDS.issues["STH-3"], title: "A step is stuck", status: "blocked", metadata: {} },
    whyNow: "Blocked.", decisionVerbs: [], severity: "medium", dismissalKey: "attention:bx-1",
    relatedIssue: { kind: "issue", id: IDS.issues["STH-3"], title: "Reconcile the bank", identifier: "STH-3", status: "blocked", metadata: { assigneeAgentId: IDS.agents.bookkeeper } },
    originAgentName: null, activityAt: "2026-11-11T08:00:00.000Z", createdAt: "2026-11-11T08:00:00.000Z", updatedAt: "2026-11-11T08:00:00.000Z",
  });
  s.attention.push({ ...s.attention.at(-1), id: "blocker_attention:bx-2", dismissalKey: "attention:bx-2", relatedIssue: { ...s.attention.at(-1).relatedIssue, metadata: {} } });
  const h = await startBoard(s);
  try {
    const items = (await inbox(h)).items;
    assert.equal(items.find((i) => i.id === "board:blocker_attention:bx-1").raisedBy, "Bookkeeper");
    assert.equal(items.find((i) => i.id === "board:blocker_attention:bx-2").raisedBy, "An agent");
  } finally { await h.close(); }
});

// ---- 5. a write that landed although its answer did not arrive ----

function fakeBoard({ post, get, patch }) {
  const calls = [];
  return {
    calls,
    post: async (path, body) => { calls.push(["POST", path, body]); return post ? post(path, body) : {}; },
    get: async (path) => { calls.push(["GET", path]); return get ? get(path) : []; },
    patch: async (path, body) => { calls.push(["PATCH", path, body]); return patch ? patch(path, body) : {}; },
  };
}
function fakeCtx(board, item) {
  const decisions = new Map();
  return {
    board, item, log: () => {}, decisions: { get: (k) => decisions.get(k), set: (k, v) => decisions.set(k, v) }, seen: decisions,
    fail: (status, message, next, code) => new HomeError(status, message, next, code),
  };
}

test("staged answer: the comment landed although the board did not answer in time, and the status step failed: success", async () => {
  let written = null;
  const board = fakeBoard({
    post: (path, body) => { written = { body: body.body, authorAgentId: null, createdAt: new Date().toISOString() }; throw boardOff(); },
    get: () => (written ? [written] : []),
    patch: () => { throw boardOff(); },
  });
  const item = { id: "staged:unclear:g1:abcd1234", actions: [{ id: "answer" }, { id: "stop" }] };
  Object.defineProperty(item, "_goalId", { value: "g1" });
  const ctx = fakeCtx(board, item);
  const out = await stagedSource.act(ctx, item.id, "answer", "Ten percent.");
  assert.match(out.message, /^Answered\./);
  assert.ok(ctx.seen.get(`answered:${item.id}`), "the item will not come back");
  assert.deepEqual(board.calls.filter((c) => c[0] === "POST").map((c) => c[2]), [{ body: "ANSWER: Ten percent." }], "written once");
  forgetComments();
});

test("staged answer: when the comment is not there, the failure stands and nothing is marked answered", async () => {
  const board = fakeBoard({ post: () => { throw boardOff(); }, get: () => [] });
  const item = { id: "staged:unclear:g2:abcd1234", actions: [{ id: "answer" }] };
  Object.defineProperty(item, "_goalId", { value: "g2" });
  const ctx = fakeCtx(board, item);
  await assert.rejects(stagedSource.act(ctx, item.id, "answer", "Ten percent."), (e) => e.code === "board_off");
  assert.equal(ctx.seen.size, 0);
  forgetComments();
});

test("board answer: the board recorded the answer although its reply did not arrive: success", async () => {
  const record = JSON.parse(JSON.stringify(FIXTURE.interaction));
  const board = fakeBoard({
    post: () => { record.status = "answered"; throw boardOff(); },
    get: () => [record],
  });
  const raw = { ...FIXTURE.attentionItem };
  Object.defineProperty(raw, "_questions", { value: questionsOf(record) });
  const item = { id: LIVE_ID };
  Object.defineProperty(item, "_raw", { value: raw });
  const out = await boardSource.act(fakeCtx(board, item), item.id, "answer", "Done.");
  assert.equal(out.message, "Your answer was passed on.");
  record.status = "pending";
  const failing = fakeBoard({ post: () => { throw boardOff(); }, get: () => [record] });
  await assert.rejects(boardSource.act(fakeCtx(failing, item), item.id, "answer", "Done."), (e) => e.code === "board_off");
});

// ---- 4. a source that cannot be read during an action ----

test("an action whose source could not be read says the board is not answering, not that the item is gone", async () => {
  let reads = 0;
  const flaky = {
    id: "goals",
    list: async () => { reads += 1; if (reads > 1) throw boardOff(); return { items: [{ id: "goal:g1", source: "goal", actions: [{ id: "acknowledge" }] }] }; },
    act: async () => ({ message: "Accepted." }),
  };
  const books = { id: "bench", list: async () => ({ items: [], notConnected: { source: "books", reason: "The books are not answering." } }), act: async () => ({}) };
  const fine = { id: "board", list: async () => ({ items: [] }), act: async () => ({}) };
  const act = createActor([flaky, books, fine]);
  const ctx = { log: () => {} };
  // listed once (the owner saw it), then the board stops answering while the action re-reads
  assert.equal((await flaky.list()).items.length, 1);
  await assert.rejects(act(ctx, { id: "goal:g1", action: "acknowledge" }), (e) => e.status === 502 && e.code === "board_off" && /switched off/.test(e.message) && Boolean(e.next));
  await assert.rejects(act(ctx, { id: "bench:Sales Invoice:X", action: "approve" }), (e) => e.status === 502 && e.message === "The books are not answering." && Boolean(e.next));
  // a source that answered and does not list it: gone, as before
  await assert.rejects(act(ctx, { id: "board:nope", action: "approve" }), (e) => e.status === 404 && e.code === "not_found");
});

// ---- 12. staged questions ----

const I = IDS_V2.issues;
const STH13 = I["STH-13"];
const unclearOf = async (h) => (await inbox(h)).items.filter((i) => i.id.startsWith(`staged:unclear:${STH13}:`));
const startStaged = () => startV2({ routes: ["inbox"], inbox: ["staged"] });
const brief = (h, unclear) => {
  const file = join(h.state, "tasks", "company-work", "STH-13", "00-brief.md");
  writeFileSync(file, `# Brief: x\n## The goal in the owner's words\nA plan.\n## What done looks like\nPosts.\n## Must-haves\n- One\n## Nice-to-haves\n- None\n## Anything unclear\n${unclear}\n`);
  const past = new Date(Date.now() - 60 * 60000);
  utimesSync(file, past, past);
};
const check = (verdict, unclear) => `VERDICT: ${verdict} - x\n# Check: round 1\n## Questions\n1. Does it? YES - y\n## Actions\nNone.\n## Anything unclear\n${unclear}\nVerdict: ${verdict}`;
const addComment = (h, body, { agent = "checker", minutes = 1 } = {}) => {
  h.board.state.comments.push({
    id: `c-${Math.random()}`, issueId: STH13, body, authorAgentId: agent ? IDS_V2.agents[agent] : null,
    authorUserId: agent ? null : "local-board", createdAt: new Date(Date.now() + minutes * 60000).toISOString(),
  });
  forgetComments();
};

test("staged question: only lines that end with a question mark are the owner's questions", async () => {
  const h = await startStaged();
  try {
    brief(h, "- Asked the Builder to use the blue theme.\n- Should the offer include free delivery?\n- The Marketer will pick the photos");
    forgetComments();
    let items = await unclearOf(h);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].details, [{ label: "Question 1", value: "Should the offer include free delivery?" }]);
    for (const none of ["None", "None.", "-", "", "- Noted the price list is final."]) {
      brief(h, none);
      forgetComments();
      items = await unclearOf(h);
      assert.equal(items.length, 0, JSON.stringify(none));
    }
  } finally { await h.close(); }
});

test("staged question: gone after a newer owner answer, and after a newer check round", async () => {
  let h = await startStaged();
  try {
    brief(h, "- Should the offer include free delivery?");
    forgetComments();
    assert.equal((await unclearOf(h)).length, 1);
    addComment(h, "ANSWER: Yes, within the city.", { agent: null });
    assert.equal((await unclearOf(h)).length, 0, "answered on the board, even without the home's own record");
  } finally { await h.close(); }
  h = await startStaged();
  try {
    brief(h, "- Should the offer include free delivery?");
    addComment(h, check("FAIL", "- The photos were too dark, asked for new ones."), { minutes: 1 });
    assert.equal((await unclearOf(h)).length, 0, "a newer check without questions");
    addComment(h, check("FAIL", "- Is the old price list still valid?"), { minutes: 2 });
    const items = await unclearOf(h);
    assert.deepEqual(items.map((i) => i.details[0].value), ["Is the old price list still valid?"]);
    addComment(h, check("PASS", "None."), { minutes: 3 });
    assert.equal((await unclearOf(h)).length, 0, "the stale question of the failed round is gone");
  } finally { await h.close(); }
});

// ---- 17. content drafts ----

const startContent = () => startV2({ routes: ["inbox"], inbox: ["content"], boardSeed: boardSeed(), stateSeed: undefined });
const contentItems = async (h) => (await inbox(h)).items.filter((i) => i.id.startsWith("content:"));
const contentDir = (h, key) => join(h.state, "tasks", "company-work", key, "content");
const draft = (title) => `---\ntitle: ${title}\nchannel: post\nplanned: 2026-12-01\n---\nSome words.\n`;

test("content draft: listed only after its task's newest check passed, or with no check once in review or done", async () => {
  const h = await startContent();
  try {
    mkdirSync(contentDir(h, "STH-2"), { recursive: true });
    writeFileSync(join(contentDir(h, "STH-2"), "launch.md"), draft("Launch"));
    // STH-2 is done and its newest check (on its step STH-6) passed
    assert.ok((await contentItems(h)).some((i) => i.title.endsWith("Launch")));
    // a newer failed round hides it
    h.board.state.comments.push({ id: "c-fail", issueId: IDS.issues["STH-6"], body: "VERDICT: FAIL - too long", authorAgentId: IDS.agents.checker, createdAt: "2026-11-12T09:00:00.000Z" }); // after every seeded time
    assert.ok(!(await contentItems(h)).some((i) => i.title.endsWith("Launch")));
    // no check at all: shown when done or in review, not while the work goes on
    h.board.state.comments = h.board.state.comments.filter((c) => !/^\s*VERDICT:/.test(c.body));
    const sth2 = h.board.state.issues.find((i) => i.identifier === "STH-2");
    sth2.status = "in_progress";
    assert.ok(!(await contentItems(h)).some((i) => i.title.endsWith("Launch")));
    sth2.status = "in_review";
    assert.ok((await contentItems(h)).some((i) => i.title.endsWith("Launch")));
    // a folder that is no task's: not listed
    mkdirSync(contentDir(h, "STH-99"), { recursive: true });
    writeFileSync(join(contentDir(h, "STH-99"), "stray.md"), draft("Stray"));
    assert.ok(!(await contentItems(h)).some((i) => i.title.endsWith("Stray")));
  } finally { await h.close(); }
});

test("content send-back: one fix task marked with the draft's item; a second send-back or Accept closes the open one", async () => {
  const h = await startContent();
  try {
    mkdirSync(contentDir(h, "STH-2"), { recursive: true });
    writeFileSync(join(contentDir(h, "STH-2"), "launch.md"), draft("Launch"));
    let item = (await contentItems(h)).find((i) => i.title.endsWith("Launch"));
    let n = h.board.requests.length;
    assert.equal((await actOn(h, item.id, "send_back", "Shorter.")).status, 200);
    const created = writesSince(h, n).filter((w) => w.method === "POST");
    assert.equal(created.length, 1);
    assert.equal(created[0].path, `/api/companies/${IDS.company}/issues`);
    assert.equal(created[0].body.description.split("\n").at(-1), `DRAFT-FIX: ${item.id}`);
    const fix = h.board.state.issues.find((i) => i.description?.endsWith(`DRAFT-FIX: ${item.id}`));
    assert.equal(fix.status, "todo");
    // the Marketer changes the draft: it is shown again as a new version
    writeFileSync(join(contentDir(h, "STH-2"), "launch.md"), draft("Launch").replace("Some words.", "Fewer words."));
    item = (await contentItems(h)).find((i) => i.title.endsWith("Launch"));
    assert.ok(item);
    n = h.board.requests.length;
    assert.equal((await actOn(h, item.id, "approve")).status, 200);
    assert.ok(writesSince(h, n).some((w) => w.method === "PATCH" && w.path === `/api/issues/${fix.id}` && w.body.status === "done"));
    assert.equal(fix.status, "done");
  } finally { await h.close(); }
});
