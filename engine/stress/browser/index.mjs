// The browser sweep (PLAN-STRESS T3): every page, every control, both themes, two widths, the keyboard, three data
// sizes, a part off or broken, and timing, in hidden headless Chrome on its own temporary profile against a stage.
//
//   $N engine/stress/run.mjs browser [--pass <n>] [--quick] [--only <finding id>] [--base <n>]
//
// Parts, in order (each its own stage; the stage and Chrome are closed between them):
//   loads     every page (pages.mjs) x dataset {empty, normal, large} x theme {light, dark} x width {1280x900, 390x844}:
//             exceptions, console errors and warnings, CSP, failed requests, requests off the stage (critical),
//             paints and long tasks, sideways scroll, text cut off with no way to read it, faint text, loading left,
//             and on `large` that no planted title opens a dialog or becomes markup (loads.mjs)
//   keyboard  per page at 1280 light on `normal`: Tab from the top, focus rings, traps, Escape, Enter/Space against
//             the click; and the shell's own keys (keyboard.mjs)
//   controls  per page at 1280 light on `normal`: every control found, written to OUT/pass-<n>/controls/<page>.json,
//             pressed once on a fresh load; fields typed into; forms sent empty, then filled (controls.mjs)
//   faults    each part x each fault mode, eight pages at once, then the part brought back (faults.mjs)
//   apps      the apps' own pages, only where an app starts inside its fence in the stage (apps.mjs)
//   timing    last and alone: 5 cold loads a page on `normal` and `large`, OUT/pass-<n>/timing.json (timing.mjs)
// --quick: `normal`, light, 1280, three pages (map, tasks, settings): loads, keyboard and controls (15 a page); no
// faults, no apps, no timing.
// --only <id>: the finding's evidence file (OUT/pass-<n>/browser/<id>.json) says which part, page, loads or fault made
// it; only that is run again, and only that finding is recorded.
// Writes OUT/pass-<n>/browser-summary.json, OUT/pass-<n>/browser/loads.jsonl and the evidence files.
//
// Outside calls the stage's guard refused (stage.outsideCalls()): the home's provider reads to Omega Plus's fixed
// origin (part home, host api.omegaplusapi.com; README "Known") are one `low` finding, the stage's known gap, with
// the pages and presses that caused them as evidence for T8; any other is `critical`.
//
// While building, these narrow a run (not for pass runs): STRESS_BROWSER_PHASES (a comma list of the parts above),
// STRESS_BROWSER_PAGES (page keys), STRESS_BROWSER_FAULTS ("part:mode,..."), STRESS_BROWSER_DATASETS.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { latest, load } from "../lib/ledger.mjs";
import { pressAll } from "./controls.mjs";
import { baselines, faultCells, runFault } from "./faults.mjs";
import { keyboardPage, keyboardShell } from "./keyboard.mjs";
import { loadAndJudge, newTally } from "./loads.mjs";
import { cellName, makeNotes } from "./notes.mjs";
import { QUICK_PAGES, pagesFor } from "./pages.mjs";
import { openTab } from "./recorder.mjs";
import { NOISY_LOAD, timePages } from "./timing.mjs";
import { appsPart } from "./apps.mjs";

export const DATASETS = ["empty", "normal", "large"];
export const THEMES = ["light", "dark"];
export const WIDTHS = [[1280, 900], [390, 844]];
const PHASES = ["loads", "keyboard", "controls", "faults", "apps", "timing"];
const PROVIDER_HOST = "api.omegaplusapi.com";

const envList = (name) => (process.env[name] ? process.env[name].split(",").map((s) => s.trim()).filter(Boolean) : null);

