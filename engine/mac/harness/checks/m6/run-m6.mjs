// The WebKit pass's checks (PLAN-MAC-2 M6, (a) to (n)): each a page script of this folder, run in the app's own web
// view through webkit-probe on a seeded home (the scenes run-webkit.mjs uses), some also in the cook harness's hidden
// Chrome for the comparison. Writes EVID/r<round>/checks.json (every run's report) and prints one line a run.
// usage: node engine/mac/harness/checks/m6/run-m6.mjs [--round mac6] [--only <regex over run ids>]
// The picture round itself is run-webkit.mjs; this adds the measures the pictures cannot show. It judges nothing:
// the hand-back's table does, from checks.json and the pictures.
// One hidden browser at a time: takes WEBKIT_LOCK (default the session's chrome.lock) with mkdir, waits 20 s while
// it exists. Refuses below 20 percent on battery. Stops everything it started, by its own handle. Nothing is bound or
// called on 3100 to 3299, 5000, 5432, 7000 or 8120; no file under engine/home/public is changed.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inventory } from "./css-inventory.mjs";

process.title = "uuu-mac-m6-checks";
const HERE = dirname(fileURLToPath(import.meta.url));
const MAC = resolve(HERE, "..", "..", "..");
const ENGINE = resolve(MAC, "..");
if (ENGINE === "/Users/aasish/uuu/engine" || ENGINE.startsWith("/Users/aasish/uuu/engine/")) { console.error("refused: run the worktree's copy"); process.exit(2); }
const HARNESS = "/Users/aasish/uuu/cook/harness/cook";
const MACH = join(MAC, "harness");
const EVID = process.env.WEBKIT_EVID || "/Users/aasish/uuu/.router/evidence/mac";
const LOCK = process.env.WEBKIT_LOCK || "/private/tmp/claude-501/-Users-aasish-uuu/9fa356e7-01ff-4248-bf1d-261a723e0785/scratchpad/chrome.lock";
const PROBE = join(MAC, ".build", "release", "webkit-probe");
const kept = (p) => (p >= 3100 && p <= 3299) || [5000, 5432, 7000, 8120].includes(p);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const opt = { round: "mac6", only: "." };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--round") opt.round = argv[++i];
  else if (argv[i] === "--only") opt.only = argv[++i];
  else { console.error(`unknown argument ${argv[i]}`); process.exit(2); }
}
if (!/^[0-9a-z-]+$/i.test(opt.round)) { console.error("bad --round"); process.exit(2); }
if (!existsSync(PROBE)) { console.error(`no probe at ${PROBE}`); process.exit(2); }

// ---- the runs ---------------------------------------------------------------------------------------------------
const PRE = readFileSync(join(HERE, "_pre.js"), "utf8");
const H = { scene: "plain", from: "harness" };
const W = { scene: "world", from: "harness", wait: "[data-office=ready]" };
const BR = { scene: "brain", from: "mac" };
const MAP_READY = "[data-office=ready]";
const tokenNames = (() => {
  const t = readFileSync(join(ENGINE, "home", "public", "styles", "tokens.css"), "utf8");
  const block = t.slice(t.indexOf(':root[data-theme="light"]'), t.indexOf("@media (prefers-color-scheme: light)"));
  return [...new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))];
})();
const shotsH = JSON.parse(readFileSync(join(HARNESS, "shots.json"), "utf8"));
const plainStates = (await import(pathToFileURL(join(HARNESS, "scenes", "plain.mjs")).href)).states;

