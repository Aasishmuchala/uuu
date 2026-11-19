// The stage's runner (PLAN-STRESS T2): one child process per part that has no real entry the stage may use as it is.
//   part-runner.mjs <part> <stage root>                  board | books | relay | web | generate | apps
//   part-runner.mjs fault <stage root> <part> <mode>     a fault server on the part's own port(s) (faults.mjs)
//   part-runner.mjs probe <stage root> <host> <port>     tries one connect and prints { refused, message }
// It runs from the stage's copy of the engine (<stage root>/root/engine/stress/lib/), always under netguard.mjs.
// The relay, the web door and the generation door are made by their own factories with the fakes injected, as their
// own tests make them, because their real entries point at Omega Plus, the internet and Runway (accepted gap: the
// entries' start-up glue is not run). `apps` is the second, runner-made App Studio host (stage option apps: true):
// app ports base+71..+89 and the stage's cloned apps. Each runner with fakes serves a small control address on
// 127.0.0.1 (port 0), written to <stage root>/fakes/<part>.json, so a sweep can change a fake's `behaviour`.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import { PARTS, startFaultServer } from "./faults.mjs";

const [, , first, root, ...rest] = process.argv;
const stamp = () => new Date().toISOString();
const say = (line) => console.log(`${stamp()} stage ${first}: ${line}`);

if (!root || !existsSync(join(root, "stage.json"))) {
  console.error("usage: part-runner.mjs <part> <stage root> (the stage root holds stage.json)");
  process.exit(64);
}
const stage = JSON.parse(readFileSync(join(root, "stage.json"), "utf8"));
const ENGINE = stage.engineDir;
const imp = (rel) => import(join(ENGINE, rel));

// Arrays the stubs keep of every request: trimmed so a long soak measures the engine, not the stubs.
function keepTrimmed(...lists) {
  const t = setInterval(() => {
    for (const l of lists) if (Array.isArray(l) && l.length > 2000) l.splice(0, l.length - 1000);
  }, 30000);
  t.unref();
}

