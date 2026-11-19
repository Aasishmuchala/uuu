// The stage of the real-apps check (PLAN-DESKTOP T2, DM3): both App Studio apps run for real in their fence, behind a
// test App Studio host (engine/apps/host.mjs), framed by a seeded test home, so the Mac app's own web view can draw
// them. It is engine/apps/test/stage/stage.mjs (PLAN-APPS-ASTRYX T6) made for two apps and a home, with one
// difference: the apps keep App Studio's own port range and take 3188 (Render to Film) and 3189 (Arch Film Studio),
// the only two ports of 3100 to 3299 this harness may bind (DM3: the orchestrator's go, 127.0.0.1 only, both free by
// lsof first). Everything else is on a free port from 3300 up or on port 0.
//
//  - a temp root under /private/tmp: a temp copy of the engine files the stage copies, whose config.json puts the
//    state in the temp root; each app cloned from this worktree's apps/ (source only), its port rewritten in the
//    copy, its packages cloned from the live engine's deps (read only, as the stage does), and built inside the app
//    fence (`app-exec <slug> --build`) in that temp state: nothing is downloaded;
//  - the stage's fake generation door and model relay (stage/fakes.mjs), one of each per app, behind one door and
//    one relay address that hands each call to its app's fake by the token's subject; no key, no sign-in;
//  - the real host (createAppHost, appExecSpawner), its own address on port 0, the frame allowed only to the test
//    home's port (cfg.ports.home);
//  - a seeded test home (the V2 seed, as testing-v2.mjs startOnV2Seed makes it) on a free port from 3300 up, sharing
//    the temp state, so /api/apps, the switches and the frame-src are the real server's own answers. Both apps are
//    switched on in the temp state; no allowance is opened in it.
// The apps' data is made through their own procedures by the stage's seeds (shots-r2f.mjs, shots-afs.mjs) against
// the fakes, whose allowance is open only while seeding; it is shut before any page is drawn.
// stop() ends only what it started, by handle, and removes the root.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { freePort, kept } from "../scenes/_lib.mjs";

export const APP_PORTS = Object.freeze({ "render-to-film": 3188, "arch-film-studio": 3189 });
export const SLUGS = Object.freeze(Object.keys(APP_PORTS));
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function waitFor(fn, ms, every = 300) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > until) return v;
    await wait(every);
  }
}

// The only ports of 3100 to 3299 this stage may bind.
export const mayBind = (p) => Object.values(APP_PORTS).includes(p) || (Number.isInteger(p) && p >= 3300 && !kept(p));

