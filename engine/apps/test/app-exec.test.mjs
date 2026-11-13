// app-exec (PLAN-V5 K18). Each test runs a copy of app-exec in a temp engine whose config puts
// the state folder in a temp folder (as test_fence_run.py does), with a fixture app beside it.
//   - A stand-in sandbox tool that only records what it was given: the refusals, the
//     folders, and the command and environment each mode builds from nothing.
//   - The real sandbox tool (engine/node_modules/.bin/srt): what the fixture app can and
//     cannot reach in each mode, from inside. Nothing here reaches the internet: every
//     probe of an outside address is refused before a packet leaves.
// Nothing is read from or written to the live engine's state. Short temp folders in
// /private/tmp keep every socket path under macOS's limit.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appFence } from "../fence.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = realpathSync(join(HERE, "..", ".."));
const OWNER_HOME = realpathSync(userInfo().homedir);
const NODE24 = realpathSync(join(OWNER_HOME, ".nvm", "versions", "node", "v24.13.0"));
const NODE = join(NODE24, "bin", "node");
const PNPM = join(NODE24, "lib", "node_modules", "pnpm", "bin", "pnpm.cjs");
const SRT = join(ENGINE, "node_modules", ".bin", "srt");
const UID = process.getuid();
const SRT_TMP = `/tmp/uuu-apps-${UID}`;
const SAFE_PATH = `${NODE24}/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
const REAL_SKIP = [SRT, NODE, "/opt/homebrew/bin/ffmpeg", "/opt/homebrew/bin/ffprobe"].every(existsSync)
  ? false : "the sandbox tool, Node 24, ffmpeg or ffprobe is missing on this Mac";

const STAND_IN_SRT = `#!/bin/bash
echo "cwd=$(pwd -P)"
env | LC_ALL=C sort | sed 's/^/env:/'
for a in "$@"; do echo "arg=$a"; done
`;
const MANIFEST = (slug, port, extra = {}) => ({
  version: 1, slug, name: `App ${slug}`, about: "A fixture app.", port, entry: ".build/index.mjs", client: "dist",
  engine: ["generate"], tools: ["ffmpeg", "ffprobe"], icon: "icon.svg", memoryMb: 256, ...extra,
});

// ---- the fixture app's code -------------------------------------------------------------

const PROBE_LIB = `
import { readFileSync } from "node:fs";
import net from "node:net";
export const T = JSON.parse(readFileSync("src/targets.json", "utf8"));
export function code(f) { try { f(); return "ok"; } catch (e) { return e.code || "error"; } }
export function reach(opts) {
  return new Promise((resolve) => {
    const s = net.connect(opts);
    const t = setTimeout(() => { s.destroy(); resolve("timeout"); }, 4000);
    s.on("data", (d) => { clearTimeout(t); s.destroy(); resolve("answered:" + d.toString().trim()); });
    s.on("connect", () => { if (!opts.wait) { clearTimeout(t); s.destroy(); resolve("connected"); } });
    s.on("error", (e) => { clearTimeout(t); resolve(e.code); });
  });
}
export function listen(where) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.on("error", (e) => resolve(e.code));
    s.listen(where, () => { s.close(); resolve("listening"); });
  });
}
// CONNECT through the sandbox tool's own proxy, the one port the command may reach.
export function viaProxy(target) {
  return new Promise((resolve) => {
    const u = new URL(process.env.HTTPS_PROXY);
    const auth = Buffer.from(decodeURIComponent(u.username) + ":" + decodeURIComponent(u.password)).toString("base64");
    const s = net.connect({ host: "127.0.0.1", port: Number(u.port) });
    const t = setTimeout(() => { s.destroy(); resolve("timeout"); }, 4000);
    let buf = "";
    s.on("connect", () => s.write("CONNECT " + target + " HTTP/1.1\\r\\nHost: " + target + "\\r\\nProxy-Authorization: Basic " + auth + "\\r\\n\\r\\n"));
    s.on("data", (d) => { buf += d; if (buf.includes("\\r\\n")) { clearTimeout(t); s.destroy(); resolve(buf.split("\\r\\n")[0]); } });
    s.on("error", (e) => { clearTimeout(t); resolve(e.code); });
  });
}
`;

// --test: each probe is one test of its own; every one passes only when the fence holds.
const REACH_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { T, code, listen, reach, viaProxy } from "./probe.mjs";

const said = (what: string, got: string) => { console.log("# probe " + what + " " + got); return got; };

test("reads nothing of the owner's home: ~/.ssh", () => {
  assert.equal(said("ssh", code(() => readdirSync(join(userInfo().homedir, ".ssh")))), "EPERM");
});
test("reads nothing of the owner's home: the engine's own config", () => {
  assert.equal(said("home-file", code(() => readFileSync(T.homeFile))), "EPERM");
});
test("reads nothing of the engine's state but its own folders", () => {
  assert.equal(said("state", code(() => readFileSync(T.stateSecret))), "EPERM");
  assert.equal(said("data-read", code(() => readFileSync(join(T.data, "kept.txt")))), "EPERM");
});
test("reads no other app", () => {
  assert.equal(said("other-app", code(() => readFileSync(T.otherApp))), "EPERM");
});
test("reads none of the system's temp areas", () => {
  assert.equal(said("var-folders", code(() => readdirSync("/private/var/folders"))), "EPERM");
  assert.equal(said("private-tmp", code(() => readdirSync("/private/tmp"))), "EPERM");
});
test("reaches no TCP port on this Mac", async () => {
  assert.equal(said("tcp-local", await reach({ host: "127.0.0.1", port: T.port })), "EPERM");
});
test("reaches no TCP port elsewhere", async () => {
  assert.equal(said("tcp-remote", await reach({ host: "192.0.2.1", port: 443 })), "EPERM");
});
test("cannot listen on a TCP port", async () => {
  assert.equal(said("tcp-listen", await listen({ host: "127.0.0.1", port: 0 })), "EPERM");
});
test("the sandbox tool's proxy opens nothing, local or remote", async () => {
  assert.match(said("proxy-local", await viaProxy("127.0.0.1:" + T.port)), /^HTTP\\/1\\.1 403/);
  assert.match(said("proxy-registry", await viaProxy("registry.npmjs.org:443")), /^HTTP\\/1\\.1 403/);
});
test("reaches no unix socket in a test run", async () => {
  assert.equal(said("unix", await reach({ path: T.outerSock })), "EPERM");
});
test("writes not its own code", () => {
  assert.equal(said("src", code(() => writeFileSync("src/planted.txt", "x"))), "EPERM");
  assert.equal(said("app-json", code(() => writeFileSync("app.json", "{}"))), "EPERM");
  assert.equal(said("build", code(() => writeFileSync(".build/planted.txt", "x"))), "EPERM");
});
test("writes not its data folder in a test run", () => {
  assert.equal(said("data-write", code(() => writeFileSync(join(T.data, "x.txt"), "x"))), "EPERM");
});
test("writes its temp folder, its home and its test data", () => {
  assert.equal(code(() => writeFileSync(join(process.env.TMPDIR!, "ok.txt"), "x")), "ok");
  assert.equal(code(() => writeFileSync(join(process.env.HOME!, "notes.md"), "x")), "ok");
  assert.equal(code(() => writeFileSync(join(process.env.APP_DATA!, "ok.json"), "{}")), "ok");
});
test("writes no program-config name, in any spelling", () => {
  const home = process.env.HOME!;
  const deep = join(process.env.TMPDIR!, "deep", "er");
  mkdirSync(deep, { recursive: true });
  for (const p of [join(home, "CLAUDE.md"), join(home, "claude.md"), join(home, "Agents.MD"), join(home, "AGENT\\u017f.md"),
    join(home, "AGENTS.override.md"), join(home, "CLAUDE.local.md"), join(deep, ".mcp.json"), join(deep, ".MCP.JSON")]) {
    assert.equal(said("config-file", code(() => writeFileSync(p, "x"))), "EPERM", p);
  }
  for (const p of [join(home, ".claude"), join(deep, ".Claude"), join(home, ".codex"), join(deep, ".agents")]) {
    assert.equal(said("config-folder", code(() => mkdirSync(p))), "EPERM", p);
  }
});
test("writes nothing in the sandbox tool's own temp folder", () => {
  for (const p of ["/private/tmp/claude", "/tmp/claude"]) {
    assert.equal(said("srt-tmp", code(() => mkdirSync(p))), "EPERM", p);
  }
});
test("its environment is built from nothing", () => {
  const e = process.env;
  for (const k of ["FENCE_X", "UUU_X", "NODE_OPTIONS", "ENGINE_CONFIG", "APP_SOCKET", "ENGINE_SOCKET", "PAPERCLIP_API_KEY"]) {
    assert.equal(e[k], undefined, k);
  }
  assert.equal(e.APP_DATA, join(T.tmp, "data"));
  assert.equal(e.APP_TMP, T.tmp);
  assert.equal(e.TMPDIR, T.tmp);
  assert.equal(e.HOME, T.home);
  assert.equal(e.PATH, T.path);
  assert.equal(e.NODE_ENV, "production");
  assert.equal(e.LANG, "en_US.UTF-8");
  assert.equal(e.FFMPEG, "/opt/homebrew/bin/ffmpeg");
  assert.equal(e.FFPROBE, "/opt/homebrew/bin/ffprobe");
});
test("this Mac's ffmpeg and ffprobe run inside", () => {
  assert.equal(spawnSync(process.env.FFMPEG!, ["-hide_banner", "-version"]).status, 0);
  assert.equal(spawnSync(process.env.FFPROBE!, ["-hide_banner", "-version"]).status, 0);
});
`;
const REACH_NAMES = [
  "reads nothing of the owner's home: ~/.ssh", "reads nothing of the owner's home: the engine's own config",
  "reads nothing of the engine's state but its own folders", "reads no other app", "reads none of the system's temp areas",
  "reaches no TCP port on this Mac", "reaches no TCP port elsewhere", "cannot listen on a TCP port",
  "the sandbox tool's proxy opens nothing, local or remote", "reaches no unix socket in a test run",
  "writes not its own code", "writes not its data folder in a test run", "writes its temp folder, its home and its test data",
  "writes no program-config name, in any spelling", "writes nothing in the sandbox tool's own temp folder",
  "its environment is built from nothing", "this Mac's ffmpeg and ffprobe run inside",
];

