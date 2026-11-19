// The seats (PLAN-DESKTOP T7): five more 127.0.0.1 ports, one per PC the owner allowed, each known only by the port a
// request arrived on; seats.json read as hostile on every request. Free ports from 3340 up, a temporary state.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { createHome } from "../lib/app.mjs";
import { readSeats, seatFor, seatPorts } from "../lib/seats.mjs";
import { STUB_URLS, startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

const FP = `SHA256:${"A".repeat(43)}`;
const MAC_HOST = "127.0.0.1:3200";

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
// Five free ports in a row, from `from` up (never 3100 to 3299).
async function freeRow(from, to) {
  for (let p = from; p + 4 <= to; p++) {
    let ok = true;
    for (let i = 0; i < 5 && ok; i++) ok = await portFree(p + i);
    if (ok) return p;
  }
  throw new Error("no five free ports in a row");
}

let h;
let app;
let ports;
let remote;

const seat = (n, role = "desk", state = "allowed") => ({ n, name: "Windows PC", role, state, fingerprint: state === "allowed" ? FP : null, added: "2026-11-19T10:00:00.000Z" });
function writeSeats(seats, { mode = 0o600, dirMode = 0o700, raw } = {}) {
  rmSync(remote, { recursive: true, force: true });
  mkdirSync(remote, { mode: 0o700 });
  chmodSync(remote, dirMode);
  writeFileSync(join(remote, "seats.json"), raw ?? JSON.stringify({ seats }), { mode });
  chmodSync(join(remote, "seats.json"), mode);
}
const seatUrl = (n) => `http://127.0.0.1:${ports[n - 1]}`;
const onSeat = (n, method, path, opts = {}) => call(seatUrl(n), method, path, { ...opts, headers: { host: MAC_HOST, ...(opts.headers || {}) } });

before(async () => {
  h = await startStubsHome({ port: 0 });
  const first = await freeRow(3340, 3399);
  const config = { ...h.config, ports: { ...h.config.ports, seats: first }, remote: { seats: 5 } };
  app = await createHome({ config, urls: { ...STUB_URLS, board: h.config.urls.board, bench: h.config.urls.bench }, seats: true, log: () => {} });
  await app.listen(0);
  ports = seatPorts(config).map((s) => s.port);
  remote = join(h.state, "remote");
});
after(async () => {
  await app.close();
  await h.close();
});

test("the five seat ports are the configured row, and every seat listener is on 127.0.0.1 (vector 9)", () => {
  assert.equal(ports.length, 5);
  assert.equal(app.seatServers.length, 5);
  for (const s of app.seatServers) assert.equal(s.address().address, "127.0.0.1");
  assert.deepEqual(app.seatServers.map((s) => s.address().port), ports);
  assert.equal(app.server.address().address, "127.0.0.1");
});

test("seat 1 allowed as desk: /api/shell says so on its port, and null on the Mac's (vector 1)", async () => {
  writeSeats([seat(1)]);
  const r = await onSeat(1, "GET", "/api/shell");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.seat, { n: 1, role: "desk" });
  const mac = await call(app.url, "GET", "/api/shell");
  assert.equal(mac.status, 200);
  // The Mac's answer stays byte for byte as before: no `seat` key, which the shell reads as null.
  assert.equal(mac.json.seat ?? null, null);
  assert.ok(!Object.hasOwn(mac.json, "seat"));
  const page = await onSeat(1, "GET", "/index.html");
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /^text\/html/);
});

test("on a seat port only the Mac's own Host is taken (vector 2)", async () => {
  writeSeats([seat(1)]);
  for (const host of ["127.0.0.1:3201", `127.0.0.1:${ports[0]}`, `localhost:${ports[0]}`, `127.0.0.1:${app.port}`, "evil.example:3200", "127.0.0.1"]) {
    const r = await onSeat(1, "GET", "/api/shell", { headers: { host } });
    assert.equal(r.status, 421, host);
    assert.equal(r.json.error.code, "wrong_host", host);
  }
  assert.equal((await onSeat(1, "GET", "/api/shell", { headers: { host: "localhost:3200" } })).status, 200);
  // The Mac's port does not take the seat's Host: unchanged.
  assert.equal((await call(app.url, "GET", "/api/shell", { headers: { host: MAC_HOST } })).status, app.port === 3200 ? 200 : 421);
});

