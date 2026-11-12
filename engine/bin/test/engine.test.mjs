import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, cpSync,
  chmodSync, rmSync, realpathSync,
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

// A copy of the engine command and its config loader only (no apply, no books,
// no Drafter's tools), so setup and test touch nothing real.
function commandCopy(t) {
  const copy = join(t.root, "engine");
  mkdirSync(join(copy, "bin"), { recursive: true });
  mkdirSync(join(copy, "lib"));
  cpSync(engineCmd, join(copy, "bin", "engine"));
  for (const f of ["config.sh", "config.py"]) cpSync(join(engineDir, "lib", f), join(copy, "lib", f));
  const run = (...args) => spawnSync("/bin/bash", [join(copy, "bin", "engine"), ...args], {
    encoding: "utf8",
    env: { ...process.env, ENGINE_CONFIG: t.cfgPath, ENGINE_PARTS_DIR: join(t.root, "parts"), FAKE_DIR: t.fake },
  });
  return { copy, run };
}

test("setup prints the line of the Artist's tools check and installs nothing", () => {
  const t = setup([["20-board.sh", "Board"]]);
  t.touch("board.on");
  const c = commandCopy(t);
  mkdirSync(join(c.copy, "art"));
  writeFileSync(join(c.copy, "art", "install.sh"), `#!/bin/bash
if [ "\${1:-}" = "--check-only" ]; then echo "Artist's tools: installed"; exit 0; fi
touch "$FAKE_DIR/art.installed"
`);
  const r = c.run("setup");
  assert.match(r.stdout, /^Artist's tools: installed$/m, r.stdout + r.stderr);
  assert.equal(existsSync(join(t.fake, "art.installed")), false, "setup only checks");
  // without the file, no line
  rmSync(join(c.copy, "art"), { recursive: true });
  const r2 = c.run("setup");
  assert.doesNotMatch(r2.stdout, /Artist's tools/);
});

test("setup prints the line of the speech model check and copies nothing", () => {
  const t = setup([["20-board.sh", "Board"]]);
  t.touch("board.on");
  const c = commandCopy(t);
  mkdirSync(join(c.copy, "media"));
  writeFileSync(join(c.copy, "media", "install.sh"), `#!/bin/bash
if [ "\${1:-}" = "--check-only" ]; then echo "Speech model: not in place"; exit 1; fi
touch "$FAKE_DIR/media.installed"
`);
  const r = c.run("setup");
  assert.match(r.stdout, /^Speech model: not in place$/m, r.stdout + r.stderr);
  assert.equal(existsSync(join(t.fake, "media.installed")), false, "setup only checks");
  rmSync(join(c.copy, "media"), { recursive: true });
  const r2 = c.run("setup");
  assert.doesNotMatch(r2.stdout, /Speech model/);
});

test("test also runs the Python tests in engine/art/tests", () => {
  const t = setup([]);
  const c = commandCopy(t);
  const dir = join(c.copy, "art", "tests");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "test_art.py"), `import os, unittest

class ArtTest(unittest.TestCase):
    def test_marker(self):
        open(os.path.join(os.environ["FAKE_DIR"], "art.tests"), "w").close()
        self.assertFalse(os.path.exists(os.path.join(os.environ["FAKE_DIR"], "art.fail")))
`);
  const r = c.run("test");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Running the Python tests in engine\/art\/tests\.\.\.$/m);
  assert.match(r.stdout, /^All tests passed\.$/m);
  assert.ok(existsSync(join(t.fake, "art.tests")));
  t.touch("art.fail");
  const bad = c.run("test");
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^Some tests failed\. The lines above say which\.$/m);
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

// A fence that passes its own check, with fenced claude and codex in place.
function fakeFence(c, { git }) {
  mkdirSync(join(c.copy, "fence", "bin"), { recursive: true });
  const fr = join(c.copy, "fence", "fence-run");
  writeFileSync(fr, "#!/bin/bash\nexit 0\n");
  chmodSync(fr, 0o755);
  for (const name of ["claude", "codex"]) {
    const p = join(c.copy, "fence", "bin", name);
    writeFileSync(p, "#!/bin/bash\nexit 0\n");
    chmodSync(p, 0o755);
  }
  if (git) cpSync(join(engineDir, "fence", "bin", "git"), join(c.copy, "fence", "bin", "git"));
}

test("the board refuses to start when the engine's git is not first on its PATH", async () => {
  const c = await engineCopy();
  fakeFence(c, { git: false });
  const r = c.board("start");
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout,
    /^The fence is not in place, so the board was not started: the engine's git is not the first one the board would find\.$/m);
  assert.equal(await listening(c.cfg.ports.board), false);
  assert.equal(existsSync(join(c.root, "state", "run", "board.pid")), false);
});