const FAIL_TEST = `import { test } from "node:test";
test("fails on purpose", () => { throw new Error("on purpose"); });
`;

// --run: a server on APP_SOCKET that probes what it can reach and answers with the results.
const SERVER = `import http from "node:http";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { T, code, listen, reach } from "../src/probe.mjs";

async function probe() {
  return {
    engine: await reach({ path: process.env.ENGINE_SOCKET, wait: true }),
    outerSock: await reach({ path: T.outerSock }),
    tcpLocal: await reach({ host: "127.0.0.1", port: T.port }),
    tcpListen: await listen({ host: "127.0.0.1", port: 0 }),
    sockInTmp: await listen(join(process.env.APP_TMP, "x.sock")),
    ssh: code(() => readdirSync(join(userInfo().homedir, ".ssh"))),
    homeFile: code(() => readFileSync(T.homeFile)),
    dataWrite: code(() => writeFileSync(join(process.env.APP_DATA, "note.txt"), "x")),
    dataConfig: code(() => writeFileSync(join(process.env.APP_DATA, "CLAUDE.md"), "x")),
    runConfig: code(() => writeFileSync(join(process.env.ENGINE_SOCKET, "..", "AGENTS.md"), "x")),
    src: code(() => writeFileSync("src/planted.txt", "x")),
    ready: code(() => writeFileSync("READY", "x")),
    env: { APP_SOCKET: process.env.APP_SOCKET, ENGINE_SOCKET: process.env.ENGINE_SOCKET, APP_DATA: process.env.APP_DATA,
      NODE_ENV: process.env.NODE_ENV, FENCE_X: process.env.FENCE_X ?? null, memory: process.execArgv },
  };
}
const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") { res.end("ok"); return; }
  if (req.url === "/probe") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(await probe())); return; }
  res.statusCode = 404; res.end();
});
server.listen(process.env.APP_SOCKET, () => console.log("listening"));
`;

