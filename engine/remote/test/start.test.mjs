// `engine start`, `stop` and `status` with the remote door, in a copy of the engine that holds only the door's
// part, so nothing else is started. PLAN-DESKTOP T8 test 13, under rule 3.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ENGINE_DIR, listening, makeWorld, newKey, onTerminal, seed, waitFor } from "./helpers.mjs";

let w;
let engine;
before(async () => {
  w = await makeWorld();
  const copy = join(w.root, "engine");
  for (const d of ["parts", "bin", join("mac", "Resources")]) mkdirSync(join(copy, d), { recursive: true });
  for (const f of ["_lib.sh", "41-remote.sh"]) cpSync(join(ENGINE_DIR, "parts", f), join(copy, "parts", f));
  cpSync(join(ENGINE_DIR, "lib"), join(copy, "lib"), { recursive: true });
  cpSync(join(ENGINE_DIR, "bin", "engine"), join(copy, "bin", "engine"));
  cpSync(join(ENGINE_DIR, "remote"), join(copy, "remote"), { recursive: true, filter: (src) => !src.includes("/remote/test") });
  cpSync(join(ENGINE_DIR, "mac", "Resources", "icon-1024.png"), join(copy, "mac", "Resources", "icon-1024.png"));
  engine = (...args) => spawnSync("/bin/bash", [join(copy, "bin", "engine"), ...args], { encoding: "utf8", env: w.env, timeout: 120000 });
  mkdirSync(join(w.root, "stick"));
  const r = engine("remote", "kit", join(w.root, "stick"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
after(() => w?.cleanup());

const sshdRunning = () => spawnSync("/usr/bin/pgrep", ["-f", join(w.state, "remote", "sshd_config")]).status === 0;
const awakePid = () => {
  const f = join(w.state, "run", "remote-awake.pid");
  return existsSync(f) ? Number(readFileSync(f, "utf8").trim()) : 0;
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("13. engine start starts the door only with its marker and an allowed seat; engine stop stops it", async () => {
  seed(w, [{ n: 1, role: "desk", key: newKey(w.keys, "pc").key }]);
  const home = `Open http://127.0.0.1:${w.cfg.ports.home}`;
  // no marker: no door, and status says so
  let r = engine("start");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.stdout.trim().split("\n"), [`Everything is on. ${home}`]);
  assert.equal(await listening(w.cfg.ports.remote), false);
  assert.equal(sshdRunning(), false);
  r = engine("status");
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.stdout.trim().split("\n"), ["remote door: off", "Everything is on."]);
  assert.equal(engine("remote", "status").stdout, "remote door: off\n");

  // the marker, as `engine remote on` writes it
  writeFileSync(join(w.remoteDir, "on"), new Date().toISOString() + "\n", { mode: 0o600 });
  r = engine("start");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.stdout.trim().split("\n"), ["Starting remote door...", `Everything is on. ${home}`]);
  assert.ok(await waitFor(() => listening(w.cfg.ports.remote)));
  assert.ok(sshdRunning());
  const awake = awakePid();
  assert.ok(awake > 0 && alive(awake), "caffeinate is not running");
  assert.match(spawnSync("/bin/ps", ["-o", "command=", "-p", String(awake)], { encoding: "utf8" }).stdout, /^\/usr\/bin\/caffeinate -s -w \d+/);
  r = engine("status");
  assert.deepEqual(r.stdout.trim().split("\n"), ["remote door: on, 1 PC(s) allowed", "Everything is on."]);
  r = engine("start");
  assert.match(r.stdout, /^Remote door is already on\.$/m);

  r = engine("stop");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.stdout.trim().split("\n"), ["Stopped remote door."]);
  assert.equal(await listening(w.cfg.ports.remote), false);
  assert.equal(sshdRunning(), false);
  assert.ok(await waitFor(() => !alive(awake), 5000), "caffeinate outlived the door");
  // the marker stays: the door is still switched on, so status asks for attention
  r = engine("status");
  assert.equal(r.status, 1);
  assert.deepEqual(r.stdout.trim().split("\n"), ["remote door: off", "Needs attention: Remote door."]);

  // marker, but no PC allowed: engine start says why and leaves the door off
  seed(w, [{ n: 1, role: "desk" }]);
  r = engine("start");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^Remote door did not come up: The remote door could not start: no PC is allowed yet\.$/m);
  assert.equal(sshdRunning(), false);
  unlinkSync(join(w.remoteDir, "on"));
  assert.equal(engine("stop").stdout, "");
});

test("the door's log keeps sshd's lines and the times it started and stopped", () => {
  const log = readFileSync(join(w.state, "logs", "remote.log"), "utf8");
  assert.match(log, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ the remote door started$/m);
  assert.match(log, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ the remote door stopped$/m);
  assert.match(log, /Server listening on 127\.0\.0\.1 port \d+\./);
  assert.doesNotMatch(log, /PRIVATE KEY|AAAAC3NzaC1lZDI1NTE5/);
});