const RUNS = [];
const add = (r) => RUNS.push({ w: 1280, h: 900, theme: "dark", flags: [], inj: {}, ...r });
// (a) pictures
for (const [st, w] of [["map", 1280], ["map", 390], ["needs", 1280], ["needs", 390]]) add({ id: `a-world-${st}-${w}`, letter: "a", ...W, state: st, w, h: w === 390 ? 844 : 900, script: "a-pictures.js", inj: { wait: MAP_READY } });
for (const [w, theme] of [[1280, "dark"], [1280, "light"], [390, "dark"], [390, "light"]]) add({ id: `a-room-tasks-${w}-${theme}`, letter: "a", ...H, state: "tasks", w, h: w === 390 ? 844 : 900, theme, script: "a-pictures.js" });
// (b) scrolling at 1280
add({ id: "b-map", letter: "b", ...W, state: "map", script: "b-scroll.js", inj: { wait: MAP_READY } });
add({ id: "b-map-list", letter: "b", ...H, state: "map-list", script: "b-scroll.js" });
add({ id: "b-tasks", letter: "b", ...H, state: "tasks", script: "b-scroll.js" });
add({ id: "b-files", letter: "b", ...H, state: "files", script: "b-scroll.js" });
// (c) CSS, WebKit and Chrome
add({ id: "c-css", letter: "c", ...H, state: "tasks", script: "c-css.js", inj: { inv: inventory() }, chrome: true });
add({ id: "c-summary", letter: "c", ...H, state: "task-done", script: "c-summary.js", chrome: true });
add({ id: "c-summary-jobs", letter: "c", ...H, state: "jobs", script: "c-summary.js", chrome: true });
// (d) policy: the home's content policy and frame-src, on App Studio with an app open
add({ id: "d-tasks", letter: "d", ...H, state: "tasks", script: "d-policy.js" });
add({ id: "d-app", letter: "d", scene: "apps", from: "mac", state: "app-on", script: "d-policy.js" });
// (e) secure context, clipboard, localStorage
add({ id: "e-context", letter: "e", ...H, state: "tasks", script: "e-context.js", inj: { mark: `m6-${Date.now()}` }, storage: true });
// (f) motion and the theme on Auto
add({ id: "f-motion-on", letter: "f", ...H, state: "map", query: "theme=dark", script: "f-motion.js", inj: { to: "#/tasks" } });
add({ id: "f-motion-off", letter: "f", ...H, state: "map", query: "theme=dark&motion=off", script: "f-motion.js", inj: { to: "#/tasks" } });
add({ id: "f-motion-reduced", letter: "f", ...H, state: "map", query: "theme=dark", flags: ["--reduced-motion"], script: "f-motion.js", inj: { to: "#/tasks" } });
add({ id: "f-auto-light", letter: "f", ...H, state: "tasks", query: "theme=auto&motion=off", theme: "light", script: "f-tokens.js", inj: { names: tokenNames, as: "light" } });
add({ id: "f-auto-dark", letter: "f", ...H, state: "tasks", query: "theme=auto&motion=off", theme: "dark", script: "f-tokens.js", inj: { names: tokenNames, as: "dark" } });
// (g) focus
add({ id: "g-tasks", letter: "g", ...H, state: "tasks", script: "g-focus.js" });
add({ id: "g-settings", letter: "g", ...H, state: "settings-appearance", script: "g-focus.js" });
add({ id: "g-brain", letter: "g", ...BR, state: "brain-results", script: "g-focus.js", inj: { wait: ".p-brain-find__result" } });
// (h) fonts (WebKit and Chrome) and every plain first row at 1280 against the cook harness's baseline
add({ id: "h-fonts-tasks", letter: "h", ...H, state: "tasks", script: "h-fonts.js", inj: { first: ".p-tasks__row" }, chrome: true });
add({ id: "h-fonts-settings", letter: "h", ...H, state: "settings-appearance", script: "h-fonts.js", inj: { first: ".k-rows__row" }, chrome: true });
for (const s of shotsH.filter((x) => x.scene === "plain" && x.first && (!x.widths || x.widths.includes(1280)))) {
  const st = plainStates[s.state];
  if (!st || st.steps || st.fresh || st.query) continue;
  if (["h-fonts-tasks"].includes(`h-first-${s.id}`)) continue;
  add({ id: `h-first-${s.id}`, letter: "h", ...H, state: s.state, script: "h-fonts.js", inj: { first: s.first }, baselineKey: `plain:${s.state}` });
}
// (i) scroll edges, sticky bars, no tab bar at 900
add({ id: "i-tasks", letter: "i", ...H, state: "tasks", script: "i-bars.js" });
add({ id: "i-files", letter: "i", ...H, state: "files", script: "i-bars.js" });
add({ id: "i-tasks-900", letter: "i", ...H, state: "tasks", w: 900, h: 800, script: "i-bars.js" });
add({ id: "i-map-900", letter: "i", ...W, state: "map", w: 900, h: 800, script: "i-bars.js", inj: { wait: MAP_READY } });
// (j) the film player
add({ id: "j-film", letter: "j", scene: "film", from: "harness", state: "film-open", script: "j-film.js" });
// (k) dialog, popover, inert with a panel open on the Map
add({ id: "k-map-room", letter: "k", ...W, state: "map-room", script: "k-layers.js", inj: { wait: MAP_READY } });
add({ id: "k-map-confirm", letter: "k", ...W, state: "map-door-confirm", script: "k-layers.js", inj: { wait: MAP_READY }, withSteps: true });
// (l) the Brain tab
add({ id: "l-brain-flow", letter: "l", ...BR, state: "brain-before", script: "l-brain.js", inj: { mode: "flow" } });
for (const theme of ["dark", "light"]) add({ id: `l-brain-390-${theme}`, letter: "l", ...BR, state: "brain-results", w: 390, h: 844, theme, script: "l-brain.js", inj: { mode: "layout" } });
// (m) Settings → Brain
for (const [w, theme] of [[1280, "dark"], [1280, "light"], [390, "dark"], [390, "light"]]) add({ id: `m-brain-${w}-${theme}`, letter: "m", ...BR, state: "settings-brain-off", w, h: w === 390 ? 844 : 900, theme, script: "m-settings-brain.js", inj: { press: w === 1280 && theme === "dark" } });
// (n) the Astryx-kit app on App Studio
add({ id: "n-astryx", letter: "n", scene: "apps", from: "mac", state: "astryx-app", script: "n-astryx.js" });

