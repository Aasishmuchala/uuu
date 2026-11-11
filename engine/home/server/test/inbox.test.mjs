// The inbox (CONTRACTS 9.3): merge, order, counts, every board mapping row and the exact board call
// each action makes, dismiss, finished goals, and a failing source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { SERVER_DIR } from "../lib/app.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { actAsSeen, call, writes } from "../lib/testing.mjs";

// A module folder holding only the core's own modules (symlinked), so a test does not change when feature
// modules are added to routes/, inbox/ or search/. Remove it with rmSync when done.
const CORE_MODULES = {
  routes: ["company", "files", "goals", "health", "inbox", "search", "state"],
  inbox: ["board", "goals"],
  search: ["goals"],
};
function coreModuleDir() {
  const dir = mkdtempSync(join(tmpdir(), "uuu-home-core-"));
  for (const [kind, names] of Object.entries(CORE_MODULES)) {
    mkdirSync(join(dir, kind));
    for (const n of names) symlinkSync(join(SERVER_DIR, kind, `${n}.mjs`), join(dir, kind, `${n}.mjs`));
  }
  return dir;
}

const at = (m) => new Date(Date.parse("2026-11-11T09:00:00.000Z") + m * 60000).toISOString();

function extraItem(sourceKind, id, { issueKey = "STH-1", severity = "normal", minutes = -10, subject = {} } = {}) {
  return {
    companyId: IDS.company, sourceKind, id: `${sourceKind}:${id}`,
    subject: { kind: sourceKind, id, companyId: IDS.company, title: `A ${sourceKind} item`, status: "open", href: "/x", metadata: {}, ...subject },
    whyNow: "Something happened.", decisionVerbs: [], severity, dismissalKey: `attention:${id}`,
    relatedIssue: issueKey ? { id: IDS.issues[issueKey], title: "Write the price list", identifier: issueKey, status: "in_progress" } : null,
    originAgentName: "Builder", activityAt: at(minutes), createdAt: at(minutes - 1), updatedAt: at(minutes),
  };
}

// The stub seed's approval has the type "request_approval", which paperclip does not have; the one type
// the home screen approves is "request_board_approval" (inbox/board.mjs), so the seed is given that type.
function plainApprovalSeed(s = boardSeed()) {
  for (const a of s.approvals) if (a.id === IDS.approval) a.type = "request_board_approval";
  for (const i of s.attention) if (i.sourceKind === "approval" && i.subject?.metadata) i.subject.metadata.type = "request_board_approval";
  return s;
}

async function withHome(fn, { seed, ...opts } = {}) {
  const h = await startStubsHome({ port: 0, boardSeed: seed || plainApprovalSeed(), ...opts });
  try { return await fn(h); } finally { await h.close(); }
}

const inbox = async (h) => (await call(h.url, "GET", "/api/inbox")).json;
// Acts with the version the inbox shows now, as the decision card does (CONTRACTS 9.3a).
const actOn = (h, id, action, note) => actAsSeen(h.url, note === undefined ? { id, action } : { id, action, note });
const lastWrite = (h) => h.board.requests.filter((r) => r.method !== "GET").at(-1);

const APPROVAL_ID = `board:approval:${IDS.approval}`;
const FAILED_ID = `board:failed_run:run:fa000000-0000-4000-8000-000000000001`;
const QUESTION_ID = `board:issue_thread_interaction:${IDS.interaction}`;
const BUDGET_ID = "board:budget_alert:ba000000-0000-4000-8000-000000000001";
const GOAL_DONE_ID = `goal:${IDS.issues["STH-2"]}`;

test("merge: every source, high first then newest first, counts", async () => {
  const core = coreModuleDir();
  try { await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/inbox");
    assert.equal(r.status, 200);
    const d = r.json;
    // failed run is high; then by time: budget -15 min, question -30, approval -60, finished goal -280
    assert.deepEqual(d.items.map((i) => i.id), [FAILED_ID, BUDGET_ID, QUESTION_ID, APPROVAL_ID, GOAL_DONE_ID]);
    assert.equal(d.items[0].severity, "high");
    assert.equal(d.counts.total, 5);
    assert.deepEqual(d.counts.bySource, { board: 4, goal: 1 });
    assert.deepEqual(d.notConnected, []);
    assert.ok(Date.parse(d.generatedAt));
    for (const i of d.items) {
      for (const k of ["id", "source", "kind", "title", "raisedBy", "when", "summary", "severity", "details", "actions", "link"]) assert.ok(k in i, `${i.id} has ${k}`);
      assert.ok(!("_raw" in i));
    }
  }, { moduleDirs: [core] }); } finally { rmSync(core, { recursive: true, force: true }); }
});

