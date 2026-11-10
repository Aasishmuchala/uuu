// The home server's safety rules (CONTRACTS 9): Host, same origin, static and file escapes, body cap,
// headers, the error shape, and that an upstream answer is never reflected.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStubsHome } from "../lib/stubs.mjs";
import { call, writes } from "../lib/testing.mjs";

let h;
let pub;
let outside;

before(async () => {
  pub = mkdtempSync(join(tmpdir(), "uuu-home-public-"));
  outside = mkdtempSync(join(tmpdir(), "uuu-home-outside-"));
  writeFileSync(join(outside, "secret.txt"), "outside the public folder\n");
  writeFileSync(join(pub, "index.html"), "<!doctype html><title>t</title>\n");
  writeFileSync(join(pub, "app.js"), "export const x = 1;\n");
  symlinkSync(join(outside, "secret.txt"), join(pub, "link.txt"));
  symlinkSync(outside, join(pub, "linkdir"));
  h = await startStubsHome({ port: 0, publicDir: pub });
});
after(async () => {
  await h.close();
  rmSync(pub, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const isErrorShape = (r) => r.json && r.json.error && typeof r.json.error.message === "string"
  && typeof r.json.error.next === "string" && typeof r.json.error.code === "string";

test("listens on 127.0.0.1 only", () => {
  assert.equal(h.app.server.address().address, "127.0.0.1");
});

test("a wrong Host header gets 421", async () => {
  for (const host of ["evil.example", `evil.example:${h.port}`, `127.0.0.1:${h.port + 1}`, "127.0.0.1", `0.0.0.0:${h.port}`]) {
    const r = await call(h.url, "GET", "/api/state", { headers: { host } });
    assert.equal(r.status, 421, host);
    assert.ok(isErrorShape(r));
  }
  const ok = await call(h.url, "GET", "/healthz", { headers: { host: `localhost:${h.port}` } });
  assert.equal(ok.status, 200);
});

test("a POST without the home screen's headers gets 403 and reaches nothing", async () => {
  const before = writes(h.board).length;
  const cases = [
    { headers: { "content-type": "application/json" } },
    { headers: { "x-engine": "1" } },
    { headers: { "content-type": "text/plain", "x-engine": "1" } },
    { headers: { "content-type": "application/x-www-form-urlencoded", "x-engine": "1" } },
    { headers: { "content-type": "application/json", "x-engine": "1", origin: "http://evil.example" } },
    { headers: { "content-type": "application/json", "x-engine": "1", "sec-fetch-site": "cross-site" } },
  ];
  for (const c of cases) {
    const r = await call(h.url, "POST", "/api/goals", { bare: true, headers: c.headers, body: { text: "x" } });
    assert.equal(r.status, 403, JSON.stringify(c.headers));
    assert.ok(isErrorShape(r));
  }
  for (const m of ["PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const r = await call(h.url, m, "/api/goals", { bare: true });
    assert.equal(r.status, 403, m);
  }
  assert.equal(writes(h.board).length, before);
  const same = await call(h.url, "POST", "/api/goals", { body: { text: "Same origin works" }, headers: { origin: `http://127.0.0.1:${h.port}`, "sec-fetch-site": "same-origin" } });
  assert.equal(same.status, 201);
});

test("no CORS headers, and the safety headers on every answer", async () => {
  for (const [m, p] of [["GET", "/api/state"], ["GET", "/api/nothing-here"], ["GET", "/"], ["GET", "/app.js"], ["POST", "/api/goals"]]) {
    const r = await call(h.url, m, p, m === "POST" ? { bare: true } : {});
    assert.equal(r.headers["cache-control"], "no-store", p);
    assert.equal(r.headers["x-content-type-options"], "nosniff", p);
    assert.ok(!Object.keys(r.headers).some((k) => k.startsWith("access-control-")), p);
  }
  const html = await call(h.url, "GET", "/");
  assert.equal(html.headers["content-security-policy"], "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
});

test("static files: served from the public folder, no escapes", async () => {
  assert.equal((await call(h.url, "GET", "/")).status, 200);
  const js = await call(h.url, "GET", "/app.js");
  assert.equal(js.status, 200);
  assert.match(js.headers["content-type"], /javascript/);
  for (const p of ["/../config.json", "/..%2f..%2fconfig.json", "/%2e%2e/%2e%2e/config.json", "/link.txt", "/linkdir/secret.txt",
    "/app.js%00.txt", "/..\\config.json", "/.hidden", "/missing.js"]) {
    const r = await call(h.url, "GET", p);
    assert.equal(r.status, 404, p);
    assert.ok(!r.text.includes("outside the public folder"), p);
  }
});

test("a missing index.html gets a plain placeholder page", async () => {
  const empty = mkdtempSync(join(tmpdir(), "uuu-home-empty-"));
  const h2 = await startStubsHome({ port: 0, publicDir: empty });
  try {
    const r = await call(h2.url, "GET", "/");
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /text\/html/);
    assert.match(r.text, /not built yet/);
    assert.ok(r.headers["content-security-policy"]);
  } finally {
    await h2.close();
    rmSync(empty, { recursive: true, force: true });
  }
});

test("files: only inside tasks/company-work, links resolved", async () => {
  const tok = (s) => Buffer.from(s, "utf8").toString("base64url");
  const ok = await call(h.url, "GET", `/api/files/${tok("STH-2/cad/bracket.step")}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers["content-disposition"], /^attachment; filename="bracket.step"$/);
  assert.equal(ok.headers["content-type"], "application/octet-stream");

  const project = join(h.state, "tasks", "company-work");
  symlinkSync(join(h.state, "ids.json"), join(project, "STH-2", "ids-link.json"));
  symlinkSync(outside, join(project, "STH-2", "out"));
  mkdirSync(join(project, "STH-9"), { recursive: true });
  for (const rel of ["../ids.json", "STH-2/../../ids.json", "/etc/passwd", h.state + "/ids.json", "STH-2/ids-link.json",
    "STH-2/out/secret.txt", "STH-2", "STH-9", "STH-2//cad/bracket.step", "STH-2/./cad/bracket.step", "nothing.txt"]) {
    const r = await call(h.url, "GET", `/api/files/${tok(rel)}`);
    assert.equal(r.status, 404, rel);
    assert.ok(isErrorShape(r), rel);
  }
  for (const bad of ["not*base64", "%2e%2e", "..", "a%2Fb"]) {
    const r = await call(h.url, "GET", `/api/files/${bad}`);
    assert.equal(r.status, 404, bad);
  }
});

test("a body over 2 MB gets 413", async () => {
  const big = Buffer.alloc(2 * 1024 * 1024 + 10, 0x61);
  const r = await call(h.url, "POST", "/api/goals", { raw: big });
  assert.equal(r.status, 413);
  assert.ok(isErrorShape(r));

  // the same without a declared length (chunked)
  const r2 = await new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port: h.port, method: "POST", path: "/api/goals", agent: false,
      headers: { host: `127.0.0.1:${h.port}`, "content-type": "application/json", "x-engine": "1", "transfer-encoding": "chunked" },
    }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
    for (let i = 0; i < 5; i++) req.write(Buffer.alloc(600 * 1024, 0x61));
    req.end();
  });
  assert.equal(r2, 413);
});

test("errors: plain shape, unknown route 404, bad JSON 400", async () => {
  const r = await call(h.url, "GET", "/api/nothing-here");
  assert.equal(r.status, 404);
  assert.ok(isErrorShape(r));
  const bad = await call(h.url, "POST", "/api/goals", { raw: "{not json" });
  assert.equal(bad.status, 400);
  assert.ok(isErrorShape(bad));
  for (const x of [r, bad]) assert.doesNotMatch(x.json.error.message + x.json.error.next, /\b[45]\d\d\b|Error:|at .*\.mjs|paperclip|frappe/i);
});

test("an upstream answer is never passed on to the browser", async () => {
  const leaky = http.createServer((req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "UPSTREAM-SECRET-DETAIL at /Users/x/stack.js:1" }));
  });
  await new Promise((r) => leaky.listen(0, "127.0.0.1", r));
  const h3 = await startStubsHome({ port: 0, urls: { board: `http://127.0.0.1:${leaky.address().port}` } });
  try {
    for (const [m, p, body] of [["GET", "/api/goals"], ["GET", "/api/company"], ["POST", "/api/goals", { text: "hi" }], ["GET", "/api/inbox"]]) {
      const r = await call(h3.url, m, p, { body });
      assert.ok(!r.text.includes("UPSTREAM-SECRET-DETAIL"), `${m} ${p}`);
      assert.ok(!r.text.includes("stack.js"), `${m} ${p}`);
    }
    const r = await call(h3.url, "GET", "/api/goals");
    assert.equal(r.status, 502);
    assert.equal(r.json.error.code, "board_error");
  } finally {
    await h3.close();
    leaky.close();
  }
});

test("no request to the board ever carries an Authorization header", async () => {
  await call(h.url, "GET", "/api/inbox");
  await call(h.url, "GET", "/api/company");
  assert.ok(h.board.requests.length > 0);
  assert.ok(h.board.requests.every((r) => !("authorization" in r.headers)));
});
