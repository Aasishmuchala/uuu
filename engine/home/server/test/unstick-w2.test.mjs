// W2: the hold sweep (lib/unstick.mjs) and how a hold reaches the owner (inbox/board.mjs).
// The fixtures are the live hold of 11 November 2026 (STH-18, read with GETs only, without the run's context):
// fixtures-w2/run-never-ran.json (GET /api/heartbeat-runs/:id), execution-hold.json (GET /api/issues/:id/execution),
// recovery-actions-hold.json (GET /api/issues/:id/recovery-actions), issue-hold.json (part of GET /api/issues/:id).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { startStubBoard } from "../../../test/stubs/board.mjs";
import { createBoard } from "../lib/board.mjs";
import { createDecisions } from "../lib/decisions.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";
import { classify, createUnstick, evidenceOf, MAX_TRIES, RECONCILIATION_CAUSES, resolveBody, SWEEP_MS } from "../lib/unstick.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(HERE, "fixtures-w2", name), "utf8"));
const RUN = fx("run-never-ran.json");
const EXEC = fx("execution-hold.json");
const ACTIONS = fx("recovery-actions-hold.json");
const PAPERCLIP = join(HERE, "..", "..", "..", "node_modules", "@paperclipai");
const IDS_OF = () => ({ companyId: IDS.company, projectId: IDS.project });
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// The board's own resolve validator, when installed.
async function realSchema() {
  const v = join(PAPERCLIP, "shared", "dist", "validators", "issue.js");
  if (!existsSync(v)) return null;
  return (await import(v)).resolveIssueRecoveryActionSchema;
}

// The live hold moved onto a seed task (STH-1 by default): its run, its settled no-replay action, the task's owner.
function holdSeed({ on = "STH-1", run = {}, action = {}, extraActions = [] } = {}) {
  const s = boardSeed();
  const target = s.issues.find((i) => i.id === IDS.issues[on]);
  const agentId = target.assigneeAgentId;
  const r = { ...RUN, companyId: IDS.company, agentId, issueId: target.id, ...run };
  const a = structuredClone(ACTIONS.actions[0]);
  Object.assign(a, { companyId: IDS.company, sourceIssueId: target.id, returnOwnerAgentId: agentId }, action);
  a.evidence = { ...a.evidence, runId: r.id, automaticRecovery: { ...a.evidence.automaticRecovery, runId: r.id } };
  s.heartbeatRuns.push(r);
  s.recoveryActions = [a, ...extraActions.map((x) => ({ companyId: IDS.company, sourceIssueId: target.id, ...x }))];
  return { seed: s, target, run: r, action: a };
}

function sweeper(b, { log = [], decisions = null } = {}) {
  let t = Date.parse("2026-11-11T10:00:00Z");
  const board = createBoard({ baseUrl: b.url, ids: IDS_OF, timeoutMs: 2000, writeTimeoutMs: 2000 });
  const u = createUnstick({ board, ids: IDS_OF, decisions, log: (l) => log.push(l), now: () => t });
  return { u, log, tick: (ms = SWEEP_MS + 1000) => { t += ms; } };
}
const resolves = (b) => b.requests.filter((r) => r.method === "POST" && r.path.endsWith("/recovery-actions/resolve"));
const writes = (b) => b.requests.filter((r) => r.method !== "GET");

// ---- what the board's code says

test("the copied causes are the board's own", async () => {
  const f = join(PAPERCLIP, "shared", "dist", "types", "execution-projection.js");
  if (!existsSync(f)) return;
  assert.deepEqual(RECONCILIATION_CAUSES, (await import(f)).EXECUTION_RECONCILIATION_CAUSES);
});

test("the live example is a hold the board shows as Stopped, behind a settled no-replay action", () => {
  assert.equal(EXEC.execution.phase, "recovery_needed");
  assert.deepEqual(EXEC.execution.permittedActions, ["inspect_run"]);
  assert.equal(EXEC.recoveryAction, null);
  assert.equal(ACTIONS.actions[0].evidence.automaticRecovery.replay, "blocked");
  assert.equal(ACTIONS.actions[0].evidence.runId, EXEC.runId);
});