test("board approval: approve, send back (needs a note), reject", async () => {
  await withHome(async (h) => {
    const item = (await inbox(h)).items.find((i) => i.id === APPROVAL_ID);
    assert.equal(item.kind, "approval");
    assert.equal(item.raisedBy, "Builder");
    assert.equal(item.title, "Buy a font licence");
    assert.deepEqual(item.actions.map((a) => [a.id, a.style, a.needsNote]), [["approve", "primary", false], ["send_back", "plain", true], ["reject", "danger", false], ["dismiss", "plain", false]]);
    assert.deepEqual(item.link, { page: "goals", id: IDS.issues["STH-1"] });

    const before = writes(h.board).length;
    const noNote = await actOn(h, APPROVAL_ID, "send_back");
    assert.equal(noNote.status, 400);
    assert.equal(noNote.json.error.code, "needs_note");
    assert.equal(writes(h.board).length, before);

    const r = await actOn(h, APPROVAL_ID, "approve", "Fine by me");
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(typeof r.json.message, "string");
    const w = lastWrite(h);
    assert.equal(`${w.method} ${w.path}`, `POST /api/approvals/${IDS.approval}/approve`);
    assert.deepEqual(w.body, { decisionNote: "Fine by me" });

    const again = await actOn(h, APPROVAL_ID, "approve");
    assert.equal(again.status, 409);
  });
  await withHome(async (h) => {
    await actOn(h, APPROVAL_ID, "send_back", "Use the free font");
    const w = lastWrite(h);
    assert.equal(`${w.method} ${w.path}`, `POST /api/approvals/${IDS.approval}/request-revision`);
    assert.deepEqual(w.body, { decisionNote: "Use the free font" });
  });
  await withHome(async (h) => {
    await actOn(h, APPROVAL_ID, "reject");
    const w = lastWrite(h);
    assert.equal(`${w.method} ${w.path}`, `POST /api/approvals/${IDS.approval}/reject`);
  });
});

test("board review: approve and send back go to stalled-review-decision", async () => {
  const seed = () => { const s = plainApprovalSeed(); s.attention.push(extraItem("review", "rv-1")); return s; };
  await withHome(async (h) => {
    const item = (await inbox(h)).items.find((i) => i.id === "board:review:rv-1");
    assert.equal(item.kind, "approval");
    assert.deepEqual(item.actions.map((a) => a.id), ["approve", "send_back", "dismiss"]);
    await actOn(h, item.id, "approve");
    const w = lastWrite(h);
    assert.equal(`${w.method} ${w.path}`, `POST /api/issues/${IDS.issues["STH-1"]}/stalled-review-decision`);
    assert.deepEqual(w.body, { action: "approve" });
  }, { seed: seed() });
  await withHome(async (h) => {
    await actOn(h, "board:review:rv-1", "send_back", "Add the GST column");
    const w = lastWrite(h);
    assert.equal(w.path, `/api/issues/${IDS.issues["STH-1"]}/stalled-review-decision`);
    assert.deepEqual(w.body, { action: "request_changes", note: "Add the GST column" });
  }, { seed: seed() });
});

