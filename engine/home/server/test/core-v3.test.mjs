// The core, changed (C3 33.1): a POST or DELETE route may name its own body limit, up to 16 MB; the
// default stays 2 MB. The route is found before the body is read, and the order of refusals holds:
// Host, then the same-origin headers, then the route (404 before any body is read), then the body.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SERVER_DIR } from "../lib/app.mjs";
import { createRouter } from "../lib/router.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

const MB = 1024 * 1024;

// A module folder: the core's health route (symlinked, for modulesFailed) plus the test's own modules.
function moduleDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "uuu-home-core3-"));
  mkdirSync(join(dir, "routes"));
  symlinkSync(join(SERVER_DIR, "routes", "health.mjs"), join(dir, "routes", "health.mjs"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

// A JSON body of about `bytes` bytes: {"s":"aaa..."}.
function jsonOf(bytes) {
  return Buffer.from(JSON.stringify({ s: "a".repeat(bytes - 8) }));
}

// Send `total` bytes with a declared length, `sendFirst` of them before waiting for the answer (the rest only
// if the server is still reading). Resolves with the status, the parsed answer, and how many bytes went out
// before the answer came. A reset after the answer is not a failure: the server may close a long upload.
function rawSend(port, { method = "POST", path, headers = {}, total, sendFirst = total, chunk = 256 * 1024 }) {
  return new Promise((resolve, reject) => {
    let sent = 0;
    let answered = false;
    let status = null;
    let sentAtAnswer = null;
    const parts = [];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const text = Buffer.concat(parts).toString("utf8");
      let json = null;
      try { json = JSON.parse(text); } catch { json = null; }
      resolve({ status, json, sentAtAnswer });
    };
    const req = http.request({
      host: "127.0.0.1", port, method, path, agent: false,
      headers: { host: `127.0.0.1:${port}`, "content-length": total, ...headers },
    }, (res) => {
      answered = true;
      status = res.statusCode;
      sentAtAnswer = sent;
      res.on("data", (c) => parts.push(c));
      res.on("end", () => { req.destroy(); finish(); });
      res.on("error", () => finish());
      res.on("aborted", () => finish());
      res.on("close", () => finish());
    });
    req.on("error", (e) => { if (answered) return; reject(e); });
    const pump = () => {
      while (!answered && sent < sendFirst) {
        const n = Math.min(chunk, sendFirst - sent);
        sent += n;
        if (!req.write(Buffer.alloc(n, 0x61))) { req.once("drain", pump); return; }
      }
      if (sent >= total) req.end();
    };
    pump();
  });
}

let h;
let dir;
before(async () => {
  dir = moduleDir({
    "routes/big.mjs": `export default function register(app) {
      app.post("/api/big", (ctx) => ({ got: ctx.body.s.length }), { maxBody: ${3 * MB} });
      app.delete("/api/big/:id", (ctx) => ({ got: ctx.body ? ctx.body.s.length : 0 }), { maxBody: ${3 * MB} });
      app.post("/api/plain", (ctx) => ({ got: ctx.body.s.length }));
      app.post("/api/tiny", (ctx) => ({ got: ctx.body }), { maxBody: 16 });
    }\n`,
    "routes/huge.mjs": `export default function register(app) {
      app.get("/api/huge-ok", () => ({ ok: true }));
      app.post("/api/huge", () => ({ ok: true }), { maxBody: ${20 * MB} });
    }\n`,
    "routes/edge.mjs": `export default function register(app) {
      app.post("/api/edge", () => ({ ok: true }), { maxBody: ${16 * MB} });
    }\n`,
    "routes/zero.mjs": `export default function register(app) { app.post("/api/zero", () => ({}), { maxBody: 0 }); }\n`,
    "routes/half.mjs": `export default function register(app) { app.post("/api/half", () => ({}), { maxBody: 1.5 }); }\n`,
    "routes/text.mjs": `export default function register(app) { app.post("/api/text", () => ({}), { maxBody: "3000000" }); }\n`,
    "routes/over.mjs": `export default function register(app) { app.delete("/api/over", () => ({}), { maxBody: ${16 * MB + 1} }); }\n`,
    "routes/notobj.mjs": `export default function register(app) { app.post("/api/notobj", () => ({}), 3000000); }\n`,
  });
  h = await startStubsHome({ port: 0, moduleDirs: [dir], log: () => {} });
});
after(async () => {
  await h.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a route with 3 MB accepts 2.5 MB and refuses 3.5 MB with 413", async () => {
  const ok = await call(h.url, "POST", "/api/big", { raw: jsonOf(2.5 * MB) });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.got, 2.5 * MB - 8);

  const del = await call(h.url, "DELETE", "/api/big/x", { raw: jsonOf(2.5 * MB) });
  assert.equal(del.status, 200);
  assert.equal(del.json.got, 2.5 * MB - 8);

  const no = await rawSend(h.port, {
    path: "/api/big", total: 3.5 * MB, headers: { "content-type": "application/json", "x-engine": "1" },
  });
  assert.equal(no.status, 413);
  assert.deepEqual(Object.keys(no.json.error).sort(), ["code", "message", "next"]);
  assert.equal(no.json.error.code, "too_large");
  assert.match(no.json.error.next, /3 MB/);

  // the same without a declared length (chunked): refused once the count passes 3 MB
  const chunked = await new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port: h.port, method: "POST", path: "/api/big", agent: false,
      headers: { host: `127.0.0.1:${h.port}`, "content-type": "application/json", "x-engine": "1", "transfer-encoding": "chunked" },
    }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
    for (let i = 0; i < 7; i++) req.write(Buffer.alloc(512 * 1024, 0x61));
    req.end();
  });
  assert.equal(chunked, 413);
});

