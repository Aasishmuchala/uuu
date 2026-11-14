// The App Studio host, the app's way into the engine (PLAN-V5 K19): its engine socket, each
// allowed route passed with a fresh token and only the allowed headers, everything else 404,
// the relay's limits, and no token in any log line. A fake door and a fake relay on port 0
// check each token's kind, subject and secret as the real ones do.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { renameSync } from "node:fs";
import { ENGINE_CODES, ENGINE_ROUTES, engineRoute } from "../host.mjs";
import { checkToken } from "../../relay/token.mjs";
import {
  appOutput, fakeParts, fixtureSpawner, freePorts, header, jsonOf, makeWorld, own, send, startHost, waitFor,
} from "./fixture-app/harness.mjs";

// ---- the routes, pure ----------------------------------------------------------------------

const BOTH = ["generate", "relay"];

test("each allowed route, by method and raw path, names its part", () => {
  const cases = [
    ["GET", "/gen/app/models", "models", "generate"], ["POST", "/gen/app/estimate", "estimate", "generate"],
    ["POST", "/gen/app/inputs", "inputs", "generate"], ["POST", "/gen/app/jobs", "jobs", "generate"],
    ["GET", "/gen/app/jobs/j0123abcdef_-Z", "job", "generate"], ["GET", "/gen/app/jobs/j01/output", "output", "generate"],
    ["GET", "/gen/app/allowance", "allowance", "generate"], ["POST", "/v1/messages", "messages", "relay"],
  ];
  for (const [method, path, name, target] of cases) {
    const r = engineRoute(method, path, BOTH);
    assert.ok(r, `${method} ${path}`);
    assert.equal(r.name, name);
    assert.equal(r.target, target);
  }
  assert.equal(ENGINE_ROUTES.length, 8);
});

test("anything else is no route: other paths, methods, queries, escapes, and a part the manifest does not name", () => {
  const none = [
    ["GET", "/gen/jobs"], ["POST", "/gen/jobs"], ["POST", "/gen/inputs"], ["POST", "/gen/owner/balance"], ["GET", "/gen/health"],
    ["GET", "/gen/app/models?x=1"], ["GET", "/gen/app/models/"], ["GET", "//gen/app/models"], ["GET", "/%67en/app/models"],
    ["HEAD", "/gen/app/models"], ["POST", "/gen/app/models"], ["GET", "/gen/app/jobs/a.b"], ["GET", "/gen/app/jobs/../x"],
    ["GET", "/gen/app/jobs/a%2Fb/output"], ["GET", `/gen/app/jobs/${"a".repeat(81)}`], ["GET", "/v1/messages"],
    ["POST", "/v1/messages/count_tokens"], ["POST", "/v1/responses"], ["GET", "/relay/health"], ["POST", "/v1/messages?beta=1"],
    ["GET", "/"], ["GET", "*"],
  ];
  for (const [method, path] of none) assert.equal(engineRoute(method, path, BOTH), null, `${method} ${path}`);
  assert.equal(engineRoute("POST", "/v1/messages", ["generate"]), null, "no relay in the manifest");
  assert.equal(engineRoute("GET", "/gen/app/models", ["relay"]), null, "no generate in the manifest");
  assert.equal(engineRoute("GET", "/gen/app/models", []), null);
  assert.equal(ENGINE_CODES.app_not_found[0], 404);
  for (const [code, [status]] of Object.entries(ENGINE_CODES)) if (code !== "app_not_found") assert.equal(status, 403, code);
});

// ---- against a running host ---------------------------------------------------------------

let w;
let parts;
let host;
let lines;
let port;
let t = Date.UTC(2026, 10, 13, 6, 0, 0);
const clock = () => t;
let sock;

before(async () => {
  port = await freePorts(3);
  w = makeWorld({ apps: [{ slug: "fix", port }, { slug: "plain", port: port + 1, engine: ["generate"] }], portFirst: port, portLast: port + 2 });
  parts = await fakeParts(w, { now: clock });
  w.switches({ fix: true, plain: true });
  ({ host, lines } = await startHost(w, { spawnApp: fixtureSpawner(w), now: clock }));
  await waitFor(() => host.app("fix")?.state === "on" && host.app("plain")?.state === "on", 10000);
  assert.equal(host.app("fix").state, "on", lines.join("\n"));
  sock = (slug = "fix") => join(w.paths.appsRun, slug, "engine.sock");
});
after(async () => {
  if (host) await host.close();
  if (parts) await parts.close();
  if (w) w.cleanup();
});

