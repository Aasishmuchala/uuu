// The stage (PLAN-STRESS, pinned interfaces): a whole engine on made-up data, in one temp folder, on ports base+N.
//
//   startStage({ base, dataset, faults, apps, label, appsSpawn, nodeModules }) -> stage
//     base        4300|4400|4500|4600|4700|4800 (default env STRESS_PORT_BASE, else 4300); anything else throws
//     dataset     "empty" | "normal" | "large" (lib/seed.mjs)
//     faults      { <part>: mode } parts started as a fault server instead (lib/faults.mjs MODES)
//     apps        false: `apps` is the copy's own host (engine/apps/host.mjs) over unchanged clones of the apps, none
//                 switched on; true: `apps` is the second, runner-made host, app ports base+71..+89, clones of the
//                 apps with only app.json's port changed
//     appsSpawn   (apps: true only) "fenced" (default: the copy's apps/app-exec) | "fixture" (adds the host's test
//                 fixture as app `fix` and runs only its server.mjs; never an app's own program unfenced)
//     nodeModules "link" (default: a link to the worktree's engine/node_modules) | "clone" (an APFS clone of it)
//   stage = { root, state, engineDir, ports, urls, pids, fakes, kill(part|pid, signal = "SIGKILL"), start(part),
//             restart(part), setFault(part, mode|null), setBehaviour(fake, behaviour), probe(host, port),
//             outsideCalls(), sample(), close() }
//
// Safety walls: only the six bases; every port checked free before anything is made (nothing is started, nothing
// killed, when one is taken); the stage folder is never inside ~/.paperclip; every Node child runs under
// stress/lib/netguard.mjs with the stage's own HOME and TMPDIR and none of the caller's keys; a signal goes only to
// a process id in pids.json whose command line holds the stage root, never to a database. Built-in modules only.
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync,
  rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_PORTS, BASES, MODES, PARTS, PART_NAMES, PREVIEW_SITES, portsOf } from "./faults.mjs";
import { call } from "./http.mjs";
import { seedFor } from "./seed.mjs";

const SRC_ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_APPS = resolve(SRC_ENGINE, "..", "apps");
const FIXTURE_APP = join(SRC_ENGINE, "apps", "test", "fixture-app");
export const NODE = process.env.STRESS_NODE || join(homedir(), ".nvm", "versions", "node", "v24.22.3", "bin", "node");
export const STAGE_PREFIX = "uuu-stress-stage-";
export const PROVIDER_KEY = "sk-stress-fake-0000";
export const RUNWAY_KEY = `key_${"5715e55fa4e00000".repeat(8)}`;
const DATABASES = /postgres|mysqld|mariadbd|redis-server/;
const LIVE_STATE = join(homedir(), ".paperclip");
// Short on purpose: an app's socket path under <root>/state/run/apps must stay under macOS's 104 bytes.
const DEFAULT_PARENT = "/private/tmp";

// Which part runs which file. `runner`: stress/lib/part-runner.mjs <part>; `entry`: the copy's own entry file, as
// engine/parts/NN-*.sh starts it (`node <file>`, cwd the engine folder).
const ENTRIES = {
  home: "home/server/main.mjs", gate: "gate/gate.mjs", gateNarrow: "gate/gate.mjs", viewer: "viewer/viewer.mjs",
  brain: "brain/door.mjs", apps: "apps/host.mjs",
};
const RUNNERS = new Set(["board", "books", "relay", "web", "generate"]);
// Which runner holds each fake (for setBehaviour).
const FAKE_PART = { provider: "relay", internet: "web", runway: "generate", "runway-mcp": "generate", higgsfield: "generate" };