// --build: what the build may and may not write.
const BUILD = `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { T, code } from "../src/probe.mjs";
const out = {
  build: code(() => writeFileSync(".build/built.txt", "built")),
  dist: code(() => { mkdirSync("dist", { recursive: true }); writeFileSync("dist/index.html", "<p>hi</p>"); }),
  src: code(() => writeFileSync("src/planted.txt", "x")),
  manifest: code(() => writeFileSync("app.json", "{}")),
  ready: code(() => writeFileSync("READY", "")),
  buildConfig: code(() => writeFileSync(".build/CLAUDE.md", "x")),
  distConfig: code(() => mkdirSync("dist/sub/.claude", { recursive: true })),
  dataRead: code(() => readFileSync(join(T.data, "kept.txt"))),
  dataWrite: code(() => writeFileSync(join(T.data, "x.txt"), "x")),
  home: code(() => writeFileSync(join(process.env.HOME, "cache.txt"), "x")),
};
console.log("BUILD " + JSON.stringify(out));
`;

// ---- the temp engines ---------------------------------------------------------------------

const cleanups = [];
after(() => { for (const f of cleanups.reverse()) { try { f(); } catch { /* best effort */ } } });

function makeWorld(prefix, { realSrt, stateName = "state" }) {
  const root = realpathSync(mkdtempSync(`/private/tmp/${prefix}`));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const eng = join(root, "engine");
  mkdirSync(join(eng, "apps"), { recursive: true });
  mkdirSync(join(eng, "lib"));
  for (const f of ["app-exec", "fence.mjs", "manifest.mjs"]) copyFileSync(join(ENGINE, "apps", f), join(eng, "apps", f));
  chmodSync(join(eng, "apps", "app-exec"), 0o755);
  for (const f of ["config.mjs", "config.py", "config.sh"]) copyFileSync(join(ENGINE, "lib", f), join(eng, "lib", f));
  const cfg = JSON.parse(readFileSync(join(ENGINE, "config.json"), "utf8"));
  cfg.stateRoot = join(root, stateName);
  cfg.paperclip.instanceRoot = join(root, "instance");
  writeFileSync(join(eng, "config.json"), JSON.stringify(cfg));
  if (realSrt) {
    symlinkSync(realpathSync(join(ENGINE, "node_modules")), join(eng, "node_modules"));
  } else {
    mkdirSync(join(eng, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(eng, "node_modules", ".bin", "srt"), STAND_IN_SRT, { mode: 0o755 });
  }
  const app = (slug, manifest, files = {}) => {
    const folder = join(root, "apps", slug);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "app.json"), JSON.stringify(manifest));
    writeFileSync(join(folder, "icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(folder, name)), { recursive: true });
      writeFileSync(join(folder, name), text);
    }
    return folder;
  };
  app("fix", MANIFEST("fix", 3172), {
    READY: "", "src/probe.mjs": PROBE_LIB, "src/reach.test.ts": REACH_TEST, "src/fail.test.ts": FAIL_TEST,
    ".build/index.mjs": SERVER, "scripts/build.mjs": BUILD,
  });
  app("fresh", MANIFEST("fresh", 3173));
  app("broken", MANIFEST("broken", 3190));
  const S = join(root, stateName);
  const A = join(S, "apps", "fix");
  return {
    root, eng, S, code: join(root, "apps", "fix"), exec: join(eng, "apps", "app-exec"),
    deps: join(A, "deps"), store: join(A, "store"), data: join(A, "data"), tmp: join(A, "tmp"), home: join(A, "home"),
    run: join(S, "run", "apps", "fix"),
    cfg: { node24: NODE24, paths: { state: S, appsCode: join(root, "apps"), apps: join(S, "apps"),
      appsRun: join(S, "run", "apps"), appsLogs: join(S, "logs", "apps") }, appPorts: { first: 3171, last: 3189 } },
  };
}

