// M63 (items 2, 15, 21, 12, 17): waiting its turn. Every agent works on one thing at a time, so a question, a job or
// a task waits while other work is ahead of it in the Chief of staff's line. The server works the number out from
// the board's records only (the runs it lists as queued or running, its parent links) and sends it as
// `queue: { ahead }` with the map, a question being read, a task not started yet and the reply to starting a job.
// A "blocked, waiting on you" card the owner has already answered is left out while the task's run waits its
// turn (or for a moment after the owner acted), and the task shows as "Waiting its turn", not under Stopped.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDS_V3 } from "../../../test/stubs/seed.mjs";
import { forgetComments } from "../lib/tasks.mjs";
import { ANSWERED_GRACE_MS, aheadIn, answeredBlock, ownerCommentAt, rootFinder, treeRuns } from "../lib/turn.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const CHIEF = IDS_V3.agents["chief-of-staff"];
const STH = (n) => IDS_V3.issues[`STH-${n}`];
const T0 = Date.parse("2026-11-12T09:00:00.000Z");
const iso = (minutes, base = T0) => new Date(base + minutes * 60000).toISOString();

// ---- the pure rules

test("aheadIn: running work and work queued before mine are ahead; a new task waits behind everything", () => {
  const rootOf = rootFinder([{ id: "g1" }, { id: "s1", parentId: "g1" }, { id: "s2", parentId: "g1" }, { id: "g2" }, { id: "g3" }, { id: "me" }]);
  const runs = [
    { id: "r1", agentId: "cos", issueId: "s1", status: "running", createdAt: iso(0) },
    { id: "r2", agentId: "cos", issueId: "s2", status: "queued", createdAt: iso(1) }, // the same task as r1
    { id: "r3", agentId: "cos", issueId: "g2", status: "queued", createdAt: iso(2) },
    { id: "r4", agentId: "cos", issueId: "me", status: "queued", createdAt: iso(3) },
    { id: "r5", agentId: "cos", issueId: "g3", status: "queued", createdAt: iso(4) }, // behind mine
    { id: "r6", agentId: "sales", issueId: "g3", status: "running", createdAt: iso(0) }, // another agent's line
  ];
  assert.deepEqual(aheadIn(runs, { agentId: "cos", mine: new Set(["me"]), rootOf }), { ahead: 2 });
  assert.deepEqual(aheadIn(runs, { agentId: "cos", mine: new Set(["new"]), rootOf }), { ahead: 4 }, "a new task: everything in the line");
  assert.deepEqual(aheadIn(runs, { agentId: "cos", rootOf }), { ahead: 4 });
  assert.equal(aheadIn(runs, { agentId: "cos", mine: new Set(["g2", "x"]), rootOf }).ahead, 1);
  assert.equal(aheadIn(runs, { agentId: "cos", mine: new Set(["s1"]), rootOf }), null, "running: it has started");
  assert.deepEqual(aheadIn([], { agentId: "cos" }), { ahead: 0 });
  assert.equal(aheadIn(runs, { agentId: null }), null);
  // A run with no task counts once; a queued run of unknown time is counted (never too few).
  assert.equal(aheadIn([{ id: "x", agentId: "cos", status: "running" }, { id: "y", agentId: "cos", issueId: "g9", status: "queued" },
    { id: "z", agentId: "cos", issueId: "me", status: "queued", createdAt: iso(0) }], { agentId: "cos", mine: new Set(["me"]) }).ahead, 2);
});