test("classify: the live run never ran; a run with a process, output or a log did", () => {
  assert.equal(classify(RUN), "never_ran");
  assert.equal(classify({ ...RUN, processPid: 4242 }), "other");
  assert.equal(classify({ ...RUN, logBytes: 120 }), "other");
  assert.equal(classify({ ...RUN, stdoutExcerpt: "hello" }), "other");
  assert.equal(classify({ ...RUN, status: "running" }), "other");
  // Not suppressed: only a run that ended within 5 seconds of its claim counts.
  assert.equal(classify({ ...RUN, errorCode: "adapter_failed" }), "never_ran");
  assert.equal(classify({ ...RUN, errorCode: "adapter_failed", finishedAt: "2026-11-11T02:25:50.000Z" }), "other");
  assert.equal(classify(null), "other");
});

test("the resolve body is exactly what the board's validator takes; the stub refuses what it refuses", async () => {
  const action = ACTIONS.actions[0];
  const body = resolveBody(action, RUN);
  assert.deepEqual(body, {
    actionId: "26db09b0-ee43-428c-8b27-eaef5fdebdcb",
    outcome: "restored",
    sourceIssueStatus: "todo",
    executionReconciliation: {
      runId: "06b3d41e-2974-4a89-b233-a2e290b0266e",
      providerStopped: true,
      actionOutcome: "not_performed",
      outcomeEvidence: "Run 06b3d41e was cancelled 0.5 s after it was claimed (error code legacy_disposition_repair_suppressed) with no process, no output and no log; nothing was performed.",
    },
    resolutionNote: "The home screen found that the stopped run never started, so it handed the task back to its agent.",
  });
  assert.ok(evidenceOf(RUN).length >= 20);
  const schema = await realSchema();
  const bad = [
    { ...body, sourceIssueStatus: "in_progress" },
    { ...body, executionReconciliation: { ...body.executionReconciliation, providerStopped: false } },
    { ...body, executionReconciliation: { ...body.executionReconciliation, outcomeEvidence: "too short" } },
    { ...body, executionReconciliation: { ...body.executionReconciliation, actionOutcome: "unknown" } },
    { ...body, extra: 1 },
    { ...body, actionId: "STH-18" },
  ];
  if (schema) {
    assert.equal(schema.safeParse(body).success, true, "the board's validator takes the body");
    for (const x of bad) assert.equal(schema.safeParse(x).success, false);
  }
  const { seed, target } = holdSeed();
  const b = await startStubBoard({ seed });
  try {
    for (const x of bad) assert.equal((await call(b.url, "POST", `/api/issues/${target.id}/recovery-actions/resolve`, { body: x })).status, 400);
    assert.equal(b.state.resolves.length, 0);
  } finally { await b.close(); }
});

// ---- the sweep against the stub board

test("a NEVER RAN hold gets exactly one resolve with the expected body, and the task goes back to its agent", async () => {
  const { seed, target, run, action } = holdSeed();
  const b = await startStubBoard({ seed });
  try {
    const { u, log } = sweeper(b);
    await u.sweep();
    const sent = resolves(b);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].path, `/api/issues/${target.id}/recovery-actions/resolve`);
    assert.deepEqual(sent[0].body, resolveBody(action, run));
    assert.equal(sent[0].headers.authorization, undefined, "sent as the owner");
    assert.deepEqual(writes(b).map((r) => r.path), [sent[0].path], "nothing else is written");
    assert.equal(b.state.resolves.length, 1, "the stub board took it");
    assert.equal(b.state.issues.find((i) => i.id === target.id).status, "todo");
    assert.ok(b.state.wakes.some((w) => w.issueId === target.id && w.reason === "issue_recovery_action_restored"));
    assert.equal(u.holds().length, 0);
    assert.equal(log.length, 1);
    assert.match(log[0], /^unstick: STH-1 /);
    assert.doesNotMatch(log[0], GUID);
    const exec = (await call(b.url, "GET", `/api/issues/${target.id}/execution`)).json;
    assert.notEqual(exec.execution.phase, "recovery_needed");
  } finally { await b.close(); }
});

