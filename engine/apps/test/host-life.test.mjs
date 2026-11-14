// The App Studio host, an app's life (PLAN-V5 K17): on and off from the owner's switches, the
// states, restarts and `failed`, the whole process group ended at a stop, the app's socket
// taken out of its reach, the socket-length guard, health on the host's own address, the status
// file and the app's log. The fixture app is spawned unfenced by an injected spawner; the real
// fence is host-sandbox.test.mjs.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs, {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { readAppsState } from "../host.mjs";
import {
  NODE, alive, appOutput, fakeParts, fixtureSpawner, freePorts, jsonOf, makeWorld, own, send, startHost, wait, waitFor,
} from "./fixture-app/harness.mjs";

const cleanups = [];
after(async () => {
  for (const f of cleanups.reverse()) {
    try { await f(); } catch { /* best effort */ }
  }
});

// A world with apps, its fake parts and a host; everything ended after the file.
async function setup(apps, { limits, extra, now, stateName, prefix } = {}) {
  const first = await freePorts(6);
  const w = makeWorld({ apps: apps.map((a, i) => ({ port: first + i, ...a })), portFirst: first, portLast: first + 5, stateName, prefix });
  cleanups.push(() => w.cleanup());
  const parts = await fakeParts(w);
  cleanups.push(() => parts.close());
  const spawner = fixtureSpawner(w, extra);
  const started = await startHost(w, { spawnApp: spawner, limits, now });
  cleanups.push(() => started.host.close());
  return { w, parts, spawner, first, ...started };
}
const stateOf = (host, slug) => host.app(slug)?.state;
const health = (port, headers = { Host: `127.0.0.1:${port}` }, path = "/apps/health") => send({ port, path, headers });

test("the switches file: no file is every app off; K17's shape is read; untrusted, not JSON or another shape is every app off", () => {
  const w = makeWorld({ prefix: "uuu-hs-" });
  cleanups.push(() => w.cleanup());
  assert.deepEqual(readAppsState(w.paths.appsState), { ok: true, on: {}, changedAt: null });
  w.switches({ fix: true, other: false }, "2026-11-13T05:00:00.000Z");
  assert.deepEqual(readAppsState(w.paths.appsState), { ok: true, on: { fix: true }, changedAt: "2026-11-13T05:00:00.000Z" });
  chmodSync(w.paths.appsState, 0o666);
  assert.equal(readAppsState(w.paths.appsState).ok, false, "others may write it");
  for (const text of ["not json", "[]", "{\"version\":2,\"apps\":{}}", "{\"version\":1,\"apps\":{\"fix\":{\"on\":\"yes\"}}}",
    "{\"version\":1,\"apps\":{\"../x\":{\"on\":true}}}", "{\"version\":1,\"apps\":[]}"]) {
    writeFileSync(w.paths.appsState, text, { mode: 0o600 });
    chmodSync(w.paths.appsState, 0o600);
    assert.deepEqual(readAppsState(w.paths.appsState), { ok: false, on: {}, changedAt: null }, text);
  }
});

test("on and off from the owner's switches within 3 seconds, at the 2-second loop", async () => {
  const { w, host, spawner, first } = await setup([{ slug: "fix" }]);
  await wait(300);
  assert.equal(stateOf(host, "fix"), "off");
  assert.equal(spawner.spawned.length, 0);
  let t0 = Date.now();
  w.switches({ fix: true });
  assert.ok(await waitFor(() => stateOf(host, "fix") === "on", 3000), `on after ${Date.now() - t0} ms`);
  assert.equal((await send({ port: first, path: "/echo", headers: own(first) })).status, 200);
  const pid = host.app("fix").pid;
  t0 = Date.now();
  w.switches({ fix: false });
  assert.ok(await waitFor(() => stateOf(host, "fix") === "off", 3000), `off after ${Date.now() - t0} ms`);
  assert.equal(alive(pid), false, "its process is gone");
  const closed = await send({ port: first, path: "/", headers: own(first), timeoutMs: 1000 });
  assert.equal(closed.error, "ECONNREFUSED", "its browser listener is closed");
  assert.equal(existsSync(join(w.paths.appsRun, "fix", "engine.sock")), false, "its engine socket is gone");
});