function appExec(w, args, extraEnv = {}, opts = {}) {
  return spawnSync(w.exec, args, {
    cwd: "/", encoding: "utf8", timeout: 120000,
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: OWNER_HOME, LANG: "C", ...extraEnv },
    ...opts,
  });
}

// What the stand-in sandbox tool saw: { cwd, env, args }.
function seen(r) {
  assert.equal(r.status, 0, r.stderr);
  const env = {};
  const args = [];
  let cwd = null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("env:")) {
      const i = line.indexOf("=");
      env[line.slice(4, i)] = line.slice(i + 1);
    } else if (line.startsWith("arg=")) args.push(line.slice(4));
    else if (line.startsWith("cwd=")) cwd = line.slice(4);
  }
  for (const k of ["PWD", "SHLVL", "_", "__CF_USER_TEXT_ENCODING"]) delete env[k];
  return { cwd, env, args };
}

function refused(r, words) {
  assert.equal(r.status, 78, `${r.stdout}\n${r.stderr}`);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, r.stderr);
  assert.match(lines[0], /^app-exec: /);
  if (words) assert.match(lines[0], words);
  assert.equal(r.stdout, "", "the sandbox tool was never started");
}

const modeOf = (p) => statSync(p).mode & 0o777;

// ---- with the stand-in sandbox tool -------------------------------------------------------

let w;
before(() => { w = makeWorld("uuu-as-", { realSrt: false }); });

test("--run: the fixed command, in the app's folder, through the settings fence.mjs wrote", () => {
  const { cwd, args } = seen(appExec(w, ["fix", "--run"]));
  assert.equal(cwd, w.code);
  assert.equal(args[0], "-s");
  assert.match(args[1], new RegExp(`^${w.S}/fences/[0-9a-f]{20}\\.json$`));
  assert.deepEqual(JSON.parse(readFileSync(args[1], "utf8")), appFence(w.cfg, { slug: "fix" }, "run"));
  assert.deepEqual(args.slice(2), ["--", "/usr/bin/env", `TMPDIR=${w.tmp}`, NODE, "--max-old-space-size=256", ".build/index.mjs"]);
});

test("--run: the environment is K18's, built from nothing", () => {
  const { env } = seen(appExec(w, ["fix", "--run"]));
  assert.deepEqual(env, {
    APP_DATA: w.data, APP_SOCKET: join(w.run, "app.sock"), APP_TMP: w.tmp, ENGINE_SOCKET: join(w.run, "engine.sock"),
    FFMPEG: "/opt/homebrew/bin/ffmpeg", FFPROBE: "/opt/homebrew/bin/ffprobe", HOME: w.home, LANG: "en_US.UTF-8",
    NODE_ENV: "production", PATH: SAFE_PATH, TMPDIR: SRT_TMP,
  });
});

test("a caller's FENCE_*, UUU_*, APP_*, ENGINE_CONFIG, NODE_OPTIONS and HOME reach nothing", () => {
  const other = join(w.root, "other-config.json");
  const cfg = JSON.parse(readFileSync(join(w.eng, "config.json"), "utf8"));
  writeFileSync(other, JSON.stringify({ ...cfg, stateRoot: join(w.root, "other-state") }));
  const r = appExec(w, ["fix", "--run"], {
    FENCE_X: "1", UUU_WEB_TOKEN: "made-up", APP_DATA: "/evil", APP_SOCKET: "/evil.sock", ENGINE_CONFIG: other,
    NODE_OPTIONS: "--require /nonexistent/evil.js", HOME: "/private/tmp", TMPDIR: "/private/tmp", PAPERCLIP_API_KEY: "made-up",
  });
  const { env, args } = seen(r);
  assert.deepEqual(Object.keys(env).sort(), ["APP_DATA", "APP_SOCKET", "APP_TMP", "ENGINE_SOCKET", "FFMPEG", "FFPROBE", "HOME",
    "LANG", "NODE_ENV", "PATH", "TMPDIR"]);
  assert.equal(env.APP_DATA, w.data);
  assert.equal(env.HOME, w.home);
  assert.ok(args[1].startsWith(`${w.S}/fences/`), "the engine's own config, not the caller's");
  assert.equal(existsSync(join(w.root, "other-state")), false);
});

test("--build: node scripts/build.mjs in the app's folder, without the sockets; .build and dist made first", () => {
  rmSync(join(w.code, "dist"), { recursive: true, force: true });
  const { cwd, env, args } = seen(appExec(w, ["fix", "--build"]));
  assert.equal(cwd, w.code);
  assert.ok(statSync(join(w.code, "dist")).isDirectory() && statSync(join(w.code, ".build")).isDirectory());
  assert.deepEqual(args.slice(2), ["--", "/usr/bin/env", `TMPDIR=${w.tmp}`, NODE, "scripts/build.mjs"]);
  assert.deepEqual(JSON.parse(readFileSync(args[1], "utf8")), appFence(w.cfg, { slug: "fix" }, "build"));
  assert.deepEqual(env, {
    APP_DATA: w.data, APP_TMP: w.tmp, FFMPEG: "/opt/homebrew/bin/ffmpeg", FFPROBE: "/opt/homebrew/bin/ffprobe", HOME: w.home,
    LANG: "en_US.UTF-8", NODE_ENV: "production", PATH: SAFE_PATH, TMPDIR: SRT_TMP,
  });
});