// What --only asks for: the finding and its evidence.
function onlyScope(ctx) {
  const rec = load(ctx.pass, { out: ctx.out }).find((r) => r.id === ctx.only) || latest({ out: ctx.out }).find((r) => r.id === ctx.only);
  if (!rec) throw new Error(`browser: no finding ${ctx.only} in the ledger`);
  let ev = null;
  try { ev = JSON.parse(readFileSync(rec.evidence, "utf8")); } catch { ev = null; }
  if (!ev) throw new Error(`browser: the finding ${ctx.only} has no evidence file to run it again from (${rec.evidence})`);
  const fault = /\((\w+):(\w+)\)$/.exec(ev.page || "");
  return {
    rec, ev,
    phase: ev.phase === "load" ? "loads" : ev.phase,
    page: fault ? ev.page.replace(/\s*\(\w+:\w+\)$/, "") : ev.page,
    cells: ev.cells || [],
    part: (ev.extra && ev.extra.part) || (fault && fault[1]) || null,
    mode: (ev.extra && ev.extra.mode) || (fault && fault[2]) || null,
  };
}

// The stage's refused outside calls, as findings.
function judgeOutside(stage, notes, where) {
  for (const c of stage.outsideCalls()) {
    const host = String(c.host || c.bad || "?");
    if (c.part === "home" && host === PROVIDER_HOST) {
      notes.note({
        phase: where.phase, page: where.page || "home", cell: where.cell, area: "outside", check: "provider-origin", target: `home: ${PROVIDER_HOST}`, severity: "low",
        title: "The home's provider reads go to Omega Plus's fixed origin; the stage's guard refused them (a known gap of the stage, not a leak)",
        expected: "no call off this Mac from the stage", actual: `home -> ${host}:${c.port} during ${where.phase}${where.page ? ` (${where.page})` : ""}`,
        suspectFiles: ["engine/home/server/lib/provider.mjs"],
      });
    } else {
      notes.note({
        phase: where.phase, page: where.page || c.part, cell: where.cell, area: "outside", check: "stage-call", target: `${c.part || "?"}: ${host}:${c.port}`, severity: "critical",
        title: `A staged part (${c.part || "?"}) tried to reach ${host}:${c.port}`, expected: "no call off this Mac", actual: JSON.stringify({ at: c.at, part: c.part, host, port: c.port, stack: String(c.stack || "").split("\n").slice(0, 4).join(" | ") }).slice(0, 600),
      });
    }
  }
}

