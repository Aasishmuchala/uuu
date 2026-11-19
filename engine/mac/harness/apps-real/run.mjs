// The two real App Studio apps inside the Mac app's own web view (PLAN-DESKTOP T2, DM3).
// usage: node engine/mac/harness/apps-real/run.mjs [--check-only] [--only <regex of row ids>] [--hold]
//
//  1. asks nothing of the live engine: its ports, state and checkout are never touched;
//  2. checks with lsof that 127.0.0.1:3188 and :3189 are free and stops if not (--check-only stops here);
//  3. starts the stage (stage.mjs): both apps built and run in their fence in a temp state, Render to Film on 3188 and
//     Arch Film Studio on 3189, behind a test App Studio host, framed by a seeded test home on a free port from 3300
//     up; both apps on, no key, no sign-in, no allowance;
//  4. for each app: webkit-probe (the app's own web view, rule list on) on the home's App Studio page with the app
//     open, at 1280 x 900 and 390 x 844, dark and light; then each check of checks.mjs in apps-real-runner (the same
//     web view, real mouse and keys); every report and picture goes to EVID/apps-real/;
//  5. stops everything it started, by handle, and checks both ports are free again.
// With --hold the stage stays up after the checks (until Ctrl-C) for the orchestrator's hand checks in a development
// build: `build.sh --dev --origin-port <the home port> --out <dir>`, opened with `open -g`.
// It takes the WebKit harness's browser lock and refuses on battery below 20 percent. The last line is
// `apps-real: 2 apps, rows <n>, breaks <m>`; exit 0 when m is 0, 1 when not, 2 when it could not run.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checksFor } from "./checks.mjs";
import { APP_PORTS, SLUGS, startStage } from "./stage.mjs";

process.title = "uuu-mac-apps-real";
const HERE = dirname(fileURLToPath(import.meta.url));
const MAC = resolve(HERE, "../..");
const ENGINE = resolve(MAC, "..");
if (ENGINE === "/Users/aasish/uuu/engine" || ENGINE.startsWith("/Users/aasish/uuu/engine/")) {
  console.error("refused: this copy of the harness is in the live checkout; run the worktree's");
  process.exit(2);
}
const EVID = join(process.env.APPS_REAL_EVID || "/Users/aasish/uuu/.router/evidence/desktop", "apps-real");
const LOCK = process.env.WEBKIT_LOCK || "/Users/aasish/uuu/.router/evidence/mac/browser.lock";
const PROBE = join(MAC, ".build", "release", "webkit-probe");
const RUNNER = join(MAC, ".build", "apps-real", "apps-real-runner");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const checkOnly = args.includes("--check-only");
const hold = args.includes("--hold");
const only = args.includes("--only") ? new RegExp(args[args.indexOf("--only") + 1]) : null;

// ---- 2. the two ports --------------------------------------------------------------------------------------------
function listening(port) {
  const r = spawnSync("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  return (r.stdout || "").split("\n").filter((l) => l.trim() && !l.startsWith("COMMAND"));
}
const busy = Object.values(APP_PORTS).flatMap((p) => listening(p).map((l) => `${p}: ${l}`));
if (busy.length) {
  console.error(`refused: ports 3188 and 3189 must both be free; held now:\n${busy.join("\n")}`);
  process.exit(2);
}
console.log("ports 3188 and 3189 free");
if (checkOnly) process.exit(0);

// ---- power, the lock, the two programs -----------------------------------------------------------------------------
const batt = execFileSync("/usr/bin/pmset", ["-g", "batt"], { encoding: "utf8" });
const pct = Number((batt.match(/(\d+)%/) || [])[1]);
if (/discharging/.test(batt) && pct < 20) { console.error("on battery below 20 percent: no run"); process.exit(2); }
if (!existsSync(PROBE)) { console.error(`no probe at ${PROBE}. Build it: cd ${MAC} && swift build -c release --product webkit-probe`); process.exit(2); }
function buildRunner() {
  const sources = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".swift")) sources.push(p); } };
  walk(join(MAC, "Sources", "EngineShell"));
  sources.sort();
  sources.push(join(HERE, "runner", "main.swift"));
  if (!existsSync(join(MAC, "Sources", "EngineShell", "Build", "BuildConstants.swift"))) throw new Error("no BuildConstants.swift: run ./check.sh once first");
  const newest = Math.max(...sources.map((s) => statSync(s).mtimeMs));
  if (existsSync(RUNNER) && statSync(RUNNER).mtimeMs > newest) return;
  mkdirSync(dirname(RUNNER), { recursive: true });
  console.log("building apps-real-runner (swiftc, EngineShell's sources and runner/main.swift)");
  execFileSync("/usr/bin/swiftc", ["-O", "-swift-version", "5", "-module-name", "AppsReal", ...sources, "-o", RUNNER], { stdio: "inherit" });
}
let locked = false;
async function takeLock() {
  mkdirSync(dirname(LOCK), { recursive: true });
  for (;;) {
    try { mkdirSync(LOCK); locked = true; return; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      console.log(`lock: ${LOCK} is held; waiting 20 s`);
      await wait(20000);
    }
  }
}
function dropLock() { if (locked) { try { rmdirSync(LOCK); } catch { /* gone */ } locked = false; } }