test("--test: node --test with the files as given; APP_DATA is <tmp>/data, made 0700", () => {
  const { cwd, env, args } = seen(appExec(w, ["fix", "--test", "src/reach.test.ts", "src/sub/two.test.ts"]));
  assert.equal(cwd, w.code);
  assert.deepEqual(args.slice(2), ["--", "/usr/bin/env", `TMPDIR=${w.tmp}`, NODE, "--test", "--test-reporter=tap",
    "src/reach.test.ts", "src/sub/two.test.ts"]);
  assert.deepEqual(JSON.parse(readFileSync(args[1], "utf8")), appFence(w.cfg, { slug: "fix" }, "test"));
  assert.equal(env.APP_DATA, join(w.tmp, "data"));
  assert.equal(modeOf(join(w.tmp, "data")), 0o700);
  assert.equal(env.APP_SOCKET, undefined);
});

test("--install: refused until the packages folder is made; then prune and fetch as K18 fixes them, with no NODE_ENV", () => {
  refused(appExec(w, ["fix", "--install", "prune"]), /packages folder .* is missing/);
  mkdirSync(w.deps, { mode: 0o755 });
  const prune = seen(appExec(w, ["fix", "--install", "prune"]));
  assert.equal(prune.cwd, w.deps);
  assert.deepEqual(prune.args.slice(2), ["--", "/usr/bin/env", `TMPDIR=${w.tmp}`, NODE, PNPM, "install", "--lockfile-only",
    "--ignore-scripts"]);
  assert.deepEqual(JSON.parse(readFileSync(prune.args[1], "utf8")), appFence(w.cfg, { slug: "fix" }, "install"));
  assert.equal(prune.env.NODE_ENV, undefined, "pnpm would leave out devDependencies");
  assert.equal(prune.env.APP_SOCKET, undefined);
  assert.equal(modeOf(w.store), 0o755);
  const fetch = seen(appExec(w, ["fix", "--install", "fetch"]));
  assert.deepEqual(fetch.args.slice(2), ["--", "/usr/bin/env", `TMPDIR=${w.tmp}`, NODE, PNPM, "install", "--frozen-lockfile",
    "--ignore-scripts", "--store-dir", w.store]);
});

test("folders: data, home and run kept and 0700; tmp emptied, unwritable folders in it too", () => {
  appExec(w, ["fix", "--run"]);
  writeFileSync(join(w.data, "kept.txt"), "kept");
  writeFileSync(join(w.home, "kept.txt"), "kept");
  writeFileSync(join(w.run, "engine.sock"), "");   // the host's, opened before the app starts
  writeFileSync(join(w.tmp, "old.txt"), "old");
  mkdirSync(join(w.tmp, "locked", "in"), { recursive: true });
  writeFileSync(join(w.tmp, "locked", "in", "f"), "x");
  chmodSync(join(w.tmp, "locked", "in"), 0o500);
  chmodSync(join(w.tmp, "locked"), 0o500);
  chmodSync(w.data, 0o755);
  seen(appExec(w, ["fix", "--run"]));
  assert.deepEqual(readdirSync(w.tmp), []);
  assert.equal(readFileSync(join(w.data, "kept.txt"), "utf8"), "kept");
  assert.equal(readFileSync(join(w.home, "kept.txt"), "utf8"), "kept");
  assert.ok(existsSync(join(w.run, "engine.sock")), "the run folder is the host's to empty");
  for (const p of [w.data, w.tmp, w.home, w.run, dirname(w.data)]) assert.equal(modeOf(p), 0o700, p);
});

test("refused: an unknown app, a bad name, a damaged app, and --run of an app not installed", () => {
  refused(appExec(w, ["nope", "--run"]), /no app is named nope/);
  refused(appExec(w, ["../fix", "--run"]), /no app is named that/);
  refused(appExec(w, ["broken", "--build"]), /broken is damaged \(bad_port\)/);
  refused(appExec(w, ["fresh", "--run"]), /not installed yet/);
  assert.equal(seen(appExec(w, ["fresh", "--build"])).cwd, join(w.root, "apps", "fresh"), "a build needs no READY");
});

test("refused: test files outside K18's pattern", () => {
  for (const f of ["src/../escape.test.ts", "src/./x.test.ts", "src//x.test.ts", "test/x.test.ts", "src/x.ts", "src/a b.test.ts",
    "/abs/src/x.test.ts", "src/x.test.ts.js", "-src/x.test.ts"]) {
    refused(appExec(w, ["fix", "--test", f]), /test file/);
  }
  refused(appExec(w, ["fix", "--test"]), /at least one test file/);
  refused(appExec(w, ["fix", "--test", "src/ok.test.ts", "src/../no.test.ts"]), /test file/);
});