test("treeRuns, answeredBlock and ownerCommentAt", () => {
  const runs = [{ agentId: "a", issueId: "g", status: "queued" }, { agentId: "b", issueId: "s", status: "running" }, { agentId: "c", issueId: "x", status: "queued" }];
  assert.deepEqual(treeRuns(runs, new Set(["g", "s"])), { running: 1, queued: 1, agentId: "a" });
  assert.deepEqual(treeRuns(null, new Set(["g"])), { running: 0, queued: 0, agentId: null });
  const now = T0;
  assert.equal(answeredBlock({ live: true, now }), true, "a queued or running run of the task");
  assert.equal(answeredBlock({ blockedAt: iso(-10), ownerAt: iso(-1), now }), true, "the owner answered after the block, a moment ago");
  assert.equal(answeredBlock({ blockedAt: iso(-1), ownerAt: iso(-10), now }), false, "blocked again after the answer");
  assert.equal(answeredBlock({ blockedAt: iso(-60), ownerAt: new Date(now - ANSWERED_GRACE_MS - 1000).toISOString(), now }), false,
    "nothing queued long after the answer: the card comes back");
  assert.equal(answeredBlock({ ownerAt: iso(-1), now }), true, "a block of unknown time counts as older");
  assert.equal(answeredBlock({ blockedAt: iso(-1), now }), false);
  assert.equal(ownerCommentAt([{ authorAgentId: "a", createdAt: iso(5) }, { authorUserId: "u", createdAt: iso(1) }, { authorUserId: "u", createdAt: iso(2) }]), iso(2));
  assert.equal(ownerCommentAt([{ authorAgentId: "a", createdAt: iso(5) }]), null, "an agent's comment is never the owner's");
});

// ---- the routes

let h;
before(async () => {
  h = await startV2({ routes: ["ask", "task", "map", "jobs", "inbox", "tasks", "shell"], inbox: ["board", "goals"] });
});
after(async () => { await h?.close(); });
beforeEach(() => { forgetComments(); });

const get = (path) => call(h.url, "GET", path);
const post = (path, body) => call(h.url, "POST", path, { body });
const issueOf = (id) => h.board.state.issues.find((i) => i.id === id);
const decisions = () => JSON.parse(readFileSync(join(h.state, "home", "decisions.json"), "utf8"));
let runN = 0;
const run = (issueId, status, minutes, agentId = CHIEF) => {
  runN += 1;
  const r = { id: `f6300000-0000-4000-8000-${String(runN).padStart(12, "0")}`, companyId: IDS_V3.company, agentId, issueId, status, createdAt: iso(minutes, Date.now()) };
  h.board.state.liveRuns.push(r);
  return r;
};
const clearRuns = (ids) => { h.board.state.liveRuns = h.board.state.liveRuns.filter((r) => !ids.includes(r.id)); };

test("the Chief of staff's line: the map, a question being read, the task page and starting a job say how many tasks are ahead", async () => {
  const busy = [run(STH(19), "running", -30), run(STH(20), "queued", -20), run(STH(21), "queued", -10)];
  try {
    // A question asked now waits behind the three.
    const asked = await post("/api/ask", { text: "Do we deliver on Sundays?" });
    assert.equal(asked.status, 201, asked.text);
    assert.deepEqual(asked.json.ask.queue, { ahead: 3 });
    const id = asked.json.ask.id;

    let map = (await get("/api/map")).json;
    assert.deepEqual(map.brain.queue, { ahead: 3 }, "a new question would wait behind 3 tasks");
    assert.equal(map.brain.asking.id, id);
    assert.deepEqual(map.brain.asking.queue, { ahead: 3 }, "no run of it yet: it waits behind all of them");

    // Its run is queued after the first two: two are ahead of it, one is behind it.
    const mine = run(id, "queued", -5);
    const later = run(STH(22), "queued", 0);
    map = (await get("/api/map")).json;
    assert.deepEqual(map.brain.asking.queue, { ahead: 3 }, "running 19, queued 20 and 21 are ahead; 22 is behind");
    assert.deepEqual(map.brain.queue, { ahead: 5 });
    const ask = (await get(`/api/ask/${id}`)).json;
    assert.equal(ask.state, "reading");
    assert.deepEqual(ask.queue, { ahead: 3 });
    const task = (await get(`/api/tasks/${id}`)).json;
    assert.deepEqual(task.task.queue, { ahead: 3 });

    // Once its run runs, no number: the present words hold.
    mine.status = "running";
    assert.equal((await get(`/api/ask/${id}`)).json.queue, null);
    assert.equal((await get(`/api/tasks/${id}`)).json.task.queue, null);
    assert.equal((await get("/api/map")).json.brain.asking.queue, null);
    clearRuns([mine.id, later.id]);

    // A job started now: the reply names the line, and promises no time.
    const job = (await get("/api/jobs/operations/summary-of-the-week")).json;
    assert.deepEqual(job.queue, { ahead: 3 });
    const started = await post("/api/jobs/operations/summary-of-the-week/start", {});
    assert.equal(started.status, 201, started.text);
    assert.deepEqual(started.json.queue, { ahead: 3 });
    assert.equal(started.json.message, "Started. The Chief of staff has it. Waiting its turn: 3 tasks are ahead of it. It is checked before it reaches you.");
    assert.doesNotMatch(started.json.message, /minute/);
  } finally {
    clearRuns(busy.map((r) => r.id));
  }
  // Nothing ahead: the words of section 25, as before.
  const started = await post("/api/jobs/operations/summary-of-the-week/start", {});
  assert.deepEqual(started.json.queue, { ahead: 0 });
  assert.equal(started.json.message, "Started. The Chief of staff has it. It takes a few minutes and is checked before it reaches you.");
  const one = run(STH(19), "running", -1);
  try {
    const again = await post("/api/jobs/operations/summary-of-the-week/start", {});
    assert.equal(again.json.message, "Started. The Chief of staff has it. Waiting its turn: 1 task is ahead of it. It is checked before it reaches you.");
  } finally { clearRuns([one.id]); }
});