test("a small own limit is held too", async () => {
  assert.equal((await call(h.url, "POST", "/api/tiny", { body: { a: 1 } })).status, 200);
  const r = await call(h.url, "POST", "/api/tiny", { body: { a: "x".repeat(40) } });
  assert.equal(r.status, 413);
  assert.equal(r.json.error.code, "too_large");
});

test("a plain route still refuses 2.1 MB", async () => {
  assert.equal((await call(h.url, "POST", "/api/plain", { raw: jsonOf(1.9 * MB) })).status, 200);
  const r = await rawSend(h.port, {
    path: "/api/plain", total: Math.round(2.1 * MB), headers: { "content-type": "application/json", "x-engine": "1" },
  });
  assert.equal(r.status, 413);
  assert.equal(r.json.error.code, "too_large");
  assert.match(r.json.error.next, /2 MB/);
});

test("20 MB to an unknown address is answered 404, before the body is read", async () => {
  const headers = { "content-type": "application/json", "x-engine": "1" };
  // only 1 MB of the 20 is sent, then the client waits: the server answers without the rest
  const early = await rawSend(h.port, { path: "/api/nowhere", total: 20 * MB, sendFirst: 1 * MB, headers });
  assert.equal(early.status, 404);
  assert.equal(early.json.error.code, "not_found");
  assert.ok(early.sentAtAnswer <= 1 * MB);

  // the whole 20 MB, sent as fast as the server takes it: dropped, never kept, then answered
  const full = await rawSend(h.port, { path: "/api/nowhere", total: 20 * MB, headers });
  assert.equal(full.status, 404);

  // an address outside /api/ and a route that knows only GET are refused the same way
  const page = await rawSend(h.port, { path: "/some/page", total: 20 * MB, sendFirst: 1 * MB, headers });
  assert.equal(page.status, 404);
  const getOnly = await rawSend(h.port, { path: "/api/health", total: 20 * MB, sendFirst: 1 * MB, headers });
  assert.equal(getOnly.status, 404);

  // the home screen still answers afterwards
  assert.equal((await call(h.url, "GET", "/healthz")).status, 200);
});

test("a request without X-Engine and a large body is answered 403, even on a route with its own limit", async () => {
  for (const path of ["/api/big", "/api/plain", "/api/nowhere"]) {
    const r = await rawSend(h.port, {
      path, total: 20 * MB, sendFirst: 1 * MB, headers: { "content-type": "application/json" },
    });
    assert.equal(r.status, 403, path);
    assert.equal(r.json.error.code, "not_same_origin", path);
    assert.ok(r.sentAtAnswer <= 1 * MB, path);
  }
  // Host is checked before everything else, the route's own limit included
  const wrongHost = await call(h.url, "POST", "/api/big", { body: { s: "a" }, headers: { host: "evil.example:80" } });
  assert.equal(wrongHost.status, 421);
});

test("a maxBody of 20 MB, or any value that is not whole bytes from 1 to 16 MB, fails registration", async () => {
  const health = (await call(h.url, "GET", "/api/health")).json;
  const failed = health.modulesFailed.map((m) => m.file).sort();
  assert.deepEqual(failed, ["routes/half.mjs", "routes/huge.mjs", "routes/notobj.mjs", "routes/over.mjs", "routes/text.mjs", "routes/zero.mjs"]);
  for (const m of health.modulesFailed) assert.equal(typeof m.error, "string");

  // a module that failed has none of its routes, even the ones registered before the bad one
  assert.equal((await call(h.url, "GET", "/api/huge-ok")).status, 404);
  assert.equal((await call(h.url, "POST", "/api/huge", { body: {} })).status, 404);
  // 16 MB exactly is allowed
  assert.equal((await call(h.url, "POST", "/api/edge", { body: {} })).status, 200);
});

test("the router keeps each route's limit and gives null for the default", () => {
  const r = createRouter();
  r.add("POST", "/api/a", () => {}, null, { maxBody: 3 * MB });
  r.add("POST", "/api/b", () => {});
  r.add("DELETE", "/api/a", () => {}, null, {});
  assert.equal(r.match("POST", "/api/a").maxBody, 3 * MB);
  assert.equal(r.match("POST", "/api/b").maxBody, null);
  assert.equal(r.match("DELETE", "/api/a").maxBody, null);
  for (const bad of [0, -1, 1.5, "3", NaN, Infinity, 16 * MB + 1, 20 * MB, null]) {
    assert.throws(() => r.add("POST", `/api/x${String(bad).replace(/\W/g, "")}`, () => {}, null, { maxBody: bad }), String(bad));
  }
  for (const bad of [null, 5, "x", []]) {
    assert.throws(() => r.add("POST", "/api/y", () => {}, null, bad), String(bad));
  }
});