const only = new RegExp(opt.only);
const runs = RUNS.filter((r) => only.test(r.id));
if (!runs.length) { console.error(`no run matches ${opt.only}`); process.exit(2); }

// ---- power, lock, what is running -----------------------------------------------------------------------------
const batt = execFileSync("/usr/bin/pmset", ["-g", "batt"], { encoding: "utf8" });
const pct = Number((batt.match(/(\d+)%/) || [])[1]);
console.log(`pmset: ${batt.trim().split("\n").pop().trim()}`);
if (/discharging/.test(batt) && pct < 20) { console.error("on battery below 20 percent: no browser pass"); process.exit(1); }
let locked = false;
async function takeLock() {
  mkdirSync(dirname(LOCK), { recursive: true });
  for (;;) {
    try { mkdirSync(LOCK); locked = true; console.log(`lock: ${LOCK}`); return; } catch (e) { if (e.code !== "EEXIST") throw e; console.log("lock held; waiting 20 s"); await wait(20000); }
  }
}
let home = null; let homeKey = null; let probe = null; let chrome = null;
const scratch = mkdtempSync(join(tmpdir(), "uuu-mac-m6-"));
async function stopHome() { const h = home; home = null; homeKey = null; if (h) { try { await h.stop(); } catch (e) { console.log(`note: a home did not stop cleanly: ${e.message}`); } } }
async function stopAll() {
  if (probe) { try { probe.kill("SIGTERM"); } catch { /* ended */ } probe = null; }
  if (chrome) { try { await chrome.close(); } catch { /* ended */ } chrome = null; }
  await stopHome();
  rmSync(scratch, { recursive: true, force: true });
  if (locked) { try { rmdirSync(LOCK); } catch { /* gone */ } locked = false; }
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await stopAll(); process.exit(130); });
process.env.COOK_ENGINE = ENGINE;

const mods = {};
async function sceneMod(r) {
  const key = `${r.from}:${r.scene}`;
  if (!mods[key]) mods[key] = await import(pathToFileURL(join(r.from === "mac" ? join(MACH, "scenes") : join(HARNESS, "scenes"), `${r.scene}.mjs`)).href);
  return mods[key];
}
async function homeFor(r) {
  const mod = await sceneMod(r);
  const each = mod.homes === "each" || mod.states[r.state]?.fresh;
  const key = each ? `${r.from}:${r.scene}:${r.state}:${r.id}` : `${r.from}:${r.scene}`;
  if (home && homeKey === key) return { home, mod };
  await stopHome();
  const h = await mod.start({ engine: ENGINE, state: each ? r.state : null });
  const port = Number(new URL(h.base).port);
  if (kept(port)) { await h.stop(); throw new Error(`refused: a home on port ${port}`); }
  home = h; homeKey = key;
  return { home, mod };
}
function urlOf(base, state, r) {
  const q = (r.query ?? `theme=${r.theme}&motion=off`) + (state.query ? `&${state.query}` : "");
  const addr = state.address || "#/map";
  return addr.startsWith("/") ? `${base}${addr}?${q}` : `${base}/?${q}${addr}`;
}
const bodyOf = (r) => PRE.replace("/*INJECT*/", `const INJ = ${JSON.stringify(r.inj || {})};`) + "\n" + readFileSync(join(HERE, r.script), "utf8");
function runProbe(args) {
  return new Promise((done) => {
    const child = spawn(PROBE, args, { stdio: ["ignore", "ignore", "pipe"] });
    probe = child; let err = "";
    child.stderr.on("data", (d) => { err += d; });
    const guard = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* */ } }, 150_000);
    child.on("close", (code) => { clearTimeout(guard); probe = null; done({ exit: code, err: err.trim().slice(0, 400) }); });
  });
}
// The probe's own website data on disk, listed (names, sizes, times), never opened: the folder WebKit keeps for a
// program without a bundle, by its name.
function probeStorage(since) {
  const roots = [join(homedir(), "Library", "WebKit", "webkit-probe"), join(homedir(), "Library", "Caches", "webkit-probe")];
  const hits = [];
  const walk = (d, depth) => {
    if (depth > 8) return;
    let list = []; try { list = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/local ?storage/i.test(p)) { try { const s = statSync(p); hits.push({ path: p.replace(homedir(), "~"), bytes: s.size, changedAfterRun: s.mtimeMs >= since }); } catch { /* */ } }
    }
  };
  for (const r of roots) walk(r, 0);
  return hits;
}

