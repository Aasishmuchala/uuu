// The App Studio host with the real fence (PLAN-V5 K17, K18, K19): the host's own spawner runs
// `app-exec <slug> --run` in a temp copy of engine/ whose config.json puts the state in a temp
// folder (as app-exec.test.mjs does), and the fixture app runs inside the sandbox tool. What it
// proves: the app is reached through its browser port and reaches the door through its engine
// socket; its environment names this Mac's ffmpeg and ffprobe; the host takes app.sock out of
// the app's reach, and neither a link at that name, nor one made before the app listens, nor
// the run folder itself can be turned against the host; a stop ends the fenced app. Nothing
// here touches the live engine's state or reaches the internet.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appExecSpawner, createAppHost } from "../host.mjs";
import { loadConfig } from "../../lib/config.mjs";
import { FIXTURE, NODE, alive, fakeParts, jsonOf, own, send, waitFor } from "./fixture-app/harness.mjs";

const ENGINE = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const SRT = join(ENGINE, "node_modules", ".bin", "srt");
const SKIP = [SRT, NODE, "/opt/homebrew/bin/ffmpeg", "/opt/homebrew/bin/ffprobe"].every(existsSync)
  ? false : "the sandbox tool, Node 24, ffmpeg or ffprobe is missing on this Mac";

// A port of K17's range that nothing holds now.
async function freeAppPort() {
  for (let p = 3189; p >= 3175; p -= 1) {
    const free = await new Promise((ok) => {
      const s = net.createServer();
      s.once("error", () => ok(false));
      s.listen(p, "127.0.0.1", () => s.close(() => ok(true)));
    });
    if (free) return p;
  }
  throw new Error("no free port in 3175 to 3189");
}

let root;
let w;            // { cfg, paths, code, doorSecret, relaySecret } as the harness's fakes want it
let parts;
let host;
let lines = [];
let port;
let linkPort;
let outer;
let outerHits = 0;

before(async () => {
  if (SKIP) return;
  root = realpathSync(mkdtempSync("/private/tmp/uuu-hx-"));
  const eng = join(root, "engine");
  mkdirSync(join(eng, "apps"), { recursive: true });
  mkdirSync(join(eng, "lib"));
  for (const f of ["app-exec", "fence.mjs", "manifest.mjs"]) copyFileSync(join(ENGINE, "apps", f), join(eng, "apps", f));
  chmodSync(join(eng, "apps", "app-exec"), 0o755);
  for (const f of ["config.mjs", "config.py", "config.sh"]) copyFileSync(join(ENGINE, "lib", f), join(eng, "lib", f));
  const raw = JSON.parse(readFileSync(join(ENGINE, "config.json"), "utf8"));
  raw.stateRoot = join(root, "s");
  raw.paperclip.instanceRoot = join(root, "instance");
  raw.doors.generate.apps = ["fix", "lnk"];
  writeFileSync(join(eng, "config.json"), JSON.stringify(raw));
  symlinkSync(realpathSync(join(ENGINE, "node_modules")), join(eng, "node_modules"));
  port = await freeAppPort();
  const others = await freeAppPort().then((p) => p);
  linkPort = others === port ? port - 1 : others;
  const outerSock = join(root, "outer.sock");
  for (const [slug, p, mode] of [["fix", port, ""], ["lnk", linkPort, "link"]]) {
    const folder = join(root, "apps", slug);
    mkdirSync(folder, { recursive: true });
    const m = JSON.parse(readFileSync(join(FIXTURE, "app.json"), "utf8"));
    writeFileSync(join(folder, "app.json"), JSON.stringify({ ...m, slug, name: `App ${slug}`, port: p }));
    copyFileSync(join(FIXTURE, "icon.svg"), join(folder, "icon.svg"));
    copyFileSync(join(FIXTURE, "server.mjs"), join(folder, "server.mjs"));
    writeFileSync(join(folder, "READY"), "");
    // The fixture's mode, where a fenced run can read it: its own data folder.
    const data = join(root, "s", "apps", slug, "data");
    mkdirSync(data, { recursive: true, mode: 0o700 });
    writeFileSync(join(data, "fixture.json"), JSON.stringify({ mode, target: outerSock }));
  }
  outer = net.createServer((s) => { outerHits += 1; s.end("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nOUTER"); });
  await new Promise((ok) => outer.listen(outerSock, ok));
  // The host's config: the temp engine's own, as main() would load it there, with the apps'
  // folder beside it, its own address on port 0, and the fake parts.
  const cfg = loadConfig({ path: join(eng, "config.json") });
  cfg.paths.appsCode = join(root, "apps");
  cfg.ports.apps = 0;
  mkdirSync(join(cfg.paths.state, "secrets", "doors"), { recursive: true, mode: 0o700 });
  mkdirSync(join(cfg.paths.state, "secrets", "provider"), { recursive: true, mode: 0o700 });
  const doorSecret = randomBytes(32).toString("hex");
  const relaySecret = randomBytes(32).toString("hex");
  writeFileSync(cfg.paths.generateSecret, `${doorSecret}\n`, { mode: 0o600 });
  writeFileSync(cfg.paths.relaySecret, `${relaySecret}\n`, { mode: 0o600 });
  w = { cfg, paths: cfg.paths, code: cfg.paths.appsCode, doorSecret, relaySecret, root };
  parts = await fakeParts(w);
  host = createAppHost({ cfg, log: (l) => lines.push(l), spawnApp: appExecSpawner(join(eng, "apps", "app-exec")), limits: { everyMs: 300 } });
  await host.listen();
  mkdirSync(cfg.paths.apps, { recursive: true, mode: 0o700 });
  writeFileSync(cfg.paths.appsState, JSON.stringify({ version: 1, apps: { fix: { on: true }, lnk: { on: true } }, changedAt: "2026-11-13T07:00:00.000Z" }), { mode: 0o600 });
  await waitFor(() => host.app("fix")?.state === "on" && host.app("lnk")?.state === "failed", 60000, 200);
});

