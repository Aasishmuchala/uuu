import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, cpSync,
  chmodSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createServer, connect } from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const engineDir = join(here, "..", "..");
const engineCmd = join(engineDir, "bin", "engine");
const realConfig = JSON.parse(readFileSync(join(engineDir, "config.json"), "utf8"));

// A temp folder with a config whose state is inside it, and a folder of fake
// parts. Each fake part keeps its on/off state in files in that folder and
// records every call in calls.log.
function setup(parts) {
  const root = mkdtempSync(join(tmpdir(), "enginetest-"));
  const state = join(root, "state");
  const fake = join(root, "fake");
  const partsDir = join(root, "parts");
  mkdirSync(state); mkdirSync(fake); mkdirSync(partsDir);
  const cfg = JSON.parse(JSON.stringify(realConfig));
  cfg.stateRoot = state;
  const cfgPath = join(root, "config.json");
  writeFileSync(cfgPath, JSON.stringify(cfg));
  for (const [file, name] of parts) {
    const id = file.replace(/^\d\d-/, "").replace(/\.sh$/, "");
    const p = join(partsDir, file);
    writeFileSync(p, `#!/bin/bash
# part-name: ${name}
id=${id}
F="$FAKE_DIR"
echo "$id $1" >> "$F/calls.log"
case "$1" in
  installed)
    if [ -f "$F/$id.missing" ]; then echo "${name} is not here."; exit 1; fi
    exit 0 ;;
  health)
    if [ -f "$F/$id.on" ]; then echo "${name} is on."; exit 0
    elif [ -f "$F/$id.sick" ]; then echo "${name} is sick."; exit 2
    else echo "${name} is off."; exit 1; fi ;;
  start)
    if [ -f "$F/$id.fail" ]; then echo "${name} broke."; echo "noise" >&2; exit 1; fi
    echo x >> "$F/$id.starts"
    touch "$F/$id.on" ;;
  stop)
    if [ -f "$F/$id.stuck" ]; then exit 1; fi
    rm -f "$F/$id.on" ;;
esac
`);
    chmodSync(p, 0o755);
  }
  const run = (...args) => spawnSync("/bin/bash", [engineCmd, ...args], {
    encoding: "utf8",
    env: { ...process.env, ENGINE_CONFIG: cfgPath, ENGINE_PARTS_DIR: partsDir, FAKE_DIR: fake },
  });
  const touch = (name) => writeFileSync(join(fake, name), "");
  const calls = () => existsSync(join(fake, "calls.log"))
    ? readFileSync(join(fake, "calls.log"), "utf8").trim().split("\n") : [];
  const starts = (id) => existsSync(join(fake, `${id}.starts`))
    ? readFileSync(join(fake, `${id}.starts`), "utf8").trim().split("\n").length : 0;
  return { root, state, fake, cfgPath, run, touch, calls, starts };
}

const THREE = [["10-alpha.sh", "Alpha"], ["20-beta.sh", "Beta"], ["30-gamma.sh", "Gamma ray"]];
const only = (calls, sub) => calls.filter((c) => c.endsWith(" " + sub)).map((c) => c.split(" ")[0]);

test("unknown or missing subcommand: usage on stderr, exit 64", () => {
  const t = setup(THREE);
  for (const args of [["nonsense"], []]) {
    const r = t.run(...args);
    assert.equal(r.status, 64);
    assert.match(r.stderr, /Usage: engine/);
    assert.equal(r.stdout, "");
  }
});

test("start runs parts in name order and ends with the pinned line", () => {
  const t = setup(THREE);
  const r = t.run("start");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(only(t.calls(), "start"), ["alpha", "beta", "gamma"]);
  const lines = r.stdout.trim().split("\n");
  assert.deepEqual(lines, [
    "Starting alpha...", "Starting beta...", "Starting gamma ray...",
    "Everything is on. Open http://127.0.0.1:3200",
  ]);
  assert.equal(r.stderr, "");
});

