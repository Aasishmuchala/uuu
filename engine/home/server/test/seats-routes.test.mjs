// The seats' two lists (PLAN-DESKTOP T7, DW4): every POST and DELETE route sorted into exactly one of DESK_MAY and
// MAC_ONLY; a seat's change refused unless it is a desk seat on a DESK_MAY route, its body unread; the reads a seat
// never gets; and Needs you's actions sorted again once the item is known. Free ports from 3360 up, a temporary state.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import { createHome, SERVER_DIR } from "../lib/app.mjs";
import { loadModules } from "../lib/loader.mjs";
import { DESK_MAY, inboxSeatMay, MAC_ONLY, SEAT_HIDDEN, seatPorts } from "../lib/seats.mjs";
import { STUB_URLS, startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

const MB = 1024 * 1024;
const FP = `SHA256:${"B".repeat(43)}`;
const MAC_HOST = "127.0.0.1:3200";
const ORIGIN = "http://127.0.0.1:3200";

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
async function freeRow(from, to) {
  for (let p = from; p + 4 <= to; p++) {
    let ok = true;
    for (let i = 0; i < 5 && ok; i++) ok = await portFree(p + i);
    if (ok) return p;
  }
  throw new Error("no five free ports in a row");
}

// Every route the home server's own modules register, as "<METHOD> <pattern>".
async function allRoutes() {
  const list = [];
  const router = { add: (method, pattern) => list.push(`${method} ${pattern}`), removeOwner() {} };
  const loaded = await loadModules({ dirs: [SERVER_DIR], router, log: () => {} });
  assert.deepEqual(loaded.failed, []);
  return list;
}
// What is wrong with the sorting, one line each; empty when every change is in exactly one list and every name is real.
function sortingProblems(routes) {
  const problems = [];
  const lists = [...DESK_MAY, ...MAC_ONLY];
  for (const r of routes) {
    if (r.startsWith("GET ")) continue;
    const n = lists.filter((x) => x === r).length;
    if (n === 0) problems.push(`Sort this route in seats.mjs: ${r}`);
    if (n > 1) problems.push(`This route is in both lists of seats.mjs, or twice: ${r}`);
  }
  for (const x of lists) if (!routes.includes(x)) problems.push(`seats.mjs names a route that does not exist: ${x}`);
  for (const x of SEAT_HIDDEN) if (!x.startsWith("GET ") || !routes.includes(x)) problems.push(`SEAT_HIDDEN names a read that does not exist: ${x}`);
  return problems;
}

let h;
let app;
let ports;

const seat = (n, role) => ({ n, name: "Windows PC", role, state: "allowed", fingerprint: FP, added: "2026-11-19T10:00:00.000Z" });
function writeSeats(seats) {
  const dir = join(h.state, "remote");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "seats.json"), JSON.stringify({ seats }), { mode: 0o600 });
}
const onSeat = (n, method, path, opts = {}) => call(`http://127.0.0.1:${ports[n - 1]}`, method, path,
  { ...opts, headers: { host: MAC_HOST, ...(method === "GET" || method === "HEAD" ? {} : { origin: ORIGIN, "sec-fetch-site": "same-origin" }), ...(opts.headers || {}) } });
const bytesOf = (file) => (existsSync(file) ? readFileSync(file) : null);

before(async () => {
  h = await startStubsHome({ port: 0 });
  const first = await freeRow(3360, 3399);
  const config = { ...h.config, ports: { ...h.config.ports, seats: first }, remote: { seats: 5 } };
  app = await createHome({ config, urls: { ...STUB_URLS, board: h.config.urls.board, bench: h.config.urls.bench }, seats: true, log: () => {} });
  await app.listen(0);
  ports = seatPorts(config).map((s) => s.port);
  assert.equal(app.seatServers.length, 5);
  writeSeats([seat(1, "desk"), seat(2, "view")]);
});
after(async () => {
  await app.close();
  await h.close();
});

test("every non-GET route is in exactly one list, and no list names a route that does not exist (vector 10)", async () => {
  const routes = await allRoutes();
  assert.deepEqual(sortingProblems(routes), []);
  assert.equal(routes.filter((r) => !r.startsWith("GET ")).length, DESK_MAY.length + MAC_ONLY.length);
  assert.ok(Object.isFrozen(DESK_MAY) && Object.isFrozen(MAC_ONLY) && Object.isFrozen(SEAT_HIDDEN));
  for (const x of [...DESK_MAY, ...MAC_ONLY]) assert.match(x, /^(POST|PUT|PATCH|DELETE) \/[^\s]*$/);
  // The check itself: a route added without sorting fails it, by name.
  assert.deepEqual(sortingProblems([...routes, "POST /api/new-thing"]), ["Sort this route in seats.mjs: POST /api/new-thing"]);
  assert.deepEqual(sortingProblems([...routes, "DELETE /api/goals/:id"]), ["Sort this route in seats.mjs: DELETE /api/goals/:id"]);
});