test("a damaged app and an app not installed are listed and never started; a broken switches file starts nothing", async () => {
  const { w, host, spawner } = await setup([
    { slug: "fix" }, { slug: "bad", manifest: { memoryMb: 99999 } }, { slug: "nready", ready: false },
  ], { limits: { everyMs: 200 } });
  w.switches({ fix: false, bad: true, nready: true });
  await waitFor(() => stateOf(host, "bad") === "damaged" && stateOf(host, "nready") === "not_installed", 3000);
  await wait(600);
  assert.equal(stateOf(host, "bad"), "damaged");
  assert.equal(stateOf(host, "nready"), "not_installed");
  assert.equal(spawner.spawned.length, 0);
  // The switches file made writable by others: not trusted, so every app is off.
  w.switches({ fix: true });
  chmodSync(w.paths.appsState, 0o666);
  await wait(800);
  assert.equal(stateOf(host, "fix"), "off");
  assert.equal(spawner.spawned.length, 0);
  chmodSync(w.paths.appsState, 0o600);
  assert.ok(await waitFor(() => stateOf(host, "fix") === "on", 3000));
  // A manifest broken while the app runs stops it.
  writeFileSync(join(w.code, "fix", "app.json"), "{ broken");
  assert.ok(await waitFor(() => stateOf(host, "fix") === "damaged", 15000));
  assert.deepEqual(host.health().apps.map((a) => [a.slug, a.state]), [["bad", "damaged"], ["fix", "damaged"], ["nready", "not_installed"]]);
});

test("health on the host's own address only: K17's shape; nothing else is served; another Host is refused", async () => {
  const { w, host } = await setup([{ slug: "fix" }, { slug: "two", ready: false }], { limits: { everyMs: 200 } });
  w.switches({ fix: true });
  await waitFor(() => stateOf(host, "fix") === "on", 3000);
  const r = await health(host.port);
  assert.equal(r.status, 200);
  const body = jsonOf(r);
  assert.deepEqual(Object.keys(body), ["status", "part", "apps"]);
  assert.equal(body.status, "ok");
  assert.equal(body.part, "apps");
  assert.deepEqual(body.apps.map((a) => Object.keys(a)), [["slug", "state", "since", "restarts"], ["slug", "state", "since", "restarts"]]);
  assert.deepEqual(body.apps.map((a) => [a.slug, a.state, a.restarts]), [["fix", "on", 0], ["two", "not_installed", 0]]);
  assert.match(body.apps[0].since, /^\d{4}-\d\d-\d\dT/);
  assert.equal((await health(host.port, { Host: `localhost:${host.port}` })).status, 200);
  assert.equal((await health(host.port, { Host: `evil.test:${host.port}` })).status, 421);
  for (const path of ["/", "/apps/health/", "/apps/health?x=1", "/healthz", "/apps"]) {
    assert.equal((await health(host.port, undefined, path)).status, 404, path);
  }
  const post = await send({ port: host.port, method: "POST", path: "/apps/health", headers: { Host: `127.0.0.1:${host.port}` } });
  assert.equal(post.status, 404);
});

