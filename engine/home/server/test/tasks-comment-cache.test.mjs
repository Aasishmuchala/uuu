// The task's comments are cached 15 seconds only while the issue list shows the task unchanged
// (S-agents-488fa58c): a VERDICT posted after a read is seen on the very next read, and a task that did not
// change is not read again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { createBoard } from "../lib/board.mjs";
import { forgetComments, loadTaskContext } from "../lib/tasks.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const STH2 = IDS.issues["STH-2"];
const commentReads = (h, id) => h.board.requests.filter((r) => r.method === "GET" && r.path === `/api/issues/${id}/comments`).length;

async function start() {
  const h = await startV2({ routes: ["inbox", "task"], inbox: ["goals", "content"], boardSeed: boardSeed() });
  h.board.state.comments = h.board.state.comments.filter((c) => !/^\s*VERDICT:/i.test(c.body));
  h.board.state.issues.find((i) => i.id === STH2).status = "in_progress";
  forgetComments();
  return h;
}

test("the stub board moves an issue's updatedAt when a comment is posted", async () => {
  const h = await start();
  try {
    const issue = h.board.state.issues.find((i) => i.id === STH2);
    issue.updatedAt = "2026-11-01T00:00:00.000Z";
    const r = await fetch(`${h.board.url}/api/issues/${STH2}/comments`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "A note." }),
    });
    assert.equal(r.status, 201);
    assert.notEqual(issue.updatedAt, "2026-11-01T00:00:00.000Z");
  } finally { forgetComments(); await h.close(); }
});

test("a VERDICT posted after the task view was read shows on the next read, not 15 s later", async () => {
  const h = await start();
  try {
    const before = (await call(h.url, "GET", `/api/tasks/${STH2}`)).json;
    assert.equal(before.acceptance.rounds.length, 0);
    // What the board does on a comment: the comment, then the issue's updatedAt moves (stub and Paperclip alike).
    const issue = h.board.state.issues.find((i) => i.id === STH2);
    h.board.state.comments.push({ id: "c-verdict", issueId: STH2, body: "VERDICT: PASS - looks fine", authorAgentId: IDS.agents.checker, createdAt: new Date().toISOString() });
    issue.updatedAt = new Date(Date.parse(issue.updatedAt || 0) + 1000).toISOString();
    const after = (await call(h.url, "GET", `/api/tasks/${STH2}`)).json;
    assert.equal(after.acceptance.rounds.length, 1, "the new comment is read at once");
    assert.equal(after.conversation.find((x) => /looks fine/.test(x.text)).kind, "verdict");
  } finally { forgetComments(); await h.close(); }
});

// The task model read straight from the stub board (as tasks-f1b.test.mjs does), so only the cached reads count.
function ctxOf(h) {
  const ids = () => ({ companyId: IDS.company, projectId: IDS.project, agents: IDS.agents });
  const url = `http://127.0.0.1:${h.board.port}`;
  return {
    board: createBoard({ baseUrl: url, ids, timeoutMs: 4000 }), ids, config: h.config, log() {}, home: { urls: { board: url } },
    decisions: { get: () => null, set: (k, v) => v },
  };
}

test("a task that did not change keeps its cached comments; one that changed is read again", async () => {
  const h = await start();
  try {
    const ctx = ctxOf(h);
    const tctx = await loadTaskContext(ctx, { withInbox: false });
    assert.ok(tctx.comments.has(STH2));
    const n = commentReads(h, STH2);
    assert.equal(n, 1);
    await loadTaskContext(ctx, { withInbox: false });
    await loadTaskContext(ctx, { withInbox: false });
    assert.equal(commentReads(h, STH2), 1, "no read again within 15 s while updatedAt holds");
    const issue = h.board.state.issues.find((i) => i.id === STH2);
    issue.updatedAt = new Date(Date.parse(issue.updatedAt || 0) + 1000).toISOString();
    await loadTaskContext(ctx, { withInbox: false });
    assert.equal(commentReads(h, STH2), 2, "read again once updatedAt moved");
    await loadTaskContext(ctx, { withInbox: false });
    assert.equal(commentReads(h, STH2), 2, "then cached again");
  } finally { forgetComments(); await h.close(); }
});
