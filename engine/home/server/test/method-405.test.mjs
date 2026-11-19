// A wrong method on an address that exists is 405 with Allow, in the home's error shape (S-routes-f430985f), after
// the host and same-origin checks exactly as before; an unknown address is still 404; a body is never read.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startStubsHome } from "../lib/stubs.mjs";
import { call, writes } from "../lib/testing.mjs";

let h;
before(async () => { h = await startStubsHome({ port: 0 }); });
after(async () => { await h.close(); });

const isErrorShape = (r) => r.json && r.json.error && typeof r.json.error.message === "string"
  && typeof r.json.error.next === "string" && r.json.error.code === "wrong_method";

test("a wrong method on a route that exists is 405 with Allow, its body unread", async () => {
  const before = writes(h.board).length;
  for (const [m, p, allow] of [
    ["PUT", "/api/goals", "GET, POST"], ["PATCH", "/api/goals", "GET, POST"], ["DELETE", "/api/goals", "GET, POST"],
    ["OPTIONS", "/api/goals", "GET, POST"], ["POST", "/api/health", "GET"], ["DELETE", "/api/company", "GET"],
  ]) {
    const r = await call(h.url, m, p, { body: { text: "never read" } });
    assert.equal(r.status, 405, `${m} ${p}`);
    assert.ok(isErrorShape(r), r.text);
    assert.equal(r.headers.allow.split(", ").sort().join(", "), allow, `${m} ${p}`);
  }
  assert.equal(writes(h.board).length, before, "nothing reached the board");
});

test("HEAD on a GET route is 405 with Allow GET and no body; the GET is not run", async () => {
  const r = await call(h.url, "HEAD", "/api/health");
  assert.equal(r.status, 405);
  assert.equal(r.headers.allow, "GET");
  assert.equal(r.text, "");
});

test("the right method still works, an unknown address is still 404", async () => {
  assert.equal((await call(h.url, "GET", "/api/health")).status, 200);
  for (const m of ["GET", "HEAD", "POST", "PUT"]) {
    const r = await call(h.url, m, "/api/nothing-here", { body: m === "GET" || m === "HEAD" ? undefined : {} });
    assert.equal(r.status, 404, m);
    assert.equal(r.headers.allow, undefined, m);
  }
});

test("a cross-origin wrong method is still the same-origin refusal (403), and a wrong Host is still 421", async () => {
  const bare = await call(h.url, "PUT", "/api/goals", { body: {}, bare: true });
  assert.equal(bare.status, 403);
  assert.equal(bare.json.error.code, "not_same_origin");
  assert.equal(bare.headers.allow, undefined);
  const evil = await call(h.url, "DELETE", "/api/goals", { body: {}, headers: { origin: "http://evil.example" } });
  assert.equal(evil.status, 403);
  const host = await call(h.url, "PUT", "/api/goals", { body: {}, headers: { host: "evil.example" } });
  assert.equal(host.status, 421);
});