// What an agent can write in its task folder: a repository laid out directly
// in it, whose file-watcher setting names a program that leaves a mark.
function plantRepository(folder) {
  const mark = join(folder, "MARKED");
  mkdirSync(join(folder, "objects"), { recursive: true });
  mkdirSync(join(folder, "refs", "heads"), { recursive: true });
  writeFileSync(join(folder, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(folder, "watch.sh"), `#!/bin/sh\necho ran > '${mark}'\n`);
  chmodSync(join(folder, "watch.sh"), 0o755);
  writeFileSync(join(folder, "config"), "[core]\n\trepositoryformatversion = 0\n\tbare = false\n" +
    `\tworktree = ${folder}\n\tfsmonitor = ${folder}/watch.sh\n`);
  return mark;
}

test("the board is started with the engine's git settings and no git variable of the caller's", async () => {
  const c = await engineCopy();
  fakeFence(c, { git: true });
  // a stand-in for paperclip: records its environment and answers health
  const envFile = join(c.root, "board-env.json");
  mkdirSync(join(c.copy, "node_modules", ".bin"), { recursive: true });
  const fake = join(c.copy, "node_modules", ".bin", "paperclipai");
  writeFileSync(fake, `#!/usr/bin/env node
require("fs").writeFileSync(${JSON.stringify(envFile)}, JSON.stringify(process.env));
require("http").createServer((q, s) => { s.end('{"status":"ok"}'); }).listen(${c.cfg.ports.board}, "127.0.0.1");
`);
  chmodSync(fake, 0o755);
  const r = spawnSync("/bin/bash", [join(c.copy, "parts", "20-board.sh"), "start"], {
    encoding: "utf8",
    env: { ...process.env, ENGINE_CONFIG: join(c.root, "config.json"),
      GIT_DIR: "/nowhere", GIT_SSH_COMMAND: "/bin/false", GIT_CONFIG_GLOBAL: "/nowhere/config" },
  });
  const pidFile = join(c.root, "state", "run", "board.pid");
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const env = JSON.parse(readFileSync(envFile, "utf8"));
    const gitConfig = join(c.root, "state", "git", "config");
    assert.equal(env.PATH.split(":")[0], join(realpathSync(c.copy), "fence", "bin"));
    const gitVars = Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("GIT_")));
    assert.deepEqual(gitVars, {
      GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1", GIT_CEILING_DIRECTORIES: process.env.HOME,
    });
    const text = readFileSync(gitConfig, "utf8");
    assert.match(text, /^\[safe\]\n\tbareRepository = explicit$/m);
    assert.match(text, /^\tfsmonitor = false$/m);
    assert.match(text, /^\thooksPath = \/dev\/null$/m);

    // git by its full path, past the wrapper, with only the board's environment
    const folder = mkdtempSync(join(tmpdir(), "boardgit-"));
    const mark = plantRepository(folder);
    const g = spawnSync("/usr/bin/git", ["-C", folder, "status", "--porcelain=v1", "--untracked-files=all"],
      { encoding: "utf8", env });
    assert.notEqual(g.status, 0);
    assert.match(g.stderr, /cannot use bare repository/);
    assert.equal(existsSync(mark), false, "the planted program ran");
    // and without those settings it would have run
    const plain = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("GIT_")));
    spawnSync("/usr/bin/git", ["-C", folder, "status", "--porcelain=v1"],
      { encoding: "utf8", env: { ...plain, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    assert.equal(existsSync(mark), true, "the planted repository is not a real test");
    rmSync(folder, { recursive: true, force: true });
  } finally {
    const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : 0;
    if (pid > 0) { try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ } }
  }
});

test("part scripts answer health, installed and stop safely when nothing runs", async () => {
  const c = await engineCopy();
  for (const part of ["30-gate.sh", "35-relay.sh", "36-web.sh", "37-generate.sh", "38-viewer.sh", "40-home.sh"]) {
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

test("a door is not installed until its READY marker is there, even with its code in place", async () => {
  const c = await engineCopy();
  for (const [part, dir, script, name] of [["36-web.sh", "web", "door.mjs", "web door"],
    ["37-generate.sh", "generate", "door.mjs", "generation door"], ["38-viewer.sh", "viewer", "viewer.mjs", "page viewer"]]) {
    const run = (sub) => spawnSync("/bin/bash", [join(c.copy, "parts", part), sub], {
      encoding: "utf8", env: { ...process.env, ENGINE_CONFIG: join(c.root, "config.json") },
    });
    mkdirSync(join(c.copy, dir), { recursive: true });
    writeFileSync(join(c.copy, dir, script), "process.exit(1);\n");
    let r = run("installed");
    assert.equal(r.status, 1, part);
    assert.equal(r.stdout.trim(), `The ${name} is not installed yet.`);
    r = run("start");
    assert.equal(r.status, 1, part);
    assert.equal(r.stdout.trim(), `The ${name} is not installed yet.`);
    assert.equal(existsSync(join(c.root, "state", "run", `${dir}.pid`)), false);
    writeFileSync(join(c.copy, dir, "READY"), "2026-11-12\n");
    r = run("installed");
    assert.equal(r.status, 0, part);
    r = run("health");
    assert.equal(r.stdout.trim(), `The ${name} is off; run engine start to turn it on.`);
  }
});