test("board question: a confirmation offers Accept, Decline and Hide; a decision only Hide", async () => {
  const base = `/api/issues/${IDS.issues["STH-1"]}/interactions/${IDS.interaction}`;
  for (const [action, path] of [["accept", `${base}/accept`], ["reject", `${base}/reject`]]) {
    await withHome(async (h) => {
      const item = (await inbox(h)).items.find((i) => i.id === QUESTION_ID);
      assert.equal(item.kind, "question");
      assert.equal(item.raisedBy, "Chief of staff");
      assert.deepEqual(item.actions.map((a) => a.id), ["accept", "reject", "dismiss"]);
      assert.equal((await actOn(h, QUESTION_ID, "answer", "Blue, please")).status, 400, "no answer for a confirmation");
      const r = await actOn(h, QUESTION_ID, action);
      assert.equal(r.status, 200, action);
      const w = lastWrite(h);
      assert.equal(`${w.method} ${w.path}`, `POST ${path}`);
      assert.deepEqual(w.body, {});
    });
  }
  // a "decision" item is a question too, but it is not an interaction: nothing goes to the board for it
  const s = plainApprovalSeed();
  s.attention.push(extraItem("decision", "dc-1", { subject: { metadata: { interactionId: "dc-1", issueId: IDS.issues["STH-1"] } } }));
  await withHome(async (h) => {
    const item = (await inbox(h)).items.find((i) => i.id === "board:decision:dc-1");
    assert.equal(item.kind, "question");
    assert.deepEqual(item.actions.map((a) => a.id), ["dismiss"]);
  }, { seed: s });
});

test("board problems: retry, answer, dismiss; high when severity is high or critical", async () => {
  await withHome(async (h) => {
    const item = (await inbox(h)).items.find((i) => i.id === FAILED_ID);
    assert.equal(item.kind, "problem");
    assert.equal(item.severity, "high");
    assert.match(item.summary, /could not finish "Reconcile the October bills"/);
    assert.deepEqual(item.actions.map((a) => a.id), ["retry", "answer", "dismiss"]);
    await actOn(h, FAILED_ID, "retry");
    const w = lastWrite(h);
    assert.equal(`${w.method} ${w.path}`, `POST /api/issues/${IDS.issues["STH-3"]}/retry`);
    assert.match(w.body.idempotencyKey, /^[0-9a-f-]{36}$/);
    assert.equal(w.body.observedRunId, "run:fa000000-0000-4000-8000-000000000001");
  });
  await withHome(async (h) => {
    await actOn(h, FAILED_ID, "answer", "The statement is in the knowledge folder.");
    const w = lastWrite(h);
    assert.equal(`${w.method} ${w.path}`, `POST /api/issues/${IDS.issues["STH-3"]}/comments`);
    assert.deepEqual(w.body, { body: "The statement is in the knowledge folder." });
  });
  const s = plainApprovalSeed();
  s.attention.push(extraItem("recovery_action", "ra-1", { severity: "critical", issueKey: "STH-3" }));
  s.attention.push(extraItem("agent_error_alert", "ae-1", { severity: "low" }));
  s.attention.push(extraItem("blocker_attention", "bl-1", { severity: "high", issueKey: "STH-3" }));
  await withHome(async (h) => {
    const items = (await inbox(h)).items;
    const by = (id) => items.find((i) => i.id === id);
    assert.equal(by("board:recovery_action:ra-1").kind, "problem");
    assert.equal(by("board:recovery_action:ra-1").severity, "high");
    assert.equal(by("board:agent_error_alert:ae-1").severity, "normal");
    assert.equal(by("board:blocker_attention:bl-1").severity, "high");
    await actOn(h, "board:recovery_action:ra-1", "retry");
    assert.equal(lastWrite(h).path, `/api/issues/${IDS.issues["STH-3"]}/retry`);
  }, { seed: s });
});

test("any other board kind: a problem with dismiss only; dismiss hides it and makes no board call", async () => {
  await withHome(async (h) => {
    const item = (await inbox(h)).items.find((i) => i.id === BUDGET_ID);
    assert.equal(item.kind, "problem");
    assert.deepEqual(item.actions.map((a) => a.id), ["dismiss"]);
    assert.equal(item.link, null);
    assert.equal((await actOn(h, BUDGET_ID, "retry")).status, 400);
    const before = writes(h.board).length;
    const r = await actOn(h, BUDGET_ID, "dismiss");
    assert.equal(r.status, 200);
    assert.equal(writes(h.board).length, before);
    assert.ok(!(await inbox(h)).items.some((i) => i.id === BUDGET_ID));
    const saved = JSON.parse(readFileSync(join(h.state, "home", "decisions.json"), "utf8"));
    assert.ok(saved["dismissed:attention:ba000000-0000-4000-8000-000000000001"]);
    assert.equal((await actOn(h, BUDGET_ID, "dismiss")).status, 409);
  });
});