test("running start twice starts nothing twice", () => {
  const t = setup(THREE);
  assert.equal(t.run("start").status, 0);
  const r = t.run("start");
  assert.equal(r.status, 0);
  for (const id of ["alpha", "beta", "gamma"]) assert.equal(t.starts(id), 1, id);
  assert.match(r.stdout, /^Alpha is already on\.$/m);
  assert.doesNotMatch(r.stdout, /Starting/);
});

test("start stops at the first failing part, names it and exits 1", () => {
  const t = setup(THREE);
  t.touch("beta.fail");
  const r = t.run("start");
  assert.equal(r.status, 1);
  assert.deepEqual(only(t.calls(), "start"), ["alpha", "beta"]);
  assert.equal(t.starts("gamma"), 0);
  assert.match(r.stdout, /^Beta did not come up: Beta is off\.$/m);
  assert.match(r.stdout, /^Beta broke\.$/m);
  assert.match(r.stdout, new RegExp(`^Check ${t.state}/logs/beta\\.log\\. Then run: engine start$`, "m"));
  assert.doesNotMatch(r.stdout, /Everything is on/);
  // the part's error output goes to its log, never to the screen
  assert.doesNotMatch(r.stdout + r.stderr, /noise/);
  assert.match(readFileSync(join(t.state, "logs", "beta.log"), "utf8"), /noise/);
  // earlier parts are left running
  assert.ok(existsSync(join(t.fake, "alpha.on")));
});

test("a part that is not installed is skipped by start and does not fail status", () => {
  const t = setup(THREE);
  t.touch("beta.missing");
  const r = t.run("start");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^Beta: not installed, skipped$/m);
  assert.equal(t.starts("beta"), 0);
  assert.match(r.stdout, /^Everything that is installed is on\.$/m);
  const s = t.run("status");
  assert.equal(s.status, 0, s.stdout);
  assert.deepEqual(s.stdout.trim().split("\n"), [
    "Alpha         on             Alpha is on.",
    "Beta          not installed  Beta is not here.",
    "Gamma ray     on             Gamma ray is on.",
    "Everything is on.",
  ]);
});

test("status: one line per part in the pinned format, then the final line", () => {
  const t = setup(THREE);
  t.touch("alpha.on");
  t.touch("gamma.sick");
  const r = t.run("status");
  assert.equal(r.status, 1);
  const want = (n, s, x) => `${n.padEnd(13)} ${s.padEnd(14)} ${x}`;
  assert.deepEqual(r.stdout.trim().split("\n"), [
    want("Alpha", "on", "Alpha is on."),
    want("Beta", "off", "Beta is off."),
    want("Gamma ray", "unhealthy", "Gamma ray is sick."),
    "Needs attention: Beta, Gamma ray.",
  ]);
  assert.equal(only(t.calls(), "start").length, 0, "status only looks");
  assert.equal(only(t.calls(), "stop").length, 0, "status only looks");
  t.touch("beta.on");
  rmSync(join(t.fake, "gamma.sick"));
  t.touch("gamma.on");
  const all = t.run("status");
  assert.equal(all.status, 0);
  assert.match(all.stdout, /\nEverything is on\.\n$/);
});

test("stop runs parts in reverse order", () => {
  const t = setup(THREE);
  t.touch("alpha.on");
  t.touch("gamma.on");
  const r = t.run("stop");
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(only(t.calls(), "stop"), ["gamma", "beta", "alpha"]);
  assert.deepEqual(r.stdout.trim().split("\n"), [
    "Stopped gamma ray.", "Beta was not running.", "Stopped alpha.",
  ]);
});

test("stop exits 1 when a part stays on", () => {
  const t = setup(THREE);
  t.touch("beta.on");
  t.touch("beta.stuck");
  const r = t.run("stop");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^Beta did not stop: Beta is on\.$/m);
  assert.match(r.stdout, /^Alpha was not running\.$/m);
  assert.match(r.stdout, /^Check .*beta\.log\. Then run: engine stop$/m);
});

test("setup refuses when there is no board on", () => {
  const t = setup([["20-board.sh", "Board"]]);
  const r = t.run("setup");
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), "Start the engine first: engine start");
});