test("the money-and-safety routes are all on the Mac", () => {
  const mac = new Set(MAC_ONLY);
  for (const r of [
    "POST /api/apps/:slug/switch", "POST /api/apps/:slug/allowance", "POST /api/generation/key", "POST /api/generation/test",
    "POST /api/generation/caps", "POST /api/generation/runway/begin", "POST /api/generation/higgsfield/begin", "POST /api/models/key",
    "POST /api/models/test", "POST /api/models/pick", "POST /api/web/switch", "POST /api/web/search-key", "POST /api/viewer/switch",
    "POST /api/brain-door/switch", "POST /api/health/prove", "POST /api/jobs/:department/:id/start", "POST /api/setup/skip",
    "POST /api/company/agents/:id/pause", "POST /api/routines/:id/run",
  ]) assert.ok(mac.has(r), r);
  for (const r of DESK_MAY) assert.doesNotMatch(r, /key|test|switch|allowance|caps|rate|models|prove|begin|forget|setup|jobs|routines|lessons|thinks/, r);
});

test("a switch from a desk seat with the right Origin is refused, and the switches files are unchanged (vector 5)", async () => {
  const files = [app.config.paths.appsState, app.config.paths.doorsState];
  const before = files.map(bytesOf);
  const r = await onSeat(1, "POST", "/api/apps/render-to-film/switch", { body: { on: true } });
  assert.equal(r.status, 403);
  assert.deepEqual(r.json.error, { message: "This is done on the Mac.", next: "Keys, switches, sign-ins and money stay on the Mac that runs the engine.", code: "mac_only" });
  for (const path of ["/api/generation/key", "/api/models/test", "/api/web/switch", "/api/health/prove", "/api/apps/render-to-film/allowance"]) {
    const x = await onSeat(1, "POST", path, { body: { on: true, key: "x", dollars: 5 } });
    assert.equal(x.status, 403, path);
    assert.equal(x.json.error.code, "mac_only", path);
  }
  assert.deepEqual(files.map(bytesOf), before);
});

test("making a task: a desk seat gets the Mac's answer; a view seat is refused (vector 6)", async () => {
  const mac = await call(app.url, "POST", "/api/goals", { body: { text: "Write the November newsletter from the Mac" } });
  const desk = await onSeat(1, "POST", "/api/goals", { body: { text: "Write the November newsletter from the PC" } });
  assert.equal(mac.status, 201);
  assert.equal(desk.status, mac.status);
  assert.deepEqual(Object.keys(desk.json).sort(), Object.keys(mac.json).sort());
  const view = await onSeat(2, "POST", "/api/goals", { body: { text: "Write it from the view seat" } });
  assert.equal(view.status, 403);
  assert.equal(view.json.error.code, "mac_only");
});

test("a view seat reads; a desk seat's change to an unknown address or a page is refused, not looked up", async () => {
  assert.equal((await onSeat(2, "GET", "/api/tasks")).status, 200);
  assert.equal((await onSeat(2, "GET", "/api/inbox")).status, 200);
  assert.equal((await onSeat(2, "HEAD", "/")).status, 200);
  for (const [m, p] of [["POST", "/api/nothing-here"], ["PUT", "/api/goals"], ["PATCH", "/api/goals"], ["DELETE", "/api/goals"], ["POST", "/index.html"], ["OPTIONS", "/api/goals"]]) {
    const r = await onSeat(1, m, p, { body: {} });
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.json.error.code, "mac_only", `${m} ${p}`);
  }
  // A desk route reaches its handler (here: nothing by that id).
  const del = await onSeat(1, "DELETE", "/api/knowledge/doc/nope");
  assert.notEqual(del.json?.error?.code, "mac_only");
  // The same-origin rule still holds on a seat, before the lists.
  const bare = await call(`http://127.0.0.1:${ports[0]}`, "POST", "/api/goals", { bare: true, headers: { host: MAC_HOST }, body: { text: "x" } });
  assert.equal(bare.status, 403);
  assert.equal(bare.json.error.code, "not_same_origin");
  const cross = await onSeat(1, "POST", "/api/goals", { body: { text: "x" }, headers: { origin: `http://127.0.0.1:${ports[0]}` } });
  assert.equal(cross.json.error.code, "not_same_origin");
});