test("the two helpers as scripts: eleven lines for a good app, one refusal line otherwise; the engine's own config only", () => {
  const helper = (file, args, extra = {}) => spawnSync("/usr/bin/env", ["-i", `HOME=${OWNER_HOME}`, `PATH=${SAFE_PATH}`,
    ...Object.entries(extra).map(([k, v]) => `${k}=${v}`), NODE, join(w.eng, "apps", file), ...args], { encoding: "utf8" });
  const launch = helper("manifest.mjs", ["--launch", "fix"]);
  assert.equal(launch.status, 0, launch.stderr);
  assert.deepEqual(launch.stdout.trimEnd().split("\n"), [
    `code=${w.code}`, `deps=${w.deps}`, `store=${w.store}`, `data=${w.data}`, `tmp=${w.tmp}`, `home=${w.home}`, `run=${w.run}`,
    "entry=.build/index.mjs", "memoryMb=256", "tools=ffmpeg ffprobe", "installed=yes"]);
  for (const [file, args, words] of [
    ["manifest.mjs", ["--launch", "nope"], /^app-exec: no app is named nope$/],
    ["manifest.mjs", ["--launch", "broken"], /^app-exec: the app broken is damaged \(bad_port\); it is never started$/],
    ["manifest.mjs", ["--launch"], /^app-exec: usage/],
    ["fence.mjs", ["--settings", "nope", "run"], /^app-exec: no app is named nope$/],
    ["fence.mjs", ["--settings", "broken", "run"], /^app-exec: the app broken is damaged/],
    ["fence.mjs", ["--settings", "fix", "shell"], /^app-exec: the app fence has no mode shell$/],
    ["fence.mjs", ["--settings", "fix"], /^app-exec: usage/],
  ]) {
    const res = helper(file, args);
    assert.equal(res.status, 78, `${file} ${args.join(" ")}: ${res.stderr}`);
    assert.equal(res.stdout, "");
    assert.match(res.stderr.trimEnd(), words);
  }
  const other = join(w.root, "elsewhere.json");
  writeFileSync(other, JSON.stringify({ ...JSON.parse(readFileSync(join(w.eng, "config.json"), "utf8")), stateRoot: join(w.root, "x") }));
  const made = helper("fence.mjs", ["--settings", "fix", "test"], { ENGINE_CONFIG: other });
  assert.equal(made.status, 0, made.stderr);
  assert.ok(made.stdout.startsWith(`${w.S}/fences/`), made.stdout);
});

test("refused: a state folder whose app sockets would be too long for this Mac", () => {
  const long = makeWorld("uuu-as-", { realSrt: false, stateName: "s".repeat(80) });
  refused(appExec(long, ["fix", "--run"]), /This app's folder path is too long for this Mac\./);
  refused(appExec(long, ["fix", "--test", "src/reach.test.ts"]), /too long for this Mac/);
});

test("refused: options app-exec does not know", () => {
  refused(appExec(w, ["fix"]), /usage/);
  refused(appExec(w, ["fix", "--shell"]), /usage/);
  refused(appExec(w, ["fix", "--run", "extra"]), /takes nothing else/);
  refused(appExec(w, ["fix", "--build", "--run"]), /takes nothing else/);
  refused(appExec(w, ["fix", "--install"]), /prune or fetch/);
  refused(appExec(w, ["fix", "--install", "all"]), /prune or fetch/);
});

test("refused: an app folder that is a link is never opened", () => {
  const away = join(w.root, "away");
  mkdirSync(away, { mode: 0o700 });
  const keep = `${w.data}.kept`;
  appExec(w, ["fix", "--run"]);
  renameSync(w.data, keep);
  symlinkSync(away, w.data);
  try {
    refused(appExec(w, ["fix", "--run"]), /data folder is a link/);
  } finally {
    unlinkSync(w.data);
    renameSync(keep, w.data);
  }
  rmSync(w.home, { recursive: true });
  symlinkSync(away, w.home);
  try {
    refused(appExec(w, ["fix", "--build"]), /home folder is a link/);
  } finally {
    unlinkSync(w.home);
  }
  // A build's output folders: a link in place of dist is never opened for writing.
  const dist = join(w.code, "dist");
  rmSync(dist, { recursive: true, force: true });
  symlinkSync(away, dist);
  try {
    refused(appExec(w, ["fix", "--build"]), /dist folder is a link/);
  } finally {
    unlinkSync(dist);
  }
});

// ---- with the real sandbox tool -----------------------------------------------------------

let r;          // the real world
let tcp;        // a TCP listener of the test's own: no app may ever reach it
let tcpHits = 0;
let outer;      // a unix socket outside the app's run folder
let outerHits = 0;
before(async () => {
  if (REAL_SKIP) return;
  r = makeWorld("uuu-ae-", { realSrt: true });
  tcp = net.createServer((s) => { tcpHits += 1; s.destroy(); });
  await new Promise((ok) => tcp.listen(0, "127.0.0.1", ok));
  mkdirSync(join(r.S, "secrets"), { recursive: true, mode: 0o700 });
  writeFileSync(join(r.S, "secrets", "planted.txt"), "made up");
  outer = net.createServer((s) => { outerHits += 1; s.end("outer"); });
  await new Promise((ok) => outer.listen(join(r.S, "outer.sock"), ok));
  mkdirSync(r.data, { recursive: true, mode: 0o700 });
  writeFileSync(join(r.data, "kept.txt"), "kept");
  writeFileSync(join(r.code, "src", "targets.json"), JSON.stringify({
    port: tcp.address().port, outerSock: join(r.S, "outer.sock"), homeFile: join(ENGINE, "config.json"),
    stateSecret: join(r.S, "secrets", "planted.txt"), otherApp: join(r.root, "apps", "fresh", "app.json"),
    data: r.data, tmp: r.tmp, home: r.home, path: SAFE_PATH,
  }));
  for (const p of ["/private/tmp/claude"]) {
    if (!existsSync(p)) cleanups.push(() => { if (existsSync(p) && lstatSync(p).isDirectory()) rmSync(p, { recursive: true }); });
  }
});
after(() => {
  if (tcp) tcp.close();
  if (outer) outer.close();
});

// The fixture's own tests, one outer test per probe, so each failure names what leaked.
let reachRun = null;
function reachResults() {
  if (!reachRun) {
    const res = appExec(r, ["fix", "--test", "src/reach.test.ts"], { FENCE_X: "1", UUU_X: "1", APP_DATA: "/evil",
      NODE_OPTIONS: "--require /nonexistent/evil.js", ENGINE_CONFIG: "/nonexistent.json", PAPERCLIP_API_KEY: "made-up" });
    const oks = new Map();
    for (const line of res.stdout.split("\n")) {
      const m = /^(ok|not ok) \d+ - (.*)$/.exec(line);
      if (m) oks.set(m[2], m[1] === "ok");
    }
    reachRun = { res, oks };
  }
  return reachRun;
}

test("real sandbox, --test: the fixture's probes all ran and passed", { skip: REAL_SKIP }, () => {
  const { res, oks } = reachResults();
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, new RegExp(`^# pass ${REACH_NAMES.length}$`, "m"));
  assert.match(res.stdout, /^# fail 0$/m);
  assert.deepEqual([...oks.keys()].sort(), [...REACH_NAMES].sort());
});
for (const name of REACH_NAMES) {
  test(`real sandbox, --test: ${name}`, { skip: REAL_SKIP }, () => {
    const { res, oks } = reachResults();
    assert.equal(oks.get(name), true, res.stdout.split("\n").filter((l) => l.startsWith("# probe") || l.includes(name)).join("\n"));
  });
}

test("real sandbox: nothing reached the test's own TCP port or unix socket", { skip: REAL_SKIP }, () => {
  reachResults();
  assert.equal(tcpHits, 0);
  assert.equal(outerHits, 0);
  assert.equal(existsSync(join(r.code, "src", "planted.txt")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(r.code, "app.json"), "utf8")), MANIFEST("fix", 3172));
  assert.equal(existsSync("/private/tmp/claude"), false);
});

