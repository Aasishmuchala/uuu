// Sweep `recovery` (PLAN-STRESS T6): each part killed in turn on a `normal` stage, with a page open on Health and
// one on Map. For each of board books gate gateNarrow relay web generate viewer apps brain home:
//   kill(part) (SIGKILL, by the stage's own process id) -> seconds until GET /api/health and the Health page say so
//   (noticedSec, the later of the two); three of the owner's controls that need the part, sent from inside the page
//   as its buttons send them (same address, same headers): each must be a plain refusal (a sentence, no stack, no
//   5xx without one, no hang) with no exception on either page; start(part) -> seconds until it is healthy and the
//   health route says so (healthySec), the home not restarted; the Health page shows it again with no reload
//   (pageRecovered). Then a part killed in the middle of its own work (a generation job on the fake, a web fetch of
//   a slow site, a site check with the viewer's Chrome open, a relay stream, saves in the home): after start, no
//   orphan process holding the stage root, every JSON state file parses, no temp file left, the ledger parses, the
//   job ended with a plain reason and was not charged twice, its port is free for the part. Then two parts at once
//   (board and books; generate and relay). Then the home killed with the pages open: they say the engine is not
//   answering and come back by themselves after start("home").
// Writes OUT/pass-<n>/recovery.json: per part { noticedSec, healthySec, pageRecovered, orphans, badFiles } and the
// rest under midWork, pairs and homeWhileOpen. Nothing but the stage's own processes is ever signalled.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PART_NAMES } from "../lib/faults.mjs";
import { call } from "../lib/http.mjs";
import { evaluate, openOn, pageText, sleep } from "../soak/pages.mjs";
import { doorCalls, prepareDoors, stagedPaths } from "../soak/work.mjs";
import { PART_FILES } from "../soak/index.mjs";

const NOTICE_LIMIT_SEC = 5;
const HEALTHY_LIMIT_SEC = 10;
const WAIT_SEC = 20; // how long to look before calling something "never"
const DATABASES = /postgres|mysqld|mariadbd|redis-server/;

// Which /api/health entry speaks for each part.
const HEALTH_ID = { board: "board", books: "books", gate: "gate", gateNarrow: "gate", relay: "relay", web: "web", generate: "generate", viewer: "viewer", apps: "apps", brain: "brain", home: "home" };

// Three owner controls per part, each { method, path, body } as the page's button sends it. Only reads, Tests and
// refusals on the staged engine: no app is ever switched on (the copy's host would bind the fixed app ports).
const CONTROLS = {
  board: [{ method: "POST", path: "/api/goals", body: { text: "A stress task while the board is off" } }, { method: "GET", path: "/api/tasks" }, { method: "GET", path: "/api/team" }],
  books: [{ method: "GET", path: "/api/departments/books" }, { method: "GET", path: "/api/departments/customers" }, { method: "GET", path: "/api/departments/support" }],
  gate: [{ method: "GET", path: "/api/health" }, { method: "GET", path: "/api/shell" }, { method: "GET", path: "/api/map" }],
  gateNarrow: [{ method: "GET", path: "/api/health" }, { method: "GET", path: "/api/shell" }, { method: "GET", path: "/api/map" }],
  relay: [{ method: "POST", path: "/api/models/test", body: {} }, { method: "GET", path: "/api/models" }, { method: "GET", path: "/api/settings" }],
  web: [{ method: "POST", path: "/api/web/test", body: {} }, { method: "GET", path: "/api/web" }, { method: "GET", path: "/api/web/visits" }],
  generate: [{ method: "POST", path: "/api/generation/test", body: {} }, { method: "GET", path: "/api/generation" }, { method: "GET", path: "/api/generation/ledger" }],
  viewer: [{ method: "GET", path: "/api/viewer" }, { method: "GET", path: "/api/health" }, { method: "GET", path: "/api/apps" }],
  apps: [{ method: "GET", path: "/api/apps" }, { method: "GET", path: "/api/health" }, { method: "GET", path: "/api/shell" }],
  brain: [{ method: "POST", path: "/api/brain-door/test", body: {} }, { method: "GET", path: "/api/brain-door" }, { method: "GET", path: "/api/brain/search?q=delivery" }],
  home: [],
};