test("a sign-in's return is never read from a seat; the Mac's port answers it as before", async () => {
  for (const r of SEAT_HIDDEN) {
    const path = r.slice(4);
    for (const n of [1, 2]) {
      const x = await onSeat(n, "GET", `${path}?code=abc&state=def`);
      assert.equal(x.status, 403, path);
      assert.equal(x.json.error.code, "mac_only", path);
    }
    assert.notEqual((await call(app.url, "GET", `${path}?code=abc&state=def`)).status, 403, path);
  }
});

// Send `total` bytes with a declared length, only `sendFirst` of them before waiting for the answer.
function rawSend(port, { path, headers, total, sendFirst }) {
  return new Promise((resolve, reject) => {
    let sent = 0;
    let answered = false;
    const parts = [];
    const started = Date.now();
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path, agent: false, headers: { "content-length": total, ...headers } }, (res) => {
      answered = true;
      const at = { status: res.statusCode, sentAtAnswer: sent, ms: Date.now() - started };
      res.on("data", (c) => parts.push(c));
      const done = () => { let json = null; try { json = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { json = null; } req.destroy(); resolve({ ...at, json }); };
      res.on("end", done);
      res.on("close", done);
    });
    req.on("error", (e) => { if (!answered) reject(e); });
    const pump = () => {
      while (!answered && sent < sendFirst) {
        const n = Math.min(256 * 1024, sendFirst - sent);
        sent += n;
        if (!req.write(Buffer.alloc(n, 0x61))) { req.once("drain", pump); return; }
      }
    };
    pump();
  });
}

test("a refusal does not read a 40 MB body: the answer comes within 2 seconds (vector 11)", async () => {
  const headers = { host: MAC_HOST, "content-type": "application/json", "x-engine": "1", origin: ORIGIN };
  for (const [n, path] of [[1, "/api/apps/render-to-film/switch"], [2, "/api/goals"], [1, "/api/brain/files-nowhere"]]) {
    const r = await rawSend(ports[n - 1], { path, headers, total: 40 * MB, sendFirst: 1 * MB });
    assert.equal(r.status, 403, path);
    assert.equal(r.json.error.code, "mac_only", path);
    assert.ok(r.ms < 2000, `${path}: ${r.ms} ms`);
    assert.ok(r.sentAtAnswer <= 1 * MB, path);
  }
  assert.equal((await onSeat(1, "GET", "/healthz")).status, 200);
});

test("Needs you from a desk seat: books made final and a shot list's cost stay on the Mac", async () => {
  const SINV = "bench:Sales Invoice:ACC-SINV-2026-00001";
  const list = (await onSeat(1, "GET", "/api/inbox")).json;
  const item = list.items.find((i) => i.id === SINV);
  assert.ok(item, "the seeded draft invoice is listed");
  const before = h.bench.requests.filter((r) => r.method !== "GET").length;
  const r = await onSeat(1, "POST", "/api/inbox/act", { body: { id: SINV, action: "approve", version: item.version } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "mac_only");
  assert.equal(h.bench.requests.filter((x) => x.method !== "GET").length, before);
  const view = await onSeat(2, "POST", "/api/inbox/act", { body: { id: SINV, action: "send_back", note: "x", version: item.version } });
  assert.equal(view.json.error.code, "mac_only");
});

test("inboxSeatMay: the Mac may do all; a view seat nothing; a desk seat nothing priced", () => {
  const desk = { n: 1, role: "desk" };
  const view = { n: 2, role: "view" };
  assert.equal(inboxSeatMay(null, "staged", {}, "approve"), true);
  for (const [src, action] of [["goals", "pick"], ["goals", "acknowledge"], ["goals", "reopen"], ["staged", "answer"], ["staged", "accept"],
    ["staged", "send_back"], ["staged", "stop"], ["board", "answer"], ["board", "reject"], ["board", "dismiss"], ["bench", "send_back"],
    ["content", "approve"], ["brain", "dismiss"]]) {
    assert.equal(inboxSeatMay(desk, src, {}, action), true, `${src} ${action}`);
    assert.equal(inboxSeatMay(view, src, {}, action), false, `view ${src} ${action}`);
  }
  for (const [src, action] of [["staged", "approve"], ["staged", "another"], ["goals", "another"], ["bench", "approve"], ["board", "retry"],
    ["board", "approve"], ["nobody", "dismiss"], ["toString", "dismiss"], ["__proto__", "dismiss"]]) {
    assert.equal(inboxSeatMay(desk, src, {}, action), false, `${src} ${action}`);
  }
  assert.equal(inboxSeatMay(desk, "board", { _raw: { sourceKind: "review" } }, "approve"), true);
  assert.equal(inboxSeatMay(desk, "board", { _raw: { sourceKind: "approval" } }, "approve"), false);
});