test("the status file: 0600, each app with its state, port and pid; the app's output kept 0600 and cut at its limit", async () => {
  const { w, host } = await setup([{ slug: "fix" }], { limits: { everyMs: 200, logBytes: 4000 } });
  w.switches({ fix: true });
  await waitFor(() => stateOf(host, "fix") === "on", 3000);
  await waitFor(() => {
    try {
      const a = JSON.parse(readFileSync(w.paths.appsStatus, "utf8")).apps[0];
      return a.state === "on" && a.pid === host.app("fix").pid;
    } catch {
      return false;
    }
  }, 15000);
  const st = JSON.parse(readFileSync(w.paths.appsStatus, "utf8"));
  assert.equal(statSync(w.paths.appsStatus).mode & 0o777, 0o600);
  assert.equal(st.version, 1);
  assert.equal(st.stateReadable, true);
  assert.equal(st.apps[0].slug, "fix");
  assert.equal(st.apps[0].pid, host.app("fix").pid);
  assert.equal(st.apps[0].port, host.app("fix").port);
  const log = join(w.paths.appsLogs, "fix.log");
  assert.equal(statSync(log).mode & 0o777, 0o600);
  assert.match(appOutput(w, "fix"), /fixture listening/);
  for (let i = 0; i < 80; i += 1) await send({ port: host.app("fix").port, path: `/echo?n=${"x".repeat(80)}`, headers: own(host.app("fix").port) });
  assert.ok(await waitFor(() => existsSync(`${log}.1`), 3000), "cut to .1");
  assert.ok(statSync(log).size <= 4000);
  assert.equal(statSync(`${log}.1`).mode & 0o777, 0o600);
});

test("three exits within 10 minutes: failed, not started again, until the owner switches it off and on", async () => {
  let mode = "exit";
  const { w, host, spawner } = await setup([{ slug: "fix" }], { limits: { everyMs: 200, restartMs: 150 }, extra: () => ({ FIXTURE_MODE: mode }) });
  w.switches({ fix: true }, "2026-11-13T05:00:00.000Z");
  assert.ok(await waitFor(() => stateOf(host, "fix") === "failed", 8000), stateOf(host, "fix"));
  assert.equal(spawner.spawned.length, 3);
  assert.equal(host.app("fix").why, "exits");
  assert.equal(host.app("fix").restarts, 2);
  await wait(1200);
  assert.equal(spawner.spawned.length, 3, "not started again while it stays on");
  assert.equal(stateOf(host, "fix"), "failed");
  mode = "";
  w.switches({ fix: false }, "2026-11-13T05:01:00.000Z");
  assert.ok(await waitFor(() => stateOf(host, "fix") === "off", 3000));
  w.switches({ fix: true }, "2026-11-13T05:02:00.000Z");
  assert.ok(await waitFor(() => stateOf(host, "fix") === "on", 3000));
  assert.equal(host.app("fix").restarts, 0);
});

test("an off and on faster than the loop still clears failed: the switches saved again since it failed", async () => {
  let mode = "exit";
  const { w, host, spawner } = await setup([{ slug: "fix" }], { limits: { everyMs: 1500, restartMs: 100 }, extra: () => ({ FIXTURE_MODE: mode }) });
  w.switches({ fix: true }, "2026-11-13T06:00:00.000Z");
  assert.ok(await waitFor(() => stateOf(host, "fix") === "failed", 10000));
  mode = "";
  await wait(1600);
  assert.equal(spawner.spawned.length, 3, "the same switches file: still failed");
  w.switches({ fix: false }, "2026-11-13T06:00:01.000Z");
  w.switches({ fix: true }, "2026-11-13T06:00:02.000Z");
  assert.ok(await waitFor(() => stateOf(host, "fix") === "on", 5000));
});

test("one exit: started again after 5 seconds, not before", async () => {
  const { w, host, first } = await setup([{ slug: "fix" }], { limits: { everyMs: 200 } });
  w.switches({ fix: true });
  await waitFor(() => stateOf(host, "fix") === "on", 3000);
  const before = host.app("fix").pid;
  const t0 = Date.now();
  await send({ port: first, path: "/exit", headers: own(first) });
  assert.ok(await waitFor(() => stateOf(host, "fix") === "starting", 2000));
  const page = await send({ port: first, path: "/", headers: own(first) });
  assert.equal(page.status, 502, "the listener stays and says why");
  await wait(4000);
  assert.equal(host.app("fix").pid, null, "not yet started again");
  assert.ok(await waitFor(() => stateOf(host, "fix") === "on", 15000));
  const took = Date.now() - t0;
  assert.ok(took >= 5000 && took < 20000, `back after ${took} ms`);
  assert.notEqual(host.app("fix").pid, before);
  assert.equal(host.app("fix").restarts, 1);
});

