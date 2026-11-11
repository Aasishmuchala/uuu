// V60d: the board client gives writes longer than reads. The real limits are 8 and 20 seconds; the slow
// fake board here answers after 90 ms, with limits of 80 ms (reads) and 200 ms (writes) passed through
// the same options, so the test stays fast.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createBoard } from "../lib/board.mjs";

const DELAY = 90;
let server;
let baseUrl;
const seen = [];

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, body });
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, method: req.method }));
      }, DELAY);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

const slowBoard = () => createBoard({ baseUrl, ids: () => ({ companyId: "c1" }), companyName: "Sthyra", timeoutMs: 80, writeTimeoutMs: 200 });

for (const m of ["post", "patch", "put"]) {
  test(`a ${m.toUpperCase()} answered after the read limit but within the write limit succeeds`, async () => {
    const out = await slowBoard()[m]("/api/issues/i1/comments", { body: "Hello" });
    assert.deepEqual(out, { ok: true, method: m.toUpperCase() });
  });
}

test("a GET answered after the read limit is the board not answering", async () => {
  await assert.rejects(slowBoard().get("/api/issues/i1"), (e) => e.code === "board_off");
});

test("a write answered after the write limit is the board not answering", async () => {
  const board = createBoard({ baseUrl, ids: () => ({}), companyName: "Sthyra", timeoutMs: 80, writeTimeoutMs: 40 });
  await assert.rejects(board.post("/api/issues/i1/comments", { body: "Hello" }), (e) => e.code === "board_off");
});

test("passing only timeoutMs still sets the read limit; writes keep their own", async () => {
  const board = createBoard({ baseUrl, ids: () => ({}), companyName: "Sthyra", timeoutMs: 80 });
  await assert.rejects(board.get("/api/issues/i1"), (e) => e.code === "board_off");
  assert.deepEqual(await board.post("/api/issues/i1/comments", { body: "Hi" }), { ok: true, method: "POST" });
});

test("the defaults are 8 seconds for reads and 20 seconds for writes", () => {
  const src = readFileSync(new URL("../lib/board.mjs", import.meta.url), "utf8");
  assert.match(src, /timeoutMs = 8000, writeTimeoutMs = 20000 \}/);
});
