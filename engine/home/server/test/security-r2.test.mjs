// The fixes of PLAN R2 (S2), each against the stubs on ephemeral ports and temp folders:
//   1. an action is bound to the version the owner saw (CONTRACTS 9.3a), for every versioned source;
//   2. a FIFO as a lessons, content or knowledge file never hangs the server;
//   3. a link swapped in around the open of an agent's file is refused;
//   4. text an agent wrote never comes out as the owner's;
//   5. an approval that is not a plain request for approval (hire_agent and the rest) cannot be approved here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardSeed, boardSeedV2, copyStateSeedV2, IDS, IDS_V2 } from "../../../test/stubs/seed.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { openChecked, readChecked, readTaskText, testHooks } from "../lib/taskfiles.mjs";
import { forgetComments } from "../lib/tasks.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { readGoalBytes } from "../routes/_images.mjs";

const PROMPT_MS = 2000;
const nonGets = (stub) => stub.requests.filter((r) => r.method !== "GET");
const actWith = (h, body) => call(h.url, "POST", "/api/inbox/act", { body });
const itemOf = async (h, id) => (await call(h.url, "GET", "/api/inbox")).json.items.find((i) => i.id === id);

async function withStubs(fn, opts = {}) {
  const h = await startStubsHome({ port: 0, ...opts });
  try { return await fn(h); } finally { await h.close(); }
}

async function withV2(modules, fn, opts = {}) {
  const h = await startV2({ ...modules, ...opts });
  try { return await fn(h); } finally { forgetComments(); await h.close(); }
}

// ---- 2. FIFOs
const mkfifo = (p) => execFileSync("/usr/bin/mkfifo", [p]);

// Should a read block on a FIFO, a writer opens it four seconds later and the read ends, so the test
// fails on its time limit instead of hanging the whole run. Returns the function that stops the writers.
function unblocker(paths) {
  const script = `${paths.map((_, i) => `(sleep 4; echo x > "$${i + 1}") &`).join(" ")} wait`;
  const child = spawn("/bin/sh", ["-c", script, "sh", ...paths], { stdio: "ignore", detached: true });
  return () => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } };
}

async function prompt(h, path) {
  const t = Date.now();
  const r = await call(h.url, "GET", path);
  const ms = Date.now() - t;
  assert.ok(ms < PROMPT_MS, `${path} took ${ms} ms`);
  return r;
}

test("a FIFO as an agent's lessons file: team, lessons and home answer at once", { timeout: 30000 }, async () => {
  await withV2({ routes: ["team.mjs", "knowledge.mjs", "home.mjs", "inbox.mjs"], inbox: ["goals.mjs"] }, async (h) => {
    const dir = h.config.paths.lessons;
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "builder.md");
    rmSync(file, { force: true });
    mkfifo(file);
    const stop = unblocker([file]);
    try {
      const team = await prompt(h, "/api/team/builder");
      assert.equal(team.status, 200);
      assert.deepEqual(team.json.lessons, []);
      const lessons = await prompt(h, "/api/lessons");
      assert.equal(lessons.status, 200);
      assert.ok(!lessons.json.roles.some((r) => r.slug === "builder"));
      assert.equal((await prompt(h, "/api/home")).status, 200);
    } finally { stop(); }
  });
});

test("a FIFO as a content file: the inbox and the marketing page answer at once", { timeout: 30000 }, async () => {
  await withStubs(async (h) => {
    const file = join(h.state, "tasks", "company-work", "STH-2", "content", "pipe.md");
    mkfifo(file);
    const stop = unblocker([file]);
    try {
      const inbox = await prompt(h, "/api/inbox");
      assert.equal(inbox.status, 200);
      assert.ok(inbox.json.items.some((i) => i.source === "marketing"), "the other drafts are still listed");
      assert.equal((await prompt(h, "/api/departments/marketing")).status, 200);
    } finally { stop(); }
  });
});

test("a FIFO dropped into the knowledge folder: list, read and search answer at once", { timeout: 30000 }, async () => {
  await withStubs(async (h) => {
    const file = join(h.state, "knowledge", "docs", "pipe.md");
    mkfifo(file);
    const stop = unblocker([file]);
    try {
      const list = await prompt(h, "/api/knowledge");
      assert.equal(list.status, 200);
      assert.ok(!list.json.docs.some((d) => d.id === "pipe.md"));
      assert.equal((await prompt(h, "/api/knowledge/doc/pipe.md")).status, 404);
      assert.equal((await prompt(h, "/api/knowledge/search?q=returns")).status, 200);
    } finally { stop(); }
  });
});