test("real sandbox: a failing test fails app-exec, and output to a file the app may not read still works", { skip: REAL_SKIP }, () => {
  const failed = appExec(r, ["fix", "--test", "src/fail.test.ts"]);
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stdout, /^# fail 1$/m);
  // Node inside the fence stops at its start when its output is a file it may not look at;
  // app-exec puts a pipe between. The file lies in /private/tmp, which the app may not read.
  for (const [file, want] of [["fail.test.ts", 1], ["reach.test.ts", 0]]) {
    const out = join(r.root, `out-${file}.txt`);
    const fd = openSync(out, "w");
    let res;
    try {
      res = appExec(r, ["fix", "--test", `src/${file}`], {}, { stdio: ["ignore", fd, fd] });
    } finally {
      closeSync(fd);
    }
    const text = readFileSync(out, "utf8");
    assert.equal(res.status, want, text);
    assert.match(text, want ? /^# fail 1$/m : /^# fail 0$/m);
    assert.doesNotMatch(text, /Native stack trace/);
  }
});

test("real sandbox, --build: writes .build and dist only; never its source, app.json, READY or a program-config name", { skip: REAL_SKIP }, () => {
  const res = appExec(r, ["fix", "--build"]);
  assert.equal(res.status, 0, res.stderr);
  const line = res.stdout.split("\n").find((l) => l.startsWith("BUILD "));
  assert.ok(line, res.stdout + res.stderr);
  assert.deepEqual(JSON.parse(line.slice(6)), {
    build: "ok", dist: "ok", src: "EPERM", manifest: "EPERM", ready: "EPERM", buildConfig: "EPERM", distConfig: "EPERM",
    dataRead: "EPERM", dataWrite: "EPERM", home: "ok",
  });
  assert.equal(readFileSync(join(r.code, ".build", "built.txt"), "utf8"), "built");
  assert.deepEqual(JSON.parse(readFileSync(join(r.code, "app.json"), "utf8")), MANIFEST("fix", 3172));
  assert.equal(readFileSync(join(r.code, "READY"), "utf8"), "");
});

function request(sock, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: sock, path, method: "GET", agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("no answer")));
    req.end();
  });
}

test("real sandbox, --run: serves on its socket and is reached from outside; reaches its engine socket and nothing else", { skip: REAL_SKIP, timeout: 90000 }, async () => {
  // As the host does (K17): the run folder made, the engine socket opened, then the app started.
  mkdirSync(r.run, { recursive: true, mode: 0o700 });
  let engineHits = 0;
  const engine = net.createServer((s) => { engineHits += 1; s.end("engine-ok"); });
  await new Promise((ok) => engine.listen(join(r.run, "engine.sock"), ok));
  const child = spawn(r.exec, ["fix", "--run"], {
    cwd: "/", detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin", HOME: OWNER_HOME, FENCE_X: "1", APP_DATA: "/evil" },
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const exited = new Promise((ok) => child.on("exit", ok));
  try {
    const sock = join(r.run, "app.sock");
    const until = Date.now() + 30000;
    while (!existsSync(sock) && Date.now() < until) await new Promise((ok) => setTimeout(ok, 100));
    assert.ok(existsSync(sock), `app.sock never appeared:\n${log}`);
    const health = await request(sock, "/healthz");
    assert.deepEqual(health, { status: 200, body: "ok" });
    const probe = await request(sock, "/probe");
    assert.equal(probe.status, 200, probe.body);
    const got = JSON.parse(probe.body);
    assert.deepEqual(got, {
      engine: "answered:engine-ok", outerSock: "EPERM", tcpLocal: "EPERM", tcpListen: "EPERM", sockInTmp: "EPERM",
      ssh: "EPERM", homeFile: "EPERM", dataWrite: "ok", dataConfig: "EPERM", runConfig: "EPERM", src: "EPERM", ready: "EPERM",
      env: { APP_SOCKET: sock, ENGINE_SOCKET: join(r.run, "engine.sock"), APP_DATA: r.data, NODE_ENV: "production", FENCE_X: null,
        memory: ["--max-old-space-size=256"] },
    });
    assert.equal(engineHits, 1);
    assert.equal(outerHits, 0);
    assert.equal(tcpHits, 0);
    assert.equal(readFileSync(join(r.data, "note.txt"), "utf8"), "x");
  } finally {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
    const done = await Promise.race([exited.then(() => true), new Promise((ok) => setTimeout(() => ok(false), 10000))]);
    if (!done) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } await exited; }
    engine.close();
  }
});