// As the app's own client asks: Node's http.request over a socket always names a Host.
const app = (path, opts = {}) => send({ socketPath: sock(opts.slug), path, method: opts.method || "GET",
  headers: { Host: "localhost", ...(opts.headers || {}) }, body: opts.body });
const lastCall = () => parts.calls[parts.calls.length - 1];
const names = (raw) => raw.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase()).sort();
const HOSTILE = { Cookie: "c=1", Authorization: "Bearer stolen", "X-Evil": "1", "Proxy-Authorization": "Basic x", Host: "evil.test",
  "X-Forwarded-For": "1.2.3.4", Accept: "application/json" };

test("each generate route reaches the door with a token of this app (kind p there) and only the allowed headers", async () => {
  const routes = [
    ["GET", "/gen/app/models"], ["POST", "/gen/app/estimate", "{\"items\":[]}", "application/json"],
    ["POST", "/gen/app/inputs", Buffer.alloc(2048, 1), "image/jpeg"], ["POST", "/gen/app/jobs", "{\"model\":\"gen4_turbo\"}", "application/json"],
    ["GET", "/gen/app/jobs/jabc123"], ["GET", "/gen/app/allowance"],
  ];
  for (const [method, path, body, type] of routes) {
    const before = parts.calls.length;
    const r = await app(path, { method, body, headers: { ...HOSTILE, ...(type ? { "Content-Type": type } : {}) } });
    assert.equal(r.status, method === "POST" && path === "/gen/app/jobs" ? 202 : 200, `${path}: ${r.body}`);
    assert.equal(parts.calls.length, before + 1);
    const c = lastCall();
    assert.equal(c.part, "door");
    assert.equal(c.url, path);
    assert.equal(c.method, method);
    assert.deepEqual(c.who, { kind: "p", slug: "app-fix", app: "fix", subject: "app-fix" });
    const want = ["accept", "authorization", "connection", "host", ...(body ? ["content-length", "content-type"] : [])].sort();
    assert.deepEqual(names(c.headers), want, path);
    assert.deepEqual(header(c.headers, "host"), [new URL(w.cfg.urls.generate).host], "the door's own address, not the app's");
    assert.equal(c.bytes, body ? Buffer.byteLength(body) : 0);
    if (type) assert.deepEqual(header(c.headers, "content-type"), [type]);
    // Only the status, Content-Type and Content-Length come back.
    assert.deepEqual(names(r.headers).filter((n) => !["connection", "date", "keep-alive"].includes(n)), ["content-length", "content-type"]);
    assert.equal(jsonOf(r).app, "fix");
  }
});

test("the token: kind t, subject app-<slug>, 120 seconds, keyed with the door's secret only, made fresh for each call", async () => {
  await app("/gen/app/models");
  const first = lastCall().token;
  assert.match(first, /^v1\.t\.app-fix\.\d+\.[0-9a-f]{64}$/);
  assert.equal(Number(first.split(".")[3]), Math.floor(t / 1000) + 120);
  assert.deepEqual(checkToken(w.doorSecret, first, t), { kind: "t", subject: "app-fix", exp: Math.floor(t / 1000) + 120 });
  assert.equal(checkToken(w.relaySecret, first, t), null, "a door token is nothing at the relay");
  assert.equal(checkToken(w.doorSecret, first, t + 121_000), null, "dead after 120 seconds");
  t += 5000;
  await app("/gen/app/models");
  assert.notEqual(lastCall().token, first);
  await app("/gen/app/models", { slug: "plain" });
  assert.equal(lastCall().who.app, "plain", "each app's socket is its own identity");
});

