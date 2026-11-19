// The staging harness (PLAN-APPS-ASTRYX T6): one App Studio app run for real in its fence, with
// stand-ins for the generation door and the model relay, on a staging port. It is the before()
// of engine/apps/test/arch-film-studio-real.test.mjs made general for either app: a temp root
// under /private/tmp; a temp copy of the engine files that test copies, whose config.json puts
// the state in the temp root; the app cloned with `cp -cR` (source, .build and dist as they are
// now), READY in the copy only, its packages cloned from the live deps (read only); the fake door
// and relay (fakes.mjs) on port 0; the real host through createAppHost with the real
// appExecSpawner. One difference: in the temp copies of lib/config.mjs and lib/config.py the app
// port range 3171-3189 becomes 4871-4889, and the copied app.json carries the staging port
// (4871 Arch Film Studio, 4872 Render to Film), so no manifest port is ever used. The
// repository's files are never changed, and nothing of the live state is written.
//
// startStage({ slug, port, pictures, log }) -> { slug, port, url, root, dataDir, cfg, host, door,
//   relay, query, mutate, upload, logs, stop }. stop() ends only what it started and removes the root.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import http from "node:http";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appExecSpawner, createAppHost } from "../../host.mjs";
import { ownerHome } from "../../fence.mjs";
import { closeServer, listen, startDoor, startRelay } from "./fakes.mjs";

export const ENGINE = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));
export const REPO = join(ENGINE, "..");
export const STAGE_PORTS = Object.freeze({ "arch-film-studio": 4871, "render-to-film": 4872 });
export const STAGE_RANGE = Object.freeze({ first: 4871, last: 4889 });
export const SRT = join(ENGINE, "node_modules", ".bin", "srt");
export const liveDeps = (slug) => join(ownerHome(), ".paperclip", "uuu-engine", "apps", slug, "deps");

// The ports nothing of this harness may ever take.
export function forbiddenPort(p) {
  return !Number.isInteger(p) || (p >= 3100 && p <= 3299) || [5000, 5432, 7000, 8120].includes(p);
}

export function portBusy(p) {
  return new Promise((ok) => {
    const s = net.createServer();
    s.once("error", () => ok(true));
    s.listen(p, "127.0.0.1", () => s.close(() => ok(false)));
  });
}

// What is missing on this Mac for a stage of `slug`, in words (empty when nothing is).
export function missingFor(slug) {
  const app = join(REPO, "apps", slug);
  return [
    [SRT, "the sandbox tool (engine/node_modules/.bin/srt)"],
    ["/opt/homebrew/bin/ffmpeg", "ffmpeg"], ["/opt/homebrew/bin/ffprobe", "ffprobe"],
    [join(app, ".build", "index.mjs"), `the app's .build/index.mjs (run engine/apps/app-exec ${slug} --build)`],
    [join(app, "dist", "index.html"), `the app's dist/index.html (run engine/apps/app-exec ${slug} --build)`],
    [join(liveDeps(slug), "node_modules"), `the app's packages (~/.paperclip/uuu-engine/apps/${slug}/deps/node_modules)`],
  ].filter(([p]) => !existsSync(p)).map(([, words]) => words);
}

// Replaces exactly one line of `file` matching `from` with `to`; fails loudly otherwise.
export function rewriteOneLine(file, from, to) {
  const lines = readFileSync(file, "utf8").split("\n");
  const hits = lines.map((l, i) => (from.test(l) ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) throw new Error(`stage: expected exactly one line of ${file} to match ${from}, found ${hits.length}`);
  const before = lines.join("\n");
  lines[hits[0]] = lines[hits[0]].replace(from, to);
  const after = lines.join("\n");
  const changed = before.split("\n").filter((l, i) => l !== after.split("\n")[i]).length;
  if (changed !== 1) throw new Error(`stage: the rewrite of ${file} changed ${changed} lines, not one`);
  writeFileSync(file, after);
}

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function waitFor(fn, ms, every = 200) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > until) return v;
    await wait(every);
  }
}

