// The WebKit picture round (PLAN-MAC-2 M4): every shot of shots-webkit.json in the app's own web view, through
// webkit-probe, at 1280 x 900 and 390 x 844, dark and light, device scale 2, motion off.
// usage: node engine/mac/harness/run-webkit.mjs --round <r> [--only <regex>] [--widths 1280,390] [--themes dark,light]
// Writes EVID/r<r>/<shot>-<width>-<theme>-webkit.png and EVID/r<r>/summary.json (EVID: WEBKIT_EVID, default
// /Users/aasish/uuu/.router/evidence/mac). Prints one line a picture; exits 1 when a picture could not be taken, a
// shot's wait never appeared, or a page asked for a WebGL context (none is expected since 18 Nov: photographs only).
// Console errors, policy violations, failed requests and dropped addresses are written down, not failed on.
//
// The seeded homes are started the way the cook harness's run.mjs starts them: its scenes are imported from
// /Users/aasish/uuu/cook/harness/cook/scenes (read only, never changed) with COOK_ENGINE set to this worktree's
// engine; a shot whose `from` is "mac" uses this folder's scenes/ instead (written anew; README.md says why).
// Takes the browser lock (WEBKIT_LOCK, default EVID/browser.lock): mkdir, wait 20 s while it exists, rmdir at the end.
// Refuses below 20 percent on battery. Stops everything it started (homes, probes) by its own handle, on any way out.
// Nothing is bound or opened on 3100 to 3299, 5000, 5432, 7000 or 8120; nothing leaves 127.0.0.1.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.title = "uuu-mac-webkit-run";
const HERE = dirname(fileURLToPath(import.meta.url));
const MAC = resolve(HERE, "..");
const ENGINE = resolve(MAC, "..");
if (ENGINE === "/Users/aasish/uuu/engine" || ENGINE.startsWith("/Users/aasish/uuu/engine/")) {
  console.error("refused: this copy of run-webkit.mjs is in the live checkout; run the worktree's");
  process.exit(2);
}
const HARNESS = "/Users/aasish/uuu/cook/harness/cook";
const EVID = process.env.WEBKIT_EVID || "/Users/aasish/uuu/.router/evidence/mac";
const LOCK = process.env.WEBKIT_LOCK || join(EVID, "browser.lock");
const PROBE = join(MAC, ".build", "release", "webkit-probe");
const SIZES = { 1280: 900, 390: 844 };
const kept = (p) => (p >= 3100 && p <= 3299) || [5000, 5432, 7000, 8120].includes(p);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- arguments ------------------------------------------------------------------------------------------------
function args(argv) {
  const o = { round: null, only: ".", widths: [1280, 390], themes: ["dark", "light"] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--round") o.round = argv[++i];
    else if (a === "--only") o.only = argv[++i];
    else if (a === "--widths") o.widths = String(argv[++i]).split(",").map(Number);
    else if (a === "--themes") o.themes = String(argv[++i]).split(",");
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.round || !/^[0-9a-z-]+$/i.test(o.round)) throw new Error("--round <r> is needed (letters, digits and dashes)");
  for (const w of o.widths) if (!SIZES[w]) throw new Error(`--widths takes 1280 and 390 only, not ${w}`);
  for (const t of o.themes) if (!["dark", "light"].includes(t)) throw new Error(`--themes takes dark and light only, not ${t}`);
  return o;
}
let opt;
try { opt = args(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }

const ALL = JSON.parse(readFileSync(join(HERE, "shots-webkit.json"), "utf8"));
const only = new RegExp(opt.only);
const shots = ALL.filter((s) => only.test(s.id));
if (!shots.length) { console.error(`no shot matches ${opt.only}`); process.exit(2); }
if (!existsSync(PROBE)) { console.error(`no probe at ${PROBE}. Build it: cd ${MAC} && swift build -c release --product webkit-probe`); process.exit(2); }

// ---- power and the lock ---------------------------------------------------------------------------------------
function battery() {
  const out = execFileSync("/usr/bin/pmset", ["-g", "batt"], { encoding: "utf8" });
  return { line: out.trim().split("\n").pop().trim(), pct: Number((out.match(/(\d+)%/) || [])[1]), discharging: /discharging/.test(out) };
}
const b = battery();
console.log(`pmset: ${b.line}`);
if (b.discharging && b.pct < 20) { console.error("on battery below 20 percent: no picture round"); process.exit(1); }

let locked = false;
async function takeLock() {
  mkdirSync(dirname(LOCK), { recursive: true });
  for (;;) {
    try { mkdirSync(LOCK); locked = true; console.log(`lock: ${LOCK}`); return; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      console.log(`lock: ${LOCK} is held; waiting 20 s`);
      await wait(20000);
    }
  }
}
function dropLock() { if (locked) { try { rmdirSync(LOCK); } catch { /* gone */ } locked = false; } }

// ---- what is running ------------------------------------------------------------------------------------------
let home = null;
let probe = null;
const scratch = mkdtempSync(join(tmpdir(), "uuu-mac-webkit-"));
async function stopHome() { const h = home; home = null; if (h) { try { await h.stop(); } catch (e) { console.log(`note: a home did not stop cleanly: ${e.message}`); } } }
async function stopAll() {
  if (probe) { try { probe.kill("SIGTERM"); } catch { /* ended */ } probe = null; }
  await stopHome();
  rmSync(scratch, { recursive: true, force: true });
  dropLock();
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await stopAll(); process.exit(130); });