const open = new Set();
let exitHook = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function realOr(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

// Throws when <path> is inside the live state (~/.paperclip): the one refusal for a stage folder.
export function checkStateFolder(path) {
  const p = realOr(path);
  const live = realOr(LIVE_STATE);
  if (p === live || p.startsWith(live + sep) || resolve(path).startsWith(LIVE_STATE + sep) || resolve(path) === LIVE_STATE) {
    throw new Error("stage: the state folder is inside the live state; refused");
  }
  return p;
}

export function checkBase(base) {
  const b = Number(base);
  if (!BASES.includes(b)) throw new Error(`stage: base ${base} is not allowed`);
  return b;
}

// True when anything answers or holds 127.0.0.1:<port>.
export function portTaken(port) {
  return new Promise((resolveTaken) => {
    const s = net.connect({ host: "127.0.0.1", port });
    let done = false;
    const end = (v) => { if (!done) { done = true; s.destroy(); resolveTaken(v); } };
    s.once("connect", () => end(true));
    s.once("error", () => {
      // Nothing answers; can we bind it?
      const srv = net.createServer();
      srv.once("error", () => { if (!done) { done = true; resolveTaken(true); } });
      srv.listen(port, "127.0.0.1", () => srv.close(() => { if (!done) { done = true; resolveTaken(false); } }));
    });
    s.setTimeout(1000, () => end(true));
  });
}

function stagePorts(ports, base, apps) {
  const keys = ["board", "gate", "gateNarrow", "relay", "web", "generate", "viewer", "preview", "apps", "brain",
    "benchWeb", "benchSocketio", "benchRedisQueue", "benchRedisCache", "benchDb", "home"];
  const list = keys.map((k) => ports[k]);
  for (let o = PREVIEW_SITES.first; o <= PREVIEW_SITES.last; o += 1) list.push(base + o);
  if (apps) for (let o = APP_PORTS.first; o <= APP_PORTS.last; o += 1) list.push(base + o);
  return list;
}

function commandOf(pid) {
  try {
    return execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = execFileSync("/bin/ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return stat !== "" && !stat.startsWith("Z");
  } catch {
    return false;
  }
}

// [{ pid, ppid, pgid, command }] of every process on this Mac (read only).
function processTable() {
  let text = "";
  try {
    text = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return [];
  }
  return text.split("\n").map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command: m[4] }));
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

function exitCleanup() {
  for (const st of open) {
    try { st._killAllSync(); } catch { /* best effort at exit */ }
  }
}

function installExitHook() {
  if (exitHook) return;
  exitHook = true;
  process.on("exit", exitCleanup);
}

// ---- the copy -----------------------------------------------------------------------------------------------------

function cloneTree(src, dest) {
  // APFS clone (copy on write): fast and costs no disk until a file changes. Links are copied as links.
  execFileSync("/bin/cp", ["-Rc", src, dest], { stdio: ["ignore", "ignore", "pipe"] });
}

function makeCopy(root, { nodeModules }) {
  const top = join(root, "root");
  mkdirSync(top, { recursive: true });
  const engineDir = join(top, "engine");
  cloneTree(SRC_ENGINE, engineDir);
  const nm = join(engineDir, "node_modules");
  rmSync(nm, { recursive: true, force: true });
  const srcNm = join(SRC_ENGINE, "node_modules");
  if (existsSync(srcNm)) {
    if (nodeModules === "clone") cloneTree(realpathSync(srcNm), nm);
    else symlinkSync(srcNm, nm);
  }
  return engineDir;
}