// One server in front of one fake per app: the call goes to the fake of the app its token names (`v1.t.app-<slug>.`);
// the fake checks the token itself. Port 0.
function dispatcher(targets) {
  const server = http.createServer((req, res) => {
    const auth = String(req.headers.authorization || "");
    const m = /^Bearer v1\.t\.app-([a-z0-9-]+)\./.exec(auth);
    const port = m && targets[m[1]];
    if (!port) { req.resume(); res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":{"message":"No token."},"code":"gen_no_token"}'); }
    const up = http.request({ host: "127.0.0.1", port: port(), method: req.method, path: req.url, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  return server;
}

export async function startStage({ engine, log = () => {} }) {
  const imp = (p) => import(pathToFileURL(join(engine, p)).href);
  const S = await imp("apps/test/stage/stage.mjs");
  const F = await imp("apps/test/stage/fakes.mjs");
  const P = await imp("apps/test/stage/pictures.mjs");
  const SEEDS = { "render-to-film": await imp("apps/test/stage/shots-r2f.mjs"), "arch-film-studio": await imp("apps/test/stage/shots-afs.mjs") };
  const { appExecSpawner, createAppHost } = await imp("apps/host.mjs");
  const seeds = await imp("test/stubs/seed.mjs");
  const { startStubBench } = await imp("test/stubs/bench.mjs");
  const { startStubBoard } = await imp("test/stubs/board.mjs");
  const { createHome } = await imp("home/server/lib/app.mjs");
  const { stubBrandCheckRunner } = await imp("home/server/lib/brandcheck.mjs");
  const { seedDecisions, STUB_URLS } = await imp("home/server/lib/stubs.mjs");
  const { loadConfig: homeLoadConfig } = await imp("lib/config.mjs");
  const REPO = join(engine, "..");

  for (const slug of SLUGS) {
    const missing = S.missingFor(slug).filter((w) => !/\.build|dist/.test(w));
    if (missing.length) throw new Error(`missing on this Mac: ${missing.join(", ")}`);
  }
  const root = realpathSync(mkdtempSync("/private/tmp/uuu-appsreal-"));
  const servers = [];
  let host = null;
  let board = null;
  let bench = null;
  let home = null;
  const lines = [];
  const stop = async () => {
    if (home) { await home.close().catch(() => {}); home = null; }
    if (host) { await host.close().catch(() => {}); host = null; }
    for (const s of servers.splice(0)) await F.closeServer(s);
    if (board) { await board.close().catch(() => {}); board = null; }
    if (bench) { await bench.close().catch(() => {}); bench = null; }
    rmSync(root, { recursive: true, force: true });
  };
  try {
    // The state: the V2 seed, as startOnV2Seed writes it.
    const state = join(root, "s");
    seeds.copyStateSeedV2(state);
    mkdirSync(join(state, "books", "bench"), { recursive: true });
    mkdirSync(join(state, "secrets"), { recursive: true, mode: 0o700 });
    chmodSync(join(state, "secrets"), 0o700);
    writeFileSync(join(state, "secrets", "bench-owner-api.txt"), "owner\nowner\n", { mode: 0o600 });
    seedDecisions(state, undefined);

    // The engine copy app-exec runs from (the stage's list of files), App Studio's own range kept.
    const eng = join(root, "engine");
    mkdirSync(join(eng, "apps"), { recursive: true });
    mkdirSync(join(eng, "lib"));
    for (const f of ["app-exec", "fence.mjs", "manifest.mjs"]) copyFileSync(join(engine, "apps", f), join(eng, "apps", f));
    chmodSync(join(eng, "apps", "app-exec"), 0o755);
    for (const f of ["config.mjs", "config.py", "config.sh"]) copyFileSync(join(engine, "lib", f), join(eng, "lib", f));
    board = await startStubBoard({ seed: seeds.boardSeedV2() });
    bench = await startStubBench({ seed: seeds.benchSeed() });
    const raw = JSON.parse(readFileSync(join(engine, "config.json"), "utf8"));
    raw.stateRoot = state;
    raw.paperclip.instanceRoot = join(root, "instance");
    raw.doors.generate.apps = [...SLUGS];
    raw.ports.board = board.port;
    raw.ports.benchWeb = bench.port;
    writeFileSync(join(eng, "config.json"), JSON.stringify(raw, null, 2));
    symlinkSync(realpathSync(join(engine, "node_modules")), join(eng, "node_modules"));

    // The apps: source cloned, READY kept, the port rewritten, packages cloned, then built in the fence.
    mkdirSync(join(root, "apps"));
    for (const slug of SLUGS) {
      const code = join(root, "apps", slug);
      const cp = spawnSync("/bin/cp", ["-cR", join(REPO, "apps", slug), code], { encoding: "utf8" });
      if (cp.status !== 0) throw new Error(`could not copy ${slug}: ${cp.stderr}`);
      for (const n of ["node_modules", ".build", "dist"]) rmSync(join(code, n), { recursive: true, force: true });
      if (!existsSync(join(code, "READY"))) writeFileSync(join(code, "READY"), "apps-real\n");
      const m = JSON.parse(readFileSync(join(code, "app.json"), "utf8"));
      if (m.slug !== slug || !Number.isInteger(m.port)) throw new Error(`${slug}: app.json is not as expected`);
      S.rewriteOneLine(join(code, "app.json"), new RegExp(`^(\\s*"port":\\s*)${m.port}(,?)$`), `$1${APP_PORTS[slug]}$2`);
      if (JSON.parse(readFileSync(join(code, "app.json"), "utf8")).port !== APP_PORTS[slug]) throw new Error(`${slug}: the port was not rewritten`);
      const st = join(state, "apps", slug);
      mkdirSync(st, { recursive: true, mode: 0o700 });
      const dep = spawnSync("/bin/cp", ["-cR", S.liveDeps(slug), join(st, "deps")], { encoding: "utf8" });
      if (dep.status !== 0) throw new Error(`could not clone the packages of ${slug}: ${dep.stderr}`);
      symlinkSync(join(st, "deps", "node_modules"), join(code, "node_modules"));
      const t0 = Date.now();
      const b = spawnSync(join(eng, "apps", "app-exec"), [slug, "--build"], { encoding: "utf8", timeout: 600_000, env: { PATH: "/usr/bin:/bin" } });
      if (b.status !== 0 || !existsSync(join(code, ".build", "index.mjs")) || !existsSync(join(code, "dist", "index.html"))) {
        throw new Error(`the app fence could not build ${slug} in the temp state (exit ${b.status}):\n${String(b.stdout).slice(-1500)}\n${String(b.stderr).slice(-1500)}`);
      }
      log(`  ${slug}: built in the app fence in ${Math.round((Date.now() - t0) / 1000)} s`);
    }

    // The pictures the fakes hand back; every clip given a quiet tone so sound on and off can be heard as a change.
    const pictures = await P.makePictures({ into: join(root, "pictures"), limit: 12 });
    for (const set of pictures.sets) {
      const tmp = `${set.clip}.a.mp4`;
      const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", set.clip, "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100",
        "-shortest", "-c:v", "copy", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", tmp], { encoding: "utf8", timeout: 60_000 });
      if (r.status === 0) renameSync(tmp, set.clip);
    }

    // The host's config, as the stage makes it, and the fakes.
    const { loadConfig } = await import(pathToFileURL(join(eng, "lib", "config.mjs")).href);
    const cfg = loadConfig({ path: join(eng, "config.json") });
    if (!realpathSync(cfg.paths.state).startsWith(root + "/")) throw new Error("the state is not in the temp root");
    cfg.paths.appsCode = join(root, "apps");
    cfg.ports.apps = 0;
    const homePort = await freePort(3300);
    if (!mayBind(homePort)) throw new Error("no free port from 3300 up for the test home");
    cfg.ports.home = homePort;
    mkdirSync(join(cfg.paths.state, "secrets", "doors"), { recursive: true, mode: 0o700 });
    mkdirSync(join(cfg.paths.state, "secrets", "provider"), { recursive: true, mode: 0o700 });
    const relaySecret = randomBytes(32).toString("hex");
    writeFileSync(cfg.paths.generateSecret, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
    writeFileSync(cfg.paths.relaySecret, `${relaySecret}\n`, { mode: 0o600 });
    const doors = {};
    const relays = {};
    for (const slug of SLUGS) {
      doors[slug] = F.startDoor({ slug, secretPath: cfg.paths.generateSecret, idsPath: cfg.paths.ids, apps: cfg.doors.generate.apps, pictures });
      relays[slug] = F.startRelay({ slug, secret: relaySecret, pictures });
      servers.push(doors[slug].server, relays[slug].server);
      await F.listen(doors[slug].server);
      await F.listen(relays[slug].server);
    }
    const doorFront = dispatcher(Object.fromEntries(SLUGS.map((s) => [s, () => doors[s].server.address().port])));
    const relayFront = dispatcher(Object.fromEntries(SLUGS.map((s) => [s, () => relays[s].server.address().port])));
    servers.push(doorFront, relayFront);
    cfg.urls.generate = `http://127.0.0.1:${await F.listen(doorFront)}`;
    cfg.urls.relay = `http://127.0.0.1:${await F.listen(relayFront)}`;

    for (const p of Object.values(APP_PORTS)) if (await S.portBusy(p)) throw new Error(`port ${p} is busy`);
    host = createAppHost({ cfg, log: (l) => { lines.push(l); log(l); }, spawnApp: appExecSpawner(join(eng, "apps", "app-exec")), limits: { everyMs: 300 } });
    await host.listen();
    mkdirSync(cfg.paths.apps, { recursive: true, mode: 0o700 });
    writeFileSync(cfg.paths.appsState, JSON.stringify({ version: 1, apps: Object.fromEntries(SLUGS.map((s) => [s, { on: true }])), changedAt: new Date().toISOString() }), { mode: 0o600 });
    const appLog = (slug) => { try { return readFileSync(join(cfg.paths.appsLogs, `${slug}.log`), "utf8").slice(-3000); } catch { return ""; } };
    for (const slug of SLUGS) {
      const on = await waitFor(() => host.app(slug)?.state === "on", 120_000);
      if (!on) throw new Error(`${slug} did not come on (${host.app(slug)?.state}: ${host.app(slug)?.why})\n${lines.slice(-15).join("\n")}\n${appLog(slug)}`);
    }

    // The test home on the same state, App Studio's host as its `apps` part, the apps' folder the temp one.
    const hcfg = homeLoadConfig({ path: join(eng, "config.json") });
    hcfg.paths.appsCode = join(root, "apps");
    hcfg.ports.home = homePort;
    const app = await createHome({
      config: hcfg,
      urls: { ...STUB_URLS, apps: `http://127.0.0.1:${host.port}` },
      proveCommand: [process.execPath, "-e", "setTimeout(() => {}, 1500)"],
      log: () => {},
    });
    app.home.brandCheckRunner = stubBrandCheckRunner;
    await app.listen(homePort);
    home = app;

    // Each app's procedures, for its seed.
    const apps = {};
    for (const slug of SLUGS) {
      const port = APP_PORTS[slug];
      const query = async (name, input) => {
        const path = `/trpc/${name}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`;
        const r = await S.request({ port, path });
        if (r.status !== 200) throw new Error(`${slug} ${name}: ${r.status} ${r.body.toString().slice(0, 400)}`);
        return JSON.parse(r.body.toString("utf8")).result.data;
      };
      const mutate = async (name, input) => {
        const r = await S.request({ port, method: "POST", path: `/trpc/${name}`, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input ?? null) });
        const json = r.body.length ? JSON.parse(r.body.toString("utf8")) : null;
        if (r.status !== 200) throw new Error(`${slug} ${name}: ${r.status} ${JSON.stringify(json).slice(0, 400)}`);
        return json.result.data;
      };
      const upload = async (path, bytes, headers = {}) => {
        const r = await S.request({ port, method: "POST", path, headers: { "Content-Type": "image/jpeg", ...headers }, body: bytes });
        if (r.status !== 200) throw new Error(`${slug} upload ${path}: ${r.status} ${r.body.toString().slice(0, 300)}`);
        return JSON.parse(r.body.toString("utf8"));
      };
      apps[slug] = { slug, port, url: `http://127.0.0.1:${port}`, door: doors[slug], relay: relays[slug], query, mutate, upload, appLog: () => appLog(slug), dataDir: join(state, "apps", slug, "data") };
    }
    const seed = async () => {
      const made = {};
      for (const slug of SLUGS) {
        const t0 = Date.now();
        made[slug] = await SEEDS[slug].seed(apps[slug], pictures, log);
        doors[slug].releaseAll();
        doors[slug].setAllowance({ open: false, budget: 0, spent: 0 });
        log(`  ${slug}: seeded in ${Math.round((Date.now() - t0) / 1000)} s; the fake door's allowance shut`);
      }
      return made;
    };
    return { root, state, homePort, hostPort: host.port, home: app, host, cfg, apps, pictures, seed, logs: () => [...lines], stop };
  } catch (err) {
    await stop();
    throw err;
  }
}