test("a second sweep inside the minute does nothing for the same task", async () => {
  const { seed } = holdSeed({ run: { processPid: 4242 } });
  const b = await startStubBoard({ seed });
  try {
    const { u, tick } = sweeper(b);
    await u.sweep();
    const execs = () => b.requests.filter((r) => r.path.endsWith("/execution")).length;
    const first = execs();
    assert.ok(first > 0);
    tick(30000);
    await u.sweep();
    assert.equal(execs(), first, "no task is looked at again within the minute");
    tick(SWEEP_MS);
    await u.sweep();
    assert.ok(execs() > first, "after the minute it looks again");
    // Two sweeps asked at once are one sweep.
    tick();
    const n = b.requests.length;
    await Promise.all([u.sweep(), u.sweep()]);
    const once = b.requests.length - n;
    tick();
    const m = b.requests.length;
    await u.sweep();
    assert.equal(b.requests.length - m, once);
  } finally { await b.close(); }
});

test("an OTHER hold is never resolved and is shown; a refused hand-back is tried 3 times, then shown", async () => {
  const other = holdSeed({ run: { processPid: 4242, logBytes: 9000 } });
  let b = await startStubBoard({ seed: other.seed });
  try {
    const { u } = sweeper(b);
    await u.sweep();
    assert.equal(resolves(b).length, 0);
    assert.deepEqual(writes(b), []);
    assert.deepEqual(u.holds().map((h) => [h.goalId, h.issueId, h.actionId]), [[other.target.id, other.target.id, other.action.id]]);
  } finally { await b.close(); }

  // Another open recovery action on the task makes the board refuse (409) a reopened hold every time.
  const busy = holdSeed({ extraActions: [{ id: "77777777-0000-4000-8000-000000000001", kind: "stranded_assigned_issue", status: "active",
    ownerType: "agent", cause: "stranded_assigned_issue", evidence: {}, updatedAt: "2026-11-11T02:00:00.000Z" }] });
  b = await startStubBoard({ seed: busy.seed });
  const root = mkdtempSync(join(tmpdir(), "uuu-unstick-"));
  try {
    const decisions = createDecisions(join(root, "decisions.json"));
    const { u, log, tick } = sweeper(b, { decisions });
    for (let i = 0; i < MAX_TRIES; i++) {
      await u.sweep();
      assert.equal(resolves(b).length, i + 1);
      assert.equal(u.holds().length, i + 1 === MAX_TRIES ? 1 : 0, "shown only after the last try");
      tick();
    }
    await u.sweep();
    tick();
    await u.sweep();
    assert.equal(resolves(b).length, MAX_TRIES, "no fourth try");
    assert.equal(u.holds().length, 1);
    assert.deepEqual(decisions.get(`unstick:${busy.action.id}`).tries, MAX_TRIES);
    assert.ok(log.every((l) => !GUID.test(l)));
    // A restarted home server remembers the tries.
    const again = sweeper(b, { decisions: createDecisions(join(root, "decisions.json")) });
    await again.u.sweep();
    assert.equal(resolves(b).length, MAX_TRIES);
    assert.equal(again.u.holds().length, 1);
  } finally { await b.close(); rmSync(root, { recursive: true, force: true }); }
});

test("a hold on a child step is found and handed back on that step", async () => {
  const { seed, target, run, action } = holdSeed({ on: "STH-5" });
  const b = await startStubBoard({ seed });
  try {
    const { u } = sweeper(b);
    await u.sweep();
    const sent = resolves(b);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].path, `/api/issues/${target.id}/recovery-actions/resolve`);
    assert.deepEqual(sent[0].body, resolveBody(action, run));
  } finally { await b.close(); }
  const other = holdSeed({ on: "STH-5", run: { processPid: 4242 } });
  const b2 = await startStubBoard({ seed: other.seed });
  try {
    const { u } = sweeper(b2);
    await u.sweep();
    assert.deepEqual(u.holds().map((h) => [h.goalId, h.issueId, h.identifier]), [[IDS.issues["STH-1"], other.target.id, "STH-5"]]);
  } finally { await b2.close(); }
});