test("a seat port with no seat is refused everything, files included (vector 3)", async () => {
  writeSeats([seat(1)]);
  for (const path of ["/api/shell", "/index.html", "/", "/healthz", "/api/nothing-here", "/app.js"]) {
    const r = await onSeat(2, "GET", path);
    assert.equal(r.status, 403, path);
    assert.equal(r.json.error.code, "seat_unknown", path);
    assert.equal(r.json.error.message, "This PC is not allowed to open the engine.", path);
  }
  const post = await onSeat(2, "POST", "/api/goals", { body: { text: "x" }, headers: { origin: "http://127.0.0.1:3200" } });
  assert.equal(post.status, 403);
  assert.equal(post.json.error.code, "seat_unknown");
});

test("a seat that is waiting, not yet allowed, is refused (vector 4)", async () => {
  writeSeats([seat(1, "desk", "waiting")]);
  const r = await onSeat(1, "GET", "/api/shell");
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "seat_unknown");
});

test("a seats.json that breaks rule 6 closes every seat port; the Mac's port still works (vector 7)", async () => {
  const cases = {
    "a link": () => {
      writeSeats([seat(1)]);
      const real = join(h.state, "seats-real.json");
      writeFileSync(real, JSON.stringify({ seats: [seat(1)] }), { mode: 0o600 });
      rmSync(join(remote, "seats.json"));
      symlinkSync(real, join(remote, "seats.json"));
    },
    "mode 644": () => writeSeats([seat(1)], { mode: 0o644 }),
    "a FIFO": () => {
      writeSeats([seat(1)]);
      rmSync(join(remote, "seats.json"));
      execFileSync("/usr/bin/mkfifo", ["-m", "600", join(remote, "seats.json")]);
    },
    "a folder of mode 755": () => writeSeats([seat(1)], { dirMode: 0o755 }),
    "17 KB long": () => writeSeats(null, { raw: JSON.stringify({ seats: [seat(1)], pad: "x".repeat(17 * 1024) }) }),
    "a folder that is a link": () => {
      const real = join(h.state, "remote-real");
      rmSync(real, { recursive: true, force: true });
      mkdirSync(real, { mode: 0o700 });
      writeFileSync(join(real, "seats.json"), JSON.stringify({ seats: [seat(1)] }), { mode: 0o600 });
      rmSync(remote, { recursive: true, force: true });
      symlinkSync(real, remote);
    },
    "not JSON": () => writeSeats(null, { raw: "{ seats: " }),
  };
  for (const [name, make] of Object.entries(cases)) {
    make();
    assert.equal(readSeats(app.config).ok, false, name);
    for (let n = 1; n <= 5; n++) {
      const started = Date.now();
      const r = await onSeat(n, "GET", "/api/shell");
      assert.equal(r.status, 403, `${name}, seat ${n}`);
      assert.equal(r.json.error.code, "seat_unknown", `${name}, seat ${n}`);
      assert.ok(Date.now() - started < 2000, `${name}: the read did not wait`);
    }
    const mac = await call(app.url, "GET", "/api/shell");
    assert.equal(mac.status, 200, name);
    assert.equal(mac.json.seat ?? null, null, name);
    rmSync(remote, { recursive: true, force: true });
  }
  writeSeats([seat(1)]);
  assert.equal((await onSeat(1, "GET", "/api/shell")).status, 200);
});