test("unknown item 404, bad request 400", async () => {
  await withHome(async (h) => {
    assert.equal((await actOn(h, "board:nothing", "approve")).status, 404);
    assert.equal((await call(h.url, "POST", "/api/inbox/act", { body: {} })).status, 400);
    assert.equal((await call(h.url, "POST", "/api/inbox/act", { body: { id: APPROVAL_ID, action: "approve", note: 5 } })).status, 400);
  });
});

test("a finished goal: listed once, acknowledge removes it, reopen comments then reopens", async () => {
  await withHome(async (h) => {
    const item = (await inbox(h)).items.find((i) => i.id === GOAL_DONE_ID);
    assert.equal(item.source, "goal");
    assert.equal(item.kind, "result");
    assert.equal(item.raisedBy, "Chief of staff");
    assert.match(item.summary, /Two drafts are ready/);
    assert.deepEqual(item.link, { page: "tasks", id: IDS.issues["STH-2"] });
    assert.deepEqual(item.actions.map((a) => [a.id, a.label, a.style, a.needsNote]), [["acknowledge", "Accept", "primary", false], ["reopen", "Send back", "plain", true]]);
    assert.deepEqual(item.details.map((d) => d.label), ["Checked", "Files"]);
    assert.equal(item.details[0].value, "Passed in round 1");
    const before = writes(h.board).length;
    const ack = await actOn(h, GOAL_DONE_ID, "acknowledge");
    assert.equal(ack.status, 200);
    assert.equal(ack.json.message, "Accepted.");
    assert.equal(writes(h.board).length, before);
    assert.ok(!(await inbox(h)).items.some((i) => i.id === GOAL_DONE_ID));
  });
  await withHome(async (h) => {
    assert.equal((await actOn(h, GOAL_DONE_ID, "reopen")).status, 400);
    const r = await actOn(h, GOAL_DONE_ID, "reopen", "Add a Hindi version too.");
    assert.equal(r.status, 200);
    assert.equal(r.json.message, "Sent back with your note. The Chief of staff will pick it up.");
    const w = h.board.requests.filter((x) => x.method !== "GET").slice(-2);
    assert.equal(`${w[0].method} ${w[0].path}`, `POST /api/issues/${IDS.issues["STH-2"]}/comments`);
    assert.deepEqual(w[0].body, { body: "Add a Hindi version too." });
    assert.equal(`${w[1].method} ${w[1].path}`, `PATCH /api/issues/${IDS.issues["STH-2"]}`);
    assert.deepEqual(w[1].body, { status: "todo" });
    assert.ok(!(await inbox(h)).items.some((i) => i.id === GOAL_DONE_ID));
  });
});

test("a source that fails lands in notConnected and the rest still list", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uuu-home-mods-"));
  mkdirSync(join(dir, "inbox"));
  writeFileSync(join(dir, "inbox", "broken.mjs"), "export default { id: 'broken', async list() { throw new Error('boom at /secret/path'); }, async act() { return {}; } };\n");
  writeFileSync(join(dir, "inbox", "off.mjs"), "export default { id: 'off', async list() { return { items: [], notConnected: { source: 'people', reason: 'The books are not installed.' } }; }, async act() { return {}; } };\n");
  const core = coreModuleDir();
  try {
    await withHome(async (h) => {
      const d = await inbox(h);
      assert.equal(d.items.length, 5);
      const nc = Object.fromEntries(d.notConnected.map((n) => [n.source, n.reason]));
      assert.ok(nc.broken);
      assert.ok(!nc.broken.includes("/secret/path"));
      assert.equal(nc.people, "The books are not installed.");
    }, { moduleDirs: [core, dir] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // board off: both board sources are not connected, the answer is still 200
  try { await withHome(async (h) => {
    await h.board.close();
    const r = await call(h.url, "GET", "/api/inbox");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items, []);
    assert.deepEqual(r.json.notConnected.map((n) => n.source).sort(), ["board", "goals"]);
    assert.match(r.json.notConnected[0].reason, /board is not answering/);
  }, { moduleDirs: [core] }); } finally { rmSync(core, { recursive: true, force: true }); }
});
