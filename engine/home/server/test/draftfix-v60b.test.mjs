// V60b: the fix task made by "Send back" on a draft is marked, closed on the owner's decision and never listed.
// F1a: only the home server's record counts (draftfix-f1a.test.mjs); the marker line is for readers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIX_MARK, closeFixTasks, fixLine, recordFixTask } from "../lib/draftfix.mjs";
import goals from "../inbox/goals.mjs";

const IDS = { companyId: "c1", projectId: "p1" };
const ID = "bench:Purchase Invoice:ACC-PINV-2026-00001";

function fakeCtx(issues, { failPatch = false, failGet = false } = {}) {
  const patches = [];
  const data = new Map();
  return {
    patches,
    ids: () => IDS,
    decisions: { get: (k) => (data.has(k) ? data.get(k) : null), set: (k, v) => data.set(k, v) },
    config: {},
    board: {
      async get(path) {
        if (failGet) throw new Error("down");
        if (path.includes("/issues?")) return issues;
        const one = /^\/api\/issues\/([^/?]+)$/.exec(path);
        if (one) return issues.find((i) => i.id === decodeURIComponent(one[1]));
        return [];
      },
      async patch(path, body) {
        if (failPatch) throw new Error("down");
        patches.push([path, body]);
        return {};
      },
    },
  };
}

test("mark: line and reading it back", () => {
  assert.equal(FIX_MARK, "DRAFT-FIX:");
  assert.equal(fixLine(ID), `DRAFT-FIX: ${ID}`);
});

test("closeFixTasks: closes only open recorded tasks for this draft, never throws", async () => {
  const issues = [
    { id: "a", status: "todo", description: `x\n${fixLine(ID)}` },
    { id: "b", status: "in_progress", description: fixLine(ID) },
    { id: "c", status: "done", description: fixLine(ID) },
    { id: "d", status: "cancelled", description: fixLine(ID) },
    { id: "e", status: "todo", description: fixLine("bench:Purchase Invoice:OTHER") },
    { id: "f", status: "todo", description: "plain" },
  ];
  const recorded = (opts) => {
    const c = fakeCtx(issues, opts);
    for (const id of ["a", "b", "c", "d"]) recordFixTask(c, ID, { id });
    recordFixTask(c, "bench:Purchase Invoice:OTHER", { id: "e" });
    return c;
  };
  const ctx = recorded();
  assert.equal(await closeFixTasks(ctx, ID), 2);
  assert.deepEqual(ctx.patches, [["/api/issues/a", { status: "done" }], ["/api/issues/b", { status: "done" }]]);
  assert.equal(await closeFixTasks(recorded({ failPatch: true }), ID), 0);
  assert.equal(await closeFixTasks(recorded({ failGet: true }), ID), 0);
  assert.equal(await closeFixTasks({ ids: () => { throw new Error("x"); } }, ID), 0);
});

test("goals inbox: a recorded finished fix task is not listed, a normal finished goal is", async () => {
  const mk = (id, description) => ({ id, identifier: id, title: id, status: "done", projectId: "p1", parentId: null, description, createdAt: "2026-11-11T10:00:00Z", updatedAt: "2026-11-11T10:00:00Z" });
  const ctx = fakeCtx([mk("g1", "A normal goal"), mk("g2", `Fix it\n\n${fixLine(ID)}`)]);
  recordFixTask(ctx, ID, { id: "g2" });
  const out = await goals.list(ctx);
  assert.deepEqual(out.items.map((i) => i.id), ["goal:g1"]);
});

test("send back writes the marker as the last line of the fix task", async () => {
  const { startStubsHome } = await import("../lib/stubs.mjs");
  const { actAsSeen, call } = await import("../lib/testing.mjs");
  const h = await startStubsHome({ port: 0 });
  try {
    const id = "bench:Sales Invoice:ACC-SINV-2026-00001";
    await call(h.url, "GET", "/api/inbox");
    const r = await actAsSeen(h.url, { id, action: "send_back", note: "Wrong customer." });
    assert.equal(r.status, 200);
    const made = h.board.requests.find((q) => q.method === "POST" && /\/issues$/.test(q.path));
    assert.equal(made.body.description.split("\n").at(-1), fixLine(id));
  } finally { await h.close(); }
});