test("the board's runs not read: no number is sent", async () => {
  const saved = h.board.state.liveRuns;
  h.board.state.liveRuns = null; // the stub's route then fails
  try {
    const map = await get("/api/map");
    assert.equal(map.status, 200, map.text);
    assert.equal(map.json.brain.queue, null);
    const asked = await post("/api/ask", { text: "Is the shop open on Monday?" });
    assert.equal(asked.status, 201, asked.text);
    assert.equal(asked.json.ask.queue, null);
    assert.equal((await get(`/api/tasks/${asked.json.ask.id}`)).json.task.queue, null);
  } finally {
    h.board.state.liveRuns = saved;
  }
});

// A goal for the Chief of staff, blocked by the board, with the board's "blocked, waiting on you" card.
async function blockedGoal(n) {
  const r = await post("/api/ask", { text: `A question that got stuck ${n}` });
  const goal = issueOf(r.json.ask.id);
  goal.status = "blocked";
  goal.blockedTransitionAt = iso(-30, Date.now());
  const cardId = `blocker_attention:blocker:${goal.id}`;
  h.board.state.attention.push({
    companyId: IDS_V3.company, sourceKind: "blocker_attention", id: cardId,
    subject: { kind: "issue", id: goal.id, title: goal.title, status: "blocked", metadata: {} },
    whyNow: "Blocks 1 task and needs human attention.", decisionVerbs: [], severity: "high", dismissalKey: `blocker:${goal.id}`,
    relatedIssue: { kind: "issue", id: goal.id, title: goal.title, identifier: goal.identifier, status: "blocked", metadata: {} },
    originAgentName: "Chief of staff", activityAt: goal.updatedAt, createdAt: goal.createdAt, updatedAt: goal.updatedAt,
  });
  return { goal, card: `board:${cardId}` };
}
const listed = async () => (await get("/api/inbox")).json.items.map((i) => i.id);
const cardOf = async (id) => (await get(`/api/tasks/${id}`)).json.task;

test("a blocked card the owner has answered: left out while the task's run is queued or running, and the task waits its turn", async () => {
  const { goal, card } = await blockedGoal(1);
  // Nothing queued and no answer: the Urgent card, and the task is under Stopped.
  assert.ok((await listed()).includes(card));
  assert.equal((await cardOf(goal.id)).column, "failed");

  // The owner's answer woke the Chief of staff, whose run is queued behind other work.
  const ahead = run(STH(20), "running", -20);
  const mine = run(goal.id, "queued", -1);
  try {
    assert.ok(!(await listed()).includes(card), "no Urgent card while the run waits its turn");
    let t = await cardOf(goal.id);
    assert.equal(t.column, "backlog");
    assert.equal(t.state, "waiting");
    assert.equal(t.plainState, "Waiting its turn");
    assert.deepEqual(t.queue, { ahead: 1 });
    const board = (await get("/api/tasks")).json;
    const col = (id) => board.columns.find((c) => c.tasks.some((x) => x.id === id))?.id;
    assert.equal(col(goal.id), "backlog", "not under Stopped");
    const ask = (await get(`/api/ask/${goal.id}`)).json;
    assert.equal(ask.state, "reading", "a question whose answer was passed on is read again, not 'needs you'");
    assert.deepEqual(ask.queue, { ahead: 1 });

    // Its run runs: being worked on, no number.
    mine.status = "running";
    t = await cardOf(goal.id);
    assert.equal(t.column, "in_progress");
    assert.equal(t.plainState, "Being worked on");
    assert.equal(t.queue, null);
    assert.ok(!(await listed()).includes(card));
  } finally {
    clearRuns([ahead.id, mine.id]);
  }
  // The run ended and the task is still blocked: the card is back.
  assert.ok((await listed()).includes(card), "the card comes back once nothing is queued or running for it");
  assert.equal((await cardOf(goal.id)).column, "failed");
});