// One request to the staged app as its own page sends it. -> { status, headers, body (Buffer) }
export function request({ port, path, method = "GET", headers = {}, body, timeoutMs = 60_000 }) {
  return new Promise((ok, fail) => {
    const h = { Host: `127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin", ...headers };
    if (method !== "GET" && method !== "HEAD") h.Origin = `http://127.0.0.1:${port}`;
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: h, agent: false, setHost: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", fail);
    });
    req.on("error", fail);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`${method} ${path}: timed out`)));
    req.end(body);
  });
}

export async function startStage({ slug, port = STAGE_PORTS[slug], pictures = null, log = () => {} } = {}) {
  if (!Object.hasOwn(STAGE_PORTS, slug)) throw new Error(`stage: no app is named ${slug}`);
  if (forbiddenPort(port)) throw new Error(`stage: port ${port} is not one this harness may use`);
  if (port < STAGE_RANGE.first || port > STAGE_RANGE.last) throw new Error(`stage: port ${port} is outside ${STAGE_RANGE.first}-${STAGE_RANGE.last}`);
  const missing = missingFor(slug);
  if (missing.length) throw new Error(`stage: missing on this Mac: ${missing.join(", ")}`);
  if (await portBusy(port)) throw new Error(`stage: port ${port} is busy`);

  const REPO_APP = join(REPO, "apps", slug);
  const root = realpathSync(mkdtempSync("/private/tmp/uuu-stage-"));
  let host = null;
  let door = null;
  let relay = null;
  const lines = [];
  const stop = async () => {
    if (host) { await host.close().catch(() => {}); host = null; }
    for (const s of [door?.server, relay?.server]) await closeServer(s);
    rmSync(root, { recursive: true, force: true });
  };
  try {
    // The engine: the files the AFS real test copies, the port range rewritten in the copies.
    const eng = join(root, "engine");
    mkdirSync(join(eng, "apps"), { recursive: true });
    mkdirSync(join(eng, "lib"));
    for (const f of ["app-exec", "fence.mjs", "manifest.mjs"]) copyFileSync(join(ENGINE, "apps", f), join(eng, "apps", f));
    chmodSync(join(eng, "apps", "app-exec"), 0o755);
    for (const f of ["config.mjs", "config.py", "config.sh"]) copyFileSync(join(ENGINE, "lib", f), join(eng, "lib", f));
    rewriteOneLine(join(eng, "lib", "config.mjs"), /^const APP_PORTS = \{ first: 3171, last: 3189 \};$/,
      `const APP_PORTS = { first: ${STAGE_RANGE.first}, last: ${STAGE_RANGE.last} };`);
    rewriteOneLine(join(eng, "lib", "config.py"), /^APP_PORTS = \{"first": 3171, "last": 3189\}$/,
      `APP_PORTS = {"first": ${STAGE_RANGE.first}, "last": ${STAGE_RANGE.last}}`);
    const raw = JSON.parse(readFileSync(join(ENGINE, "config.json"), "utf8"));
    raw.stateRoot = join(root, "s");
    raw.paperclip.instanceRoot = join(root, "instance");
    raw.doors.generate.apps = [slug];
    writeFileSync(join(eng, "config.json"), JSON.stringify(raw));
    symlinkSync(realpathSync(join(ENGINE, "node_modules")), join(eng, "node_modules"));

    // The app: a clone of the repo's folder as it is now, READY and the port in the copy only.
    const code = join(root, "apps", slug);
    mkdirSync(join(root, "apps"));
    const cp = spawnSync("/bin/cp", ["-cR", REPO_APP, code], { encoding: "utf8" });
    if (cp.status !== 0) throw new Error(`stage: could not copy the app: ${cp.stderr}`);
    rmSync(join(code, "node_modules"), { force: true });
    rmSync(join(code, "READY"), { force: true });
    writeFileSync(join(code, "READY"), "staging\n");
    const manifestText = readFileSync(join(code, "app.json"), "utf8");
    const manifest = JSON.parse(manifestText);
    if (manifest.slug !== slug || !Number.isInteger(manifest.port)) throw new Error("stage: the app's app.json is not as expected");
    rewriteOneLine(join(code, "app.json"), new RegExp(`^(\\s*"port":\\s*)${manifest.port}(,?)$`), `$1${port}$2`);
    if (JSON.parse(readFileSync(join(code, "app.json"), "utf8")).port !== port) throw new Error("stage: the copied app.json's port was not rewritten");
    const state = join(root, "s", "apps", slug);
    mkdirSync(state, { recursive: true, mode: 0o700 });
    const dep = spawnSync("/bin/cp", ["-cR", liveDeps(slug), join(state, "deps")], { encoding: "utf8" });
    if (dep.status !== 0) throw new Error(`stage: could not clone the packages: ${dep.stderr}`);
    symlinkSync(join(state, "deps", "node_modules"), join(code, "node_modules"));

    // The config as main() would load it in the temp engine: its own copy of config.mjs.
    const { loadConfig } = await import(pathToFileURL(join(eng, "lib", "config.mjs")).href);
    const cfg = loadConfig({ path: join(eng, "config.json") });
    if (cfg.appPorts.first !== STAGE_RANGE.first || cfg.appPorts.last !== STAGE_RANGE.last) throw new Error("stage: the temp config did not take the staging range");
    if (!realpathSync(cfg.paths.state).startsWith(root + "/")) throw new Error("stage: the state is not in the temp root");
    cfg.paths.appsCode = join(root, "apps");
    cfg.ports.apps = 0;
    mkdirSync(join(cfg.paths.state, "secrets", "doors"), { recursive: true, mode: 0o700 });
    mkdirSync(join(cfg.paths.state, "secrets", "provider"), { recursive: true, mode: 0o700 });
    const relaySecret = randomBytes(32).toString("hex");
    writeFileSync(cfg.paths.generateSecret, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
    writeFileSync(cfg.paths.relaySecret, `${relaySecret}\n`, { mode: 0o600 });
    door = startDoor({ slug, secretPath: cfg.paths.generateSecret, idsPath: cfg.paths.ids, apps: cfg.doors.generate.apps, pictures });
    relay = startRelay({ slug, secret: relaySecret, pictures });
    cfg.urls.generate = `http://127.0.0.1:${await listen(door.server)}`;
    cfg.urls.relay = `http://127.0.0.1:${await listen(relay.server)}`;

    host = createAppHost({ cfg, log: (l) => { lines.push(l); log(l); }, spawnApp: appExecSpawner(join(eng, "apps", "app-exec")), limits: { everyMs: 300 } });
    await host.listen();
    mkdirSync(cfg.paths.apps, { recursive: true, mode: 0o700 });
    writeFileSync(cfg.paths.appsState, JSON.stringify({ version: 1, apps: { [slug]: { on: true } }, changedAt: new Date().toISOString() }), { mode: 0o600 });
    const on = await waitFor(() => host.app(slug)?.state === "on", 120_000);
    const appLog = () => { try { return readFileSync(join(cfg.paths.appsLogs, `${slug}.log`), "utf8").slice(-3000); } catch { return ""; } };
    if (!on) throw new Error(`stage: ${slug} did not come on (${host.app(slug)?.state}: ${host.app(slug)?.why})\n${lines.slice(-15).join("\n")}\n${appLog()}`);

    const url = `http://127.0.0.1:${port}`;
    const query = async (name, input) => {
      const path = `/trpc/${name}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`;
      const r = await request({ port, path });
      if (r.status !== 200) throw new Error(`${name}: ${r.status} ${r.body.toString().slice(0, 400)}`);
      return JSON.parse(r.body.toString("utf8")).result.data;
    };
    const mutate = async (name, input) => {
      const r = await request({ port, method: "POST", path: `/trpc/${name}`, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input ?? null) });
      const json = r.body.length ? JSON.parse(r.body.toString("utf8")) : null;
      if (r.status !== 200) throw new Error(`${name}: ${r.status} ${JSON.stringify(json).slice(0, 400)}`);
      return json.result.data;
    };
    const upload = async (path, bytes, headers = {}) => {
      const r = await request({ port, method: "POST", path, headers: { "Content-Type": "image/jpeg", ...headers }, body: bytes });
      if (r.status !== 200) throw new Error(`upload ${path}: ${r.status} ${r.body.toString().slice(0, 300)}`);
      return JSON.parse(r.body.toString("utf8"));
    };
    return {
      slug, port, url, root, cfg, dataDir: join(state, "data"), door, relay,
      host, query, mutate, upload, logs: () => [...lines], appLog,
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}