function ownFolder(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

// The control address: GET /fakes, GET /seen/<name>, POST /behaviour/<name> (the body replaces the behaviour).
async function startControl(part, fakes) {
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
      res.end(text);
    };
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const m = /^\/(fakes|seen|behaviour)(?:\/([a-z-]+))?$/.exec(req.url || "");
      if (!m) return send(404, { error: "no such control" });
      if (m[1] === "fakes") {
        return send(200, Object.fromEntries(Object.entries(fakes).map(([k, f]) => [k, { url: f.url, behaviour: f.behaviour || null }])));
      }
      const f = fakes[m[2]];
      if (!f) return send(404, { error: "no such fake" });
      if (m[1] === "seen") return send(200, { seen: (f.seen || []).slice(-200) });
      if (req.method !== "POST" || !f.behaviour) return send(405, { error: "POST a behaviour to a fake that has one" });
      let b;
      try { b = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return send(400, { error: "not JSON" }); }
      for (const k of Object.keys(f.behaviour)) delete f.behaviour[k];
      Object.assign(f.behaviour, b && typeof b === "object" ? b : {});
      return send(200, { behaviour: f.behaviour });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const out = { part, control: url, fakes: Object.fromEntries(Object.entries(fakes).map(([k, f]) => [k, f.url])) };
  mkdirSync(join(root, "fakes"), { recursive: true });
  const file = join(root, "fakes", `${part}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(out, null, 2));
  renameSync(`${file}.tmp`, file);
  return server;
}

function onStop(fn) {
  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    try { await fn(); } catch { /* ending anyway */ }
    say(`stopped (${sig})`);
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

const lastResort = (err) => say(`caught an error it did not expect: ${err && (err.code || err.name)}`);

async function loadCfg() {
  const { loadConfig } = await imp("lib/config.mjs");
  return loadConfig({ path: join(ENGINE, "config.json") });
}

// ---- the parts ---------------------------------------------------------------------------------------------------

async function runBoard() {
  const { startStubBoard } = await imp("test/stubs/board.mjs");
  const cfg = await loadCfg();
  const seed = JSON.parse(readFileSync(join(root, "seed", "board.json"), "utf8"));
  const board = await startStubBoard({ port: cfg.ports.board, seed, instanceRoot: cfg.paperclip.instanceRoot });
  keepTrimmed(board.requests);
  say(`stub board on ${board.url}`);
  onStop(() => board.close());
}

async function runBooks() {
  const { startStubBench } = await imp("test/stubs/bench.mjs");
  const cfg = await loadCfg();
  const seed = JSON.parse(readFileSync(join(root, "seed", "bench.json"), "utf8"));
  const bench = await startStubBench({ port: cfg.ports.benchWeb, seed });
  keepTrimmed(bench.requests);
  say(`stub books on http://127.0.0.1:${cfg.ports.benchWeb}`);
  onStop(() => bench.close());
}

async function runRelay() {
  process.on("uncaughtException", lastResort);
  process.on("unhandledRejection", lastResort);
  const { createRelay } = await imp("relay/relay.mjs");
  const { startProvider } = await imp("test/stubs/provider.mjs");
  const cfg = await loadCfg();
  const p = cfg.paths;
  ownFolder(p.models);
  ownFolder(p.providerSecrets);
  const { randomBytes } = await import("node:crypto");
  try {
    writeFileSync(p.relaySecret, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  const provider = await startProvider({ behaviour: {} });
  keepTrimmed(provider.seen);
  const relay = createRelay({
    listenPort: cfg.ports.relay, upstream: provider.url,
    paths: { state: p.modelsState, ids: p.ids, key: p.providerKey, secret: p.relaySecret, status: p.relayStatus },
    log: (line) => console.log(line),
  });
  await relay.listen();
  const control = await startControl("relay", { provider });
  say(`relay on 127.0.0.1:${cfg.ports.relay}, the fake provider on ${provider.url}`);
  onStop(async () => { await relay.close(); await provider.close(); control.close(); });
}

async function runWeb() {
  process.on("uncaughtException", lastResort);
  process.on("unhandledRejection", lastResort);
  const { createWebDoor, webDoorOptions } = await imp("web/door.mjs");
  const { ensureSecret } = await imp("doors/common.mjs");
  const I = await imp("test/stubs/internet.mjs");
  const cfg = await loadCfg();
  ownFolder(cfg.paths.doors);
  ensureSecret(cfg.paths.webSecret);
  const page = "<!doctype html><title>A stress page</title><h1>A stress page</h1><p>Plain words about timber prices.</p>";
  const inet = await I.startInternet({
    sites: {
      "site.test": { addresses: ["93.184.216.34"], handler: I.ok(page) },
      "example.com": { addresses: ["93.184.216.35"], handler: I.ok("<title>Example Domain</title><p>Example</p>") },
      "stall.test": { addresses: ["151.101.0.5"], handler: I.stall() },
      "drip.test": { addresses: ["151.101.0.11"], handler: I.drip(50) },
      "big.test": { addresses: ["151.101.0.2"], handler: I.big(6 * 1024 * 1024, { declare: false }) },
      "bomb.test": { addresses: ["151.101.0.3"], handler: I.bomb("gzip", 64 * 1024 * 1024) },
      "to-loop.test": { addresses: ["151.101.0.12"], handler: I.redirect("http://127.0.0.1/") },
      "to-private.test": { addresses: ["151.101.0.1"], handler: I.redirect("http://private.test/") },
      "private.test": { addresses: ["10.1.2.3"], handler: I.ok("router") },
      "loop.test": { addresses: ["127.0.0.1"], handler: I.ok("loop") },
      "api.search.brave.com": { addresses: ["151.101.0.9"], handler: I.ok('{"web":{"results":[]}}', { type: "application/json" }) },
      "html.duckduckgo.com": { addresses: ["151.101.0.13"], handler: I.ok("<html><body></body></html>") },
    },
  });
  keepTrimmed(inet.seen.lookups, inet.seen.connects, inet.seen.requests);
  // The watch's programs are made unfindable, so it never starts yt-dlp (which would reach the real internet).
  const none = join(root, "no-tools", "absent");
  const tools = { srt: none, ytdlp: [none], ffprobe: [none], ffmpeg: [none], whisper: [none], deno: none };
  const door = createWebDoor({ ...webDoorOptions(cfg), net: inet.net, tools });
  await door.listen();
  const control = await startControl("web", { internet: { url: null, seen: inet.seen.requests } });
  say(`web door on 127.0.0.1:${cfg.ports.web}, on the fake internet`);
  onStop(async () => { await door.close(); await inet.close(); control.close(); });
}

async function runGenerate() {
  process.on("uncaughtException", lastResort);
  process.on("unhandledRejection", lastResort);
  const { createGenerateDoor, generateDoorOptions } = await imp("generate/door.mjs");
  const { ensureSecret } = await imp("doors/common.mjs");
  const { startRunway } = await imp("test/stubs/runway.mjs");
  const RM = await imp("test/stubs/runway-mcp.mjs");
  const HF = await imp("test/stubs/higgsfield.mjs");
  const cfg = await loadCfg();
  ownFolder(cfg.paths.doors);
  ownFolder(cfg.paths.doorWork);
  ensureSecret(cfg.paths.generateSecret);
  const runway = await startRunway({ key: stage.runwayKey, behaviour: {} });
  const runwayMcp = await RM.startRunwayMcp({ behaviour: {} });
  const higgsfield = await HF.startHiggsfield({ behaviour: {} });
  keepTrimmed(runway.seen.api, runway.seen.outputs, runway.seen.lookups, runway.seen.connects, runwayMcp.calls, higgsfield.calls);
  const real = generateDoorOptions(cfg);
  const door = createGenerateDoor({
    ...real,
    upstream: runway.url, net: runway.net,
    higgsfield: { origin: higgsfield.url, redirectUri: real.higgsfield.redirectUri, net: higgsfield.net, uploadSuffixes: [HF.UPLOAD_HOST.split(".").slice(1).join(".")] },
    runwayAccount: { origin: runwayMcp.url, redirectUri: real.runwayAccount.redirectUri, net: runwayMcp.net, uploadSuffixes: [RM.UPLOAD_HOST] },
  });
  await door.listen();
  const control = await startControl("generate", {
    runway: { url: runway.url, behaviour: runway.behaviour, seen: runway.seen.api },
    "runway-mcp": { url: runwayMcp.url, behaviour: runwayMcp.behaviour, seen: runwayMcp.calls },
    higgsfield: { url: higgsfield.url, behaviour: higgsfield.behaviour, seen: higgsfield.calls },
  });
  say(`generation door on 127.0.0.1:${cfg.ports.generate}, on fake Runway, Runway MCP and Higgsfield`);
  onStop(async () => { await door.close(); await runway.close(); await runwayMcp.close(); await higgsfield.close(); control.close(); });
}

// The second App Studio host. spawnApp: the copy's own fenced app-exec (stage option appsSpawn "fenced", the
// default), or (appsSpawn "fixture") the host's test fixture's server.mjs, our own test code, for the `fix` app only.
async function runApps() {
  process.on("uncaughtException", lastResort);
  process.on("unhandledRejection", lastResort);
  const H = await imp("apps/host.mjs");
  const cfg = await loadCfg();
  cfg.appPorts = { first: stage.ports.home - 99 + 71, last: stage.ports.home - 99 + 89 };
  cfg.paths.appsCode = join(root, "root", "apps");
  for (const f of [cfg.paths.apps, cfg.paths.appsRun, cfg.paths.appsLogs]) ownFolder(f);
  let spawnApp = H.appExecSpawner(join(ENGINE, "apps", "app-exec"));
  if (stage.appsSpawn === "fixture") {
    spawnApp = (slug, env) => {
      const folder = join(cfg.paths.appsCode, slug);
      const args = slug === "fix" && existsSync(join(folder, "server.mjs"))
        ? ["--import", join(ENGINE, "stress", "lib", "netguard.mjs"), join(folder, "server.mjs")]
        : ["-e", "process.exit(70)"];
      return spawn(process.execPath, args, {
        cwd: folder, detached: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
        env: { ...env, STRESS_PART: `app-${slug}`, STRESS_STAGE_ROOT: root },
      });
    };
  }
  const host = H.createAppHost({ cfg, log: (line) => console.log(line), spawnApp });
  await host.listen();
  say(`second App Studio host on 127.0.0.1:${cfg.ports.apps}, apps on ${cfg.appPorts.first}-${cfg.appPorts.last} (${stage.appsSpawn || "fenced"})`);
  onStop(() => host.close());
}

async function runFault(part, mode) {
  const p = PARTS[part];
  if (!p) throw new Error(`no such part ${part}`);
  const server = await startFaultServer({ ports: p.ports.map((k) => stage.ports[k]), mode, shape: p.shape });
  say(`fault ${mode} for ${part} on ${p.ports.map((k) => stage.ports[k]).join(", ")}`);
  onStop(() => server.close());
  setInterval(() => {}, 1 << 30);
}

function runProbe(host, port) {
  let out;
  try {
    const s = net.connect({ host, port: Number(port) });
    s.on("error", () => {});
    s.destroy();
    out = { refused: false, message: "connect was let through" };
  } catch (e) {
    out = { refused: true, message: e.message };
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
}

const RUNNERS = { board: runBoard, books: runBooks, relay: runRelay, web: runWeb, generate: runGenerate, apps: runApps };
try {
  if (first === "fault") await runFault(rest[0], rest[1]);
  else if (first === "probe") runProbe(rest[0], rest[1]);
  else if (RUNNERS[first]) await RUNNERS[first]();
  else {
    console.error(`part-runner: no runner for ${first}`);
    process.exit(64);
  }
} catch (err) {
  say(`could not start: ${err && (err.code || err.message)}`);
  process.exit(1);
}