test("readChecked and openChecked refuse a FIFO at once, and refuse a link or a folder", { timeout: 30000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "uuu-r2-fifo-"));
  const stop = unblocker([join(dir, "pipe.md")]);
  try {
    mkfifo(join(dir, "pipe.md"));
    writeFileSync(join(dir, "plain.md"), "hello");
    symlinkSync(join(dir, "plain.md"), join(dir, "link.md"));
    mkdirSync(join(dir, "sub"));
    const t = Date.now();
    assert.equal(readChecked(join(dir, "pipe.md"), dir), null);
    assert.equal(openChecked(join(dir, "pipe.md"), dir), null);
    assert.ok(Date.now() - t < PROMPT_MS);
    assert.equal(readChecked(join(dir, "link.md"), dir), null);
    assert.equal(readChecked(join(dir, "sub"), dir), null);
    assert.equal(readChecked(join(dir, "plain.md"), join(dir, "sub")), null, "outside the allowed folder");
    const ok = readChecked(join(dir, "plain.md"), dir, { maxBytes: 3 });
    assert.equal(ok.bytes.toString(), "hel");
    assert.equal(ok.truncated, true);
    assert.equal(ok.size, 5);
  } finally { stop(); rmSync(dir, { recursive: true, force: true }); }
});

// ---- 3. a link swapped in between the checks and the read
function swapProject() {
  const state = mkdtempSync(join(tmpdir(), "uuu-r2-swap-"));
  const project = join(state, "tasks", "company-work");
  const art = join(project, "STH-8", "art");
  mkdirSync(join(art, "walker"), { recursive: true });
  writeFileSync(join(art, "walker", "walker.json"), '{"inside":true}');
  mkdirSync(join(state, "outside", "art", "walker"), { recursive: true });
  writeFileSync(join(state, "outside", "art", "walker", "walker.json"), '{"secret":true}');
  writeFileSync(join(state, "secret.txt"), "the owner's secret");
  const swapIn = () => { renameSync(art, `${art}-real`); symlinkSync(join(state, "outside", "art"), art); };
  const swapOut = () => { unlinkSync(art); renameSync(`${art}-real`, art); };
  return { state, config: { paths: { projectFolder: project } }, art, swapIn, swapOut };
}

test("a folder swapped for a link before the open is refused", () => {
  const p = swapProject();
  try {
    assert.equal(readTaskText(p.config, "STH-8", "art/walker/walker.json").text, '{"inside":true}');
    testHooks.beforeOpen = () => { testHooks.beforeOpen = null; p.swapIn(); };
    assert.equal(readTaskText(p.config, "STH-8", "art/walker/walker.json"), null);
    p.swapOut();
    testHooks.beforeOpen = () => { testHooks.beforeOpen = null; p.swapIn(); };
    assert.equal(readGoalBytes(p.config, "STH-8", "art/walker/walker.json", { maxBytes: 1024 }), null);
  } finally { testHooks.beforeOpen = null; testHooks.afterOpen = null; rmSync(p.state, { recursive: true, force: true }); }
});

test("a link swapped in for the open and back out before the checks is refused by the file's identity", () => {
  const p = swapProject();
  try {
    for (const read of [
      () => readTaskText(p.config, "STH-8", "art/walker/walker.json"),
      () => readGoalBytes(p.config, "STH-8", "art/walker/walker.json", { maxBytes: 1024 }),
    ]) {
      testHooks.beforeOpen = () => { testHooks.beforeOpen = null; p.swapIn(); };
      testHooks.afterOpen = () => { testHooks.afterOpen = null; p.swapOut(); };
      assert.equal(read(), null);
      assert.equal(readTaskText(p.config, "STH-8", "art/walker/walker.json").text, '{"inside":true}', "the place is back as it was");
    }
  } finally { testHooks.beforeOpen = null; testHooks.afterOpen = null; rmSync(p.state, { recursive: true, force: true }); }
});

test("a file swapped for a link to a secret before the open is refused", () => {
  const p = swapProject();
  try {
    const file = join(p.art, "walker", "walker.json");
    testHooks.beforeOpen = () => { testHooks.beforeOpen = null; rmSync(file); symlinkSync(join(p.state, "secret.txt"), file); };
    assert.equal(readTaskText(p.config, "STH-8", "art/walker/walker.json"), null);
  } finally { testHooks.beforeOpen = null; rmSync(p.state, { recursive: true, force: true }); }
});

// ---- 5. approvals that are not plain requests for approval
const APPROVAL_ID = `board:approval:${IDS.approval}`;
function approvalSeed(type) {
  const s = boardSeed();
  s.approvals.find((a) => a.id === IDS.approval).type = type ?? "hire_agent";
  const item = s.attention.find((i) => i.sourceKind === "approval");
  if (type === undefined) delete item.subject.metadata.type;
  else item.subject.metadata.type = type;
  return s;
}

