// The task model (CONTRACTS-V2 16.3) on the version 2 seed: columns, cards, Needs-you items, board calls.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createBoard } from "../lib/board.mjs";
import { createDecisions } from "../lib/decisions.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { columnOf, decorateInbox, findTask, forgetComments, loadTaskContext, taskCard } from "../lib/tasks.mjs";
import { call } from "../lib/testing.mjs";
import { modulesOnly, startV2 } from "../lib/testing-v2.mjs";

const issueId = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let h;
before(async () => { h = await startV2({ inbox: ["board", "goals"] }); });
after(async () => { await h?.close(); });

// A handler's ctx, made the way lib/app.mjs makes it, against the stub home's board and state.
function makeCtx() {
  const config = h.config;
  const ids = () => JSON.parse(readFileSync(config.paths.ids, "utf8"));
  return {
    config, ids, log: () => {},
    board: createBoard({ baseUrl: config.urls.board, ids, companyName: config.paperclip.companyName }),
    decisions: createDecisions(join(config.paths.homeData, "decisions.json")),
    home: h.app.home,
  };
}

const card = (tctx, key) => taskCard(findTask(tctx, key), tctx);
const commentReads = () => h.board.requests.filter((r) => r.method === "GET" && /\/comments$/.test(r.path.split("?")[0]));

test("columnOf: every seeded task lands in its column", async () => {
  const tctx = await loadTaskContext(makeCtx());
  const want = {
    "STH-1": "in_progress", "STH-15": "in_progress",
    "STH-2": "pending_review", "STH-8": "pending_review",
    "STH-7": "pending_review", "STH-13": "pending_review", "STH-18": "pending_review",
    "STH-3": "failed", "STH-14": "done", "STH-17": "canceled",
  };
  for (const [key, column] of Object.entries(want)) {
    const goal = findTask(tctx, key);
    assert.ok(goal, `${key} is a task`);
    assert.equal(columnOf(goal, tctx), column, key);
  }
  for (const g of tctx.goals) {
    assert.ok(["backlog", "in_progress", "pending_review", "done", "failed", "canceled"].includes(columnOf(g, tctx)), g.identifier);
  }
});

test("columnOf: a blocked task with no board problem is pending review, not failed", async () => {
  const tctx = await loadTaskContext(makeCtx(), { withInbox: false });
  assert.deepEqual(tctx.needsYou, []);
  assert.equal(columnOf(findTask(tctx, "STH-3"), tctx), "pending_review");
});

test("taskCard: STH-8 fits task-card, size M, round 2, at the check, waiting for you", async () => {
  const tctx = await loadTaskContext(makeCtx());
  const c = card(tctx, "STH-8");
  assert.deepEqual(sameShape(readShape("task-card"), c), []);
  assert.equal(c.id, issueId(8));
  assert.equal(c.identifier, "STH-8");
  assert.equal(c.column, "pending_review");
  assert.equal(c.state, "done");
  assert.equal(c.plainState, "Finished");
  assert.equal(c.size, "M");
  assert.equal(c.round, 2);
  assert.deepEqual(c.stage, { id: "check", label: "Check" });
  assert.equal(c.waitingForYou, true);
  assert.equal(c.live, false);
  assert.equal(c.stepsTotal, 4);
  assert.equal(c.stepsDone, 4);
  assert.equal(c.schedule, null);
  assert.equal(typeof c.who.slug, "string");
});

test("taskCard: STH-14 came from the daily brief routine", async () => {
  const tctx = await loadTaskContext(makeCtx(), { withComments: "all" });
  const c = card(tctx, "STH-14");
  assert.deepEqual(sameShape(readShape("task-card"), c), []);
  assert.deepEqual(c.schedule, { label: "Daily at 09:00", routineId: "daily-brief" });
  assert.equal(c.column, "done");
  assert.equal(c.waitingForYou, false);
});

test("taskCard: STH-15 is the Marketer's and live", async () => {
  const tctx = await loadTaskContext(makeCtx());
  const c = card(tctx, "STH-15");
  assert.deepEqual(sameShape(readShape("task-card"), c), []);
  assert.deepEqual(c.who, { slug: "marketer", name: "Marketer" });
  assert.equal(c.live, true);
  assert.equal(c.column, "in_progress");
  assert.deepEqual(c.stage, { id: "work", label: "Work" });
});