export default async function browserSweep(ctx) {
  const started = new Date().toISOString();
  const notes = makeNotes(ctx);
  const tally = newTally();
  let checks = 0;
  const check = (n = 1) => { checks += n; };
  const log = ctx.log;
  const only = ctx.only ? onlyScope(ctx) : null;
  if (only) log(`--only ${ctx.only}: ${only.phase} ${only.page || ""} ${only.cells.map(cellName).join(" ")} ${only.part ? `${only.part}:${only.mode}` : ""}`);
  const want = only ? [only.phase] : (envList("STRESS_BROWSER_PHASES") || (ctx.quick ? ["loads", "keyboard", "controls"] : PHASES));
  const pageFilter = only && only.page ? [only.page] : (ctx.quick ? QUICK_PAGES : envList("STRESS_BROWSER_PAGES"));
  const loadsFile = join(ctx.passDir, "browser", "loads.jsonl");
  mkdirSync(join(ctx.passDir, "browser"), { recursive: true });
  const summary = { pass: ctx.pass, quick: ctx.quick, only: ctx.only || null, base: ctx.base, startedAt: started, phases: {} };
  const pick = (pages) => (pageFilter ? pages.filter((p) => pageFilter.includes(p.key)) : pages);

  // ---- loads, keyboard, controls (the last two on `normal`, after its loads, in the same stage) ----------------
  const datasets = only && only.phase === "loads" ? [...new Set(only.cells.map((c) => c.dataset))]
    : ctx.quick ? ["normal"] : (envList("STRESS_BROWSER_DATASETS") || DATASETS);
  const needNormal = want.includes("keyboard") || want.includes("controls");
  const loadDatasets = want.includes("loads") ? datasets : [];
  const stageSets = [...new Set([...loadDatasets, ...(needNormal ? ["normal"] : [])])];
  for (const dataset of stageSets) {
    const stage = await ctx.startStage({ dataset });
    const browser = await ctx.openBrowser();
    try {
      const { pages, ids } = await pagesFor(stage);
      log(`${dataset}: stage up on ${stage.urls.home}; ${pages.length} pages; ids ${JSON.stringify(ids)}`);
      if (loadDatasets.includes(dataset)) {
        const t0 = Date.now();
        for (const theme of ctx.quick ? ["light"] : THEMES) {
          for (const [width, height] of ctx.quick ? [WIDTHS[0]] : WIDTHS) {
            const cell = { dataset, theme, width };
            if (only && !only.cells.some((c) => cellName(c) === cellName(cell))) continue;
            const tab = await openTab(browser, { stage, width, height });
            try {
              for (const page of pick(pages)) {
                if (page.narrowOnly && width >= 860) continue;
                await loadAndJudge({ tab, stage, page, cell, notes, tally, theme, loadsFile });
                check();
              }
            } finally {
              await tab.close().catch(() => {});
            }
            judgeOutside(stage, notes, { phase: "load", cell });
            log(`${cellName(cell)}: loaded (${tally.loads} loads so far)`);
          }
        }
        summary.phases[`loads-${dataset}`] = { ms: Date.now() - t0 };
      }
      if (dataset === "normal" && needNormal) {
        const cell = { dataset: "normal", theme: "light", width: 1280 };
        const tab = await openTab(browser, { stage, width: 1280, height: 900 });
        try {
          const own = pick(pages).filter((p) => !p.narrowOnly && p.expect !== "notfound");
          if (want.includes("keyboard")) {
            const t0 = Date.now();
            const kb = {};
            for (const page of own) {
              if (page.key === "shell") continue;
              kb[page.key] = await keyboardPage({ tab, stage, page, notes, cell, sample: ctx.quick ? 2 : 5 }).catch((e) => ({ error: String(e.message || e) }));
              check();
            }
            if (!only || only.page === "shell") { kb.shell = await keyboardShell({ tab, stage, notes, cell }); check(); }
            writeFileSync(join(ctx.passDir, "browser", "keyboard.json"), `${JSON.stringify(kb, null, 2)}\n`);
            summary.phases.keyboard = { ms: Date.now() - t0, pages: Object.keys(kb).length };
            judgeOutside(stage, notes, { phase: "keyboard", cell });
          }
          if (want.includes("controls")) {
            const t0 = Date.now();
            const shellDone = new Set();
            for (const page of own.filter((p) => !p.open || !ctx.quick)) {
              const noisy = loadavg()[0] > NOISY_LOAD;
              const before = tally.controlsPressed;
              await pressAll({ ctx, tab, stage, page, notes, tally, shellDone, quick: ctx.quick, cell, noisy });
              check(tally.controlsPressed - before);
              judgeOutside(stage, notes, { phase: "controls", page: page.key, cell });
              log(`controls ${page.key}: ${tally.controlsPressed} pressed, ${tally.controlsListed} listed so far`);
            }
            summary.phases.controls = { ms: Date.now() - t0 };
          }
        } finally {
          await tab.close().catch(() => {});
        }
      }
      judgeOutside(stage, notes, { phase: "load" });
    } finally {
      await browser.close().catch(() => {});
      await stage.close();
    }
    notes.flush();
  }

  // ---- faults ----------------------------------------------------------------------------------------------------
  if (want.includes("faults")) {
    const t0 = Date.now();
    const stage = await ctx.startStage({ dataset: "normal" });
    const browser = await ctx.openBrowser();
    const cells = [];
    try {
      const { pages } = await pagesFor(stage);
      const base = await baselines({ browser, stage, pages });
      const asked = envList("STRESS_BROWSER_FAULTS");
      let list = faultCells();
      if (only) list = list.filter((c) => c.part === only.part && c.mode === only.mode);
      else if (asked) list = list.filter((c) => asked.includes(`${c.part}:${c.mode}`));
      const cell = { dataset: "normal", theme: "light", width: 1280 };
      for (const { part, mode } of list) {
        const r = await runFault({ browser, stage, part, mode, pages, baseline: base, notes, tally, cell, log });
        cells.push(r);
        check();
        log(`fault ${part}:${mode}: ${Object.entries(r.pages).map(([k, v]) => `${k}${v.exceptions ? " EXC" : ""}${v.busy ? " BUSY" : ""}${v.back === false ? " NOBACK" : ""}`).join(", ")}`);
      }
      judgeOutside(stage, notes, { phase: "faults" });
    } finally {
      await browser.close().catch(() => {});
      await stage.close();
    }
    writeFileSync(join(ctx.passDir, "browser", "faults.json"), `${JSON.stringify(cells, null, 2)}\n`);
    summary.phases.faults = { ms: Date.now() - t0, cells: cells.length };
    notes.flush();
  }

  // ---- the apps' own pages ---------------------------------------------------------------------------------------
  if (want.includes("apps")) {
    const t0 = Date.now();
    const r = await appsPart({ ctx, notes, tally, log });
    summary.phases.apps = { ms: Date.now() - t0, covered: r.covered, apps: r.apps };
    check();
    notes.flush();
  }

  // ---- timing, last and alone --------------------------------------------------------------------------------------
  if (want.includes("timing")) {
    const t0 = Date.now();
    const timing = {};
    const sets = only ? [...new Set(only.cells.map((c) => c.dataset))] : ["normal", "large"];
    for (const dataset of sets) {
      const stage = await ctx.startStage({ dataset });
      const browser = await ctx.openBrowser();
      try {
        const { pages } = await pagesFor(stage);
        timing[dataset] = await timePages({ browser, stage, pages: pick(pages), rounds: 5, dataset, notes, log });
        check(Object.keys(timing[dataset]).length);
      } finally {
        await browser.close().catch(() => {});
        await stage.close();
      }
    }
    if (!only) writeFileSync(join(ctx.passDir, "timing.json"), `${JSON.stringify({ at: new Date().toISOString(), loadAverage: loadavg(), noisyAbove: NOISY_LOAD, ...timing }, null, 2)}\n`);
    summary.phases.timing = { ms: Date.now() - t0 };
    notes.flush();
  }

  const s = {
    ...summary,
    endedAt: new Date().toISOString(),
    pagesLoaded: tally.pages.size,
    loads: tally.loads,
    controlsFound: tally.controlsFound,
    controlsPressed: tally.controlsPressed,
    controlsListed: tally.controlsListed,
    exceptions: tally.exceptions,
    consoleErrors: tally.consoleErrors,
    consoleWarnings: tally.consoleWarnings,
    cspViolations: tally.cspViolations,
    failedRequests: tally.failedRequests,
    outsideRequests: tally.outsideRequests,
    dialogs: tally.dialogs,
    faultCells: tally.faultCells,
    findingsRecorded: notes.counts.recorded,
    notCovered: existsSync(join(ctx.passDir, "not-covered.txt")) ? readFileSync(join(ctx.passDir, "not-covered.txt"), "utf8").split("\n").filter((l) => l.startsWith("browser:")) : [],
  };
  // A run of one finding (--only) leaves the pass's summary alone.
  if (!only) writeFileSync(join(ctx.passDir, "browser-summary.json"), `${JSON.stringify(s, null, 2)}\n`);
  log(`summary: ${JSON.stringify({ pagesLoaded: s.pagesLoaded, loads: s.loads, controlsFound: s.controlsFound, controlsPressed: s.controlsPressed, controlsListed: s.controlsListed, exceptions: s.exceptions, consoleErrors: s.consoleErrors, cspViolations: s.cspViolations, failedRequests: s.failedRequests, outsideRequests: s.outsideRequests })}`);
  if (only) log(`--only ${ctx.only}: ${notes.counts.recorded ? "seen again" : "not seen again"}`);
  return { checks };
}
