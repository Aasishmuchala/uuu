// M63b (final review): a question (POST /api/ask) or a task in the owner's own words (POST /api/goals) is always a
// new task. The board treats a new top-level task whose title matches an open one of the last 48 hours as that task
// and hands the old one back with `deduplicated: true`, unless the request says `allowDuplicate: true` (paperclip's
// createIssueSchema; services/issues.js "recent_open_title"). Both routes send it, as routes/jobs.mjs does, and a
// task the board still hands back is refused plainly, with nothing recorded. The stub board does not dedup, so a
// small proxy in front of it does, as the board does (the same proxy as test/jobs-routes.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const OPTIONS = { routes: ["ask", "goals"], inbox: ["board", "goals"] };
const norm = (t) => String(t || "").trim().replace(/\s+/g, " ").toLowerCase();
const decisions = (home) => {
  const p = join(home.state, "home", "decisions.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
};

// mode "board": dedup by title unless allowDuplicate is true; "replay": hand back the open task whatever is asked.
async function dedupBoard(mode) {
  const state = { target: null, stub: null, posts: [] };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (req.method === "POST" && /^\/api\/companies\/[^/]+\/issues$/.test(req.url)) {
      const body = JSON.parse(raw);
      state.posts.push(body);
      const dedup = mode === "replay" || body.allowDuplicate !== true;
      const old = dedup && state.stub.state.issues.find((i) => !i.parentId && !["done", "cancelled"].includes(i.status) && norm(i.title) === norm(body.title));
      if (old) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ...old, deduplicated: true, deduplicationReason: "recent_open_title" }));
      }
    }
    const out = await fetch(`${state.target}${req.url}`, { method: req.method, headers: { "content-type": "application/json", ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) }, body: raw || undefined });
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(await out.text());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });
  return state;
}

async function withDedupBoard(mode, fn) {
  const proxy = await dedupBoard(mode);
  try {
    const home = await startV2({ ...OPTIONS, urls: { board: proxy.url } });
    proxy.target = home.board.url;
    proxy.stub = home.board;
    try { return await fn(home, proxy); } finally { await home.close(); }
  } finally { await proxy.close(); }
}

const post = (home, path, body) => call(home.url, "POST", path, { body });

test("POST /api/ask: the same question twice is two tasks, each with its own ask: record", async () => {
  await withDedupBoard("board", async (home, proxy) => {
    const a = await post(home, "/api/ask", { text: "How long is our warranty?" });
    const b = await post(home, "/api/ask", { text: "How long is our warranty?" });
    assert.equal(a.status, 201, a.text);
    assert.equal(b.status, 201, b.text);
    assert.ok(proxy.posts.every((p) => p.allowDuplicate === true));
    assert.notEqual(a.json.ask.id, b.json.ask.id, "a second question is a new task");
    const d = decisions(home);
    assert.ok(d[`ask:${a.json.ask.id}`] && d[`ask:${b.json.ask.id}`]);
  });
});

test("POST /api/ask: a question the board hands back as an existing task records nothing and says so", async () => {
  await withDedupBoard("replay", async (home) => {
    const a = await post(home, "/api/ask", { text: "Do we deliver on Sundays?" });
    assert.equal(a.status, 201, a.text);
    const before = decisions(home);
    const b = await post(home, "/api/ask", { text: "Do we deliver on Sundays?\n\nAnd on public holidays?" });
    assert.equal(b.status, 409, b.text);
    assert.equal(b.json.error.code, "already_asked");
    assert.doesNotMatch(b.json.error.message + b.json.error.next, /STH-|[0-9a-f]{8}-|dedup/i);
    assert.deepEqual(decisions(home), before, "no ask: record lands on the old task");
  });
});

test("POST /api/goals: the same words twice is two tasks", async () => {
  await withDedupBoard("board", async (home, proxy) => {
    const a = await post(home, "/api/goals", { text: "Write a note for the front desk" });
    const b = await post(home, "/api/goals", { text: "Write a note for the front desk" });
    assert.equal(a.status, 201, a.text);
    assert.equal(b.status, 201, b.text);
    assert.ok(proxy.posts.every((p) => p.allowDuplicate === true));
    assert.notEqual(a.json.goal.id, b.json.goal.id);
  });
});

test("POST /api/goals: a task the board hands back as an existing one records nothing and says so", async () => {
  await withDedupBoard("replay", async (home) => {
    const a = await post(home, "/api/goals", { text: "Plan the stock count", template: "plan-a-thing" });
    assert.equal(a.status, 201, a.text);
    const before = decisions(home);
    const b = await post(home, "/api/goals", { text: "Plan the stock count", template: "other-thing" });
    assert.equal(b.status, 409, b.text);
    assert.equal(b.json.error.code, "already_given");
    assert.doesNotMatch(b.json.error.message + b.json.error.next, /STH-|[0-9a-f]{8}-|dedup/i);
    assert.deepEqual(decisions(home), before, "no template: record lands on the old task");
  });
});