test("a task whose run is still going, or whose owner changed, is not handed back but shown", async () => {
  const locked = holdSeed();
  locked.target.executionRunId = "88888888-0000-4000-8000-000000000001";
  let b = await startStubBoard({ seed: locked.seed });
  try {
    const { u } = sweeper(b);
    await u.sweep();
    assert.equal(resolves(b).length, 0);
    assert.equal(u.holds().length, 1, "shown to the owner, and looked at again next sweep, not counted as a try");
  } finally { await b.close(); }
  const moved = holdSeed({ action: { returnOwnerAgentId: IDS.agents.builder } });
  b = await startStubBoard({ seed: moved.seed });
  try {
    const { u } = sweeper(b);
    await u.sweep();
    assert.equal(resolves(b).length, 0);
  } finally { await b.close(); }
});

test("a board that is off ends the sweep quietly", async () => {
  const dead = http.createServer();
  await new Promise((r) => dead.listen(0, "127.0.0.1", r));
  const port = dead.address().port;
  await new Promise((r) => dead.close(r));
  const board = createBoard({ baseUrl: `http://127.0.0.1:${port}`, ids: IDS_OF, timeoutMs: 500 });
  const log = [];
  const u = createUnstick({ board, ids: IDS_OF, log: (l) => log.push(l) });
  await u.sweep();
  assert.deepEqual(u.holds(), []);
  assert.deepEqual(log, []);
  // Not set up yet: nothing is asked.
  const none = createUnstick({ board, ids: () => null });
  await none.sweep();
});

test("a slow board never delays a page, and the sweep ends when it gives up", async () => {
  const sockets = new Set();
  const slow = http.createServer(() => { /* never answers */ });
  slow.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => slow.listen(0, "127.0.0.1", r));
  const h = await startStubsHome({ port: 0, urls: { board: `http://127.0.0.1:${slow.address().port}` } });
  try {
    const sweeping = h.app.home.unstick.sweep();
    const t0 = Date.now();
    const page = await call(h.url, "GET", "/");
    assert.equal(page.status, 200);
    assert.ok(Date.now() - t0 < 2000);
    for (const s of sockets) s.destroy();
    await sweeping;
    assert.deepEqual(h.app.home.unstick.holds(), []);
  } finally {
    await h.close();
    await new Promise((r) => { slow.closeAllConnections?.(); slow.close(r); });
  }
});

test("the sweep is made by the home server but not started outside main.mjs", async () => {
  const { seed } = holdSeed();
  const h = await startStubsHome({ port: 0, boardSeed: seed });
  try {
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(typeof h.app.home.unstick.start, "function");
    assert.equal(resolves(h.board).length, 0);
    const main = readFileSync(join(HERE, "..", "main.mjs"), "utf8");
    assert.match(main, /home\.unstick\.start\(\)/);
  } finally { await h.close(); }
});

// ---- what the owner sees