test("a blocked card is left out for a moment after the owner answers, then comes back if nothing was queued", async () => {
  const { goal, card } = await blockedGoal(2);
  // The owner's own comment after the block (a reply, an ANSWER:): left out at once.
  const c = { id: "c6300000-0000-4000-8000-000000000001", issueId: goal.id, body: "ANSWER: Yes, go ahead.", authorAgentId: null, authorUserId: "local-board", createdAt: new Date(Date.now() - 30000).toISOString() };
  h.board.state.comments.push(c);
  assert.ok(!(await listed()).includes(card));
  assert.equal((await cardOf(goal.id)).plainState, "Waiting its turn");
  // An agent's comment is never the owner's answer.
  c.authorAgentId = CHIEF; c.authorUserId = null;
  forgetComments();
  assert.ok((await listed()).includes(card));
  // An answer older than the moment allowed, with nothing queued: the card is back.
  c.authorAgentId = null; c.authorUserId = "local-board"; c.createdAt = new Date(Date.now() - ANSWERED_GRACE_MS - 60000).toISOString();
  forgetComments();
  assert.ok((await listed()).includes(card));
  assert.equal((await cardOf(goal.id)).column, "failed");
  // An answer from before the block does not count.
  c.createdAt = iso(-40, Date.now());
  goal.blockedTransitionAt = iso(-30, Date.now());
  forgetComments();
  assert.ok((await listed()).includes(card));
});

test("acting on a task's Needs-you item records the owner's action, and the card waits its turn", async () => {
  const { goal, card } = await blockedGoal(3);
  const items = (await get("/api/inbox")).json.items;
  const item = items.find((i) => i.id === card);
  assert.ok(item.actions.some((a) => a.id === "answer"), "Reply is offered");
  // The stub takes the reply as a comment; drop it so only the home server's record is left to decide.
  const r = await actAsSeen(h.url, { id: card, action: "answer", note: "The answer is yes." });
  assert.equal(r.status, 200, r.text);
  h.board.state.comments = h.board.state.comments.filter((x) => x.issueId !== goal.id);
  forgetComments();
  const at = decisions()[`acted:${goal.id}`];
  assert.ok(Number.isFinite(Date.parse(at)), "acted:<task id> holds the time");
  assert.ok(!(await listed()).includes(card));
  // Hiding is not an answer.
  const { goal: g2, card: c2 } = await blockedGoal(4);
  const hid = await actAsSeen(h.url, { id: c2, action: "dismiss" });
  assert.equal(hid.status, 200, hid.text);
  assert.equal(decisions()[`acted:${g2.id}`], undefined);
});

// The compose dialog and a department's box say the same as the map's box: GET /api/shell carries the Chief of
// staff's line, from the board's live runs only.
test("GET /api/shell: queue is how many tasks a task given now would wait behind", async () => {
  const busy = [run(STH(19), "running", -30), run(STH(20), "queued", -20), run(STH(20), "queued", -19)];
  try {
    const shell = (await get("/api/shell")).json;
    assert.deepEqual(shell.queue, { ahead: 2 }, "two runs of one task count once");
  } finally {
    clearRuns(busy.map((r) => r.id));
  }
  await new Promise((resolve) => setTimeout(resolve, 1100)); // the shell keeps the board's answers for a second
  assert.deepEqual((await get("/api/shell")).json.queue, { ahead: 0 });
  const saved = h.board.state.liveRuns;
  h.board.state.liveRuns = null; // the stub's route then fails: the shell still answers, with no number
  try {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const r = await get("/api/shell");
    assert.equal(r.status, 200);
    assert.equal(r.json.queue, null);
  } finally {
    h.board.state.liveRuns = saved;
  }
});