function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
function listening(port) {
  return new Promise((resolve) => {
    const c = connect(port, "127.0.0.1");
    c.on("connect", () => { c.destroy(); resolve(true); });
    c.on("error", () => resolve(false));
  });
}

// A copy of engine/ with parts/ and lib/ only, on unused ports.
async function engineCopy() {
  const root = mkdtempSync(join(tmpdir(), "enginecopy-"));
  const copy = join(root, "engine");
  mkdirSync(copy);
  cpSync(join(engineDir, "parts"), join(copy, "parts"), { recursive: true });
  cpSync(join(engineDir, "lib"), join(copy, "lib"), { recursive: true });
  const cfg = JSON.parse(JSON.stringify(realConfig));
  cfg.stateRoot = join(root, "state");
  for (const k of Object.keys(cfg.ports)) cfg.ports[k] = await freePort();
  const cfgPath = join(root, "config.json");
  writeFileSync(cfgPath, JSON.stringify(cfg));
  const board = (sub) => spawnSync("/bin/bash", [join(copy, "parts", "20-board.sh"), sub], {
    encoding: "utf8", env: { ...process.env, ENGINE_CONFIG: cfgPath },
  });
  return { root, copy, cfg, board };
}

test("the board refuses to start when the fence is not there", async () => {
  const c = await engineCopy();
  const r = c.board("start");
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /^The fence is not in place, so the board was not started: .+/m);
  assert.equal(await listening(c.cfg.ports.board), false);
  assert.equal(existsSync(join(c.root, "state", "run", "board.pid")), false);
});

test("the board refuses to start when the fence fails its own check", async () => {
  const c = await engineCopy();
  mkdirSync(join(c.copy, "fence", "bin"), { recursive: true });
  const fr = join(c.copy, "fence", "fence-run");
  writeFileSync(fr, "#!/bin/bash\necho 'the sandbox tool is missing.'\nexit 1\n");
  chmodSync(fr, 0o755);
  const r = c.board("start");
  assert.equal(r.status, 3);
  assert.match(r.stdout,
    /^The fence is not in place, so the board was not started: the sandbox tool is missing\.$/m);
  assert.equal(await listening(c.cfg.ports.board), false);
});

test("the board refuses to start when the fenced wrappers are not first on its PATH", async () => {
  const c = await engineCopy();
  mkdirSync(join(c.copy, "fence", "bin"), { recursive: true });
  const fr = join(c.copy, "fence", "fence-run");
  writeFileSync(fr, "#!/bin/bash\nexit 0\n");
  chmodSync(fr, 0o755);
  // only claude is there; codex would be found elsewhere or not at all
  const cl = join(c.copy, "fence", "bin", "claude");
  writeFileSync(cl, "#!/bin/bash\nexit 0\n");
  chmodSync(cl, 0o755);
  const r = c.board("start");
  assert.equal(r.status, 3);
  assert.match(r.stdout, /^The fence is not in place, so the board was not started: the fenced claude and codex/m);
  assert.equal(await listening(c.cfg.ports.board), false);
});

test("part scripts answer health, installed and stop safely when nothing runs", async () => {
  const c = await engineCopy();
  for (const part of ["30-gate.sh", "40-home.sh"]) {
    const run = (sub) => spawnSync("/bin/bash", [join(c.copy, "parts", part), sub], {
      encoding: "utf8", env: { ...process.env, ENGINE_CONFIG: join(c.root, "config.json") },
    });
    const inst = run("installed");
    assert.equal(inst.status, 1, part);
    assert.match(inst.stdout, /is not installed yet\./);
    const h = run("health");
    assert.equal(h.status, 1, part);
    assert.match(h.stdout, /is off; run engine start to turn it on\./);
    assert.equal(run("stop").status, 0, part);
    const bad = run("nonsense");
    assert.equal(bad.status, 64);
  }
  const h = c.board("health");
  assert.equal(h.status, 1);
  assert.equal(h.stdout.trim(), "The board is off; run engine start to turn it on.");
});