test("a picture's output is streamed back with its length; a body over the route's limit is refused before the door", async () => {
  const r = await app("/gen/app/jobs/j9/output", { headers: { Accept: "*/*" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 5 * 1024 * 1024);
  assert.deepEqual(header(r.headers, "content-type"), ["video/mp4"]);
  assert.deepEqual(header(r.headers, "content-length"), [String(5 * 1024 * 1024)]);
  assert.deepEqual(header(r.headers, "set-cookie"), []);
  const before = parts.calls.length;
  const big = await app("/gen/app/inputs", { method: "POST", body: Buffer.alloc(4 * 1024 * 1024 + 1), headers: { "Content-Type": "image/png" } });
  assert.equal(big.status, 403);
  assert.equal(jsonOf(big).code, "app_too_big");
  const job = await app("/gen/app/jobs", { method: "POST", body: Buffer.alloc(64 * 1024 + 1, 32), headers: { "Content-Type": "application/json" } });
  assert.equal(jsonOf(job).code, "app_too_big");
  assert.equal(parts.calls.length, before);
});

test("the relay: POST /v1/messages reaches it with a relay token of this app; the body is passed as the app sent it", async () => {
  const body = JSON.stringify({ model: "whatever-the-app-named", max_tokens: 10, messages: [{ role: "user", content: "hi" }] });
  const r = await app("/v1/messages", { method: "POST", body, headers: { ...HOSTILE, "Content-Type": "application/json" } });
  assert.equal(r.status, 200, r.body.toString());
  const c = lastCall();
  assert.equal(c.part, "relay");
  assert.deepEqual(c.who, { kind: "t", subject: "app-fix", exp: Math.floor(t / 1000) + 120 });
  assert.equal(checkToken(w.doorSecret, c.token, t), null, "a relay token is nothing at the door");
  assert.equal(c.bytes, Buffer.byteLength(body));
  assert.deepEqual(names(c.headers), ["accept", "authorization", "connection", "content-length", "content-type", "host"]);
  assert.match(jsonOf(r).content[0].text, /hello app-fix/);
  assert.deepEqual(header(r.headers, "x-relay"), []);
});

test("the relay takes JSON only, at most 32 MB", async () => {
  const before = parts.calls.length;
  const text = await app("/v1/messages", { method: "POST", body: "{}", headers: { "Content-Type": "text/plain" } });
  assert.equal(text.status, 403);
  assert.equal(jsonOf(text).code, "app_refused");
  const two = await app("/v1/messages", { method: "POST", body: "{}", headers: { "Content-Type": ["application/json", "application/json"] } });
  assert.equal(jsonOf(two).code, "app_refused");
  const big = await app("/v1/messages", { method: "POST", body: Buffer.alloc(32 * 1024 * 1024 + 1, 32), headers: { "Content-Type": "application/json" } });
  assert.equal(big.status, 403);
  assert.equal(jsonOf(big).code, "app_too_big");
  assert.equal(parts.calls.length, before, "nothing reached the relay");
});

test("an app whose manifest does not name the relay gets 404 at /v1/messages; every other address is 404 too", async () => {
  const before = parts.calls.length;
  const r = await app("/v1/messages", { slug: "plain", method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  assert.equal(r.status, 404);
  assert.deepEqual(jsonOf(r), { error: { message: ENGINE_CODES.app_not_found[1] }, code: "app_not_found" });
  for (const [method, path] of [["GET", "/gen/jobs"], ["POST", "/gen/owner/balance"], ["GET", "/gen/app/models?x=1"], ["GET", "/relay/health"],
    ["POST", "/v1/responses"], ["GET", "/gen/app/jobs/a.b"], ["GET", "/gen/health"], ["GET", "/healthz"]]) {
    const x = await app(path, { method, body: method === "POST" ? "{}" : undefined, headers: { "Content-Type": "application/json" } });
    assert.equal(x.status, 404, `${method} ${path}`);
    assert.equal(jsonOf(x).code, "app_not_found");
  }
  assert.equal(parts.calls.length, before);
});

test("no secret → app_engine_off, and nothing is sent; a part that does not answer → app_engine_off", async () => {
  const before = parts.calls.length;
  renameSync(w.paths.generateSecret, `${w.paths.generateSecret}.away`);
  try {
    const r = await app("/gen/app/models");
    assert.equal(r.status, 403);
    assert.deepEqual(jsonOf(r), { error: { message: "The engine part this app needs is off." }, code: "app_engine_off" });
  } finally {
    renameSync(`${w.paths.generateSecret}.away`, w.paths.generateSecret);
  }
  assert.equal(parts.calls.length, before);
  const real = w.cfg.urls.relay;
  // The relay's address is fixed when the host starts, so a closed one is shown with the real
  // relay stopped for a moment.
  await new Promise((ok) => parts.relay.close(ok));
  parts.relay.closeAllConnections();
  try {
    const r = await app("/v1/messages", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    assert.equal(r.status, 403);
    assert.equal(jsonOf(r).code, "app_engine_off");
  } finally {
    await new Promise((ok) => parts.relay.listen(Number(new URL(real).port), "127.0.0.1", ok));
  }
});

test("the relay's limits: 60 calls an hour, 300 a day, per app, then app_limited with K19's sentence", async () => {
  const ask = () => app("/v1/messages", { method: "POST", body: "{\"messages\":[]}", headers: { "Content-Type": "application/json" } });
  t += 2 * 24 * 3600_000; // a fresh day: the calls above are out of every window
  let ok = 0;
  for (let i = 0; i < 60; i += 1) if ((await ask()).status === 200) ok += 1;
  assert.equal(ok, 60);
  const sixtyFirst = await ask();
  assert.equal(sixtyFirst.status, 403);
  assert.deepEqual(jsonOf(sixtyFirst), { error: { message: "This app has asked to think too often today." }, code: "app_limited" });
  t += 3600_000 + 1000;
  assert.equal((await ask()).status, 200, "a new hour");
  for (let h = 0; h < 4; h += 1) {
    for (let i = 0; i < (h === 0 ? 59 : 60); i += 1) assert.equal((await ask()).status, 200);
    t += 3600_000 + 1000;
  }
  const over = await ask();
  assert.equal(jsonOf(over).code, "app_limited", "300 in a day");
  t += 18 * 3600_000;
  assert.equal(jsonOf(await ask()).code, "app_limited", "still within a day of the first calls");
  t += 2 * 3600_000;
  assert.equal((await ask()).status, 200, "a day after the first calls, they no longer count");
  // Another app's thinking is its own (plain has no relay at all, so fix's calls count only for fix).
  assert.equal((await app("/gen/app/models", { slug: "plain" })).status, 200);
});

test("the relay's count is kept across a restart of the host", async () => {
  t += 2 * 24 * 3600_000;
  const ask = (h) => send({ socketPath: sock(), path: "/v1/messages", method: "POST", body: "{}", headers: { Host: "localhost", "Content-Type": "application/json" } }).then((r) => [r, h]);
  for (let i = 0; i < 60; i += 1) assert.equal((await ask())[0].status, 200);
  await host.close();
  ({ host, lines } = await startHost(w, { spawnApp: fixtureSpawner(w), now: clock }));
  await waitFor(() => host.app("fix")?.state === "on", 10000);
  const [r] = await ask();
  assert.equal(jsonOf(r).code, "app_limited");
});

test("many at once: at most 16 engine calls per app wait on the engine together", async () => {
  // The door answers at once, so the cap shows only with calls held open: outputs read slowly.
  const held = [];
  const http = await import("node:http");
  for (let i = 0; i < 16; i += 1) {
    held.push(await new Promise((ok) => {
      const req = http.request({ socketPath: sock(), path: `/gen/app/jobs/h${i}/output`, agent: false }, (res) => ok({ req, res }));
      req.end();
    }));
  }
  const extra = await app("/gen/app/models");
  assert.equal(extra.status, 403);
  assert.equal(jsonOf(extra).code, "app_busy");
  for (const h of held) h.res.destroy();
  await waitFor(async () => (await app("/gen/app/models")).status === 200, 3000);
  assert.equal((await app("/gen/app/models")).status, 200);
});

test("the whole way: the owner's browser → the app → its engine socket → the door", async () => {
  const r = await send({ port, method: "POST", path: "/x", headers: { ...own(port), Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json" },
    body: JSON.stringify({ method: "POST", path: "/gen/app/estimate", body: { items: [{ model: "gen4_turbo" }] } }) });
  assert.equal(r.status, 200, r.body.toString());
  const got = jsonOf(r);
  assert.equal(got.status, 200);
  assert.equal(JSON.parse(got.body).app, "fix");
  assert.deepEqual(names(lastCall().headers), ["accept", "authorization", "connection", "content-length", "content-type", "host"]);
  assert.notEqual(header(lastCall().headers, "authorization")[0], "Bearer stolen");
});

test("log lines: the time, the app, the route's name and the status; never a token, a secret, a header or a body", async () => {
  await app("/gen/app/jobs/jlog/output");
  await app("/gen/app/models");
  await app("/gen/jobs");
  const all = lines.join("\n");
  assert.match(all, /^\d{4}-\d\d-\d\dT[\d:.]+Z app fix models 200$/m);
  assert.match(all, /^\d{4}-\d\d-\d\dT[\d:.]+Z app fix unknown 404 app_not_found$/m);
  for (const text of [all, appOutput(w, "fix"), appOutput(w, "plain")]) {
    assert.doesNotMatch(text, /v1\.t\.|Bearer|[0-9a-f]{64}/, "no token or secret");
    assert.ok(!text.includes(w.doorSecret) && !text.includes(w.relaySecret));
    assert.doesNotMatch(text, /jlog|gen\/app|whatever-the-app-named/, "no path or body");
  }
});