// M63 item 49: the owner answered a step's question; the board then blocked the top task too. Needs you hides the
// step's card by the step's own block time, so the task's state must say the same: waiting its turn, not stuck.
test("an answered step's block: Needs you and the task's state agree, even when the top task was blocked after the answer", async () => {
  const r = await post("/api/ask", { text: "A task whose step asked the owner" });
  const goal = issueOf(r.json.ask.id);
  const step = {
    ...goal, id: "f6300000-0000-4000-8000-0000000004a9", identifier: "STH-949", issueNumber: 949, parentId: goal.id,
    title: "Draft the quotation", assigneeAgentId: IDS_V3.agents.bookkeeper, status: "blocked", blockedTransitionAt: iso(-30, Date.now()),
  };
  h.board.state.issues.push(step);
  goal.status = "blocked";
  goal.blockedTransitionAt = iso(-30, Date.now());
  const cardId = `blocker_attention:blocker:${step.id}`;
  h.board.state.attention.push({
    companyId: IDS_V3.company, sourceKind: "blocker_attention", id: cardId,
    subject: { kind: "issue", id: step.id, title: step.title, status: "blocked", metadata: {} },
    whyNow: "Blocks 1 task and needs human attention.", decisionVerbs: [], severity: "high", dismissalKey: `blocker:${step.id}`,
    relatedIssue: { kind: "issue", id: step.id, title: step.title, identifier: step.identifier, status: "blocked", metadata: {} },
    originAgentName: "Bookkeeper", activityAt: step.updatedAt, createdAt: step.createdAt, updatedAt: step.updatedAt,
  });
  const card = `board:${cardId}`;
  assert.ok((await listed()).includes(card));
  const answered = await actAsSeen(h.url, { id: card, action: "answer", note: "Use Nos as the unit." });
  assert.equal(answered.status, 200, answered.text);
  // The board blocks the top task again a moment after the owner's answer.
  goal.blockedTransitionAt = new Date(Date.now() + 1000).toISOString();
  forgetComments();
  assert.ok(!(await listed()).includes(card), "Needs you holds nothing for it");
  const t = await cardOf(goal.id);
  assert.equal(t.plainState, "Waiting its turn", "and the task does not say it is stuck");
  assert.notEqual(t.column, "failed");
  assert.notEqual(t.column, "pending_review");
});

// M63 item 52: while the Chief of staff plans a Sales job, Sales is at work on the map and in the dock.
test("a job being planned by the Chief of staff counts as working for the job's department, by the job record", async () => {
  const sales = async () => {
    const map = (await get("/api/map")).json.departments.find((d) => d.id === "sales").counts.working;
    const one = (await get("/api/map/sales")).json;
    return { map, one };
  };
  const before0 = (await get("/api/map")).json.departments.map((d) => [d.id, d.counts.working]);
  const planning = run(STH(20), "running", -1); // STH-20 was started from sales/call-write-up
  try {
    const after1 = (await get("/api/map")).json.departments.map((d) => [d.id, d.counts.working]);
    for (const [id, n] of before0) {
      const now = after1.find((x) => x[0] === id)[1];
      if (id === "sales") assert.equal(now, n + 1, "Sales is working");
      else if (id !== "operations") assert.equal(now, n, id);
    }
    assert.ok((await sales()).map >= 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const dock = (await get("/api/shell")).json.dock.find((d) => d.id === "sales");
    assert.equal(dock.working, after1.find((x) => x[0] === "sales")[1]);
    // Queued is not planning yet; and a task with no job record counts for no department.
    planning.status = "queued";
    assert.equal((await get("/api/map")).json.departments.find((d) => d.id === "sales").counts.working, before0.find((x) => x[0] === "sales")[1]);
  } finally {
    clearRuns([planning.id]);
  }
  const free = run(STH(19), "running", -1);
  try {
    const now = (await get("/api/map")).json.departments.map((d) => [d.id, d.counts.working]);
    for (const [id, n] of before0) if (id !== "operations") assert.equal(now.find((x) => x[0] === id)[1], n, id);
  } finally {
    clearRuns([free.id]);
  }
});