test("forwarding headers and a made-up X-Seat change nothing (vector 8)", async () => {
  writeSeats([seat(1)]);
  const lies = { "x-forwarded-for": "192.168.1.20", forwarded: "for=192.168.1.20;host=127.0.0.1:3202", "x-seat": "2", "x-forwarded-port": "3202" };
  const one = await onSeat(1, "GET", "/api/shell", { headers: lies });
  assert.deepEqual(one.json.seat, { n: 1, role: "desk" });
  const two = await onSeat(2, "GET", "/api/shell", { headers: { ...lies, "x-seat": "1", forwarded: "for=127.0.0.1;host=127.0.0.1:3201" } });
  assert.equal(two.status, 403);
  assert.equal(two.json.error.code, "seat_unknown");
  const mac = await call(app.url, "GET", "/api/shell", { headers: lies });
  assert.ok(!Object.hasOwn(mac.json, "seat"));
});

test("a seat removed while the server runs is refused on its next request (vector 12)", async () => {
  writeSeats([seat(1), seat(2, "view")]);
  assert.deepEqual((await onSeat(2, "GET", "/api/shell")).json.seat, { n: 2, role: "view" });
  writeSeats([seat(1)]);
  const r = await onSeat(2, "GET", "/api/shell");
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "seat_unknown");
  assert.equal((await onSeat(1, "GET", "/api/shell")).status, 200);
  rmSync(remote, { recursive: true, force: true });
  assert.equal((await onSeat(1, "GET", "/api/shell")).json.error.code, "seat_unknown");
});

test("readSeats: the pinned shape only; anything else is no seats", () => {
  const cfg = app.config;
  rmSync(remote, { recursive: true, force: true });
  assert.deepEqual({ ...readSeats(cfg), seats: [...readSeats(cfg).seats] }, { ok: true, reason: "none", seats: [] });
  writeSeats([seat(1), seat(3, "view", "waiting")]);
  const good = readSeats(cfg);
  assert.equal(good.ok, true);
  assert.deepEqual(good.seats.map((s) => [s.n, s.role, s.state]), [[1, "desk", "allowed"], [3, "view", "waiting"]]);
  assert.ok(Object.isFrozen(good.seats));
  const bad = [
    [seat(1), seat(1)],
    [seat(6)],
    [seat(0)],
    [{ ...seat(1), role: "owner" }],
    [{ ...seat(1), role: "owner-away" }],
    [{ ...seat(1), state: "on" }],
    [{ ...seat(1), fingerprint: null }],
    [{ ...seat(1), fingerprint: "MD5:aa" }],
    [{ ...seat(1), n: "1" }],
    [{ ...seat(1), name: "a\nb" }],
    [seat(1), seat(2), seat(3), seat(4), seat(5), seat(5)],
  ];
  for (const seats of bad) {
    writeSeats(seats);
    assert.equal(readSeats(cfg).ok, false, JSON.stringify(seats));
  }
  for (const raw of ["[]", "null", "{}", '{"seats": {}}', '"x"']) {
    writeSeats(null, { raw });
    assert.equal(readSeats(cfg).ok, false, raw);
  }
});

test("seatFor: null off the seat ports; the role only for an allowed seat", () => {
  writeSeats([seat(1), seat(2, "view"), seat(3, "desk", "waiting")]);
  const cfg = app.config;
  assert.equal(seatFor(app.port, cfg), null);
  assert.equal(seatFor(ports[0] - 1, cfg), null);
  assert.equal(seatFor(ports[4] + 1, cfg), null);
  assert.deepEqual({ ...seatFor(ports[0], cfg) }, { n: 1, role: "desk" });
  assert.deepEqual({ ...seatFor(ports[1], cfg) }, { n: 2, role: "view" });
  assert.deepEqual({ ...seatFor(ports[2], cfg) }, { n: 3, role: null });
  assert.deepEqual({ ...seatFor(ports[4], cfg) }, { n: 5, role: null });
  rmSync(remote, { recursive: true, force: true });
});

test("the seat ports from the engine's own config: 3201 to 3205", () => {
  assert.deepEqual(seatPorts(h.config).map((s) => s.port), [3201, 3202, 3203, 3204, 3205]);
  assert.equal(h.config.ports.remote, 3220);
});

test("a home on any other port than its own opens no seat port unless asked", async () => {
  assert.equal(h.app.seatServers.length, 0);
});