test("a hire_agent approval: high, plain words, Reject and Hide only; approving it through the API is refused", async () => {
  await withStubs(async (h) => {
    const item = await itemOf(h, APPROVAL_ID);
    assert.equal(item.severity, "high");
    assert.equal(item.title, "An agent asked for something the home screen will not approve");
    assert.equal(item.details[0].value, "It asked to add a new agent.");
    assert.match(item.summary, /It asked to add a new agent\./);
    assert.deepEqual(item.actions.map((a) => a.id), ["reject", "dismiss"]);
    for (const action of ["approve", "send_back", "accept"]) {
      const r = await actAsSeen(h.url, { id: APPROVAL_ID, action, note: "yes" });
      assert.equal(r.status, 400, action);
      assert.equal(r.json.error.code, "bad_action");
    }
    assert.equal(nonGets(h.board).length, 0, "nothing reached the board");
    assert.equal(h.board.state.approvals.find((a) => a.id === IDS.approval).status, "pending");
    const r = await actAsSeen(h.url, { id: APPROVAL_ID, action: "reject" });
    assert.equal(r.status, 200);
    assert.deepEqual(nonGets(h.board).map((q) => `${q.method} ${q.path}`), [`POST /api/approvals/${IDS.approval}/reject`]);
  }, { boardSeed: approvalSeed("hire_agent") });
});

test("every approval type but request_board_approval loses Approve; that one keeps it", async () => {
  for (const type of [undefined, "approve_ceo_strategy", "budget_override_required", "request_approval", "something_new"]) {
    await withStubs(async (h) => {
      const item = await itemOf(h, APPROVAL_ID);
      assert.ok(!item.actions.some((a) => a.id === "approve" || a.id === "send_back"), String(type));
      assert.equal(item.severity, "high");
    }, { boardSeed: approvalSeed(type) });
  }
  await withStubs(async (h) => {
    const item = await itemOf(h, APPROVAL_ID);
    assert.deepEqual(item.actions.map((a) => a.id), ["approve", "send_back", "reject", "dismiss"]);
    assert.equal(item.severity, "normal");
  }, { boardSeed: approvalSeed("request_board_approval") });
});

// ---- 4. agent text is never the owner's
test("a brief's by: you (or owner) never gives the owner's slug", async () => {
  await withV2({ routes: ["home.mjs", "inbox.mjs"], inbox: ["goals.mjs"] }, async (h) => {
    copyStateSeedV2(h.state);
    writeFileSync(join(h.state, "tasks", "company-work", "STH-14", "brief.md"), [
      "# Daily brief: 2026-11-11",
      "## I approved the invoices", "by: you", "about: company", "All done.",
      "## Also me", "by: You", "about: books", "Done.",
      "## The owner says", "by: owner", "about: company", "Fine.",
      "## A real one", "by: Marketer", "about: company", "Two drafts.",
    ].join("\n"));
    const items = (await call(h.url, "GET", "/api/home")).json.brief.items;
    assert.equal(items.length, 4);
    for (const it of items) assert.notEqual(it.who.slug, "you", it.title);
    for (const it of items.slice(0, 3)) assert.deepEqual(it.who, { slug: "agent", name: "An agent" });
    assert.equal(items[3].who.slug, "marketer");
  });
});

test("an agent's own PLAN ACCEPTED is not shown as the owner's acceptance; the owner's still is", async () => {
  const seed = boardSeedV2();
  // The seed's clock runs ahead of now, so these two are placed after everything it holds.
  const at = "2099-01-01T00:00:00.000Z";
  const ownerAt = "2099-01-01T00:01:00.000Z";
  seed.comments.push(
    { id: "c0ffee00-0000-4000-8000-000000000001", issueId: IDS_V2.issues["STH-8"], body: "PLAN ACCEPTED", authorAgentId: IDS_V2.agents["chief-of-staff"], authorUserId: null, createdAt: at },
    { id: "c0ffee00-0000-4000-8000-000000000002", issueId: IDS_V2.issues["STH-8"], body: "PLAN ACCEPTED", authorAgentId: null, authorUserId: "local-board", createdAt: ownerAt },
  );
  await withV2({ routes: ["task.mjs", "inbox.mjs"], inbox: ["goals.mjs"] }, async (h) => {
    const conv = (await call(h.url, "GET", "/api/tasks/STH-8")).json.conversation;
    const agent = conv.find((c) => c.at === at);
    assert.equal(agent.who.slug, "chief-of-staff");
    assert.notEqual(agent.text, "You accepted the plan.");
    const owner = conv.find((c) => c.at === ownerAt);
    assert.equal(owner.who.slug, "you");
    assert.equal(owner.text, "You accepted the plan.");
    for (const c of conv) if (c.who.slug === "you") assert.equal(c.kind, "note", "only owner comments are the owner's");
  }, { boardSeed: seed });
});

