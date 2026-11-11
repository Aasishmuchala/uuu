// F1b items 7 and 12: one way to stop a task (lib/stop.mjs) for the Tasks page, "A task stopped" and the staged
// items. The goal is cancelled first, then its open steps; a step that fails does not stop the rest; a task the
// owner gave that an agent moved under the goal is left alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { createBoard } from "../lib/board.mjs";
import { HomeError } from "../lib/errors.mjs";
import { isOwnerGoal, stepsToStop, stopTask } from "../lib/stop.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import stagedSource from "../inbox/staged.mjs";

const I = IDS.issues;
const GRAFT = "e0000000-0000-4000-8000-0000000000f1";
const GRAFT_STEP = "e0000000-0000-4000-8000-0000000000f2";

// The plain seed with its steps made by the Chief of staff (as on the live board), and a task the owner gave
// (with a step of its own) that an agent moved under STH-1.
function seed() {
  const s = boardSeed();
  for (const i of s.issues) if (i.parentId) Object.assign(i, { createdByAgentId: IDS.agents["chief-of-staff"], createdByUserId: null });
  const base = s.issues.find((i) => i.id === I["STH-1"]);
  s.issues.push({ ...base, id: GRAFT, identifier: "STH-41", issueNumber: 41, title: "The owner's other task", parentId: I["STH-1"], status: "todo" });
  s.issues.push({ ...base, id: GRAFT_STEP, identifier: "STH-42", issueNumber: 42, title: "Its step", parentId: GRAFT, status: "todo",
    createdByAgentId: IDS.agents["chief-of-staff"], createdByUserId: null });
  return s;
}
const statusOf = (h, id) => h.board.state.issues.find((i) => i.id === id).status;
const patches = (h, n) => h.board.requests.slice(n).filter((r) => r.method === "PATCH").map((r) => r.path.split("/").at(-1));

function expectStopped(h, n, log) {
  assert.equal(statusOf(h, I["STH-1"]), "cancelled");
  assert.equal(statusOf(h, I["STH-4"]), "cancelled");
  assert.equal(statusOf(h, I["STH-5"]), "cancelled");
  assert.equal(statusOf(h, GRAFT), "todo", "the owner's own task is left alone");
  assert.equal(statusOf(h, GRAFT_STEP), "todo", "and what is under it");
  const p = patches(h, n);
  assert.equal(p[0], I["STH-1"], "the goal first");
  assert.deepEqual(p.slice(1).sort(), [I["STH-4"], I["STH-5"]].sort());
  if (log) assert.ok(log.some((l) => /left STH-41 running/.test(l)), log.join("\n"));
}

test("the Tasks page's Stop stops the goal first, then its steps, and leaves a grafted task alone", async () => {
  const h = await startV2({ routes: ["goals"], boardSeed: seed() });
  try {
    const n = h.board.requests.length;
    const r = await call(h.url, "POST", `/api/goals/${I["STH-1"]}/stop`, { body: {} });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.message, "Stopped. The task will not go on.");
    expectStopped(h, n);
  } finally { await h.close(); }
});

test("Stop this task on \"A task stopped\" stops the steps too", async () => {
  const h = await startV2({ routes: ["inbox"], inbox: ["board"], boardSeed: seed() });
  try {
    h.app.home.unstick.holds = () => [{ goalId: I["STH-1"], issueId: I["STH-4"], identifier: "STH-4", title: "Draft", goalTitle: "Write the price list", actionId: null, when: null }];
    let forgot = null;
    h.app.home.unstick.forget = (id) => { forgot = id; };
    const n = h.board.requests.length;
    const r = await actAsSeen(h.url, { id: `board:hold:${I["STH-1"]}`, action: "stop" });
    assert.equal(r.status, 200, r.text);
    expectStopped(h, n);
    assert.equal(forgot, I["STH-1"]);
  } finally { await h.close(); }
});

test("Stop this task on a staged item stops the steps too", async () => {
  const h = await startV2({ routes: [], boardSeed: seed() });
  try {
    const ids = () => ({ companyId: IDS.company, projectId: IDS.project, agents: IDS.agents });
    const item = { id: `staged:stopped:${I["STH-1"]}`, actions: [{ id: "stop" }] };
    Object.defineProperty(item, "_goalId", { value: I["STH-1"] });
    const log = [];
    const ctx = {
      board: createBoard({ baseUrl: `http://127.0.0.1:${h.board.port}`, ids, timeoutMs: 4000 }), ids, item, log: (l) => log.push(l),
      decisions: { get: () => null, set: () => {} }, fail: (s, m, x, c) => new HomeError(s, m, x, c),
    };
    const n = h.board.requests.length;
    const out = await stagedSource.act(ctx, item.id, "stop", null);
    assert.equal(out.message, "Stopped. The task will not go on.");
    expectStopped(h, n, log);
  } finally { await h.close(); }
});

test("the goal is stopped even when a step cannot be; the answer says how many were not", async () => {
  const issues = [
    { id: "G", identifier: "STH-1", status: "in_progress" },
    { id: "S1", parentId: "G", status: "todo", createdByAgentId: "chief" },
    { id: "S2", parentId: "G", status: "in_progress", createdByAgentId: "chief" },
    { id: "S3", parentId: "S2", status: "todo", createdByAgentId: "chief" },
    { id: "S4", parentId: "G", status: "done", createdByAgentId: "chief" },
  ];
  const calls = [];
  const board = {
    async get() { throw new Error("not read"); },
    async patch(path) {
      calls.push(path.split("/").at(-1));
      if (/S1|S3/.test(path)) throw new HomeError(409, "no", "no", "conflict");
      return {};
    },
  };
  const log = [];
  const out = await stopTask({ board, log: (l) => log.push(l), ids: () => ({}) }, "G", { issues });
  assert.equal(calls[0], "G");
  assert.deepEqual(calls.slice(1).sort(), ["S1", "S2", "S3"], "every open step is tried; a done one is not");
  assert.equal(out.failed, 2);
  assert.equal(out.message, "Stopped, but 2 of its steps could not be stopped. Stop it again in a minute.");
  assert.equal(log.filter((l) => /could not be stopped/.test(l)).length, 2);

  // The goal itself failing is the failure, and no step is touched.
  calls.length = 0;
  board.patch = async (path) => { calls.push(path); throw new HomeError(409, "no", "no", "conflict"); };
  await assert.rejects(stopTask({ board, log() {}, ids: () => ({}) }, "G", { issues }), (e) => e.status === 409);
  assert.equal(calls.length, 1);
});

test("which steps are stopped: open ones made by an agent; never a task the owner gave", () => {
  const owner = { createdByUserId: "local-board", createdByAgentId: null };
  assert.equal(isOwnerGoal(owner), true);
  assert.equal(isOwnerGoal({ createdByAgentId: "a" }), false);
  assert.equal(isOwnerGoal({ ...owner, originRunId: "r" }), false, "made from an agent's suggestion");
  const { steps, grafted } = stepsToStop([
    { id: "A", parentId: "G", status: "todo", createdByAgentId: "a" },
    { id: "B", parentId: "G", status: "todo", ...owner },
    { id: "C", parentId: "B", status: "todo", createdByAgentId: "a" },
    { id: "D", parentId: "A", status: "cancelled", createdByAgentId: "a" },
  ], "G");
  assert.deepEqual(steps.map((s) => s.id), ["A"]);
  assert.deepEqual(grafted.map((s) => s.id), ["B"]);
});