after(async () => {
  if (host) await host.close();
  if (parts) await parts.close();
  if (outer) await new Promise((ok) => outer.close(ok));
  if (root) rmSync(root, { recursive: true, force: true });
});

test("real fence: the app comes on, reached only through its browser port, with this Mac's ffmpeg and ffprobe named", { skip: SKIP }, async () => {
  assert.equal(host.app("fix").state, "on", lines.join("\n"));
  const env = jsonOf(await send({ port, path: "/env", headers: own(port) }));
  assert.equal(env.FFMPEG, "/opt/homebrew/bin/ffmpeg");
  assert.equal(env.FFPROBE, "/opt/homebrew/bin/ffprobe");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.APP_SOCKET, join(realpathSync(w.paths.appsRun), "fix", "app.sock"));
  assert.equal(env.ENGINE_SOCKET, join(realpathSync(w.paths.appsRun), "fix", "engine.sock"));
  assert.notEqual(env.pid, host.app("fix").pid, "the app is inside the sandbox tool, not the group's first process");
});

test("real fence: the whole way, the browser → the fenced app → its engine socket → the door, as this app", { skip: SKIP }, async () => {
  const r = await send({ port, method: "POST", path: "/x", headers: { ...own(port), Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json" },
    body: JSON.stringify({ method: "GET", path: "/gen/app/allowance" }) });
  assert.equal(r.status, 200, r.body.toString());
  const got = jsonOf(r);
  assert.equal(got.status, 200, JSON.stringify(got));
  assert.equal(JSON.parse(got.body).app, "fix");
  const c = parts.calls[parts.calls.length - 1];
  assert.deepEqual(c.who, { kind: "p", slug: "app-fix", app: "fix", subject: "app-fix" });
  const relay = await send({ port, method: "POST", path: "/x", headers: { ...own(port), Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json" },
    body: JSON.stringify({ method: "POST", path: "/v1/messages", body: { messages: [] } }) });
  assert.match(JSON.parse(jsonOf(relay).body).content[0].text, /hello app-fix/);
});

test("real fence: app.sock is moved where the app cannot reach; a link the app plants at that name is never followed", { skip: SKIP }, async () => {
  const run = join(w.paths.appsRun, "fix");
  assert.equal(existsSync(join(run, "app.sock")), false);
  assert.ok(lstatSync(join(w.paths.appsRun, ".host", "fix")).isSocket());
  const planted = jsonOf(await send({ port, path: "/plant", headers: own(port) }));
  assert.equal(planted.plant, "ok", "the fence lets an app make a link in its run folder (T65's finding)");
  assert.ok(lstatSync(join(run, "app.sock")).isSymbolicLink());
  for (let i = 0; i < 5; i += 1) {
    const r = await send({ port, path: "/echo", headers: own(port) });
    assert.equal(r.status, 200);
    assert.equal(jsonOf(r).url, "/echo");
  }
  assert.equal(outerHits, 0);
});

test("real fence: an app whose app.sock is a link from the start fails, and the socket it named is never reached", { skip: SKIP }, () => {
  assert.equal(host.app("lnk").state, "failed", lines.join("\n"));
  assert.equal(host.app("lnk").why, "app_socket_not_a_socket");
  assert.equal(outerHits, 0);
  assert.equal(host.app("lnk").pid, null);
});

test("real fence: the app can neither move, remove nor replace its run folder, nor link in a socket from outside", { skip: SKIP }, async () => {
  const got = jsonOf(await send({ port, path: "/attack", headers: own(port) }));
  assert.deepEqual(got, { renameRun: "EPERM", rmdirRun: "EPERM", linkOverRun: "EPERM", folderOverRun: "EPERM", hardLink: "EPERM" });
  const run = join(w.paths.appsRun, "fix");
  assert.ok(lstatSync(run).isDirectory() && !lstatSync(run).isSymbolicLink());
  assert.equal((await send({ port, path: "/echo", headers: own(port) })).status, 200, "the host still reaches the app");
  assert.equal(outerHits, 0);
});

test("real fence: switched off, the fenced app and everything it started end, and its folders are emptied", { skip: SKIP }, async () => {
  const env = jsonOf(await send({ port, path: "/env", headers: own(port) }));
  const kids = jsonOf(await send({ port, path: "/child", headers: own(port) }));
  const group = host.app("fix").pid;
  assert.ok(alive(env.pid) && alive(kids.kid) && alive(kids.away));
  writeFileSync(w.paths.appsState, JSON.stringify({ version: 1, apps: { fix: { on: false }, lnk: { on: true } }, changedAt: "2026-11-13T07:05:00.000Z" }), { mode: 0o600 });
  assert.ok(await waitFor(() => host.app("fix").state === "off", 20000, 200));
  await waitFor(() => !alive(env.pid) && !alive(kids.kid) && !alive(kids.away), 3000);
  assert.equal(alive(group), false, "the sandbox tool");
  assert.equal(alive(env.pid), false, "the app inside it");
  assert.equal(alive(kids.kid), false, "its child");
  assert.equal(alive(kids.away), false, "a helper it started in a session of its own");
  assert.equal(existsSync(join(w.paths.appsRun, "fix", "engine.sock")), false);
  assert.equal(existsSync(join(w.paths.appsRun, ".host", "fix")), false);
});