test("taskCard: the stage follows the documents in the task's folder", async () => {
  const tctx = await loadTaskContext(makeCtx());
  assert.deepEqual(card(tctx, "STH-13").stage, { id: "brief", label: "Brief" });
  assert.deepEqual(card(tctx, "STH-7").stage, { id: "plan", label: "Plan" });
  assert.equal(card(tctx, "STH-7").size, "M");
  assert.equal(card(tctx, "STH-13").size, "L");
  assert.equal(card(tctx, "STH-18").round, 5);
  assert.deepEqual(card(tctx, "STH-18").stage, { id: "check", label: "Check" });
  for (const g of tctx.goals) assert.deepEqual(sameShape(readShape("task-card"), taskCard(g, tctx)), [], g.identifier);
});

test("decorateInbox: adds taskId, identifier and agent, and keeps what the source needs to act", async () => {
  const tctx = await loadTaskContext(makeCtx());
  const goalItem = tctx.needsYou.find((i) => i.id === `goal:${issueId(8)}`);
  assert.ok(goalItem, "the finished STH-8 waits for the owner");
  assert.deepEqual(sameShape(readShape("needs-you-item"), goalItem), []);
  assert.equal(goalItem.taskId, issueId(8));
  assert.equal(goalItem.identifier, "STH-8");
  assert.deepEqual(goalItem.agent, { slug: "chief-of-staff", name: "Chief of staff" });
  assert.equal(goalItem._goalId, issueId(8), "the hidden key the goals source acts with is kept");
  assert.equal(Object.keys(goalItem).includes("_goalId"), false);

  const failed = tctx.needsYou.find((i) => i.source === "board" && i.kind === "problem");
  assert.equal(failed.taskId, issueId(3));

  const raw = [
    { id: "x:1", source: "x", kind: "question", raisedBy: "The Marketer", link: { page: "tasks", id: issueId(16) } },
    { id: "x:2", source: "x", kind: "question", raisedBy: "Books", link: { page: "books", id: "SINV-1" } },
    { id: "x:3", source: "x", kind: "question", raisedBy: "Artist", link: null },
  ];
  const [a, b, c] = decorateInbox(raw, tctx);
  assert.equal(a.taskId, issueId(15), "a step's item belongs to its top task");
  assert.equal(a.identifier, "STH-15");
  assert.deepEqual(a.agent, { slug: "marketer", name: "Marketer" });
  assert.equal(b.taskId, null);
  assert.equal(b.identifier, null);
  assert.equal(b.agent, null);
  assert.deepEqual(c.agent, { slug: "artist", name: "Artist" });
  assert.equal(raw[0].taskId, undefined, "the items given are not changed");
});

test("findTask: by id or identifier, top tasks only", async () => {
  const tctx = await loadTaskContext(makeCtx(), { withInbox: false, withComments: false });
  assert.equal(findTask(tctx, "STH-8").id, issueId(8));
  assert.equal(findTask(tctx, issueId(8)).identifier, "STH-8");
  assert.equal(findTask(tctx, "STH-9"), null, "a step is not a task");
  assert.equal(findTask(tctx, "STH-999"), null);
  assert.equal(findTask(tctx, ""), null);
});

test("board calls: one each for tasks, agents and live runs; comments only for unfinished tasks", async () => {
  forgetComments();
  const from = h.board.requests.length;
  const tctx = await loadTaskContext(makeCtx(), { withInbox: false });
  const seen = h.board.requests.slice(from).map((r) => `${r.method} ${r.path.split("?")[0]}`);
  const count = (suffix) => seen.filter((p) => p.endsWith(suffix)).length;
  assert.equal(count("/issues"), 1);
  assert.equal(count("/agents"), 1);
  assert.equal(count("/live-runs"), 1);
  assert.ok(seen.every((p) => p.startsWith("GET ")), "reading writes nothing");
  const read = new Set(seen.filter((p) => p.endsWith("/comments")).map((p) => p.split("/")[3]));
  assert.ok(read.has(issueId(8)), "a task waiting for review is read");
  assert.ok(read.has(issueId(9)), "and its steps");
  assert.ok(!read.has(issueId(14)), "an accepted task is not read");
  assert.ok(!read.has(issueId(17)), "a canceled task is not read");
  assert.equal(card(tctx, "STH-14").size, null, "unread comments give no size");
  assert.equal(card(tctx, "STH-14").round, null);
});

