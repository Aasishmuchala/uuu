// Sweep `soak` (PLAN-STRESS T6): the whole staged engine on `large` under steady work for --minutes (default 45,
// 30 to 60 judged), then idle with the pages closed, sampled every 30 s into OUT/pass-<n>/soak.jsonl, and judged
// against the Targets table's soak row. --quick (3 minutes), or --minutes under 30, is a short run: everything is
// sampled and written, exceptions, errors, 5xx, hangs, dead parts and outside calls are still findings, but the
// leak, CPU and slowdown limits are not judged (they need minute 10 and a long tail).
//
// Steady work: one page walking the 21 addresses, one every 4 s, switching theme every lap, never reloading; a
// page left on Map and one on Needs you; 5 home GETs a second over the read routes; one owner POST every 10 s that
// hides the setup and shows it again; one fake generation job, web fetch, brain ask, relay answer and gate call
// every 15 s (soak/work.mjs). Each sample: stage.sample() for every part plus its CPU seconds, each page's
// JSHeapUsedSize after a forced collection, Nodes, JSEventListeners, Documents, the size of every file under
// state/logs, state/doors and state/home, the files under the stage's temp folder, the load average, and the calls
// since the last sample.
//
// A leak suspect is diagnosed before it is recorded (judged runs): a part's by halving the work (the pages alone,
// then the routes and doors alone, 5 minutes each, the RSS slope of each), a page's by two heap snapshots 20 laps
// apart, naming the three constructors that grew most.
import { readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { call, ownerPost } from "../lib/http.mjs";
import { PART_NAMES } from "../lib/faults.mjs";
import { cpuOf, fileSizes, line, percentile, tempFiles } from "./measure.mjs";
import {
  gcMetrics, growing, heapByConstructor, moveTo, openOn, pageAddresses, sleep, switchTheme,
} from "./pages.mjs";
import { doorCalls, prepareDoors } from "./work.mjs";

const SAMPLE_MS = 30_000;
const WALK_MS = 4_000;
const HOME_GET_MS = 200; // 5 a second
const OWNER_POST_MS = 10_000;
const DOOR_MS = 15_000;
const MB = 1024 * 1024;

// The read routes the home GETs go round (every one a plain read: no Test, no switch, no spend).
export const READ_ROUTES = [
  "/api/home", "/api/map", "/api/shell", "/api/tasks", "/api/inbox", "/api/jobs", "/api/team", "/api/routines",
  "/api/knowledge", "/api/health", "/api/setup", "/api/apps", "/api/settings", "/api/company", "/api/goals",
  "/api/brain", "/api/state", "/api/lessons", "/api/web", "/api/viewer", "/api/brain-door", "/api/search?q=stair",
  "/api/departments/books", "/api/departments/marketing", "/api/studio/films", "/api/generation", "/api/models",
  "/api/world",
];

// Which files to look at first when a part leaks or slows.
export const PART_FILES = {
  board: ["engine/test/stubs/board.mjs"],
  books: ["engine/test/stubs/bench.mjs"],
  gate: ["engine/gate/gate.mjs", "engine/gate/narrow.mjs"],
  gateNarrow: ["engine/gate/gate.mjs", "engine/gate/narrow.mjs"],
  relay: ["engine/relay/relay.mjs", "engine/relay/upstream.mjs"],
  web: ["engine/web/door.mjs", "engine/web/fetch.mjs", "engine/web/state.mjs"],
  generate: ["engine/generate/door.mjs", "engine/generate/ledger.mjs", "engine/generate/state.mjs"],
  viewer: ["engine/viewer/viewer.mjs"],
  apps: ["engine/apps/host.mjs"],
  brain: ["engine/brain/door.mjs", "engine/brain/retrieve.mjs"],
  home: ["engine/home/server/main.mjs", "engine/home/server/lib/app.mjs"],
};
const FILE_OWNERS = [
  [/^logs\/([a-zA-Z]+)\.log$/, (m) => [`engine/stress/lib/stage.mjs (the ${m[1]} part's output)`]],
  [/^doors\/generate/, () => ["engine/generate/door.mjs", "engine/generate/ledger.mjs"]],
  [/^doors\/web|visits/, () => ["engine/web/state.mjs"]],
  [/^doors\/brain/, () => ["engine/brain/door.mjs"]],
  [/^doors\/viewer/, () => ["engine/viewer/viewer.mjs"]],
  [/^home\/decisions/, () => ["engine/home/server/lib/decisions.mjs"]],
  [/^home\//, () => ["engine/home/server/main.mjs"]],
];
const ownersOf = (rel) => {
  for (const [re, fn] of FILE_OWNERS) { const m = re.exec(rel); if (m) return fn(m); }
  return [];
};

// Errors that are not faults: the made-up ids of pages whose kind the dataset lacks (pages.mjs `fallback`).
function expectedError(e, routes) {
  if (e.kind !== "log" || !/status of 404/.test(e.text)) return false;
  const r = routes.find((x) => x.hash === e.route);
  return !!(r && r.fallback);
}

// A small loop: fn every `ms`, never two at once (a slow turn is skipped, not stacked), until stop().
function every(ms, fn) {
  let busy = false;
  let skipped = 0;
  const t = setInterval(() => {
    if (busy) { skipped += 1; return; }
    busy = true;
    Promise.resolve().then(fn).catch(() => {}).finally(() => { busy = false; });
  }, ms);
  return {
    get skipped() { return skipped; },
    async stop() {
      clearInterval(t);
      for (let i = 0; i < 300 && busy; i += 1) await sleep(100);
    },
  };
}

export default async function soak(ctx) {
  const { log } = ctx;
  if (ctx.minutes !== null && ctx.minutes !== undefined && ctx.minutes > 60) throw new Error("soak: --minutes is 30 to 60 (or under 30 for a short run that is not judged)");
  const minutes = ctx.minutes ?? (ctx.quick ? 3 : 45);
  const judged = !ctx.quick && minutes >= 30;
  const idleMs = judged ? 5 * 60_000 : 60_000;
  const tenMin = judged ? 10 * 60_000 : SAMPLE_MS; // the reference sample: minute 10, or the first after the start
  const lapsApart = judged ? 20 : 1;
  const out = ctx.passDir;
  const jsonl = join(out, "soak.jsonl");
  const summaryFile = join(out, "soak-summary.json");
  const errorsFile = join(out, "soak-errors.jsonl");
  rmSync(jsonl, { force: true });
  rmSync(errorsFile, { force: true });
  if (ctx.only) log(`--only ${ctx.only}: the soak has no single check to repeat; the whole soak runs`);
  log(`${minutes} minutes loaded, then ${idleMs / 60000} idle; limits ${judged ? "judged" : "not judged (a short run)"}`);

  const stage = await ctx.startStage({ dataset: "large", apps: false });
  log(`stage ${stage.root}`);
  await prepareDoors(stage);
  const doors = await doorCalls(stage);
  const routes = await pageAddresses(stage);
  const startPids = Object.fromEntries(Object.entries(stage.pids).map(([k, v]) => [k, v.pid]));
  const tempAtStart = tempFiles(stage.root);
  const outsideAtStart = stage.outsideCalls().length;

  const t0 = Date.now();
  const since = () => Date.now() - t0;
  const calls = []; // { t, kind, target, ms, status, ok, hang, code }
  let callsMark = 0;
  const note = (kind, target, r) => calls.push({ t: since(), kind, target, ms: r.ms ?? null, status: r.status ?? 0, ok: !!r.ok, hang: !!r.hang, code: r.code ?? null });

  const browser = await ctx.openBrowser();
  const walker = await openOn(browser, stage.urls.home, "map", "walker");
  const mapPage = await openOn(browser, stage.urls.home, "map", "map");
  const needsPage = await openOn(browser, stage.urls.home, "needs-you", "needs-you");
  const pages = { walker, map: mapPage, "needs-you": needsPage };
  const allErrors = () => Object.values(pages).flatMap((p) => p.watch.errors);

  // ---- the walker -----------------------------------------------------------------------------------------------
  let walkAt = 0;
  let lap = 0;
  let walking = true;
  let walkerPaused = false;
  let walkerIdle = Promise.resolve();
  const blanks = {};
  const themes = [];
  const snaps = { a: null, b: null, lapA: null, lapB: null };
  const walk = (async () => {
    while (walking) {
      if (walkerPaused) { await sleep(200); continue; }
      let done;
      walkerIdle = new Promise((r) => { done = r; });
      try {
        const r = routes[walkAt];
        await moveTo(walker, r.hash);
        await sleep(WALK_MS);
        const text = await walker.page.send("Runtime.evaluate", { expression: "(document.querySelector('main') || document.body).innerText.trim().length", returnByValue: true }).catch(() => null);
        if (text && text.result && text.result.value === 0) blanks[r.hash] = (blanks[r.hash] || 0) + 1;
        walkAt += 1;
        if (walkAt === routes.length) {
          walkAt = 0;
          lap += 1;
          themes.push(await switchTheme(walker).catch(() => "failed"));
          // The page leak's snapshots: the first at minute 10 (the first lap on a short run), the next `lapsApart`
          // laps later.
          if (!snaps.a) {
            if (judged ? since() >= tenMin : lap >= 1) { snaps.a = await heapByConstructor(walker).catch(() => null); snaps.lapA = lap; log(`heap snapshot A at lap ${lap}`); }
          } else if (!snaps.b && lap >= snaps.lapA + lapsApart) {
            snaps.b = await heapByConstructor(walker).catch(() => null); snaps.lapB = lap; log(`heap snapshot B at lap ${lap}`);
          }
        }
      } catch (e) {
        log(`walker: ${e.message}`);
        await sleep(1000);
      } finally {
        done();
      }
    }
  })();

  // Pauses the walker and puts it on Map for a like-for-like reading; -> gcMetrics of every page.
  async function steady() {
    walkerPaused = true;
    await walkerIdle;
    try {
      await moveTo(walker, "map");
      await sleep(2500);
      const m = {};
      for (const [name, p] of Object.entries(pages)) m[name] = await gcMetrics(p).catch(() => null);
      return m;
    } finally {
      walker.watch.current(routes[walkAt].hash);
      walkerPaused = false;
    }
  }

  // ---- the steady work ------------------------------------------------------------------------------------------
  let getAt = 0;
  let inflight = 0;
  let backlog = 0;
  const homeGets = setInterval(() => {
    if (inflight >= 20) { backlog += 1; return; }
    const path = READ_ROUTES[getAt % READ_ROUTES.length];
    getAt += 1;
    inflight += 1;
    const t = Date.now();
    call(`${stage.urls.home}${path}`, { timeoutMs: 10_000 })
      .then((r) => note("home", path, { ms: r.ms, status: r.status, ok: r.status === 200, code: r.status === 200 ? null : (r.json && r.json.error && r.json.error.code) || null }))
      .catch((e) => note("home", path, { ms: Date.now() - t, status: 0, ok: false, hang: !!e.hang, code: e.code }))
      .finally(() => { inflight -= 1; });
  }, HOME_GET_MS);
  let hidden = false;
  const ownerLoop = every(OWNER_POST_MS, async () => {
    hidden = !hidden;
    const t = Date.now();
    try {
      const r = await ownerPost(stage, "/api/setup/dismiss", { dismissed: hidden }, { timeoutMs: 10_000 });
      note("owner", "/api/setup/dismiss", { ms: r.ms, status: r.status, ok: r.status === 200 });
    } catch (e) {
      note("owner", "/api/setup/dismiss", { ms: Date.now() - t, status: 0, ok: false, hang: !!e.hang, code: e.code });
    }
  });
  const doorLoops = ["generate", "web", "brain", "relay", "gate"].map((d) => every(DOOR_MS, async () => note("door", d, await doors[d]())));

  // ---- sampling -------------------------------------------------------------------------------------------------
  const samples = [];
  async function takeSample(phase, { withPages = true, pageMetrics = null } = {}) {
    const s = stage.sample();
    const cpu = cpuOf(Object.values(s.parts).map((p) => p.pid));
    for (const p of Object.values(s.parts)) p.cpuSec = p.pid ? (cpu[p.pid] ?? null) : null;
    let pm = pageMetrics;
    if (!pm && withPages) {
      pm = {};
      for (const [name, p] of Object.entries(pages)) {
        pm[name] = await gcMetrics(p).catch(() => null);
        if (pm[name]) pm[name].route = p === walker ? routes[walkAt].hash : (name === "map" ? "map" : "needs-you");
      }
    }
    const fresh = calls.slice(callsMark);
    callsMark = calls.length;
    const row = {
      at: s.at, sec: Math.round(since() / 1000), phase, parts: s.parts, pages: pm || {},
      files: fileSizes(stage.state), tempFiles: tempFiles(stage.root), load: loadavg().map((x) => Math.round(x * 100) / 100),
      calls: { n: fresh.length, failed: fresh.filter((c) => !c.ok).length, p95: percentile(fresh.map((c) => c.ms), 0.95) },
      lap,
    };
    samples.push(row);
    appendFileSync(jsonl, `${JSON.stringify(row)}\n`);
    return row;
  }

  await takeSample("loaded");
  let refPages = null;
  const loadedMs = minutes * 60_000;
  let nextSample = SAMPLE_MS;
  while (since() < loadedMs) {
    await sleep(Math.max(0, Math.min(nextSample, loadedMs) - since()));
    if (since() >= nextSample) {
      if (!refPages && since() >= tenMin) {
        refPages = await steady();
        await takeSample("loaded", { pageMetrics: refPages });
      } else {
        await takeSample("loaded");
      }
      const last = samples[samples.length - 1];
      log(`${Math.round(since() / 1000)} s: lap ${lap}, calls ${last.calls.n} (failed ${last.calls.failed}), load ${last.load[0]}`);
      nextSample += SAMPLE_MS;
    }
  }

  // ---- the end of the loaded part -------------------------------------------------------------------------------
  clearInterval(homeGets);
  await Promise.all([ownerLoop.stop(), ...doorLoops.map((l) => l.stop())]);
  for (let i = 0; i < 250 && inflight > 0; i += 1) await sleep(100);
  // The generation jobs still being followed end by themselves (about 25 s each on the fake).
  await Promise.race([Promise.all(doors.followed.map((f) => f.done)), sleep(130_000)]);
  const endPages = await steady();
  walking = false;
  await walk;
  if (snaps.a && !snaps.b) { snaps.b = await heapByConstructor(walker).catch(() => null); snaps.lapB = lap; }
  await takeSample("loaded", { pageMetrics: endPages });
  const errors = allErrors();
  for (const e of errors) appendFileSync(errorsFile, `${JSON.stringify(e)}\n`);
  await browser.close();

  // ---- idle, the pages closed -----------------------------------------------------------------------------------
  const idleStart = since();
  const settleMs = judged ? 60_000 : 15_000;
  let idleCpuFrom = null;
  let idleFromAt = null;
  nextSample = idleStart + SAMPLE_MS;
  while (since() < idleStart + idleMs) {
    const wake = Math.min(nextSample, idleStart + idleMs, idleCpuFrom ? Infinity : idleStart + settleMs);
    await sleep(Math.max(0, wake - since()));
    if (!idleCpuFrom && since() >= idleStart + settleMs) {
      idleCpuFrom = cpuOf(Object.values(stage.pids).map((e) => e.pid));
      idleFromAt = Date.now();
    }
    if (since() >= nextSample) { await takeSample("idle", { withPages: false }); nextSample += SAMPLE_MS; }
  }
  const pidsNow = stage.pids;
  const idleCpuTo = cpuOf(Object.values(pidsNow).map((e) => e.pid));
  const idleWall = (Date.now() - (idleFromAt || Date.now())) / 1000;
  const idleCpu = {};
  for (const part of PART_NAMES) {
    const pid = pidsNow[part] && pidsNow[part].pid;
    const a = idleCpuFrom && pid ? idleCpuFrom[pid] : null;
    const b = pid ? idleCpuTo[pid] : null;
    idleCpu[part] = Number.isFinite(a) && Number.isFinite(b) && idleWall > 0 ? Math.round(((b - a) / idleWall) * 1000) / 10 : null;
  }
  const lastIdle = await takeSample("idle", { withPages: false });

  // ---- judging --------------------------------------------------------------------------------------------------
  let checks = 0;
  const evidence = jsonl;
  const rec = (f) => ctx.record({ area: "soak", evidence, ...f });
  const loaded = samples.filter((s) => s.phase === "loaded");
  const startS = loaded[0];
  const refS = loaded.find((s) => s.sec * 1000 >= tenMin) || loaded[1] || startS;
  const endS = loaded[loaded.length - 1];

  // Parts: alive the whole time, under the guard, with nothing thrown.
  for (const part of PART_NAMES) {
    checks += 1;
    const now = pidsNow[part] && pidsNow[part].pid;
    if (!now || now !== startPids[part] || !lastIdle.parts[part] || lastIdle.parts[part].pid === null) {
      rec({ severity: "high", check: "part-alive", target: part, title: `${part} did not last the soak`, expected: "the same process from start to end",
        actual: `started as ${startPids[part]}, now ${now || "gone"}`, suspectFiles: PART_FILES[part] || [] });
    }
  }
  const logHits = {};
  for (const part of PART_NAMES) {
    if (part === "gateNarrow") continue;
    let text = "";
    try { text = readFileSync(join(stage.state, "logs", `${part}.log`), "utf8"); } catch { continue; }
    const hits = text.split("\n").filter((l) => /uncaught|unhandled|caught an error it did not expect|TypeError|ReferenceError|RangeError|FATAL|out of memory/i.test(l));
    checks += 1;
    if (hits.length) {
      logHits[part] = hits.slice(0, 5);
      rec({ severity: "high", check: "part-exception", target: part, title: `${part} logged an exception during the soak`, expected: "no exception in 45 minutes",
        actual: `${hits.length} lines, first: ${hits[0].slice(0, 300)}`, evidence: join(stage.state, "logs", `${part}.log`), suspectFiles: PART_FILES[part] || [] });
    }
  }

  // Outside calls (the home's provider reads to Omega Plus are the stage's known, accepted gap: README "Known").
  const outside = stage.outsideCalls().slice(outsideAtStart);
  const unknownOutside = outside.filter((c) => !(c.part === "home" && /omegaplusapi\.com$/.test(String(c.host))));
  checks += 1;
  if (unknownOutside.length) {
    const c = unknownOutside[0];
    rec({ severity: "critical", check: "outside-call", target: `${c.part}:${c.host}:${c.port}`, title: `${c.part} tried to reach ${c.host}:${c.port} during the soak`,
      expected: "no outside call", actual: `${unknownOutside.length} refused tries; first stack: ${(c.stack || []).slice(0, 3).join(" | ")}`,
      evidence: join(stage.root, "outside-calls.jsonl"), suspectFiles: PART_FILES[c.part] || [] });
  }

  // Calls: no 5xx, no hang.
  const byTarget = new Map();
  for (const c of calls) {
    const k = `${c.kind} ${c.target}`;
    if (!byTarget.has(k)) byTarget.set(k, []);
    byTarget.get(k).push(c);
  }
  for (const [k, list] of byTarget) {
    checks += 1;
    const five = list.filter((c) => c.status >= 500);
    const hangs = list.filter((c) => c.hang);
    const kind = k.split(" ")[0];
    const target = k.slice(kind.length + 1);
    const files = kind === "door" ? PART_FILES[target] : ["engine/home/server/routes/"];
    if (hangs.length) {
      rec({ severity: "high", check: "hang", target: k, title: `${target} hung during the soak`, expected: "every answer in 10 s (doors 20 s)",
        actual: `${hangs.length} of ${list.length} calls got no answer in time`, suspectFiles: files });
    }
    if (five.length) {
      rec({ severity: "high", check: "5xx", target: k, title: `${target} answered ${five[0].status} during the soak`, expected: "no 5xx",
        actual: `${five.length} of ${list.length} calls; codes ${[...new Set(five.map((c) => c.code || c.status))].join(", ")}`, suspectFiles: files });
    }
    const bad = list.filter((c) => !c.ok && c.status < 500 && !c.hang);
    if (bad.length && (kind === "door" || kind === "owner")) {
      rec({ severity: "medium", check: "refused", target: k, title: `${target} did not do the soak's work`, expected: kind === "door" ? "each call answered and done" : "200",
        actual: `${bad.length} of ${list.length} calls; ${[...new Set(bad.map((c) => `${c.status} ${c.code || ""}`.trim()))].slice(0, 5).join(", ")}`, suspectFiles: files });
    }
  }
  // Generation jobs: every one sent ended done on the fake.
  const jobs = doors.followed;
  const jobRow = {
    sent: jobs.length, done: jobs.filter((j) => j.state === "done").length, failed: jobs.filter((j) => j.endedMs !== null && j.state !== "done").length,
    unended: jobs.filter((j) => j.endedMs === null).length, busy: calls.filter((c) => c.target === "generate" && c.code === "gen_busy").length,
    p95EndedMs: percentile(jobs.map((j) => j.endedMs), 0.95),
  };
  checks += 1;
  if (jobRow.unended) {
    const j = jobs.find((x) => x.endedMs === null);
    rec({ severity: "high", check: "job-unended", target: "generate", title: "A generation job on the fake did not end", expected: "every job ends within 2 minutes",
      actual: `${jobRow.unended} of ${jobRow.sent}; e.g. ${j.job} last ${j.status} ${j.state}`, suspectFiles: PART_FILES.generate });
  }
  if (jobRow.failed) {
    const j = jobs.find((x) => x.endedMs !== null && x.state !== "done");
    rec({ severity: "medium", check: "job-failed", target: "generate", title: "A generation job on the fake ended without its result", expected: "every job done",
      actual: `${jobRow.failed} of ${jobRow.sent}; e.g. ${j.job} ${j.state}`, suspectFiles: PART_FILES.generate });
  }
  checks += 1;
  if (backlog > 0) {
    rec({ severity: "medium", check: "backlog", target: "home", title: "The home fell behind 5 reads a second", expected: "no more than 20 reads waiting",
      actual: `${backlog} reads were skipped with 20 waiting`, suspectFiles: PART_FILES.home });
  }

  // Pages: no exception, console error, error log line or failed request.
  const real = errors.filter((e) => !expectedError(e, routes));
  const groups = new Map();
  for (const e of real) {
    const k = `${e.kind}|${e.route}|${e.text.replace(/\d+/g, "#").slice(0, 120)}`;
    if (!groups.has(k)) groups.set(k, { first: e, n: 0 });
    groups.get(k).n += 1;
  }
  checks += Object.keys(pages).length;
  for (const { first: e, n } of groups.values()) {
    const sev = e.kind === "exception" ? "high" : "medium";
    rec({ severity: sev, check: `page-${e.kind}`, target: `${e.route}|${e.text.replace(/\d+/g, "#").slice(0, 80)}`,
      title: `${e.kind === "exception" ? "An exception" : e.kind === "csp" ? "A CSP violation" : e.kind === "failed" ? "A failed request" : "A console error"} on #/${e.route} during the soak`,
      expected: "none", actual: `${n} times (${e.page} page): ${e.text.slice(0, 300)}${e.url ? ` at ${e.url}` : ""}`, evidence: errorsFile,
      suspectFiles: [`engine/home/public/pages/${(routes.find((r) => r.hash === e.route) || { id: "" }).id}.js`] });
  }
  checks += 1;
  for (const [hash, n] of Object.entries(blanks)) {
    if (n < 2) continue;
    rec({ severity: "high", check: "blank", target: hash, title: `#/${hash} was blank during the soak`, expected: "the page draws every lap",
      actual: `blank ${n} times`, suspectFiles: [`engine/home/public/pages/${(routes.find((r) => r.hash === hash) || { id: "" }).id}.js`] });
  }

  // Temp files cleaned.
  checks += 1;
  if (lastIdle.tempFiles > tempAtStart + 5) {
    rec({ severity: "medium", check: "temp-files", target: "stage tmp", title: "Temp files were left behind after the soak", expected: `about ${tempAtStart} files under the stage's temp folder after idle`,
      actual: `${lastIdle.tempFiles} files`, evidence: join(stage.root, "tmp"), suspectFiles: [] });
  }

  // The limits (judged runs only).
  const judgedRows = { parts: {}, pages: {}, files: [], slower: [] };
  const suspects = [];
  for (const part of PART_NAMES) {
    const ref = refS.parts[part] || {};
    const end = endS.parts[part] || {};
    const start = startS.parts[part] || {};
    const row = {
      rssRefKb: ref.rssKb ?? null, rssEndKb: end.rssKb ?? null, fdsStart: start.fds ?? null, fdsEnd: end.fds ?? null, idleCpuPct: idleCpu[part],
    };
    row.rssOk = row.rssRefKb === null || row.rssEndKb === null || (row.rssEndKb <= 1.3 * row.rssRefKb && row.rssEndKb - row.rssRefKb <= 50 * 1024);
    row.fdsOk = row.fdsStart === null || row.fdsEnd === null || row.fdsEnd <= row.fdsStart + 10;
    row.cpuOk = row.idleCpuPct === null || row.idleCpuPct < 5;
    judgedRows.parts[part] = row;
  }
  for (const name of Object.keys(pages)) {
    const a = refPages && refPages[name];
    const b = endPages && endPages[name];
    const row = { ref: a, end: b };
    if (a && b) {
      row.heapOk = b.heap <= 1.25 * a.heap;
      row.nodesOk = b.nodes <= 1.1 * a.nodes;
      row.listenersOk = b.listeners <= 1.1 * a.listeners;
    }
    judgedRows.pages[name] = row;
  }
  // Files: more than 5 MB over the run (scaled to 45 minutes), or straight-line growth.
  const firstFiles = startS.files;
  const lastFiles = endS.files;
  for (const rel of Object.keys(lastFiles)) {
    const grew = lastFiles[rel] - (firstFiles[rel] || 0);
    const per45 = (grew / Math.max(1, endS.sec - startS.sec)) * 45 * 60;
    const fit = line(loaded.map((s) => [s.sec, s.files[rel]]));
    const straight = fit.r !== null && fit.r > 0.97 && grew > 256 * 1024;
    judgedRows.files.push({ file: rel, startBytes: firstFiles[rel] || 0, endBytes: lastFiles[rel], per45MinBytes: Math.round(per45), r: fit.r === null ? null : Math.round(fit.r * 1000) / 1000, flagged: per45 > 5 * MB || straight });
  }
  // Slower: p95 of the last 5 minutes over 2 times minutes 5 to 10.
  for (const [k, list] of byTarget) {
    const early = list.filter((c) => c.t >= 5 * 60_000 && c.t < 10 * 60_000).map((c) => c.ms);
    const late = list.filter((c) => c.t >= loadedMs - 5 * 60_000).map((c) => c.ms);
    const pe = percentile(early, 0.95);
    const pl = percentile(late, 0.95);
    judgedRows.slower.push({ target: k, p95Early: pe, p95Late: pl, slower: pe !== null && pl !== null && pl > 2 * pe && pl - pe > 20 });
  }

  if (judged) {
    for (const [part, row] of Object.entries(judgedRows.parts)) {
      checks += 3;
      if (!row.rssOk) suspects.push(part);
      if (!row.fdsOk) {
        rec({ severity: "high", check: "fds", target: part, title: `${part} kept files or sockets open during the soak`, expected: "open files no more than 10 over the start",
          actual: `${row.fdsStart} at the start, ${row.fdsEnd} at the end`, suspectFiles: PART_FILES[part] || [] });
      }
      if (!row.cpuOk) {
        rec({ severity: "high", check: "idle-cpu", target: part, title: `${part} kept working while idle`, expected: "idle CPU under 5 %",
          actual: `${row.idleCpuPct} % over the idle minutes`, suspectFiles: PART_FILES[part] || [] });
      }
    }
    for (const f of judgedRows.files) {
      checks += 1;
      if (!f.flagged) continue;
      rec({ severity: "medium", check: "file-growth", target: f.file, title: `${f.file} grows without a cap`, expected: "no more than 5 MB in 45 minutes, and a cap named in code",
        actual: `${f.startBytes} to ${f.endBytes} bytes (${f.per45MinBytes} a 45 minutes; straight line r=${f.r})`, suspectFiles: ownersOf(f.file) });
    }
    for (const s of judgedRows.slower) {
      checks += 1;
      if (!s.slower) continue;
      const [kind, ...t] = s.target.split(" ");
      rec({ severity: "medium", check: "slower", target: s.target, title: `${t.join(" ")} got slower during the soak`, expected: "p95 of the last 5 minutes no more than 2 times minutes 5 to 10",
        actual: `${s.p95Early} ms then ${s.p95Late} ms`, suspectFiles: kind === "door" ? PART_FILES[t.join(" ")] || [] : ["engine/home/server/routes/"] });
    }
    // Page leaks, with the heap snapshots' three fastest-growing constructors.
    const top = snaps.a && snaps.b ? growing(snaps.a, snaps.b, 3) : [];
    for (const [name, row] of Object.entries(judgedRows.pages)) {
      checks += 3;
      if (row.heapOk === false || row.nodesOk === false || row.listenersOk === false) {
        const what = [row.heapOk === false && "heap", row.nodesOk === false && "DOM nodes", row.listenersOk === false && "listeners"].filter(Boolean).join(", ");
        rec({ severity: "high", check: "page-leak", target: name, title: `The ${name} page grew (${what}) during the soak`,
          expected: "heap after a collection no more than 1.25 times minute 10; nodes and listeners no more than 10 % up",
          actual: `minute 10 ${JSON.stringify(row.ref)}, end ${JSON.stringify(row.end)}${name === "walker" && top.length ? `; grew most between laps ${snaps.lapA} and ${snaps.lapB}: ${top.map((x) => `${x.name} ${x.countFrom}->${x.countTo} (${Math.round(x.grew / 1024)} KB)`).join(", ")}` : ""}`,
          suspectFiles: name === "walker" ? ["engine/home/public/shell/app-shell.js", "engine/home/public/lib/api.js"] : [`engine/home/public/pages/${name}.js`] });
      }
    }
    // Part leaks: halve the work to name the loop that causes it.
    for (const part of suspects) {
      const row = judgedRows.parts[part];
      const diag = await diagnose(ctx, stage, part, { minutes: 5, routes, doors });
      rec({ severity: "high", check: "rss", target: part, title: `${part}'s memory grew during the soak`,
        expected: "RSS at the end no more than 1.3 times and 50 MB over minute 10",
        actual: `${Math.round(row.rssRefKb / 1024)} MB at minute 10, ${Math.round(row.rssEndKb / 1024)} MB at the end; halved: ${diag.sentence}`,
        suspectFiles: [...(PART_FILES[part] || []), ...diag.files] });
    }
  }

  const heapTop = snaps.a && snaps.b ? growing(snaps.a, snaps.b, 3) : [];
  const summary = {
    minutes, judged, idleMinutes: idleMs / 60000, samples: samples.length, laps: lap, themes: themes.length,
    routes: routes.map((r) => ({ id: r.id, hash: r.hash, fallback: r.fallback })),
    calls: Object.fromEntries([...byTarget].map(([k, l]) => [k, { n: l.length, ok: l.filter((c) => c.ok).length, p50: percentile(l.map((c) => c.ms), 0.5), p95: percentile(l.map((c) => c.ms), 0.95), max: percentile(l.map((c) => c.ms), 1) }])),
    jobs: jobRow, backlog, skipped: { owner: ownerLoop.skipped, doors: doorLoops.map((l) => l.skipped) },
    errors: { total: errors.length, expected: errors.length - real.length, real: real.length, groups: groups.size },
    blanks, idleCpu, outside: { total: outside.length, unknown: unknownOutside.length }, logHits,
    heapSnapshots: snaps.a ? { lapA: snaps.lapA, lapB: snaps.lapB, totalA: snaps.a.total, totalB: snaps.b ? snaps.b.total : null, top: heapTop } : null,
    limits: judgedRows, suspects,
  };
  writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  log(`samples ${samples.length}, laps ${lap}, calls ${calls.length}, page errors ${real.length} (+${errors.length - real.length} expected), outside calls ${outside.length}`);
  log(`summary ${summaryFile}`);
  await stage.close();
  return { checks };
}

// Halves the work on a part that leaked: 5 minutes of the pages alone (walker, Map, Needs you, the owner's POST),
// then 5 minutes of the home GETs and the door calls alone, the part's RSS slope in each.
// -> { sentence, files, halves }
export async function diagnose(ctx, stage, part, { minutes = 5, routes, doors }) {
  const slope = async (label, run) => {
    const pts = [];
    const t0 = Date.now();
    const stop = await run();
    while (Date.now() - t0 < minutes * 60_000) {
      const s = stage.sample().parts[part];
      if (s && s.rssKb) pts.push([(Date.now() - t0) / 60000, s.rssKb]);
      await sleep(10_000);
    }
    await stop();
    const fit = line(pts);
    return { label, kbPerMin: fit.slope === null ? null : Math.round(fit.slope), r: fit.r };
  };
  const halves = [];
  halves.push(await slope("the pages", async () => {
    const b = await ctx.openBrowser();
    const w = await openOn(b, stage.urls.home, "map", "walker");
    await openOn(b, stage.urls.home, "map", "map");
    await openOn(b, stage.urls.home, "needs-you", "needs-you");
    let on = true;
    let i = 0;
    const loop = (async () => { while (on) { await moveTo(w, routes[i % routes.length].hash).catch(() => {}); i += 1; if (i % routes.length === 0) await switchTheme(w).catch(() => {}); await sleep(WALK_MS); } })();
    let hidden = false;
    const owner = every(OWNER_POST_MS, async () => { hidden = !hidden; await ownerPost(stage, "/api/setup/dismiss", { dismissed: hidden }).catch(() => {}); });
    return async () => { on = false; await loop; await owner.stop(); await b.close(); };
  }));
  halves.push(await slope("the routes and doors", async () => {
    let k = 0;
    const t = setInterval(() => { call(`${stage.urls.home}${READ_ROUTES[k++ % READ_ROUTES.length]}`, { timeoutMs: 10_000 }).catch(() => {}); }, HOME_GET_MS);
    const d = ["generate", "web", "brain", "relay", "gate"].map((n) => every(DOOR_MS, () => doors[n]()));
    return async () => { clearInterval(t); await Promise.all(d.map((x) => x.stop())); };
  }));
  const worse = halves.filter((h) => h.kbPerMin !== null).sort((a, b) => b.kbPerMin - a.kbPerMin)[0];
  const sentence = halves.map((h) => `${h.label} ${h.kbPerMin ?? "?"} KB a minute`).join(", ") + (worse ? `; it follows ${worse.label}` : "");
  const files = !worse ? [] : worse.label === "the pages" ? ["engine/home/public/shell/app-shell.js", "engine/home/server/routes/"] : ["engine/home/server/routes/"];
  return { sentence, files, halves };
}
