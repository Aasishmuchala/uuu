// F1b items 5 and 6 (lib/unstick.mjs), on a fake board and a fake clock.
//   5. A never-started hold that cannot be handed back now (the task is under review, has another owner, or a run
//      is still checked out on it) is shown to the owner, not left unseen forever.
//   6. A task is handed back at most 3 times in any 24 hours; a hold that keeps coming back is then shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnstick, HANDBACK_WINDOW_MS, MAX_HANDBACKS, SWEEP_MS } from "../lib/unstick.mjs";

const IDS_OF = () => ({ companyId: "c1", projectId: "p1" });
const AGENT = "agent-1";

// One goal G held by the board. Every successful resolve clears the hold; `comeBack` puts a new one in its place.
function fakeBoard({ issue = {}, comeBack = true } = {}) {
  const goal = { id: "G", identifier: "STH-9", title: "Pay bills", projectId: "p1", parentId: null, status: "todo", assigneeAgentId: AGENT, ...issue };
  let n = 1;
  let held = true;
  const resolves = [];
  const runId = () => `run-${n}`;
  const board = {
    async get(path) {
      if (path.startsWith("/api/companies/c1/issues")) return [goal];
      if (path === "/api/issues/G/execution") return { runId: runId(), execution: { phase: held ? "recovery_needed" : "queued" } };
      if (path === "/api/issues/G/recovery-actions") {
        const a = { id: `action-${n}`, status: "active", cause: "legacy_execution_requires_reconciliation", returnOwnerAgentId: AGENT, evidence: { runId: runId() } };
        return { active: held ? a : null, actions: held ? [a] : [] };
      }
      if (path.startsWith("/api/heartbeat-runs/")) {
        return { id: runId(), agentId: AGENT, issueId: "G", status: "failed", errorCode: "legacy_disposition_repair_suppressed", startedAt: null, finishedAt: "2026-11-11T10:00:00.000Z" };
      }
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path, body) {
      resolves.push({ path, body });
      if (comeBack) n += 1; else held = false;
      return {};
    },
  };
  return { board, goal, resolves };
}

function memoryDecisions() {
  const data = new Map();
  return { get: (k) => (data.has(k) ? data.get(k) : null), set: (k, v) => { data.set(k, v); return v; }, data };
}

function sweeper(board, decisions = memoryDecisions()) {
  let t = Date.parse("2026-11-11T10:00:00Z");
  const log = [];
  const u = createUnstick({ board, ids: IDS_OF, decisions, log: (l) => log.push(l), now: () => t });
  return { u, log, decisions, tick: (ms = SWEEP_MS + 1000) => { t += ms; } };
}

test("a never-started hold on a task under review, with another owner, or with a run checked out is shown", async () => {
  for (const issue of [{ status: "in_review" }, { assigneeAgentId: "agent-2" }, { checkoutRunId: "run-x" }]) {
    const { board, resolves } = fakeBoard({ issue });
    const { u, tick } = sweeper(board);
    await u.sweep();
    assert.equal(resolves.length, 0, JSON.stringify(issue));
    assert.deepEqual(u.holds().map((h) => [h.goalId, h.issueId]), [["G", "G"]], JSON.stringify(issue));
    tick();
    await u.sweep();
    assert.equal(u.holds().length, 1, "still shown on the next sweep");
  }
});

test("a hold that can be handed back again once the task is free is handed back and no longer shown", async () => {
  const { board, goal, resolves } = fakeBoard({ issue: { status: "in_review" }, comeBack: false });
  const { u, tick } = sweeper(board);
  await u.sweep();
  assert.equal(u.holds().length, 1);
  goal.status = "todo";
  tick();
  await u.sweep();
  assert.equal(resolves.length, 1);
  assert.equal(u.holds().length, 0);
});

test("a hold that comes back after every hand-back: 3 hand-backs in 24 hours, then it is shown", async () => {
  const { board, resolves } = fakeBoard();
  const { u, tick, decisions, log } = sweeper(board);
  for (let i = 0; i < MAX_HANDBACKS; i++) {
    await u.sweep();
    assert.equal(resolves.length, i + 1);
    assert.equal(u.holds().length, 0);
    tick();
  }
  for (let i = 0; i < 5; i++) {
    await u.sweep();
    tick();
  }
  assert.equal(resolves.length, MAX_HANDBACKS, "no fourth hand-back within the day");
  assert.equal(u.holds().length, 1, "shown to the owner");
  assert.equal(decisions.get("unstick-handbacks:G").at.length, MAX_HANDBACKS, "kept in the decisions store");
  assert.ok(log.some((l) => /left to the owner/.test(l)));

  // A restarted home server remembers the hand-backs.
  const again = sweeper(board, decisions);
  await again.u.sweep();
  assert.equal(resolves.length, MAX_HANDBACKS);
  assert.equal(again.u.holds().length, 1);

  // A day after the first hand-back, one more is allowed.
  tick(HANDBACK_WINDOW_MS - (MAX_HANDBACKS + 5) * (SWEEP_MS + 1000) + 1000);
  await u.sweep();
  assert.equal(resolves.length, MAX_HANDBACKS + 1);
  assert.equal(u.holds().length, 0);
});