test("comments are cached for 15 seconds", async () => {
  forgetComments();
  await loadTaskContext(makeCtx(), { withInbox: false });
  const first = commentReads().length;
  const tctx = await loadTaskContext(makeCtx(), { withInbox: false });
  assert.equal(commentReads().length, first, "the second read uses the cache");
  await tctx.commentsOf(issueId(8));
  assert.equal(commentReads().length, first);
  forgetComments(issueId(8));
  const list = await tctx.commentsOf(issueId(8));
  assert.equal(commentReads().length, first + 1);
  assert.ok(list.some((c) => /^RESULT:/.test(c.body)));
});

test("withComments false reads no comments", async () => {
  forgetComments();
  const before = commentReads().length;
  const tctx = await loadTaskContext(makeCtx(), { withInbox: false, withComments: false });
  assert.equal(commentReads().length, before);
  assert.equal(card(tctx, "STH-8").size, null);
  assert.equal(card(tctx, "STH-8").round, null);
});

test("the context: agents, live runs and routines", async () => {
  const tctx = await loadTaskContext(makeCtx(), { withInbox: false, withComments: false });
  assert.deepEqual(tctx.agents.get("a0000000-0000-4000-8000-000000000010"), { slug: "artist", name: "Artist" });
  assert.ok(tctx.liveByIssue.has(issueId(16)));
  assert.ok(tctx.liveByAgent.has("a0000000-0000-4000-8000-000000000008"));
  const daily = [...tctx.routines.values()].find((r) => r.id === "daily-brief");
  assert.deepEqual(daily, { id: "daily-brief", plain: "Daily at 09:00" });
  assert.equal(tctx.accepted(issueId(14)), true);
  assert.equal(tctx.accepted(issueId(8)), false);
});

test("the board off: loadTaskContext throws the plain board error", async () => {
  const ctx = makeCtx();
  ctx.board = createBoard({ baseUrl: "http://127.0.0.1:9", ids: ctx.ids, companyName: "Sthyra", timeoutMs: 1000 });
  await assert.rejects(loadTaskContext(ctx, { withInbox: false }), (e) => e.code === "board_off");
});

test("modulesOnly: a folder that holds only the named modules and the route helpers", () => {
  const dir = modulesOnly({ routes: ["state.mjs"], inbox: ["goals"], search: [] });
  try {
    const routes = readdirSync(join(dir, "routes")).sort();
    assert.ok(routes.includes("state.mjs"));
    for (const f of routes) assert.ok(f === "state.mjs" || f.startsWith("_"), f);
    assert.ok(routes.includes("_departments.mjs"), "every routes/_*.mjs helper is there");
    assert.deepEqual(readdirSync(join(dir, "inbox")), ["goals.mjs"]);
    assert.deepEqual(readdirSync(join(dir, "search")), []);
    assert.ok(lstatSync(join(dir, "routes", "state.mjs")).isSymbolicLink());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.throws(() => modulesOnly({ routes: ["../lib/app"] }));
  assert.throws(() => modulesOnly({ routes: ["no-such-module"] }));
});

test("startV2: loads only the named modules, on the version 2 seed, and removes its folder on close", async () => {
  const h2 = await startV2({ routes: ["state"] });
  const dir = h2.modulesDir;
  try {
    assert.equal((await call(h2.url, "GET", "/api/state")).status, 200);
    assert.equal((await call(h2.url, "GET", "/api/inbox")).status, 404, "a module not named is not loaded");
    assert.equal((await call(h2.url, "GET", "/api/goals")).status, 404);
    assert.deepEqual(h2.app.home.inboxSources, []);
    assert.deepEqual(h2.app.home.searchSources, []);
    assert.notEqual(h2.port, 3210);
    assert.ok(existsSync(join(h2.state, "tasks", "company-work", "STH-8", "01-plan.md")), "the version 2 files are there");
  } finally {
    await h2.close();
  }
  assert.equal(existsSync(dir), false);
});