test("an OTHER hold is one Needs-you item with Stop this task and Reply, and both work", async () => {
  // STH-3: STH-1 has a question, and the inbox drops a task's board "blocked" items while it waits for an answer.
  const { seed, target, action } = holdSeed({ on: "STH-3", run: { processPid: 4242, logBytes: 9000 } });
  // The board's own item for the same hold (an open action would give one) is not shown twice.
  seed.attention.push({
    companyId: IDS.company, sourceKind: "recovery_action", id: `recovery_action:${action.id}`,
    subject: { kind: "recovery_action", id: action.id, title: action.nextAction, metadata: { cause: action.cause, sourceIssueId: target.id } },
    whyNow: "Recovery action is assigned to a human owner.", decisionVerbs: [], severity: "medium",
    relatedIssue: { kind: "issue", id: target.id, title: target.title }, activityAt: "2026-11-11T02:25:53.844Z",
  });
  const h = await startStubsHome({ port: 0, boardSeed: seed });
  try {
    await h.app.home.unstick.sweep();
    const items = (await call(h.url, "GET", "/api/inbox")).json.items;
    const held = items.filter((i) => i.id === `board:hold:${target.id}`);
    assert.equal(held.length, 1);
    assert.equal(items.filter((i) => i.id === `board:recovery_action:${action.id}`).length, 0);
    const item = held[0];
    assert.equal(item.kind, "problem");
    assert.equal(item.summary, "This task stopped and the board will not start it again by itself.");
    assert.deepEqual(item.actions.map((a) => a.id), ["stop", "answer", "dismiss"]);
    assert.deepEqual(item.actions.map((a) => a.label), ["Stop this task", "Reply", "Hide"]);
    assert.deepEqual(item.link, { page: "goals", id: target.id });
    // The words the owner reads (the task's own title aside): no ids, codes or tool names.
    const words = [item.title, item.summary, item.raisedBy, ...item.actions.map((a) => a.label),
      ...item.details.filter((d) => d.label !== "Task").map((d) => `${d.label} ${d.value}`)].join(" ");
    assert.doesNotMatch(words, GUID);
    assert.doesNotMatch(words, /recovery|reconcil|paperclip|execution|\b\d{3}\b/i);

    const n = h.board.requests.length;
    let r = await actAsSeen(h.url, { id: item.id, action: "answer", note: "Please carry on from the plan." });
    assert.equal(r.status, 200, r.text);
    assert.ok(h.board.state.comments.some((c) => c.issueId === target.id && c.body === "Please carry on from the plan."));
    r = await actAsSeen(h.url, { id: item.id, action: "stop" });
    assert.equal(r.status, 200, r.text);
    assert.equal(h.board.state.issues.find((i) => i.id === target.id).status, "cancelled");
    assert.deepEqual(h.board.requests.slice(n).filter((x) => x.method !== "GET").map((x) => `${x.method} ${x.path}`),
      [`POST /api/issues/${target.id}/comments`, `PATCH /api/issues/${target.id}`]);
    assert.equal((await call(h.url, "GET", "/api/inbox")).json.items.filter((i) => i.id === item.id).length, 0);
  } finally { await h.close(); }
});

test("the board's recovery item for a hold offers no Try again; others still do", async () => {
  const seed = boardSeed();
  const mk = (n, cause) => ({
    companyId: IDS.company, sourceKind: "recovery_action", id: `recovery_action:${n}`,
    subject: { kind: "recovery_action", id: n, title: "Stopped", metadata: { cause, sourceIssueId: IDS.issues["STH-3"] } },
    whyNow: "Recovery action is assigned to a human owner.", decisionVerbs: [], severity: "medium",
    relatedIssue: { kind: "issue", id: IDS.issues["STH-3"], title: "Reconcile the October bills" }, activityAt: "2026-11-11T02:25:53.844Z",
  });
  seed.attention.push(mk("99999999-0000-4000-8000-000000000001", "legacy_execution_requires_reconciliation"));
  seed.attention.push(mk("99999999-0000-4000-8000-000000000002", "stranded_assigned_issue"));
  const h = await startStubsHome({ port: 0, boardSeed: seed });
  try {
    const items = (await call(h.url, "GET", "/api/inbox")).json.items;
    const held = items.find((i) => i.id === "board:recovery_action:99999999-0000-4000-8000-000000000001");
    const plain = items.find((i) => i.id === "board:recovery_action:99999999-0000-4000-8000-000000000002");
    assert.ok(held && plain);
    assert.ok(!held.actions.some((a) => a.id === "retry"));
    assert.ok(held.actions.some((a) => a.id === "answer"));
    assert.ok(plain.actions.some((a) => a.id === "retry"));
  } finally { await h.close(); }
});