process.env.COOK_ENGINE = ENGINE;
async function sceneModule(s) {
  const dir = s.from === "mac" ? join(HERE, "scenes") : join(HARNESS, "scenes");
  return import(pathToFileURL(join(dir, `${s.scene}.mjs`)).href);
}
async function startHome(mod, state) {
  const h = await mod.start({ engine: ENGINE, state });
  const port = Number(new URL(h.base).port);
  if (kept(port)) { await h.stop(); throw new Error(`refused: a scene's home is on port ${port}`); }
  return h;
}

// The cook harness's address of a state, with `theme` and `motion=off` in the query.
function urlOf(base, state, theme, extra) {
  const q = `theme=${theme}&motion=off${state.query ? `&${state.query}` : ""}${extra ? `&${extra}` : ""}`;
  const addr = state.address || "#/map";
  return addr.startsWith("/") ? `${base}${addr}?${q}` : `${base}/?${q}${addr}`;
}

const STEPS_JS = readFileSync(join(HERE, "checks", "steps.js"), "utf8");
const LOOK_JS = readFileSync(join(HERE, "checks", "look.js"), "utf8");
function scriptFor(s, state) {
  return STEPS_JS
    .replace("/*STEPS*/[]", JSON.stringify(state.steps || []))
    .replace("/*WAIT*/null", JSON.stringify(s.wait || null))
    .replace("/*CSS*/null", JSON.stringify(s.css || null))
    .replace("/*LOOK*/", LOOK_JS);
}

// One probe run. -> { exit, report } (report null when the probe wrote none).
function runProbe(argv) {
  return new Promise((done) => {
    const child = spawn(PROBE, argv, { stdio: ["ignore", "ignore", "pipe"] });
    probe = child;
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    const guard = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* ended */ } }, 150_000);
    child.on("close", (code) => { clearTimeout(guard); probe = null; done({ exit: code, err: err.trim().slice(0, 500) }); });
  });
}

// ---- the round ------------------------------------------------------------------------------------------------
const OUT = join(EVID, `r${opt.round}`);
mkdirSync(OUT, { recursive: true });
const summaryFile = join(OUT, "summary.json");
let summary = { pictures: {} };
try { summary = JSON.parse(readFileSync(summaryFile, "utf8")); if (!summary.pictures) summary.pictures = {}; } catch { summary = { pictures: {} }; }
summary.round = opt.round;
summary.engine = ENGINE;
summary.probe = PROBE;
summary.at = new Date().toISOString();
let failed = 0;
let taken = 0;