test("stop ends the whole group, a grandchild too, and a helper the app started in a session of its own", async () => {
  const { w, host, first } = await setup([{ slug: "fix" }], { limits: { everyMs: 200 } });
  w.switches({ fix: true });
  await waitFor(() => stateOf(host, "fix") === "on", 3000);
  const kids = jsonOf(await send({ port: first, path: "/child", headers: own(first) }));
  const app = host.app("fix").pid;
  assert.ok(alive(kids.kid) && alive(kids.away) && alive(app));
  w.switches({ fix: false });
  assert.ok(await waitFor(() => stateOf(host, "fix") === "off", 5000));
  await waitFor(() => !alive(kids.kid) && !alive(kids.away), 3000);
  assert.equal(alive(app), false, "the app");
  assert.equal(alive(kids.kid), false, "the grandchild in its group");
  assert.equal(alive(kids.away), false, "the helper in a session of its own");
});

test("a stop gives SIGTERM its time (10 seconds; here 0.8), then SIGKILL", async () => {
  const { w, host, first } = await setup([{ slug: "fix" }], { limits: { everyMs: 200, stopGraceMs: 800 } });
  w.switches({ fix: true });
  await waitFor(() => stateOf(host, "fix") === "on", 3000);
  // A child in the app's group that ignores SIGTERM.
  const { deaf } = jsonOf(await send({ port: first, path: "/deaf", headers: own(first) }));
  await wait(300);
  assert.ok(alive(deaf));
  const t0 = Date.now();
  w.switches({ fix: false });
  assert.ok(await waitFor(() => stateOf(host, "fix") === "off", 6000));
  assert.ok(Date.now() - t0 >= 800, `it waited for SIGTERM first (${Date.now() - t0} ms)`);
  assert.equal(alive(deaf), false, "SIGKILL ended what ignored SIGTERM");
});

test("one slow app does not slow another", async () => {
  const { w, host, first } = await setup([{ slug: "fix" }, { slug: "two" }], { limits: { everyMs: 200 } });
  w.switches({ fix: true, two: true });
  await waitFor(() => stateOf(host, "fix") === "on" && stateOf(host, "two") === "on", 4000);
  const slow = [];
  for (let i = 0; i < 64; i += 1) slow.push(send({ port: first, path: "/slow?ms=2500", headers: own(first) }));
  await wait(200);
  const t0 = Date.now();
  const quick = await send({ port: first + 1, path: "/echo", headers: own(first + 1) });
  assert.equal(quick.status, 200);
  assert.ok(Date.now() - t0 < 500, `the other app answered in ${Date.now() - t0} ms`);
  const ok = await Promise.all(slow);
  assert.ok(ok.every((r) => r.status === 200));
});

test("the socket-length guard: an app whose sockets would be too long for this Mac fails, and nothing is started", async () => {
  const { w, host, spawner } = await setup([{ slug: "fix" }], { limits: { everyMs: 200 }, stateName: "s".repeat(80), prefix: "uuu-hl-" });
  w.switches({ fix: true });
  assert.ok(await waitFor(() => stateOf(host, "fix") === "failed", 3000));
  assert.equal(host.app("fix").why, "path_too_long");
  assert.equal(spawner.spawned.length, 0);
});