// The apps' clones, without their node_modules links (those point into a live state folder).
function makeApps(root, base, { apps, appsSpawn }) {
  const dest = join(root, "root", "apps");
  mkdirSync(dest, { recursive: true });
  let slugs = [];
  try { slugs = readdirSync(SRC_APPS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { slugs = []; }
  for (const slug of slugs) {
    cloneTree(join(SRC_APPS, slug), join(dest, slug));
    rmSync(join(dest, slug, "node_modules"), { recursive: true, force: true });
  }
  if (!apps) return { dest, slugs };
  if (appsSpawn === "fixture") {
    const f = join(dest, "fix");
    mkdirSync(f, { recursive: true });
    for (const name of ["app.json", "icon.svg", "server.mjs"]) cpSync(join(FIXTURE_APP, name), join(f, name));
    writeFileSync(join(f, "READY"), "");
    slugs.push("fix");
  }
  slugs.forEach((slug, i) => {
    const file = join(dest, slug, "app.json");
    if (!existsSync(file)) return;
    const m = JSON.parse(readFileSync(file, "utf8"));
    m.port = base + APP_PORTS.first + i;
    writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
  });
  return { dest, slugs };
}

function stagedConfig(engineDir, root, ports, { appsSpawn, apps }) {
  const file = join(engineDir, "config.json");
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  cfg.stateRoot = join(root, "state");
  cfg.node24 = dirname(dirname(NODE));
  for (const k of Object.keys(cfg.ports)) {
    if (!(k in ports)) throw new Error(`stage: the config has a port ${k} the stage does not know; add it to faults.mjs OFFSETS`);
    cfg.ports[k] = ports[k];
  }
  for (const k of Object.keys(ports)) if (!(k in cfg.ports) && k !== "benchDb") cfg.ports[k] = ports[k];
  cfg.paperclip.instanceRoot = join(root, "paperclip");
  cfg.fence.realClaude = join(root, "root", "fake-claude");
  cfg.fence.policyPortsAllowed = [ports.benchWeb];
  if (apps && appsSpawn === "fixture") {
    cfg.doors.generate.apps = [...new Set([...(cfg.doors.generate.apps || []), "fix"])];
  }
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return file;
}

function writeSecrets(state) {
  const s = join(state, "secrets");
  for (const d of [s, join(s, "provider"), join(s, "doors")]) mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(join(s, "provider", "omega-key"), `${PROVIDER_KEY}\n`, { mode: 0o600 });
  writeFileSync(join(s, "doors", "runway-key"), `${RUNWAY_KEY}\n`, { mode: 0o600 });
  writeFileSync(join(s, "bench-owner-api.txt"), "owner\nowner\n", { mode: 0o600 });
  mkdirSync(join(state, "books", "bench"), { recursive: true });
  mkdirSync(join(state, "logs"), { recursive: true });
}

// ---- the stage ----------------------------------------------------------------------------------------------------

export async function startStage({
  base, dataset = "normal", faults = {}, apps = false, label = "stage", appsSpawn = "fenced", nodeModules = "link",
} = {}) {
  const b = checkBase(base ?? (process.env.STRESS_PORT_BASE || 4300));
  for (const [part, mode] of Object.entries(faults || {})) {
    if (!PART_NAMES.includes(part)) throw new Error(`stage: ${part} is not a part`);
    if (!MODES.includes(mode)) throw new Error(`stage: fault ${mode} is not one of ${MODES.join(", ")}`);
  }
  if (!["fenced", "fixture"].includes(appsSpawn)) throw new Error(`stage: appsSpawn ${appsSpawn} is not fenced or fixture`);
  const ports = portsOf(b);
  for (const p of stagePorts(ports, b, apps)) {
    if (await portTaken(p)) throw new Error(`stage: port ${p} is in use; nothing was started`);
  }
  const parent = checkStateFolder(process.env.STRESS_STAGE_PARENT || DEFAULT_PARENT);
  const safeLabel = String(label).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 16) || "stage";
  const root = realpathSync(mkdtempSync(join(parent, `${STAGE_PREFIX}${safeLabel}-`)));
  try {
    checkStateFolder(root);
  } catch (e) {
    rmSync(root, { recursive: true, force: true });
    throw e;
  }

  let st;
  try {
    for (const d of ["home", "tmp", "seed", "fakes", "paperclip"]) mkdirSync(join(root, d), { recursive: true, mode: 0o700 });
    const engineDir = makeCopy(root, { nodeModules });
    makeApps(root, b, { apps, appsSpawn });
    const state = join(root, "state");
    const seed = seedFor(dataset, { dest: state });
    writeFileSync(join(root, "seed", "board.json"), JSON.stringify(seed.board));
    writeFileSync(join(root, "seed", "bench.json"), JSON.stringify(seed.bench));
    writeSecrets(state);
    const configPath = stagedConfig(engineDir, root, ports, { apps, appsSpawn });
    writeJsonAtomic(join(root, "stage.json"), {
      root, engineDir, configPath, base: b, ports, dataset, apps: !!apps, appsSpawn, runwayKey: RUNWAY_KEY, label: safeLabel,
    });
    writeJsonAtomic(join(root, "pids.json"), {});
    st = makeStage({ root, engineDir, state, ports, base: b, apps: !!apps, dataset });
    open.add(st);
    installExitHook();
    for (const part of PART_NAMES) {
      if (part === "gateNarrow") continue; // one process with the gate
      if (faults[part]) await st.setFault(part, faults[part]);
      else await st.start(part);
    }
    return st;
  } catch (e) {
    if (st) await st.close().catch(() => {});
    else rmSync(root, { recursive: true, force: true });
    throw e;
  }
}

function makeStage({ root, engineDir, state, ports, base, apps, dataset }) {
  const pidsFile = join(root, "pids.json");
  const guard = join(engineDir, "stress", "lib", "netguard.mjs");
  const runner = join(engineDir, "stress", "lib", "part-runner.mjs");
  const started = new Set(); // every process id this stage ever started (each its own process group)
  const children = new Map(); // pid -> ChildProcess (so Node reaps it)
  const faultsNow = {};
  const urls = {};
  for (const [k, p] of Object.entries(ports)) urls[k] = `http://127.0.0.1:${p}`;
  urls.books = urls.benchWeb;

  const readPids = () => {
    try { return JSON.parse(readFileSync(pidsFile, "utf8")); } catch { return {}; }
  };
  const writePids = (p) => writeJsonAtomic(pidsFile, p);
  const healthUrl = (part) => `${urls[PARTS[part].health[0]]}${PARTS[part].health[1]}`;
  const partPorts = (part) => PARTS[part].ports.map((k) => ports[k]);
  const group = (part) => (PARTS[part].shares ? [part, PARTS[part].shares] : [part]);
  const env = (part) => ({
    PATH: `${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: join(root, "home"),
    TMPDIR: `${join(root, "tmp")}/`,
    LANG: "en_US.UTF-8",
    STRESS_PART: part,
    STRESS_STAGE_ROOT: root,
  });

  function spawnPart(part, args) {
    const log = join(state, "logs", `${part === "gateNarrow" ? "gate" : part}.log`);
    const fd = openSync(log, "a", 0o600);
    let child;
    try {
      child = spawn(NODE, ["--import", guard, ...args], { cwd: engineDir, detached: true, stdio: ["ignore", fd, fd], env: env(part) });
    } finally {
      closeSync(fd);
    }
    child.on("error", () => {});
    child.unref();
    started.add(child.pid);
    children.set(child.pid, child);
    child.on("exit", () => children.delete(child.pid));
    return { child, log };
  }

  function argsFor(part) {
    if (part === "apps" && apps) return [runner, "apps", root];
    if (RUNNERS.has(part)) return [runner, part, root];
    return [join(engineDir, ENTRIES[part])];
  }

  async function waitUntil(fn, ms, every = 150) {
    const end = Date.now() + ms;
    for (;;) {
      if (await fn()) return true;
      if (Date.now() > end) return false;
      await sleep(every);
    }
  }

  const healthy = async (part) => {
    try {
      const r = await call(healthUrl(part), { timeoutMs: 2000 });
      return r.status === 200;
    } catch {
      return false;
    }
  };
  const listening = async (port) => {
    const s = net.connect({ host: "127.0.0.1", port });
    return new Promise((r) => {
      s.once("connect", () => { s.destroy(); r(true); });
      s.once("error", () => r(false));
      s.setTimeout(1000, () => { s.destroy(); r(false); });
    });
  };

  function tail(file) {
    try { return readFileSync(file, "utf8").split("\n").slice(-12).join("\n"); } catch { return ""; }
  }

  function record(parts, pid, extra = {}) {
    const p = readPids();
    for (const name of parts) p[name] = { pid, startedAt: new Date().toISOString(), ...extra };
    writePids(p);
  }

  // The refusal check before any signal: the id is in pids.json and its command line holds the stage root.
  function signalOk(pid) {
    const listed = Object.values(readPids()).some((e) => e && e.pid === pid);
    const cmd = commandOf(pid);
    if (!listed || !cmd.includes(root) || DATABASES.test(cmd)) {
      throw new Error(`stage: ${pid} is not a process this stage started; not signalled`);
    }
  }

  function signalGroup(pid, signal) {
    try {
      process.kill(-pid, signal);
    } catch {
      try { process.kill(pid, signal); } catch { /* gone */ }
    }
  }

  async function kill(target, signal = "SIGKILL") {
    let pid;
    if (typeof target === "number") {
      pid = target;
      signalOk(pid);
    } else {
      if (!PART_NAMES.includes(target)) throw new Error(`stage: ${target} is not a part`);
      const e = readPids()[target];
      if (!e) return false;
      pid = e.pid;
      if (!alive(pid)) {
        const p = readPids();
        for (const [k, v] of Object.entries(p)) if (v && v.pid === pid) delete p[k];
        writePids(p);
        return false;
      }
      signalOk(pid);
    }
    signalGroup(pid, signal);
    let gone = await waitUntil(() => !alive(pid), signal === "SIGKILL" ? 5000 : 10000, 100);
    if (!gone) {
      signalGroup(pid, "SIGKILL");
      gone = await waitUntil(() => !alive(pid), 5000, 100);
    }
    const p = readPids();
    const names = Object.entries(p).filter(([, v]) => v && v.pid === pid).map(([k]) => k);
    for (const k of names) delete p[k];
    writePids(p);
    for (const k of names) delete faultsNow[k];
    // Its ports closed (the kernel may need a moment after the process ends).
    const held = names.flatMap((n) => partPorts(n));
    await waitUntil(async () => !(await Promise.all(held.map(listening))).some(Boolean), 5000, 100);
    return gone;
  }

  async function start(part) {
    if (!PART_NAMES.includes(part)) throw new Error(`stage: ${part} is not a part`);
    const parts = group(part);
    const now = readPids()[part];
    if (now && alive(now.pid) && !now.fault) return now.pid;
    if (now && now.fault) await kill(part, "SIGTERM");
    for (const p of [...new Set(parts.flatMap(partPorts))]) {
      if (await listening(p)) throw new Error(`stage: port ${p} is in use; nothing was started`);
    }
    const { child, log } = spawnPart(part, argsFor(part));
    record(parts, child.pid);
    let exited = null;
    child.once("exit", (code, sig) => { exited = { code, sig }; });
    const ok = await waitUntil(async () => exited !== null || (await Promise.all(parts.map(healthy))).every(Boolean), 30000);
    if (!ok || exited) {
      if (!exited && alive(child.pid)) signalGroup(child.pid, "SIGKILL");
      const p = readPids();
      for (const n of parts) delete p[n];
      writePids(p);
      throw new Error(`stage: ${part} did not become healthy${exited ? ` (it exited ${exited.code ?? exited.sig})` : " in 30 s"}\n${tail(log)}`);
    }
    return child.pid;
  }

  async function restart(part) {
    await kill(part, "SIGTERM");
    return start(part);
  }

  async function setFault(part, mode) {
    if (!PART_NAMES.includes(part)) throw new Error(`stage: ${part} is not a part`);
    // The gate and the narrow gate are one process: a fault on either replaces both.
    const owner = part === "gateNarrow" ? "gate" : part;
    if (mode !== null && !MODES.includes(mode)) throw new Error(`stage: fault ${mode} is not one of ${MODES.join(", ")}`);
    await kill(owner, "SIGTERM");
    for (const n of group(owner)) delete faultsNow[n];
    if (mode === null) return start(owner);
    for (const n of group(owner)) faultsNow[n] = mode;
    if (mode === "off") return null;
    const { child, log } = spawnPart(owner, [runner, "fault", root, owner, mode]);
    record(group(owner), child.pid, { fault: mode });
    const ok = await waitUntil(async () => (await Promise.all(partPorts(owner).map(listening))).every(Boolean), 10000);
    if (!ok) throw new Error(`stage: the fault server for ${owner} did not start\n${tail(log)}`);
    return child.pid;
  }

  function readFakes() {
    const out = {};
    let files = [];
    try { files = readdirSync(join(root, "fakes")).filter((f) => f.endsWith(".json")); } catch { files = []; }
    for (const f of files) {
      try { out[f.slice(0, -5)] = JSON.parse(readFileSync(join(root, "fakes", f), "utf8")); } catch { /* being written */ }
    }
    return out;
  }

  async function setBehaviour(fake, behaviour) {
    const part = FAKE_PART[fake];
    if (!part) throw new Error(`stage: ${fake} is not a fake`);
    const f = readFakes()[part];
    if (!f) throw new Error(`stage: ${part} is not running, so ${fake} has no control`);
    const r = await call(`${f.control}/behaviour/${fake}`, { method: "POST", headers: { "content-type": "application/json" }, body: behaviour || {} });
    if (r.status !== 200) throw new Error(`stage: ${fake} did not take the behaviour (${r.status})`);
    return r.json.behaviour;
  }

  // One connect from a runner under the guard: { refused, message }.
  function probe(host, port) {
    const out = execFileSync(NODE, ["--import", guard, runner, "probe", root, String(host), String(port)], {
      cwd: engineDir, env: env("probe"), encoding: "utf8", timeout: 15000,
    });
    return JSON.parse(out.trim().split("\n").pop());
  }

  function outsideCalls() {
    try {
      return readFileSync(join(root, "outside-calls.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return { bad: l }; }
      });
    } catch {
      return [];
    }
  }

  function sample() {
    const pids = readPids();
    const parts = {};
    for (const part of PART_NAMES) {
      const e = pids[part];
      if (!e || !alive(e.pid)) { parts[part] = { pid: null, rssKb: null, cpuPct: null, fds: null, fault: faultsNow[part] || null }; continue; }
      let rssKb = null;
      let cpuPct = null;
      let fds = null;
      try {
        const [rss, cpu] = execFileSync("/bin/ps", ["-o", "rss=,%cpu=", "-p", String(e.pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\s+/);
        rssKb = Number(rss);
        cpuPct = Number(cpu);
      } catch { /* ended between the two reads */ }
      try {
        const text = execFileSync("/usr/sbin/lsof", ["-p", String(e.pid)], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
        fds = Math.max(0, text.split("\n").filter(Boolean).length - 1);
      } catch { /* lsof found nothing */ }
      parts[part] = { pid: e.pid, rssKb, cpuPct, fds, fault: e.fault || null };
    }
    return { at: new Date().toISOString(), parts };
  }

  // Every process this stage started, and their descendants while they are still linked to them.
  function ours() {
    const table = processTable();
    const set = new Set();
    for (const p of table) if (started.has(p.pid) || started.has(p.pgid)) set.add(p.pid);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of table) {
        if (!set.has(p.pid) && (set.has(p.ppid) || set.has(p.pgid))) { set.add(p.pid); grew = true; }
      }
    }
    return table.filter((p) => set.has(p.pid));
  }

  let closed = false;
  const st = {
    root, state, engineDir, ports, urls, base, dataset, apps,
    get pids() { return readPids(); },
    get fakes() { return readFakes(); },
    get faults() { return { ...faultsNow }; },
    kill, start, restart, setFault, setBehaviour, probe, outsideCalls, sample,
    healthy,
    async close() {
      if (closed) return { leftovers: [] };
      closed = true;
      const mine = ours();
      const leaders = [...new Set(Object.values(readPids()).map((e) => e && e.pid).filter(Boolean))];
      for (const pid of leaders) {
        const cmd = commandOf(pid);
        if (cmd.includes(root) && !DATABASES.test(cmd)) signalGroup(pid, "SIGTERM");
      }
      await waitUntil(() => leaders.every((p) => !alive(p)), 5000, 100);
      // What is left of ours (a part that would not end, a child in its own group): killed by id.
      for (const p of mine) {
        if (alive(p.pid) && !DATABASES.test(p.command)) {
          try { process.kill(p.pid, "SIGKILL"); } catch { /* gone */ }
        }
      }
      for (const pid of leaders) if (alive(pid) && commandOf(pid).includes(root)) signalGroup(pid, "SIGKILL");
      await waitUntil(() => mine.every((p) => !alive(p.pid)), 5000, 100);
      const leftovers = processTable().filter((p) => p.command.includes(root)).map((p) => ({ pid: p.pid, command: p.command.slice(0, 200) }));
      open.delete(st);
      rmSync(root, { recursive: true, force: true });
      return { leftovers };
    },
    _killAllSync() {
      for (const p of ours()) {
        if (p.command.includes(root) && !DATABASES.test(p.command)) {
          try { process.kill(p.pid, "SIGKILL"); } catch { /* gone */ }
        }
      }
      for (const pid of started) {
        if (alive(pid) && commandOf(pid).includes(root)) { try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ } }
      }
      try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
  return st;
}