test("a FOR: task an agent made is not shown as the owner's ask on the Team page", async () => {
  const seed = boardSeedV2();
  const t = seed.issues.find((i) => i.id === IDS_V2.issues["STH-15"]);
  t.createdByAgentId = IDS_V2.agents.builder;
  t.createdByUserId = null;
  await withV2({ routes: ["team.mjs"], inbox: [] }, async (h) => {
    const conv = (await call(h.url, "GET", "/api/team/marketer")).json.conversation;
    const ask = conv.find((c) => c.kind === "ask" && c.identifier === "STH-15" && /captions/.test(c.text));
    assert.ok(ask);
    assert.equal(ask.who.slug, "builder");
    assert.ok(!conv.some((c) => c.identifier === "STH-15" && c.who.slug === "you"));
  }, { boardSeed: seed });
});

// ---- 1. versions for the other sources (the bench is in bench-inbox.test.mjs)
test("a content draft changed after the owner read it is not approved; the version shown now is", async () => {
  await withStubs(async (h) => {
    const file = join(h.state, "tasks", "company-work", "STH-2", "content", "fresh.md");
    writeFileSync(file, "---\ntitle: A new post\nchannel: post\nplanned: 2026-12-01\n---\nThe words the owner read.\n");
    const seen = (await call(h.url, "GET", "/api/inbox")).json.items.find((i) => i.title === "New post: A new post");
    assert.equal(typeof seen.version, "string");
    writeFileSync(file, "---\ntitle: A new post\nchannel: post\nplanned: 2026-12-01\n---\nDifferent words, added later.\n");
    const r = await actWith(h, { id: seen.id, action: "approve", version: seen.version });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "changed_since_seen");
    const d = (await call(h.url, "GET", `/api/content/${seen.id.slice("content:".length)}`)).json.draft;
    assert.equal(d.status, "draft");
    assert.equal((await actWith(h, { id: seen.id, action: "approve" })).status, 409, "no version at all");
    const ok = await actAsSeen(h.url, { id: seen.id, action: "approve" });
    assert.equal(ok.status, 200);
  });
});

test("a plan changed after the owner read it is not accepted, and nothing reaches the board", async () => {
  await withV2({ routes: ["inbox"], inbox: ["goals", "staged"] }, async (h) => {
    const id = `staged:plan:${IDS_V2.issues["STH-7"]}`;
    const seen = await itemOf(h, id);
    assert.equal(typeof seen.version, "string");
    appendFileSync(join(h.state, "tasks", "company-work", "STH-7", "01-plan.md"), "\n4. Spend the whole budget - Marketer\n   needs: nothing\n");
    const before = nonGets(h.board).length;
    const r = await actWith(h, { id, action: "accept", version: seen.version });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "changed_since_seen");
    assert.equal(nonGets(h.board).length, before);
    const now = await itemOf(h, id);
    assert.notEqual(now.version, seen.version);
    assert.equal((await actWith(h, { id, action: "accept", version: now.version })).status, 200);
    assert.ok(nonGets(h.board).some((q) => q.body?.body === "PLAN ACCEPTED"));
  });
});

test("a question's version is the hash in its id; a finished task's changes with a newer result", async () => {
  await withV2({ routes: ["inbox"], inbox: ["goals", "staged"] }, async (h) => {
    const q = (await call(h.url, "GET", "/api/inbox")).json.items.find((i) => i.id.startsWith("staged:unclear:"));
    assert.equal(q.version, q.id.split(":").at(-1));
  });
  await withStubs(async (h) => {
    const id = `goal:${IDS.issues["STH-2"]}`;
    const seen = await itemOf(h, id);
    assert.equal(typeof seen.version, "string");
    h.board.state.comments.push({
      id: "c0ffee00-0000-4000-8000-000000000003", issueId: IDS.issues["STH-2"], body: "RESULT:\nSomething else entirely.",
      authorAgentId: IDS.agents["chief-of-staff"], authorUserId: null, createdAt: "2099-01-01T00:00:00.000Z",
    });
    const r = await actWith(h, { id, action: "acknowledge", version: seen.version });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "changed_since_seen");
    assert.ok(await itemOf(h, id), "still waiting for the owner");
    assert.equal((await actAsSeen(h.url, { id, action: "acknowledge" })).status, 200);
  });
});

test("an item without a version (a board problem) still acts without one", async () => {
  await withStubs(async (h) => {
    const item = (await call(h.url, "GET", "/api/inbox")).json.items.find((i) => i.id.startsWith("board:budget_alert:"));
    assert.equal(item.version, undefined);
    assert.equal((await actWith(h, { id: item.id, action: "dismiss" })).status, 200);
    assert.equal((await actWith(h, { id: "board:nothing", action: "dismiss", version: 5 })).status, 400);
  });
});