test("app.sock made a link to another socket: never followed; the app fails and the other socket is never reached", async () => {
  const { w, host } = await setup([{ slug: "fix" }], {
    limits: { everyMs: 200 }, extra: () => ({ FIXTURE_MODE: "link", FIXTURE_TARGET: target }),
  });
  let hits = 0;
  var target = join(w.root, "outer.sock"); // eslint-disable-line no-var
  const outer = net.createServer((s) => { hits += 1; s.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"); });
  await new Promise((ok) => outer.listen(target, ok));
  cleanups.push(() => new Promise((ok) => outer.close(ok)));
  w.switches({ fix: true });
  assert.ok(await waitFor(() => stateOf(host, "fix") === "failed", 5000), stateOf(host, "fix"));
  assert.equal(host.app("fix").why, "app_socket_not_a_socket");
  assert.equal(hits, 0);
  assert.equal(existsSync(join(w.paths.appsRun, ".host", "fix")), false, "the moved link is removed");
  assert.equal(host.app("fix").pid, null, "its group was ended");
});

test("the app's socket is moved out of its run folder, and a link planted in its place later changes nothing", async () => {
  const { w, host, first } = await setup([{ slug: "fix" }], { limits: { everyMs: 200 } });
  w.switches({ fix: true });
  await waitFor(() => stateOf(host, "fix") === "on", 3000);
  const run = join(w.paths.appsRun, "fix");
  const moved = join(w.paths.appsRun, ".host", "fix");
  assert.equal(existsSync(join(run, "app.sock")), false);
  assert.ok(lstatSync(moved).isSocket());
  assert.equal(statSync(join(w.paths.appsRun, ".host")).mode & 0o777, 0o700);
  assert.equal(statSync(run).mode & 0o777, 0o700);
  let hits = 0;
  const outer = net.createServer((s) => { hits += 1; s.destroy(); });
  await new Promise((ok) => outer.listen(join(w.root, "o2.sock"), ok));
  cleanups.push(() => new Promise((ok) => outer.close(ok)));
  const { symlinkSync } = await import("node:fs");
  symlinkSync(join(w.root, "o2.sock"), join(run, "app.sock"));
  for (let i = 0; i < 5; i += 1) assert.equal((await send({ port: first, path: "/echo", headers: own(first) })).status, 200);
  assert.equal(hits, 0);
});

test("an app that never answers /healthz fails within its time; one that listens late is still on", async () => {
  const { w, host, spawner } = await setup([{ slug: "fix" }, { slug: "late" }], {
    limits: { everyMs: 200, healthMs: 1500 }, extra: (slug) => ({ FIXTURE_MODE: slug === "fix" ? "silent" : "late" }),
  });
  w.switches({ fix: true, late: true });
  assert.ok(await waitFor(() => stateOf(host, "fix") === "failed", 15000));
  assert.equal(host.app("fix").why, "no_health");
  assert.ok(await waitFor(() => stateOf(host, "late") === "on", 15000));
  const pid = spawner.spawned.length;
  await wait(600);
  assert.equal(spawner.spawned.length, pid, "a failed start is not tried again");
});

test("a port another program holds: failed, and the app is ended", async () => {
  const first = await freePorts(2);
  const squatter = net.createServer();
  await new Promise((ok) => squatter.listen(first, "127.0.0.1", ok));
  cleanups.push(() => new Promise((ok) => squatter.close(ok)));
  const w = makeWorld({ apps: [{ slug: "fix", port: first }], portFirst: first, portLast: first + 1 });
  cleanups.push(() => w.cleanup());
  const parts = await fakeParts(w);
  cleanups.push(() => parts.close());
  const { host } = await startHost(w, { spawnApp: fixtureSpawner(w), limits: { everyMs: 200 } });
  cleanups.push(() => host.close());
  w.switches({ fix: true });
  assert.ok(await waitFor(() => stateOf(host, "fix") === "failed", 5000));
  assert.equal(host.app("fix").why, "port_busy");
  assert.equal(host.app("fix").pid, null);
});

test("a changed description restarts the app on its new port", async () => {
  const { w, host, first } = await setup([{ slug: "fix" }], { limits: { everyMs: 200 } });
  w.switches({ fix: true });
  await waitFor(() => stateOf(host, "fix") === "on", 3000);
  const m = JSON.parse(readFileSync(join(w.code, "fix", "app.json"), "utf8"));
  m.port = first + 3;
  writeFileSync(join(w.code, "fix", "app.json"), JSON.stringify(m));
  assert.ok(await waitFor(() => stateOf(host, "fix") === "on" && host.app("fix").port === first + 3, 8000));
  assert.equal((await send({ port: first + 3, path: "/echo", headers: own(first + 3) })).status, 200);
  assert.equal((await send({ port: first, path: "/", headers: own(first), timeoutMs: 1000 })).error, "ECONNREFUSED");
});

test("the run folder is emptied at each start; what an app left there is gone", async () => {
  const { w, host } = await setup([{ slug: "fix" }], { limits: { everyMs: 200 } });
  const run = join(w.paths.appsRun, "fix");
  mkdirSync(join(run, "deep", "locked"), { recursive: true });
  writeFileSync(join(run, "deep", "locked", "left.txt"), "x");
  chmodSync(join(run, "deep", "locked"), 0o500);
  chmodSync(join(run, "deep"), 0o500);
  w.switches({ fix: true });
  assert.ok(await waitFor(() => stateOf(host, "fix") === "on", 3000));
  assert.equal(existsSync(join(run, "deep")), false);
  assert.ok(lstatSync(join(run, "engine.sock")).isSocket());
  // What closes the engine socket to others is its folder, made new and 0700, in a folder of the
  // host's that is 0700 too; the socket's own mode is never changed by name (T85).
  assert.equal(statSync(run).mode & 0o777, 0o700);
  assert.equal(statSync(w.paths.appsRun).mode & 0o777, 0o700);
  assert.equal(statSync(join(w.paths.appsRun, ".host")).mode & 0o777, 0o700);
});

test("the host never changes a mode or removes a tree by name inside a run folder an app can write; it renames it away first (T85)", async () => {
  const { w, host } = await setup([{ slug: "fix" }], { limits: { everyMs: 200 } });
  const runRoot = realpathSync(w.paths.appsRun);
  const run = join(w.paths.appsRun, "fix");
  // What an app could leave: a link to a folder outside, a link inside a folder it closed.
  const outside = join(w.root, "outside");
  mkdirSync(join(outside, "keep"), { recursive: true });
  writeFileSync(join(outside, "keep", "precious.txt"), "the owner's");
  mkdirSync(join(run, "deep", "closed"), { recursive: true });
  symlinkSync(outside, join(run, "to-outside"));
  symlinkSync(join(outside, "keep"), join(run, "deep", "closed", "keep"));
  chmodSync(join(run, "deep", "closed"), 0o000);
  const calls = [];
  const saved = { chmodSync: fs.chmodSync, rm: fsp.rm, rmSync: fs.rmSync, unlinkSync: fs.unlinkSync, rmdirSync: fs.rmdirSync };
  fs.chmodSync = (path, mode) => { calls.push(["chmodSync", String(path)]); return saved.chmodSync(path, mode); };
  fs.rmSync = (path, o) => { calls.push(["rmSync", String(path)]); return saved.rmSync(path, o); };
  fs.unlinkSync = (path) => { calls.push(["unlinkSync", String(path)]); return saved.unlinkSync(path); };
  fs.rmdirSync = (path, o) => { calls.push(["rmdirSync", String(path)]); return saved.rmdirSync(path, o); };
  fsp.rm = (path, o) => { calls.push(["rm", String(path)]); return saved.rm(path, o); };
  syncBuiltinESMExports();
  try {
    w.switches({ fix: true });
    assert.ok(await waitFor(() => stateOf(host, "fix") === "on", 5000));
    w.switches({ fix: false });
    assert.ok(await waitFor(() => stateOf(host, "fix") === "off", 5000));
    w.switches({ fix: true });
    assert.ok(await waitFor(() => stateOf(host, "fix") === "on", 5000));
  } finally {
    Object.assign(fs, { chmodSync: saved.chmodSync, rmSync: saved.rmSync, unlinkSync: saved.unlinkSync, rmdirSync: saved.rmdirSync });
    fsp.rm = saved.rm;
    syncBuiltinESMExports();
  }
  const inRun = calls.filter(([, path]) => path === run || path.startsWith(`${run}/`));
  assert.deepEqual(inRun, [], "nothing done by name in or to the run folder");
  assert.ok(calls.some(([k, path]) => k === "rm" && path.startsWith(`${runRoot}/.gone-fix-`)), JSON.stringify(calls));
  assert.equal(readFileSync(join(outside, "keep", "precious.txt"), "utf8"), "the owner's", "no link was followed");
  assert.deepEqual(readdirSync(w.paths.appsRun).filter((n) => n.startsWith(".gone-")), [], "what was renamed away is gone");
  assert.equal(existsSync(join(run, "to-outside")), false);
});

test("close stops every app and closes every listener", async () => {
  const first = await freePorts(3);
  const w = makeWorld({ apps: [{ slug: "fix", port: first }, { slug: "two", port: first + 1 }], portFirst: first, portLast: first + 2 });
  cleanups.push(() => w.cleanup());
  const parts = await fakeParts(w);
  cleanups.push(() => parts.close());
  const { host } = await startHost(w, { spawnApp: fixtureSpawner(w), limits: { everyMs: 200 } });
  w.switches({ fix: true, two: true });
  await waitFor(() => stateOf(host, "fix") === "on" && stateOf(host, "two") === "on", 4000);
  const pids = [host.app("fix").pid, host.app("two").pid];
  const hp = host.port;
  await host.close();
  assert.ok(pids.every((p) => !alive(p)));
  for (const port of [first, first + 1, hp]) {
    assert.equal((await send({ port, path: "/", headers: own(port), timeoutMs: 1000 })).error, "ECONNREFUSED", String(port));
  }
  const st = JSON.parse(readFileSync(w.paths.appsStatus, "utf8"));
  assert.deepEqual(st.apps.map((a) => [a.slug, a.state, a.pid]), [["fix", "off", null], ["two", "off", null]]);
});

test("an app left running by a host that was killed is ended when the next host starts", async () => {
  const first = await freePorts(2);
  const w = makeWorld({ apps: [{ slug: "fix", port: first }], portFirst: first, portLast: first + 1 });
  cleanups.push(() => w.cleanup());
  // As a killed host leaves it: the app's group running, its pid in the status file.
  const orphan = spawn(NODE, [join(w.code, "fix", "server.mjs")], { cwd: join(w.code, "fix"), detached: true, stdio: "ignore",
    env: { APP_SOCKET: join(w.root, "orphan.sock"), FIXTURE_MODE: "silent" } });
  const stranger = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  cleanups.push(() => { try { process.kill(-stranger.pid, "SIGKILL"); } catch { /* gone */ } });
  mkdirSync(w.paths.apps, { recursive: true, mode: 0o700 });
  writeFileSync(w.paths.appsStatus, JSON.stringify({ version: 1, apps: [
    { slug: "fix", state: "on", pid: orphan.pid, relayCalls: [] },
    { slug: "other", state: "on", pid: stranger.pid, relayCalls: [] },
  ] }), { mode: 0o600 });
  await wait(300);
  assert.ok(alive(orphan.pid));
  const parts = await fakeParts(w);
  cleanups.push(() => parts.close());
  const { host } = await startHost(w, { spawnApp: fixtureSpawner(w), limits: { everyMs: 200, stopGraceMs: 1000 } });
  cleanups.push(() => host.close());
  assert.ok(await waitFor(() => !alive(orphan.pid), 3000), "the app's old group is ended");
  assert.ok(alive(stranger.pid), "a process group that is not an app's is left alone");
});
