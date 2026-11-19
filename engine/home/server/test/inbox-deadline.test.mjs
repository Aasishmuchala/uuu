// Each inbox source has SOURCE_DEADLINE_MS to list (S-faults-1b2b2774): a source that does not answer is listed as
// not answering with its part's plain sentence and its late answer is dropped; while that late call still runs the
// source is not asked again and is said at once; an action's re-read is never cut short.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVER_DIR } from "../lib/app.mjs";
import { HomeError } from "../lib/errors.mjs";
import { SOURCE_DEADLINE_MS, mergeInbox } from "../lib/inbox.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

const item = (id, source) => ({ id, source, kind: "draft", title: id, raisedBy: "Bookkeeper", when: "2026-11-19T10:00:00.000Z", summary: "", severity: "normal", details: [], actions: [], link: null });

function sources() {
  let release = null;
  const hold = new Promise((r) => { release = r; });
  const calls = { bench: 0, board: 0 };
  const list = [
    { id: "bench", async list() { calls.bench += 1; await hold; return { items: [item("bench:late", "books")] }; } },
    { id: "board", async list() { calls.board += 1; return { items: [item("board:1", "board")] }; } },
  ];
  return { list, calls, release };
}

test("the deadline is about 4 s", () => {
  assert.equal(SOURCE_DEADLINE_MS, 4000);
});

test("a source that never answers is said within the deadline; its late answer is dropped; it is not asked again meanwhile", async () => {
  const ctx = { board: {}, log() {} };
  const { list, calls, release } = sources();
  const t = Date.now();
  const first = await mergeInbox(ctx, list, { deadlineMs: 200 });
  assert.ok(Date.now() - t < 1000, `answered in ${Date.now() - t} ms`);
  assert.deepEqual(first.items.map((i) => i.id), ["board:1"]);
  assert.deepEqual(first.notConnected, [{ source: "bench", reason: "The books are not answering." }]);
  assert.equal(first.unread.get("bench").status, 502);

  // While the late call runs, the books are said at once and not asked again.
  const t2 = Date.now();
  const second = await mergeInbox(ctx, list, { deadlineMs: 200 });
  assert.ok(Date.now() - t2 < 100, `said at once (${Date.now() - t2} ms)`);
  assert.deepEqual(second.notConnected, [{ source: "bench", reason: "The books are not answering." }]);
  assert.deepEqual(calls, { bench: 1, board: 2 });

  // Once it has ended (its answer dropped), the next read asks again.
  release();
  await new Promise((r) => setTimeout(r, 20));
  const third = await mergeInbox(ctx, list, { deadlineMs: 200 });
  assert.equal(calls.bench, 2);
  assert.deepEqual(third.notConnected, []);
  assert.deepEqual(third.items.map((i) => i.id).sort(), ["bench:late", "board:1"]);
});

test("the late mark is kept per home (board client), and a board source late says the board", async () => {
  let release = null;
  const hold = new Promise((r) => { release = r; });
  const slowBoard = [{ id: "staged", async list() { await hold; return { items: [] }; } }];
  const a = await mergeInbox({ board: {}, log() {} }, slowBoard, { deadlineMs: 100 });
  assert.deepEqual(a.notConnected, [{ source: "staged", reason: "The board is not answering." }]);
  let asked = 0;
  const fine = [{ id: "staged", async list() { asked += 1; return { items: [] }; } }];
  const b = await mergeInbox({ board: {}, log() {} }, fine, { deadlineMs: 100 });
  assert.equal(asked, 1, "another home's board client is asked");
  assert.deepEqual(b.notConnected, []);
  release();
});

test("an action's re-read waits for the source (never cut short)", async () => {
  let release = null;
  const hold = new Promise((r) => { release = r; });
  const list = [{ id: "bench", async list() { await hold; return { items: [item("bench:1", "books")] }; } }];
  setTimeout(release, 300);
  const out = await mergeInbox({ board: {}, log() {}, acting: true }, list, { deadlineMs: 50 });
  assert.deepEqual(out.items.map((i) => i.id), ["bench:1"]);
  assert.deepEqual(out.notConnected, []);
});

test("GET /api/inbox with a source that never answers answers within 5 s with the plain reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uuu-inbox-deadline-"));
  mkdirSync(join(dir, "routes"));
  mkdirSync(join(dir, "inbox"));
  symlinkSync(join(SERVER_DIR, "routes", "inbox.mjs"), join(dir, "routes", "inbox.mjs"));
  writeFileSync(join(dir, "inbox", "bench.mjs"), "export default { id: 'bench', list: () => new Promise(() => {}), act: async () => ({}) };\n");
  const h = await startStubsHome({ port: 0, moduleDirs: [dir] });
  try {
    const t = Date.now();
    const r = await call(h.url, "GET", "/api/inbox");
    assert.ok(Date.now() - t < 5000, `answered in ${Date.now() - t} ms`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.notConnected, [{ source: "bench", reason: "The books are not answering." }]);
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a department page whose first books read does not answer says the books are not answering, not loading for 15 s", async () => {
  const { FIRST_READ_MS, departmentPage } = await import("../routes/_departments.mjs");
  assert.equal(FIRST_READ_MS, 4000);
  const ctx = {
    bench: { installed: () => true, has: () => new Promise(() => {}) },
    board: { companyId: async () => { throw new HomeError(502, "The board is off.", "", "board_off"); } },
    ids: () => null, config: {}, log() {},
  };
  const def = { id: "books", title: "Books", agentSlug: "bookkeeper", agentName: "Bookkeeper", mainDoctype: "Sales Invoice", switches: [] };
  const t = Date.now();
  const out = await departmentPage(ctx, def, async () => { throw new Error("not reached"); }, { firstReadMs: 100 });
  assert.ok(Date.now() - t < 1000, `answered in ${Date.now() - t} ms`);
  assert.equal(out.connected, false);
  assert.deepEqual(out.notConnected, { reason: "The books are not answering.", next: "Try again in a minute. If it keeps happening, look at Health." });
});

test("the board client: after a read times out, reads fail at once for holdMs; writes are not held", async () => {
  const http = await import("node:http");
  const { SLOW_HOLD_MS, createBoard } = await import("../lib/board.mjs");
  assert.equal(SLOW_HOLD_MS, 5000);
  const seen = [];
  let hang = true;
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (hang && req.method === "GET") return; // never answers
    res.writeHead(200, { "content-type": "application/json" });
    res.end("[]");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const board = createBoard({ baseUrl: `http://127.0.0.1:${server.address().port}`, ids: () => null, timeoutMs: 100, holdMs: 400 });
  try {
    await assert.rejects(board.get("/api/a"), (e) => e.code === "board_off");
    assert.equal(seen.length, 1);
    const t = Date.now();
    await assert.rejects(board.get("/api/b"), (e) => e.code === "board_off");
    assert.ok(Date.now() - t < 50, "held: at once");
    assert.equal(seen.length, 1, "held: the board is not asked");
    assert.deepEqual(await board.post("/api/c", {}), [], "a write is not held");
    hang = false;
    await new Promise((r) => setTimeout(r, 450));
    assert.deepEqual(await board.get("/api/d"), [], "after the hold the board is asked again");
    assert.deepEqual(seen.slice(1), ["POST /api/c", "GET /api/d"]);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