// ---- one browser run ----------------------------------------------------------------------------------------------
let child = null;
function runChild(bin, argv, timeoutMs) {
  return new Promise((ok) => {
    let err = "";
    child = spawn(bin, argv, { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", (d) => { err += d; });
    const t = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* ended */ } }, timeoutMs);
    child.on("exit", (code, sig) => { clearTimeout(t); child = null; ok({ code: code ?? (sig ? 128 : 1), err: err.trim() }); });
  });
}
const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };

let stage = null;
const scratch = join(tmpdir(), `uuu-apps-real-${process.pid}`);
async function cleanup() {
  if (child) { try { child.kill("SIGTERM"); } catch { /* ended */ } }
  if (stage) { await stage.stop().catch(() => {}); stage = null; }
  rmSync(scratch, { recursive: true, force: true });
  dropLock();
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await cleanup(); process.exit(130); });

let exitCode = 0;
const table = [];
try {
  buildRunner();
  mkdirSync(EVID, { recursive: true });
  mkdirSync(join(scratch, "downloads"), { recursive: true });
  for (const f of readdirSync(EVID)) if (/\.(png|json|txt)$/.test(f)) rmSync(join(EVID, f));
  const t0 = Date.now();
  console.log("stage: building both apps in the fence and starting them (3188, 3189)");
  stage = await startStage({ engine: ENGINE, log: (l) => { if (!/^\d{4}-/.test(l)) console.log(l); } });
  console.log(`stage: home 127.0.0.1:${stage.homePort}, App Studio host 127.0.0.1:${stage.hostPort}; seeding`);
  const made = await stage.seed();
  console.log(`stage: ready in ${Math.round((Date.now() - t0) / 1000)} s`);
  const upload = stage.pictures.sets[2].render;
  await takeLock();

  for (const slug of SLUGS) {
    const path = (theme) => `/?theme=${theme}&motion=off#/apps/${slug}`;
    // Item 9 (and item 1's home side): webkit-probe, four pictures.
    const pics = [];
    if (!only || only.test("9-pictures") || only.test("1-frame-draws")) {
      for (const [w, h] of [[1280, 900], [390, 844]]) {
        for (const theme of ["dark", "light"]) {
          const name = `${slug}-${w}-${theme}`;
          const json = join(EVID, `${name}-probe.json`);
          const r = await runChild(PROBE, ["--origin-port", String(stage.homePort), "--path", path(theme), "--size", `${w}x${h}`, "--scale", "2",
            "--wait-ms", "4000", "--appearance", theme, "--snapshot", join(EVID, `${name}.png`), "--json", json], 120_000);
          const rep = readJson(json) || {};
          pics.push({ name, code: r.code, rep });
        }
      }
      const bad = pics.filter((p) => p.code !== 0 || !existsSync(join(EVID, `${p.name}.png`)));
      table.push({ app: slug, row: "9-pictures", verdict: bad.length ? "breaks" : "works", why: bad.length ? `no picture for ${bad.map((p) => p.name).join(", ")}` : `four pictures by webkit-probe (${pics.map((p) => `${p.name}.png`).join(", ")}); judged by eye in the answer`, evidence: pics.map((p) => `${p.name}.png`) });
    }
    const kb = spawnSync("/usr/bin/defaults", ["read", "-g", "AppleKeyboardUIMode"], { encoding: "utf8" });
    const ctx = { picDir: EVID, made, upload, keyboardUIMode: kb.status === 0 ? Number(kb.stdout.trim()) : 0 };
    for (const c of checksFor(slug, ctx)) {
      if (only && !only.test(c.id)) continue;
      if (!c.steps) { const [verdict, why] = c.judge(); table.push({ app: slug, row: c.id, verdict, why, where: c.where }); continue; }
      const steps = join(scratch, `${slug}-${c.id}.steps.json`);
      writeFileSync(steps, JSON.stringify(c.steps()));
      const out = join(EVID, `${slug}-${c.id}.json`);
      const r = await runChild(RUNNER, ["--home-port", String(stage.homePort), "--path", path("dark"), "--steps", steps, "--json", out, "--size", "1280x900",
        "--appearance", "dark", "--upload", upload, "--download-dir", join(scratch, "downloads")], 300_000);
      const rep = readJson(out);
      let verdict; let why; let more = [];
      if (!rep || !rep.loaded) [verdict, why] = ["breaks", `the runner could not load the page (exit ${r.code}${r.err ? `: ${r.err.slice(0, 200)}` : ""})`];
      else {
        try { [verdict, why, more = []] = c.judge(rep, ctx); } catch (e) { [verdict, why] = ["breaks", `the check could not judge the report: ${e.message}`]; }
        // Item 1 also holds the probe's own report of the home page.
        if (c.id === "1-frame-draws") {
          const p = pics.find((x) => x.name === `${slug}-1280-dark`);
          const pr = p && p.rep;
          if (pr) {
            const bad = [...(pr.consoleErrors || []), ...(pr.cspViolations || []), ...(pr.failedRequests || [])];
            if (pr.dropped) bad.push(`dropped ${pr.dropped}`);
            if (pr.images && pr.images.broken) bad.push(`${pr.images.broken} broken image(s)`);
            if (bad.length) [verdict, why] = ["breaks", `${why}; webkit-probe on the home page: ${bad.slice(0, 4).join("; ")}`];
            else why += "; webkit-probe on the home page: consoleErrors, cspViolations, failedRequests empty, dropped 0, images.broken 0";
          }
        }
        if (c.after) { const extra = c.after(rep, (f) => (existsSync(f) ? statSync(f).size : 0)); if (extra === 0) [verdict, why] = ["breaks", `${why}; but the file written was empty`]; else if (extra) why += ` (${extra} bytes)`; }
      }
      table.push({ app: slug, row: c.id, verdict, why, where: c.where, evidence: [`${slug}-${c.id}.json`] });
      for (const m of more) table.push({ app: slug, evidence: [`${slug}-${c.id}.json`], ...m });
      console.log(`${slug} ${c.id}: ${verdict}`);
    }
  }

  const lines = [];
  for (const t of table) lines.push(`${t.app}\t${t.row}\t${t.verdict}\t${t.where && t.verdict !== "works" ? `[${t.where}] ` : ""}${t.why}`);
  writeFileSync(join(EVID, "table.txt"), lines.join("\n") + "\n");
  writeFileSync(join(EVID, "results.json"), JSON.stringify({ homePort: stage.homePort, ports: APP_PORTS, made, table }, null, 2));
  console.log("");
  for (const l of lines) console.log(l);
  if (hold) {
    dropLock();
    console.log(`\nholding: home http://127.0.0.1:${stage.homePort}/#/apps/render-to-film (and arch-film-studio); Ctrl-C ends it`);
    await new Promise(() => {});
  }
} catch (e) {
  console.error(`apps-real: ${e.stack || e.message}`);
  exitCode = 2;
} finally {
  await cleanup();
}
const still = Object.values(APP_PORTS).flatMap((p) => listening(p));
if (still.length) { console.error(`after the run something still listens on 3188 or 3189:\n${still.join("\n")}`); exitCode = 2; }
const breaks = table.filter((t) => t.verdict === "breaks").length;
if (exitCode === 0 && breaks) exitCode = 1;
console.log(`apps-real: 2 apps, rows ${table.length}, breaks ${breaks}`);
process.exit(exitCode);
