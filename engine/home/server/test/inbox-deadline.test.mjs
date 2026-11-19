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

test("a source that never answers is said within the deadline; it is not asked again meanwhile; its late answer is shown next", async () => {
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

test("a source that always answers in 1.5 times the deadline shows its item from the second read on (REVIEW-STRESS 2)", async () => {
  const ctx = { board: {}, log() {} };
  let calls = 0;
  const list = [{ id: "bench", async list() { calls += 1; await new Promise((r) => setTimeout(r, 300)); return { items: [item(`bench:money-${calls}`, "books")] }; } }];
  const first = await mergeInbox(ctx, list, { deadlineMs: 200 });
  assert.deepEqual(first.items, []);
  assert.deepEqual(first.notConnected, [{ source: "bench", reason: "The books are not answering." }]);
  await new Promise((r) => setTimeout(r, 150)); // the late call ends (at 300 ms)
  for (let n = 2; n <= 4; n++) {
    const t = Date.now();
    const out = await mergeInbox(ctx, list, { deadlineMs: 200 });
    assert.ok(Date.now() - t < 100, `read ${n} served at once`);
    assert.equal(out.items.length, 1, `read ${n} shows the item`);
    assert.match(out.items[0].id, /^bench:money-/);
    assert.deepEqual(out.notConnected, []);
    await new Promise((r) => setTimeout(r, 350)); // the call behind it ends and is kept
  }
  assert.ok(calls >= 4, `one call behind each read (${calls})`);
  // A failed call clears what was kept: nothing old is shown as if it were whole.
  list[0].list = async () => { calls += 1; await new Promise((r) => setTimeout(r, 300)); throw new Error("down"); };
  await mergeInbox(ctx, list, { deadlineMs: 200 }); // served kept, a failing call behind it
  await new Promise((r) => setTimeout(r, 350));
  const after = await mergeInbox(ctx, list, { deadlineMs: 200 });
  assert.deepEqual(after.items, []);
  assert.equal(after.notConnected.length, 1);
});

test("a write that lands but times out, with a read held meanwhile: Stop still reports success (REVIEW-STRESS 1)", async () => {
  const http = await import("node:http");
  const { createBoard } = await import("../lib/board.mjs");
  const { stopTask } = await import("../lib/stop.mjs");
  let status = "in_progress";
  const server = http.createServer((req, res) => {
    if (req.method === "PATCH") { req.resume(); req.on("end", () => { status = "cancelled"; }); return; } // lands, never answers
    if (req.url === "/api/slow") return; // a page's read that times out and holds reads
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "g1", status }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const h = await startStubsHome({ port: 0 });
  try {
    const board = createBoard({ baseUrl: `http://127.0.0.1:${server.address().port}`, ids: () => null, timeoutMs: 100, writeTimeoutMs: 250, holdMs: 5000 });
    const slow = board.get("/api/slow").catch((e) => e);
    const ctx = { board, config: h.config, log() {}, ids: () => ({ companyId: "c1" }) };
    const out = await stopTask(ctx, "g1", { issues: [{ id: "g1", identifier: "STH-1", status: "in_progress" }] });
    assert.equal((await slow).code, "board_off", "the page's read timed out");
    await assert.rejects(board.get("/api/x"), (e) => e.message.includes("running but not answering"), "reads are held");
    assert.equal(out.message, "Stopped. The task will not go on.");
    assert.equal(status, "cancelled");
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await h.close();
  }
});

test("an owner's action reads the board unheld; a timeout or the hold says running but not answering, a refused board says off (REVIEW-STRESS 1, 3)", async () => {
  const http = await import("node:http");
  const { createBoard } = await import("../lib/board.mjs");
  const { createActor } = await import("../lib/inbox.mjs");
  const server = http.createServer((req, res) => {
    if (req.url === "/api/slow") return;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("[]");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const board = createBoard({ baseUrl: `http://127.0.0.1:${server.address().port}`, ids: () => null, timeoutMs: 100, holdMs: 5000 });
    const slow = await board.get("/api/slow").catch((e) => e);
    assert.equal(slow.message, "The board is running but not answering, so agents and tasks cannot be reached.");
    assert.equal(slow.next, "Restart the engine: engine stop, then engine start.");
    const held = await board.get("/api/list").catch((e) => e);
    assert.equal(held.message, slow.message, "held: the same words");
    assert.deepEqual(await board.get("/api/list", { held: false }), []);
    assert.deepEqual(await board.unheld().get("/api/list"), []);
    let seen = null;
    const src = { id: "board", async list(c) { seen = await c.board.get("/api/list"); return { items: [{ ...item("board:1", "board"), actions: [{ id: "go", label: "Go", style: "primary", needsNote: false }] }] }; }, async act() { return { message: "Done." }; } };
    const act = createActor([src]);
    const out = await act({ board, log() {}, decisions: null }, { id: "board:1", action: "go" });
    assert.deepEqual(seen, [], "the action's re-read reached the board while reads were held");
    assert.equal(out.message, "Done.");
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  const off = createBoard({ baseUrl: "http://127.0.0.1:9", ids: () => null, timeoutMs: 100 });
  const e = await off.get("/api/x").catch((x) => x);
  assert.equal(e.message, "The board is switched off, so agents and tasks cannot be reached.");
});

test("/api/shell says when its Needs-you count is partial (REVIEW-STRESS 2)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uuu-shell-partial-"));
  mkdirSync(join(dir, "routes"));
  mkdirSync(join(dir, "inbox"));
  symlinkSync(join(SERVER_DIR, "routes", "shell.mjs"), join(dir, "routes", "shell.mjs"));
  writeFileSync(join(dir, "inbox", "bench.mjs"), "export default { id: 'bench', list: () => new Promise(() => {}), act: async () => ({}) };\n");
  writeFileSync(join(dir, "inbox", "goals.mjs"), "export default { id: 'goals', list: async () => ({ items: [] }), act: async () => ({}) };\n");
  const h = await startStubsHome({ port: 0, moduleDirs: [dir] });
  try {
    const r = await call(h.url, "GET", "/api/shell");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.counts.partial, true);
    assert.deepEqual(r.json.notConnected, [{ source: "bench", reason: "The books are not answering." }]);
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
  const whole = await startStubsHome({ port: 0 });
  try {
    const r = await call(whole.url, "GET", "/api/shell");
    assert.equal(r.json.counts.partial, false);
    assert.deepEqual(r.json.notConnected, []);
  } finally { await whole.close(); }
});

test("books not installed: the shell's count is whole (partial false); a source that failed makes it partial (second look 1)", async () => {
  const h = await startStubsHome({ port: 0, benchInstalled: false });
  try {
    const r = await call(h.url, "GET", "/api/shell");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.counts.partial, false);
    assert.deepEqual(r.json.notConnected, [{ source: "books", reason: "Books is not installed on this Mac yet." }]);
    const inbox = await call(h.url, "GET", "/api/inbox");
    assert.deepEqual(inbox.json.notConnected, [{ source: "books", reason: "Books is not installed on this Mac yet." }], "no new key in the inbox's answer");
  } finally { await h.close(); }
  const failed = await mergeInbox({ board: {}, log() {} }, [{ id: "bench", async list() { throw new Error("down"); } }]);
  assert.equal(failed.notConnected[0].failed, true);
  const declared = await mergeInbox({ board: {}, log() {} }, [{ id: "bench", async list() { return { items: [], notConnected: { source: "books", reason: "x" } }; } }]);
  assert.equal(declared.notConnected[0].failed, undefined);
});

test("an item handled by an action does not come back from what was kept, nor from a call already running (second look 2)", async () => {
  const { createActor } = await import("../lib/inbox.mjs");
  const board = {};
  let waiting = true;
  const src = {
    id: "bench",
    async list() { const snapshot = waiting ? [{ ...item("bench:1", "books"), actions: [{ id: "approve", label: "Approve", style: "primary", needsNote: false }] }] : []; await new Promise((r) => setTimeout(r, 300)); return { items: snapshot }; },
    async act() { waiting = false; return { message: "Approved." }; },
  };
  const ctx = { board, log() {} };
  await mergeInbox(ctx, [src], { deadlineMs: 100 }); // late
  await new Promise((r) => setTimeout(r, 250)); // ends: kept, with bench:1
  const kept = await mergeInbox(ctx, [src], { deadlineMs: 100 }); // served kept; a call (that read bench:1) runs behind it
  assert.deepEqual(kept.items.map((i) => i.id), ["bench:1"]);
  // The action re-reads the source at once (an action is never served kept), then acts.
  const fast = { ...src, list: async () => ({ items: waiting ? [{ ...item("bench:1", "books"), actions: [{ id: "approve", label: "Approve", style: "primary", needsNote: false }] }] : [] }) };
  const actor = createActor([fast]);
  const out = await actor({ board, log() {}, decisions: null }, { id: "bench:1", action: "approve" });
  assert.equal(out.message, "Approved.");
  await new Promise((r) => setTimeout(r, 400)); // the call that was running before the action ends: not kept
  const after = await mergeInbox(ctx, [src], { deadlineMs: 1000 });
  assert.deepEqual(after.items.map((i) => i.id), [], "the handled item is not shown again");
});

test("a call let go that ends late does not overwrite a newer kept answer (per-call token)", async () => {
  const ctx = { board: {}, log() {} };
  let n = 0;
  const resolvers = [];
  const src = { id: "bench", list: () => { n += 1; const me = n; return new Promise((r) => resolvers.push(() => r({ items: [item(`bench:${me}`, "books")] }))); } };
  await mergeInbox(ctx, [src], { deadlineMs: 50 }); // call 1, late, still running
  // Call 1 is let go (as after KEPT_MS) and call 2 starts and ends late: kept is call 2's.
  const { forgetKept } = await import("../lib/inbox.mjs");
  forgetKept(ctx.board);
  await mergeInbox(ctx, [src], { deadlineMs: 50 }); // call 2
  resolvers[1]();
  await new Promise((r) => setTimeout(r, 20));
  resolvers[0](); // call 1 ends last
  await new Promise((r) => setTimeout(r, 20));
  const out = await mergeInbox(ctx, [src], { deadlineMs: 50 });
  assert.deepEqual(out.items.map((i) => i.id), ["bench:2"]);
});