test("remote on and off at a terminal, with a typed yes: the marker, the door, and back", async () => {
  seed(w, [{ n: 1, role: "view", key: newKey(w.keys, "pc-on").key }]);
  let r = w.tty(["on"], "no");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^Nothing was changed\.$/m);
  assert.equal(existsSync(join(w.remoteDir, "on")), false);
  r = w.tty(["on"], "yes");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^Type yes to open the remote door\.$/m);
  assert.match(r.stdout, /^The remote door is on\.$/m);
  assert.ok(existsSync(join(w.remoteDir, "on")));
  assert.ok(await listening(w.cfg.ports.remote));
  assert.equal(w.cli(["status"]).stdout, "remote door: on, 1 PC(s) allowed\n");
  r = w.tty(["off"], "yes");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^remote door: off$/m);
  assert.equal(existsSync(join(w.remoteDir, "on")), false);
  assert.equal(await listening(w.cfg.ports.remote), false);
  assert.equal(sshdRunning(), false);
  // with no PC allowed, on refuses and leaves no marker
  seed(w, [{ n: 1, role: "view" }]);
  r = w.tty(["on"], "yes");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^The remote door could not start: no PC is allowed yet\.$/m);
  assert.equal(existsSync(join(w.remoteDir, "on")), false);
});

// The commands with a stand-in for the door's part, which records what it was asked and answers as told: a start
// that fails, a stop that fails, a door running with no marker (REVIEW-DESKTOP M2).
test("M2. on stops a door whose start failed before the marker goes; off keeps the marker when the stop failed", () => {
  const copy = join(w.root, "fake");
  mkdirSync(join(copy, "parts"), { recursive: true });
  cpSync(join(ENGINE_DIR, "lib"), join(copy, "lib"), { recursive: true });
  cpSync(join(ENGINE_DIR, "remote"), join(copy, "remote"), { recursive: true, filter: (src) => !src.includes("/remote/test") });
  const calls = join(w.root, "fake-calls");
  const running = join(w.root, "fake-running");
  writeFileSync(join(copy, "parts", "41-remote.sh"), [
    "#!/bin/bash",
    'echo "$1" >>"$FAKE_CALLS"',
    'case "$1" in',
    '  start) touch "$FAKE_RUNNING"; echo "The remote door is running but not answering."; exit "${FAKE_START:-0}" ;;',
    '  stop) if [ "${FAKE_STOP:-0}" = 0 ]; then rm -f "$FAKE_RUNNING"; else echo "Something is still answering where the remote door runs."; fi; exit "${FAKE_STOP:-0}" ;;',
    '  health) if [ -f "$FAKE_RUNNING" ]; then exit 0; fi; exit 1 ;;',
    "esac",
  ].join("\n") + "\n", { mode: 0o755 });
  const cli = join(copy, "remote", "remote.mjs");
  const marker = join(w.remoteDir, "on");
  const run = (args, extra = {}) => {
    rmSync(calls, { force: true });
    const r = onTerminal([process.execPath, cli, ...args], "yes", { ...w.env, FAKE_CALLS: calls, FAKE_RUNNING: running, ...extra });
    const asked = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
    return { ...r, asked: asked.filter((x) => x !== "health") };
  };
  const status = (extra = {}) => spawnSync(process.execPath, [cli, "status"], { encoding: "utf8", env: { ...w.env, FAKE_CALLS: calls, FAKE_RUNNING: running, ...extra } }).stdout;
  seed(w, [{ n: 1, role: "desk", key: newKey(w.keys, "fake-pc").key }]);
  rmSync(marker, { force: true });
  rmSync(running, { force: true });

  // (3) a start that fails: the part is stopped, then the marker goes
  let r = run(["on"], { FAKE_START: "1" });
  assert.equal(r.status, 1, r.stdout);
  assert.deepEqual(r.asked, ["start", "stop"]);
  assert.equal(existsSync(marker), false);
  assert.equal(existsSync(running), false);
  // ... and when that stop fails too, the marker stays, so nothing says off while the door may run
  r = run(["on"], { FAKE_START: "1", FAKE_STOP: "1" });
  assert.equal(r.status, 1);
  assert.deepEqual(r.asked, ["start", "stop"]);
  assert.equal(existsSync(marker), true);
  assert.match(r.stdout, /^Something is still answering where the remote door runs\.$/m);
  // (1) status follows the running door, not the marker
  rmSync(marker);
  assert.equal(status(), "remote door: on, 1 PC(s) allowed\n");
  // (4) off with a stop that fails: the marker stays and off is not said
  writeFileSync(marker, "test\n", { mode: 0o600 });
  r = run(["off"], { FAKE_STOP: "1" });
  assert.equal(r.status, 1);
  assert.equal(existsSync(marker), true);
  assert.doesNotMatch(r.stdout, /remote door: off/);
  // a stop that works: then the marker goes
  r = run(["off"]);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.asked, ["stop"]);
  assert.equal(existsSync(marker), false);
  assert.equal(status(), "remote door: off\n");
  // (2) running with no marker: remove stops it and, with no PC left, does not start it again
  writeFileSync(running, "");
  r = run(["remove", "1"]);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.asked, ["stop"]);
  // a stop that fails while a PC is removed is said, and the command fails
  seed(w, [{ n: 1, role: "desk", key: newKey(w.keys, "fake-pc2").key }, { n: 2, role: "desk", key: newKey(w.keys, "fake-pc3").key }]);
  writeFileSync(running, "");
  r = run(["remove", "2"], { FAKE_STOP: "1" });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^Something is still answering where the remote door runs\.$/m);
  rmSync(running, { force: true });
});