test("real sandbox, the install's fence: writes its packages and store only, reaches no port and no host but the registry", { skip: REAL_SKIP }, () => {
  mkdirSync(r.deps, { recursive: true, mode: 0o755 });
  mkdirSync(r.store, { recursive: true, mode: 0o755 });
  mkdirSync(r.tmp, { recursive: true, mode: 0o700 });
  mkdirSync(r.home, { recursive: true, mode: 0o700 });
  const made = spawnSync("/usr/bin/env", ["-i", `HOME=${OWNER_HOME}`, `PATH=${SAFE_PATH}`, NODE, join(r.eng, "apps", "fence.mjs"),
    "--settings", "fix", "install"], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const settings = made.stdout.trim();
  assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")).network.allowedDomains, ["registry.npmjs.org"]);
  // The command app-exec runs for an install is pnpm; this is the same fence round a probe.
  const script = `
    import { readFileSync, writeFileSync } from "node:fs";
    import net from "node:net";
    const code = (f) => { try { f(); return "ok"; } catch (e) { return e.code || "error"; } };
    const reach = (o) => new Promise((ok) => { const s = net.connect(o); s.on("connect", () => { s.destroy(); ok("connected"); }); s.on("error", (e) => ok(e.code)); setTimeout(() => ok("timeout"), 4000); });
    const viaProxy = (target) => new Promise((ok) => {
      const u = new URL(process.env.HTTPS_PROXY);
      const auth = Buffer.from(decodeURIComponent(u.username) + ":" + decodeURIComponent(u.password)).toString("base64");
      const s = net.connect({ host: "127.0.0.1", port: Number(u.port) });
      let buf = "";
      s.on("connect", () => s.write("CONNECT " + target + " HTTP/1.1\\r\\nHost: " + target + "\\r\\nProxy-Authorization: Basic " + auth + "\\r\\n\\r\\n"));
      s.on("data", (d) => { buf += d; if (buf.includes("\\r\\n")) { s.destroy(); ok(buf.split("\\r\\n")[0]); } });
      s.on("error", (e) => ok(e.code));
      setTimeout(() => ok("timeout"), 4000);
    });
    console.log("INSTALL " + JSON.stringify({
      deps: code(() => writeFileSync("package.json", "{}")),
      store: code(() => writeFileSync(${JSON.stringify(join(r.store, "x"))}, "x")),
      depsConfig: code(() => writeFileSync("AGENTS.md", "x")),
      codeRead: code(() => readFileSync(${JSON.stringify(join(r.code, "app.json"))})),
      codeWrite: code(() => writeFileSync(${JSON.stringify(join(r.code, "src", "planted.txt"))}, "x")),
      dataRead: code(() => readFileSync(${JSON.stringify(join(r.data, "kept.txt"))})),
      tcpLocal: await reach({ host: "127.0.0.1", port: ${tcp.address().port} }),
      unix: await reach({ path: ${JSON.stringify(join(r.S, "outer.sock"))} }),
      proxyLocal: await viaProxy("127.0.0.1:${tcp.address().port}"),
      proxyOther: await viaProxy("example.com:443"),
    }));`;
  const res = spawnSync(NODE, [SRT, "-s", settings, "--", "/usr/bin/env", `TMPDIR=${r.tmp}`, NODE, "--input-type=module", "-e", script], {
    cwd: r.deps, encoding: "utf8", timeout: 60000,
    env: { HOME: r.home, PATH: SAFE_PATH, LANG: "en_US.UTF-8", TMPDIR: SRT_TMP },
  });
  assert.equal(res.status, 0, res.stderr);
  const line = res.stdout.split("\n").find((l) => l.startsWith("INSTALL "));
  assert.ok(line, res.stdout + res.stderr);
  const got = JSON.parse(line.slice(8));
  assert.equal(got.proxyLocal.startsWith("HTTP/1.1 403"), true, got.proxyLocal);
  assert.equal(got.proxyOther.startsWith("HTTP/1.1 403"), true, got.proxyOther);
  delete got.proxyLocal;
  delete got.proxyOther;
  assert.deepEqual(got, {
    deps: "ok", store: "ok", depsConfig: "EPERM", codeRead: "EPERM", codeWrite: "EPERM", dataRead: "EPERM", tcpLocal: "EPERM",
    unix: "EPERM",
  });
  assert.equal(tcpHits, 0);
  assert.equal(outerHits, 0);
});