await takeLock();
try {
  const order = [...new Set(shots.map((s) => `${s.from}:${s.scene}`))];
  for (const key of order) {
    const mine = shots.filter((s) => `${s.from}:${s.scene}` === key);
    let mod;
    try { mod = await sceneModule(mine[0]); } catch (e) { for (const s of mine) { console.log(`${s.id} FAIL the scene could not be read: ${e.message}`); failed++; } continue; }
    const perState = mod.homes === "each";
    if (!perState) {
      const t0 = Date.now();
      try { home = await startHome(mod, null); console.log(`scene ${key}: ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`); }
      catch (e) { console.log(`scene ${key}: could not start: ${e.message}`); for (const s of mine) { console.log(`${s.id} FAIL the scene did not start`); failed++; } continue; }
    }
    for (const s of mine) {
      const state = mod.states[s.state];
      if (!state) { console.log(`${s.id} FAIL scene ${s.scene} has no state ${s.state}`); failed++; continue; }
      if (perState && !state.fresh) {
        const t0 = Date.now();
        try { home = await startHome(mod, s.state); console.log(`scene ${key}/${s.state}: ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`); }
        catch (e) { console.log(`scene ${key}/${s.state}: could not start: ${e.message}`); console.log(`${s.id} FAIL the scene did not start`); failed++; continue; }
      }
      const widths = opt.widths.filter((w) => !s.widths || s.widths.includes(w));
      for (const w of widths) {
        for (const theme of opt.themes.filter((t) => !s.themes || s.themes.includes(t))) {
          const name = `${s.id}-${w}-${theme}-webkit`;
          try {
            if (state.fresh) { await stopHome(); home = await startHome(mod, s.state); }
            if (home.prepare) await home.prepare(s.state);
            const url = new URL(urlOf(home.base, state, theme, s.query));
            const scriptFile = join(scratch, `${name}.js`);
            const jsonFile = join(scratch, `${name}.json`);
            writeFileSync(scriptFile, scriptFor(s, state));
            const png = join(OUT, `${name}.png`);
            rmSync(png, { force: true });
            const r = await runProbe(["--origin-port", url.port, "--path", `${url.pathname}${url.search}${url.hash}`,
              "--size", `${w}x${SIZES[w]}`, "--scale", "2", "--appearance", theme, "--reduced-motion",
              "--script", scriptFile, "--snapshot", png, "--json", jsonFile]);
            let rep = null;
            try { rep = JSON.parse(readFileSync(jsonFile, "utf8")); } catch { rep = null; }
            const sr = rep && rep.scriptResult && typeof rep.scriptResult === "object" ? rep.scriptResult : {};
            const notes = [...(rep?.notes || []), ...(sr.notes || [])];
            const pic = {
              shot: s.id, width: w, theme, kind: s.kind, scene: s.scene, state: s.state, from: s.from,
              file: existsSync(png) ? `${name}.png` : null, probeExit: r.exit, probeError: r.err || null,
              url: rep?.url ?? url.href, title: rep?.title ?? null, loaded: rep?.loaded ?? false, visibility: rep?.visibility ?? null,
              consoleErrors: rep?.consoleErrors ?? [], cspViolations: rep?.cspViolations ?? [], failedRequests: rep?.failedRequests ?? [],
              dropped: rep?.dropped ?? null, externalAsked: rep?.externalAsked ?? [], panelsAsked: rep?.panelsAsked ?? [],
              webglContexts: rep?.webglContexts ?? null, images: rep?.images ?? null, frames: rep?.frames ?? null,
              overflow: sr.look?.overflow ?? null, scrollWidth: sr.look?.scrollWidth ?? null, offenders: sr.look?.wide ?? [],
              frameSources: sr.look?.frames ?? [], waited: sr.waited ?? null, scriptError: rep?.scriptError ?? null, notes,
              elapsedMs: rep?.elapsedMs ?? null,
            };
            summary.pictures[name] = pic;
            const fails = [];
            if (r.exit !== 0) fails.push(`probe exit ${r.exit}${r.err ? ` (${r.err.split("\n")[0]})` : ""}`);
            if (!pic.file) fails.push("no picture");
            if (pic.webglContexts !== 0) fails.push(`webglContexts ${pic.webglContexts}`);
            if (pic.waited === false) fails.push(`${s.wait} never appeared`);
            if (pic.file) taken++;
            if (fails.length) failed++;
            const extra = [];
            if (pic.consoleErrors.length) extra.push(`errors ${JSON.stringify(pic.consoleErrors.slice(0, 2))}`);
            if (pic.failedRequests.length) extra.push(`failed ${JSON.stringify(pic.failedRequests.slice(0, 2))}`);
            if (pic.cspViolations.length) extra.push(`csp ${JSON.stringify(pic.cspViolations.slice(0, 2))}`);
            if (pic.dropped) extra.push(`dropped ${pic.dropped}`);
            if (pic.overflow) extra.push(`wider than the window: ${pic.scrollWidth} > ${w}`);
            if (pic.images?.broken) extra.push(`broken images ${pic.images.broken}`);
            if (notes.length) extra.push(`notes ${JSON.stringify(notes)}`);
            console.log(`${name} ${fails.length ? `FAIL ${fails.join(", ")}` : "ok"}${extra.length ? ` | ${extra.join(" | ")}` : ""}`);
          } catch (e) {
            failed++;
            console.log(`${name} FAIL ${e.message}`);
          } finally {
            if (state.fresh) await stopHome();
          }
        }
      }
      if (perState) await stopHome();
    }
    await stopHome();
  }
} catch (e) {
  console.log(`stopped: ${e.message}`);
  failed++;
} finally {
  writeFileSync(summaryFile, `${JSON.stringify(summary, null, 1)}\n`);
  await stopAll();
}

const all = Object.values(summary.pictures).filter((p) => shots.some((s) => s.id === p.shot));
const withErrors = all.filter((p) => p.consoleErrors.length).map((p) => `${p.shot}-${p.width}-${p.theme}`);
console.log(`pictures: ${taken} in ${OUT}`);
console.log(`console errors: ${withErrors.length ? withErrors.join(", ") : "none"}`);
console.log(`webgl contexts: ${all.reduce((n, p) => n + (p.webglContexts || 0), 0)}`);
console.log(`exit ${failed ? 1 : 0}${failed ? ` (${failed} failed)` : ""}`);
process.exit(failed ? 1 : 0);