// [{ pid, ppid, command }] of every process (read only).
function processTable() {
  let text = "";
  try { text = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); } catch { return []; }
  return text.split("\n").map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
}

// Processes whose command line holds the stage root but that are neither a part in pids.json nor below one: what a
// killed part left behind (the viewer's Chrome group, an app's group, a runner's child).
function orphans(stage) {
  const table = processTable();
  const live = new Set(Object.values(stage.pids).map((e) => e.pid));
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of table) if (!live.has(p.pid) && live.has(p.ppid)) { live.add(p.pid); grew = true; }
  }
  return table.filter((p) => p.command.includes(stage.root) && !live.has(p.pid) && p.pid !== process.pid && !DATABASES.test(p.command))
    .map((p) => ({ pid: p.pid, command: p.command.slice(0, 200) }));
}

// Every *.json and *.jsonl under the state folder that does not parse, and every *.tmp older than 5 s.
function badFiles(state) {
  const bad = [];
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (depth < 10 && e.name !== "node_modules" && e.name !== "secrets") walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      const rel = relative(state, p);
      if (/\.tmp$/.test(e.name) || /\.tmp\b/.test(e.name)) {
        try { if (Date.now() - statSync(p).mtimeMs > 5000) bad.push({ file: rel, why: "a temp file left behind" }); } catch { /* gone */ }
        continue;
      }
      if (!/\.jsonl?$/.test(e.name)) continue;
      let text;
      try {
        if (statSync(p).size > 64 * 1024 * 1024) continue;
        text = readFileSync(p, "utf8");
      } catch { continue; }
      try {
        if (e.name.endsWith(".jsonl")) {
          text.split("\n").forEach((l, i) => { if (l.trim()) { try { JSON.parse(l); } catch { throw new Error(`line ${i + 1}`); } } });
        } else if (text.trim()) {
          JSON.parse(text);
        } else {
          throw new Error("empty");
        }
      } catch (err) {
        bad.push({ file: rel, why: `does not parse (${err.message.slice(0, 60)})` });
      }
    }
  };
  walk(state, 0);
  return bad;
}

// The words of a health sentence as the Health page shows them: the part before "Run:" (the command is drawn as a
// chip of its own), spaces folded.
const fold = (t) => String(t || "").replace(/\s+/g, " ").trim();
const head = (sentence) => fold(String(sentence || "").split(/\bRun:/)[0]);
const shows = async (p, sentence) => fold(await pageText(p)).includes(head(sentence));

const round = (ms) => (ms === null ? null : Math.round(ms / 100) / 10);

// Polls fn() every 250 ms until it is true or `sec` pass; -> milliseconds taken, or null.
async function until(fn, sec = WAIT_SEC) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await fn(); } catch { ok = false; }
    if (ok) return Date.now() - t0;
    if (Date.now() - t0 > sec * 1000) return null;
    await sleep(250);
  }
}