// ---- the pass ---------------------------------------------------------------------------------------------------
const OUT = join(EVID, `r${opt.round}`);
const PICS = join(OUT, "checks");
mkdirSync(PICS, { recursive: true });
const file = join(OUT, "checks.json");
let all = {};
try { all = JSON.parse(readFileSync(file, "utf8")); } catch { all = {}; }
const baseline = JSON.parse(readFileSync(join(HARNESS, "baseline-pages.json"), "utf8"));
let failed = 0;
await takeLock();
try {
  // Runs of one scene together, so a shared home starts once.
  const order = [...runs].sort((a, b) => `${a.from}:${a.scene}`.localeCompare(`${b.from}:${b.scene}`));
  for (const r of order) {
    const t0 = Date.now();
    const rec = { id: r.id, letter: r.letter, scene: r.scene, state: r.state, width: r.w, theme: r.theme, flags: r.flags };
    try {
      const { home: h, mod } = await homeFor(r);
      const state = mod.states[r.state];
      if (!state) throw new Error(`no state ${r.state}`);
      if (h.prepare) await h.prepare(r.state);
      if (r.withSteps) r.inj = { ...r.inj, steps: state.steps || [] };
      const url = new URL(urlOf(h.base, state, r));
      rec.path = `${url.pathname}${url.search}${url.hash}`;
      const body = bodyOf(r);
      const sf = join(scratch, `${r.id}.js`); const jf = join(scratch, `${r.id}.json`);
      writeFileSync(sf, body);
      const png = join(PICS, `${r.id}.png`);
      const started = Date.now();
      const res = await runProbe(["--origin-port", url.port, "--path", rec.path, "--size", `${r.w}x${r.h}`, "--scale", "1",
        "--appearance", r.theme, ...r.flags, "--script", sf, "--snapshot", png, "--json", jf, "--wait-ms", "600"]);
      let rep = null; try { rep = JSON.parse(readFileSync(jf, "utf8")); } catch { rep = null; }
      rec.probeExit = res.exit; rec.probeError = res.err || null;
      rec.webkit = rep ? { result: rep.scriptResult, scriptError: rep.scriptError ?? null, consoleErrors: rep.consoleErrors, cspViolations: rep.cspViolations,
        failedRequests: rep.failedRequests, webglContexts: rep.webglContexts, images: rep.images, frames: rep.frames, visibility: rep.visibility, notes: rep.notes } : null;
      if (r.storage) rec.storageOnDisk = probeStorage(started);
      if (r.baselineKey) rec.baseline = baseline[r.baselineKey] ?? null;
      if (r.chrome) {
        const { openChrome } = await import(pathToFileURL(join(HARNESS, "cdp.mjs")).href);
        chrome = await openChrome({ width: r.w, height: r.h });
        try {
          await chrome.go(url.href, 15000);
          const v = await chrome.evaluate(`(async () => {\n${body}\n})().then((v) => JSON.parse(JSON.stringify(v ?? null)))`);
          rec.chrome = { result: v };
        } catch (e) { rec.chrome = { error: e.message }; }
        finally { try { await chrome.close(); } catch { /* */ } chrome = null; }
      }
      if (res.exit !== 0 || !rep) failed++;
      const sr = rep?.scriptResult;
      console.log(`${r.id} ${res.exit === 0 ? "ran" : `PROBE EXIT ${res.exit} ${res.err.split("\n")[0]}`} ${((Date.now() - t0) / 1000).toFixed(1)} s | errors ${rep?.consoleErrors?.length ?? "?"} | csp ${rep?.cspViolations?.length ?? "?"} | webgl ${rep?.webglContexts ?? "?"}${rep?.scriptError ? ` | script error ${rep.scriptError.slice(0, 160)}` : ""} | ${JSON.stringify(sr).slice(0, 260)}`);
    } catch (e) {
      failed++; rec.error = e.message;
      console.log(`${r.id} FAIL ${e.message}`);
    }
    all[r.id] = rec;
    writeFileSync(file, `${JSON.stringify(all, null, 1)}\n`);
  }
} finally {
  await stopAll();
}
console.log(`runs ${runs.length}, could not run ${failed}; ${file}`);
process.exit(failed ? 1 : 0);