export default async function recovery(ctx) {
  const { log } = ctx;
  if (ctx.only) log(`--only ${ctx.only}: the whole recovery runs (each step depends on the one before)`);
  const out = ctx.passDir;
  const stage = await ctx.startStage({ dataset: "normal", apps: false });
  log(`stage ${stage.root}`);
  await prepareDoors(stage, { viewer: true });
  const doors = await doorCalls(stage);
  const cfg = await stagedPaths(stage);
  let checks = 0;
  const rec = (f) => ctx.record({ area: "recovery", evidence: join(out, "recovery.json"), ...f });

  const browser = await ctx.openBrowser();
  const health = await openOn(browser, stage.urls.home, "health", "health");
  const map = await openOn(browser, stage.urls.home, "map", "map");
  const pages = [health, map];
  await sleep(3000);
  const mark = async () => { for (const p of pages) await evaluate(p.page, "window.__stressMark = 1; true").catch(() => {}); };
  const reloaded = async () => {
    for (const p of pages) { if ((await evaluate(p.page, "window.__stressMark === 1").catch(() => false)) !== true) return true; }
    return false;
  };
  await mark();
  const errorsNow = () => pages.reduce((n, p) => n + p.watch.errors.filter((e) => e.kind === "exception").length, 0);

  const healthEntry = async (id) => {
    const r = await call(`${stage.urls.home}/api/health`, { timeoutMs: 8000 });
    if (r.status !== 200 || !r.json || !Array.isArray(r.json.parts)) return null;
    return r.json.parts.find((x) => x.id === id) || null;
  };
  // The control as the page's button sends it, from inside the page. -> { status, plain, text }
  const press = async (p, c) => {
    const expr = `(async () => {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
      try {
        const r = await fetch(${JSON.stringify(c.path)}, { method: ${JSON.stringify(c.method)}, signal: ctl.signal, cache: "no-store", credentials: "same-origin",
          headers: ${JSON.stringify(c.method === "GET" ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json", "X-Engine": "1" })},
          body: ${c.method === "GET" ? "undefined" : JSON.stringify(JSON.stringify(c.body || {}))} });
        const text = await r.text();
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        const message = json && json.error && typeof json.error.message === "string" ? json.error.message : null;
        return { status: r.status, json: json !== null, message, stack: /\\n\\s+at\\s|node:internal|\\.mjs:\\d+/.test(text) };
      } catch (e) { return { status: 0, json: false, message: null, stack: false, error: String(e && e.name) }; } finally { clearTimeout(t); }
    })()`;
    const r = await evaluate(p.page, expr, { timeoutMs: 20000 }).catch((e) => ({ status: 0, json: false, message: null, stack: false, error: e.message }));
    const sentence = typeof r.message === "string" && r.message.length > 5;
    const plain = !r.stack && (r.status >= 200 && r.status < 300 ? r.json : sentence);
    return { path: c.path, method: c.method, status: r.status, plain, hang: r.status === 0 && /Abort/.test(String(r.error)), message: r.message, stack: r.stack };
  };

  const results = {};
  const homePid0 = stage.pids.home.pid;

  // ---- each part in turn ---------------------------------------------------------------------------------------
  for (const part of PART_NAMES) {
    const id = HEALTH_ID[part];
    const before = await healthEntry(id);
    const exc0 = errorsNow();
    const homeBefore = stage.pids.home && stage.pids.home.pid;
    await mark();
    log(`kill ${part}`);
    const tKill = Date.now();
    await stage.kill(part);
    const killMs = Date.now() - tKill;
    let offSentence = null;
    let apiMs;
    let pageMs;
    if (part === "home") {
      apiMs = await until(async () => { try { await call(`${stage.urls.home}/healthz`, { timeoutMs: 1000 }); return false; } catch { return true; } });
      pageMs = await until(async () => /not answering/i.test(await pageText(health)) && /not answering/i.test(await pageText(map)));
    } else {
      apiMs = await until(async () => { const e = await healthEntry(id); if (e && e.state !== "on") { offSentence = e.sentence; return true; } return false; });
      pageMs = await until(async () => offSentence !== null && (await shows(health, offSentence)));
    }
    const noticedSec = apiMs === null || pageMs === null ? null : round(killMs + Math.max(apiMs, pageMs));
    const presses = [];
    for (const c of CONTROLS[part]) presses.push(await press(health, c));
    checks += 1 + presses.length;
    const tStart = Date.now();
    await stage.start(part);
    const startMs = Date.now() - tStart;
    const healthyMs0 = await until(async () => (await stage.healthy(part)) && (part === "home" || ((await healthEntry(id)) || {}).state === (before ? before.state : "on")));
    const healthyMs = healthyMs0 === null ? null : startMs + healthyMs0;
    const recoveredMs = await until(async () => {
      const t = await pageText(health);
      if (part === "home") return !/not answering/i.test(t) && t.length > 200;
      return offSentence === null ? true : !fold(t).includes(head(offSentence));
    });
    const pageRecovered = recoveredMs !== null && !(await reloaded());
    const exceptions = errorsNow() - exc0;
    const homeRestarted = part !== "home" && stage.pids.home && stage.pids.home.pid !== homeBefore;
    const o = orphans(stage);
    const bf = badFiles(stage.state);
    results[part] = {
      noticedSec, apiNoticedSec: round(apiMs), pageNoticedSec: round(pageMs), offSentence,
      healthySec: round(healthyMs), pageRecovered, pageRecoveredSec: round(recoveredMs),
      orphans: o, badFiles: bf, controls: presses, exceptions, homeRestarted: !!homeRestarted,
    };
    log(`${part}: noticed ${noticedSec} s (api ${round(apiMs)}, page ${round(pageMs)}), healthy ${results[part].healthySec} s, page back ${pageRecovered}, controls ${presses.map((x) => `${x.status}${x.plain ? "" : "!"}`).join(" ")}`);

    checks += 6;
    const files = PART_FILES[part] || [];
    if (noticedSec === null) {
      rec({ severity: "high", check: "noticed", target: part, title: `With ${part} killed, ${apiMs === null ? "the health route" : "the Health page"} never said so`,
        expected: `GET /api/health and the Health page say so within ${NOTICE_LIMIT_SEC} s`, actual: `api ${round(apiMs)} s, page ${round(pageMs)} s (looked for ${WAIT_SEC} s)`,
        suspectFiles: ["engine/home/server/lib/health.mjs", "engine/home/public/pages/health.js"] });
    } else if (noticedSec > NOTICE_LIMIT_SEC) {
      rec({ severity: "medium", check: "noticed-late", target: part, title: `With ${part} killed, the home took ${noticedSec} s to say so`,
        expected: `within ${NOTICE_LIMIT_SEC} s`, actual: `api ${round(apiMs)} s, page ${round(pageMs)} s`,
        suspectFiles: part === "home" ? ["engine/home/public/shell/app-shell.js", "engine/home/public/lib/api.js"] : ["engine/home/public/pages/health.js"] });
    }
    if (healthyMs === null || healthyMs / 1000 > HEALTHY_LIMIT_SEC) {
      rec({ severity: "high", check: "healthy", target: part, title: `${part} was not healthy within ${HEALTHY_LIMIT_SEC} s of its start`,
        expected: `healthy within ${HEALTHY_LIMIT_SEC} s`, actual: `${round(healthyMs)} s`, suspectFiles: files });
    }
    if (!pageRecovered) {
      rec({ severity: "high", check: "page-recovered", target: part, title: `The Health page did not come back by itself after ${part} started again`,
        expected: "the page shows the part on again, with no reload", actual: recoveredMs === null ? `still showing it off after ${WAIT_SEC} s` : "the page was reloaded",
        suspectFiles: ["engine/home/public/pages/health.js", "engine/home/public/lib/api.js"] });
    }
    if (homeRestarted) {
      rec({ severity: "high", check: "home-restarted", target: part, title: `The home restarted when ${part} was killed`, expected: "the home keeps running", actual: `home pid ${homeBefore} -> ${stage.pids.home && stage.pids.home.pid}`, suspectFiles: PART_FILES.home });
    }
    if (exceptions > 0) {
      const e = pages.flatMap((p) => p.watch.errors.filter((x) => x.kind === "exception")).slice(-1)[0];
      rec({ severity: "high", check: "page-exception", target: part, title: `A page threw while ${part} was killed`, expected: "no exception", actual: `${exceptions}: ${e ? e.text.slice(0, 300) : ""}`, suspectFiles: ["engine/home/public/pages/health.js", "engine/home/public/pages/map.js"] });
    }
    for (const x of presses) {
      if (x.hang) rec({ severity: "high", check: "control-hang", target: `${part} ${x.method} ${x.path}`, title: `${x.method} ${x.path} hung with ${part} killed`, expected: "a plain answer within 15 s", actual: "no answer", suspectFiles: ["engine/home/server/routes/"] });
      else if (x.stack) rec({ severity: "high", check: "control-stack", target: `${part} ${x.method} ${x.path}`, title: `${x.method} ${x.path} sent a stack with ${part} killed`, expected: "a plain sentence", actual: `status ${x.status}`, suspectFiles: ["engine/home/server/routes/"] });
      else if (!x.plain) rec({ severity: x.status >= 500 ? "high" : "medium", check: "control-plain", target: `${part} ${x.method} ${x.path}`, title: `${x.method} ${x.path} gave no plain refusal with ${part} killed`, expected: "200, or a refusal with a sentence", actual: `status ${x.status}`, suspectFiles: ["engine/home/server/routes/"] });
    }
    if (o.length) rec({ severity: "high", check: "orphans", target: part, title: `Killing ${part} left processes behind`, expected: "none", actual: JSON.stringify(o).slice(0, 400), suspectFiles: files });
    if (bf.length) rec({ severity: "high", check: "bad-files", target: part, title: `A state file was left broken after ${part} was killed`, expected: "every JSON state file parses, no temp file left", actual: JSON.stringify(bf).slice(0, 400), suspectFiles: files });
  }

  // ---- killed in the middle of its own work ----------------------------------------------------------------------
  const midWork = {};
  const afterKill = async (part, extra = {}) => {
    const o = orphans(stage);
    const bf = badFiles(stage.state);
    const healthy = await stage.healthy(part);
    const r = { orphans: o, badFiles: bf, healthy, ...extra };
    midWork[part] = r;
    checks += 3;
    if (o.length) rec({ severity: "high", check: "mid-orphans", target: part, title: `Killing ${part} in the middle of its work left processes behind`, expected: "none", actual: JSON.stringify(o).slice(0, 400), suspectFiles: PART_FILES[part] || [] });
    if (bf.length) rec({ severity: "high", check: "mid-bad-files", target: part, title: `Killing ${part} in the middle of its work left a broken state file`, expected: "every JSON state file parses, no temp file left", actual: JSON.stringify(bf).slice(0, 400), suspectFiles: PART_FILES[part] || [] });
    if (!healthy) rec({ severity: "high", check: "mid-healthy", target: part, title: `${part} did not come back after being killed in the middle of its work`, expected: "healthy", actual: "not healthy", suspectFiles: PART_FILES[part] || [] });
    log(`mid-work ${part}: ${JSON.stringify({ orphans: o.length, badFiles: bf.length, healthy, ...extra }).slice(0, 300)}`);
    return r;
  };

  // A generation job running on the fake.
  {
    const job = await doors.submitJob();
    await sleep(800);
    await stage.kill("generate");
    await stage.start("generate");
    let state = null;
    const endedMs = job.job ? await until(async () => { state = await doors.jobState(job.job); return state.status !== 200 || ["done", "failed", "cancelled"].includes(state.state); }, 60) : null;
    let ledger = [];
    let ledgerOk = true;
    try {
      ledger = readFileSync(cfg.paths.ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch (e) {
      ledgerOk = e.code === "ENOENT";
    }
    const spent = ledger.filter((l) => l.job === job.job && l.state === "spent").length;
    const plainReason = !!state && (state.state === "done" || (typeof state.reason === "string" && state.reason.length > 5) || (state.status !== 200 && !!state.code));
    await afterKill("generate", { job: job.job, submitted: job.status, endedSec: round(endedMs), state, ledgerOk, spentLines: spent, plainReason });
    checks += 3;
    if (!ledgerOk) rec({ severity: "critical", check: "mid-ledger", target: "generate", title: "The generation ledger does not parse after the door was killed mid-job", expected: "every line parses", actual: "a line does not parse", suspectFiles: ["engine/generate/ledger.mjs"] });
    if (spent > 1) rec({ severity: "critical", check: "mid-charged-twice", target: "generate", title: "A job killed in the middle was charged twice", expected: "one spent line at most", actual: `${spent} spent lines for ${job.job}`, suspectFiles: ["engine/generate/door.mjs", "engine/generate/ledger.mjs"] });
    if (job.job && (endedMs === null || !plainReason)) rec({ severity: "high", check: "mid-job-ended", target: "generate", title: "A job killed in the middle did not end with a plain reason", expected: "the job shows ended, with a reason", actual: JSON.stringify(state).slice(0, 300), suspectFiles: ["engine/generate/door.mjs"] });
  }

  // A web fetch of a slow (drip) site.
  {
    const pending = doors.fetchPage("http://drip.test/", 60000).catch((e) => ({ status: 0, error: e.code }));
    await sleep(1500);
    await stage.kill("web");
    const answer = await pending;
    await stage.start("web");
    const after = await doors.fetchPage("http://site.test/", 20000).catch((e) => ({ status: 0, error: e.code }));
    await afterKill("web", { during: answer.status ?? 0, afterStatus: after.status });
    checks += 1;
    if (after.status !== 200) rec({ severity: "high", check: "mid-web-after", target: "web", title: "The web door did not fetch again after being killed mid-fetch", expected: "200", actual: String(after.status), suspectFiles: PART_FILES.web });
  }

  // A site check with the viewer's Chrome open.
  {
    const pending = doors.siteCheck(90000).catch((e) => ({ status: 0, error: e.code }));
    const chromeSeen = await until(() => processTable().some((p) => p.command.includes(stage.root) && /Google Chrome/.test(p.command)), 20);
    await stage.kill("viewer");
    const answer = await pending;
    const goneMs = await until(() => !processTable().some((p) => p.command.includes(stage.root) && /Google Chrome/.test(p.command)), 15);
    await stage.start("viewer");
    await afterKill("viewer", { chromeSeen: chromeSeen !== null, during: answer.status ?? 0, chromeGoneSec: round(goneMs) });
    checks += 1;
    if (chromeSeen !== null && goneMs === null) rec({ severity: "high", check: "mid-viewer-chrome", target: "viewer", title: "The viewer's Chrome outlived the viewer", expected: "Chrome's group ends with the viewer", actual: "Chrome still running 15 s later", suspectFiles: ["engine/viewer/viewer.mjs", "engine/viewer/chrome.mjs"] });
  }

  // A relay stream, slowed by the fake provider.
  {
    let slowed = true;
    try { await stage.setBehaviour("provider", { eventDelayMs: 400 }); } catch { slowed = false; }
    const pending = doors.relayStream(60000).catch((e) => ({ status: 0, error: e.code }));
    await sleep(1200);
    await stage.kill("relay");
    const answer = await pending;
    await stage.start("relay");
    const after = await doors.relayStream(20000).catch((e) => ({ status: 0, error: e.code }));
    await afterKill("relay", { slowed, during: answer.status ?? 0, afterStatus: after.status });
    checks += 1;
    if (after.status !== 200) rec({ severity: "high", check: "mid-relay-after", target: "relay", title: "The relay did not answer again after being killed mid-stream", expected: "200", actual: String(after.status), suspectFiles: PART_FILES.relay });
  }

  // Saves in the home: twenty owner POSTs at once, the home killed among them.
  {
    const keys = ["basics", "brand", "books"]; // lib/setup.mjs SKIPPABLE
    const sends = [];
    for (let i = 0; i < 20; i += 1) {
      sends.push(call(`${stage.urls.home}/api/setup/skip`, {
        method: "POST", headers: { "content-type": "application/json", "x-engine": "1", host: `127.0.0.1:${stage.ports.home}` },
        body: { step: keys[i % keys.length], skip: i % 2 === 0 }, timeoutMs: 10000,
      }).catch((e) => ({ status: 0, error: e.code })));
    }
    sends.push(call(`${stage.urls.home}/api/setup/dismiss`, {
      method: "POST", headers: { "content-type": "application/json", "x-engine": "1", host: `127.0.0.1:${stage.ports.home}` }, body: { dismissed: true }, timeoutMs: 10000,
    }).catch((e) => ({ status: 0, error: e.code })));
    await sleep(40);
    await stage.kill("home");
    const answers = await Promise.all(sends);
    await stage.start("home");
    let decisionsOk = true;
    try { JSON.parse(readFileSync(join(stage.state, "home", "decisions.json"), "utf8")); } catch (e) { decisionsOk = e.code === "ENOENT"; }
    await afterKill("home", { answered: answers.filter((a) => a.status === 200).length, cut: answers.filter((a) => a.status === 0).length, decisionsOk });
    checks += 1;
    if (!decisionsOk) rec({ severity: "high", check: "mid-home-decisions", target: "home", title: "decisions.json was left broken by a kill during saves", expected: "parses", actual: "does not parse", suspectFiles: ["engine/home/server/lib/decisions.mjs"] });
  }

  // ---- two at once ------------------------------------------------------------------------------------------------
  const pairs = {};
  for (const pair of [["board", "books"], ["generate", "relay"]]) {
    const exc0 = errorsNow();
    await mark();
    await Promise.all(pair.map((p) => stage.kill(p)));
    const offs = {};
    const apiMs = await until(async () => {
      for (const p of pair) { const e = await healthEntry(HEALTH_ID[p]); if (!e || e.state === "on") return false; offs[p] = e.sentence; }
      return true;
    });
    const pageMs = await until(async () => { const t = fold(await pageText(health)); return pair.every((p) => offs[p] && t.includes(head(offs[p]))); });
    const tStart = Date.now();
    await Promise.all(pair.map((p) => stage.start(p)));
    const startMs = Date.now() - tStart;
    const healthyMs0 = await until(async () => (await Promise.all(pair.map((p) => stage.healthy(p)))).every(Boolean)
      && (await Promise.all(pair.map((p) => healthEntry(HEALTH_ID[p])))).every((e) => e && e.state === "on"));
    const healthyMs = healthyMs0 === null ? null : startMs + healthyMs0;
    const backMs = await until(async () => { const t = fold(await pageText(health)); return pair.every((p) => !offs[p] || !t.includes(head(offs[p]))); });
    const key = pair.join("+");
    pairs[key] = {
      noticedSec: apiMs === null || pageMs === null ? null : round(Math.max(apiMs, pageMs)), apiNoticedSec: round(apiMs), pageNoticedSec: round(pageMs),
      healthySec: round(healthyMs), pageRecovered: backMs !== null && !(await reloaded()), exceptions: errorsNow() - exc0, orphans: orphans(stage), badFiles: badFiles(stage.state),
    };
    log(`pair ${key}: ${JSON.stringify(pairs[key]).slice(0, 300)}`);
    checks += 4;
    const r = pairs[key];
    if (r.noticedSec === null) rec({ severity: "high", check: "pair-noticed", target: key, title: `With ${pair.join(" and ")} killed together, the home never said so`, expected: `within ${NOTICE_LIMIT_SEC} s`, actual: `api ${r.apiNoticedSec}, page ${r.pageNoticedSec}`, suspectFiles: ["engine/home/server/lib/health.mjs", "engine/home/public/pages/health.js"] });
    if (r.healthySec === null || r.healthySec > HEALTHY_LIMIT_SEC) rec({ severity: "high", check: "pair-healthy", target: key, title: `${pair.join(" and ")} were not healthy within ${HEALTHY_LIMIT_SEC} s`, expected: `within ${HEALTHY_LIMIT_SEC} s`, actual: `${r.healthySec} s`, suspectFiles: pair.flatMap((p) => PART_FILES[p] || []) });
    if (!r.pageRecovered) rec({ severity: "high", check: "pair-page", target: key, title: `The Health page did not come back after ${pair.join(" and ")} started again`, expected: "back with no reload", actual: "not back", suspectFiles: ["engine/home/public/pages/health.js"] });
    if (r.exceptions || r.orphans.length || r.badFiles.length) rec({ severity: "high", check: "pair-leftovers", target: key, title: `Killing ${pair.join(" and ")} together left a mark`, expected: "no exception, orphan or broken file", actual: JSON.stringify({ exceptions: r.exceptions, orphans: r.orphans, badFiles: r.badFiles }).slice(0, 400), suspectFiles: pair.flatMap((p) => PART_FILES[p] || []) });
  }

  // ---- the home killed with the pages open ------------------------------------------------------------------------
  let homeWhileOpen;
  {
    await mark();
    const exc0 = errorsNow();
    await stage.kill("home");
    const saidMs = await until(async () => /not answering/i.test(await pageText(health)) && /not answering/i.test(await pageText(map)));
    // What the pages showed with the home down (for the finding).
    const shownWhileDown = { health: fold(await pageText(health)).slice(0, 300), map: fold(await pageText(map)).slice(0, 300) };
    await stage.start("home");
    const backMs = await until(async () => {
      const [a, b] = [await pageText(health), await pageText(map)];
      return !/not answering/i.test(a) && !/not answering/i.test(b) && a.length > 200;
    });
    homeWhileOpen = { saidSec: round(saidMs), backSec: round(backMs), reloaded: await reloaded(), exceptions: errorsNow() - exc0, shownWhileDown };
    log(`home while open: ${JSON.stringify(homeWhileOpen)}`);
    checks += 3;
    if (saidMs === null || saidMs / 1000 > NOTICE_LIMIT_SEC) rec({ severity: saidMs === null ? "high" : "medium", check: "home-open-said", target: "home", title: "With the home killed, an open page did not say the engine is not answering in time", expected: `"The engine is not answering." within ${NOTICE_LIMIT_SEC} s on Health and Map`, actual: saidMs === null ? `not in ${WAIT_SEC} s; Health showed: "${shownWhileDown.health.slice(0, 160)}"` : `${round(saidMs)} s`, suspectFiles: ["engine/home/public/shell/app-shell.js", "engine/home/public/lib/api.js"] });
    if (backMs === null || homeWhileOpen.reloaded) rec({ severity: "high", check: "home-open-back", target: "home", title: "Open pages did not come back by themselves after the home started again", expected: "back with no reload", actual: backMs === null ? "not back" : "reloaded", suspectFiles: ["engine/home/public/shell/app-shell.js", "engine/home/public/lib/api.js"] });
    if (homeWhileOpen.exceptions) rec({ severity: "high", check: "home-open-exception", target: "home", title: "A page threw while the home was down", expected: "no exception", actual: String(homeWhileOpen.exceptions), suspectFiles: ["engine/home/public/shell/app-shell.js"] });
  }

  const outside = stage.outsideCalls().filter((c) => !(c.part === "home" && /omegaplusapi\.com$/.test(String(c.host))));
  checks += 1;
  if (outside.length) {
    const c = outside[0];
    rec({ severity: "critical", check: "outside-call", target: `${c.part}:${c.host}:${c.port}`, title: `${c.part} tried to reach ${c.host}:${c.port} during the recovery`, expected: "no outside call", actual: `${outside.length} refused tries`, evidence: join(stage.root, "outside-calls.jsonl"), suspectFiles: PART_FILES[c.part] || [] });
  }

  const report = {
    at: new Date().toISOString(), dataset: "normal", homePidAtStart: homePid0,
    parts: Object.fromEntries(PART_NAMES.map((p) => [p, results[p]])),
    midWork, pairs, homeWhileOpen,
    pageErrors: pages.flatMap((p) => p.watch.errors).slice(0, 200),
  };
  writeFileSync(join(out, "recovery.json"), `${JSON.stringify(report, null, 2)}\n`);
  log(`wrote ${join(out, "recovery.json")}`);
  await browser.close();
  await stage.close();
  return { checks };
}
