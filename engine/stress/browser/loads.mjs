// One page load, judged (PLAN-STRESS T3): the load record and the observations it makes.
//   loadAndJudge({ tab, stage, page, cell, notes, tally, theme, log }) -> { snap, win, ms }
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { norm } from "./notes.mjs";
import { drawnContrast, sleep } from "./recorder.mjs";
import { MISSING, urlOf } from "./pages.mjs";

export const newTally = () => ({
  loads: 0, pages: new Set(), exceptions: 0, consoleErrors: 0, consoleWarnings: 0, cspViolations: 0, failedRequests: 0,
  outsideRequests: 0, dialogs: 0, controlsFound: 0, controlsPressed: 0, controlsListed: 0, faultCells: 0,
});

const pathOf = (url) => {
  try { const u = new URL(url); return `${u.pathname}`; } catch { return String(url).slice(0, 120); }
};

// What one window of events says, as observations. `planted` says faults are planted, so failed requests to the
// faulty part are expected and are not findings. Returns the counts it added.
export function judgeWindow({ win, snap, page, cell, notes, tally, phase, planted = false, area = "page", owner = false }) {
  const key = page.key;
  const base = { phase, page: key, cell };
  for (const e of win.exceptions) {
    tally.exceptions += 1;
    notes.note({ ...base, area, check: "exception", target: `${key}: ${norm(e)}`, severity: "high", title: `An uncaught exception on ${key}`, expected: "no uncaught exception", actual: e.slice(0, 400) });
  }
  // While a fault is planted only exceptions, CSP, outside calls and dialogs count: a failed load logs by itself.
  for (const e of planted ? [] : win.console) {
    tally.consoleErrors += 1;
    notes.note({ ...base, area, check: "console-error", target: `${key}: ${norm(e)}`, severity: "medium", title: `A console error on ${key}`, expected: "no console error", actual: e.slice(0, 400) });
  }
  for (const e of planted ? [] : win.warnings) {
    tally.consoleWarnings += 1;
    notes.note({ ...base, area, check: "console-warning", target: `${key}: ${norm(e)}`, severity: "low", title: `A console warning on ${key}`, expected: "no console warning", actual: e.slice(0, 400) });
  }
  const csp = [...win.csp, ...((snap && snap.csp) || []).map((c) => `${c.directive} ${c.blocked} ${c.source}:${c.line}`)];
  for (const c of csp) {
    tally.cspViolations += 1;
    notes.note({ ...base, area, check: "csp", target: `${key}: ${norm(c, 70)}`, severity: "medium", title: `A content-security-policy violation on ${key}`, expected: "no CSP violation", actual: c.slice(0, 400) });
  }
  if (!planted) {
    for (const f of win.failed) {
      // A page opened on an id the dataset lacks (`empty`) is asked to show "not there": its own 404 is the answer.
      if (page.missingId && f.status === 404 && String(f.url).includes(MISSING)) continue;
      tally.failedRequests += 1;
      const what = f.status ? String(f.status) : f.error || "failed";
      notes.note({ ...base, area, check: "failed-request", target: `${key}: ${f.method || "GET"} ${norm(pathOf(f.url), 70)} ${what}`, severity: f.status >= 500 ? "high" : "medium", title: `A request that failed on ${key}`, expected: "every request answers below 400", actual: `${f.method || "GET"} ${pathOf(f.url)} -> ${what}` });
    }
  }
  for (const { url: u, type } of win.outside) {
    // The owner's own press may take the whole tab to a site off this Mac (a sign-in page): that is the owner's
    // browser going where it was sent, not the stage calling out. Anything else the page asks for is.
    if (owner && type === "Document") continue;
    tally.outsideRequests += 1;
    let host = u;
    try { host = new URL(u).host; } catch { /* as is */ }
    notes.note({ ...base, area: "outside", check: "browser-request", target: host, severity: "critical", title: `The page asked for an address off this Mac (${host})`, expected: "every request goes to the stage", actual: `${key}: ${u}` });
  }
  for (const d of win.dialogs) {
    tally.dialogs += 1;
    notes.note({ ...base, area: "safety", check: "dialog", target: `${key}: ${d.type}`, severity: "critical", title: `A native ${d.type} dialog opened on ${key}`, expected: "no dialog (planted text never runs)", actual: d.message });
  }
  if (snap && snap.planted > 0) {
    notes.note({ ...base, area: "safety", check: "planted-markup", target: key, severity: "critical", title: `Planted text became markup on ${key}`, expected: "titles are shown as text", actual: `${snap.planted} element(s) made from planted text` });
  }
}

// Loads `page` in `tab` and judges the load. The record goes to OUT/pass-<n>/browser/loads.jsonl.
export async function loadAndJudge({ tab, stage, page, cell, notes, tally, theme, loadsFile, phase = "load" }) {
  const url = urlOf(stage, page, theme);
  const t0 = Date.now();
  const nav = await tab.load(url, { maxMs: 10000 });
  // A spinner gets five more seconds before it counts.
  let snap = await tab.snapshot().catch((e) => ({ error: String(e.message || e) }));
  for (let i = 0; i < 10 && snap && snap.busy > 0; i += 1) {
    await sleep(500);
    snap = await tab.snapshot().catch(() => snap);
  }
  if (page.open) {
    await sleep(400);
    snap = await tab.snapshot().catch(() => snap);
    snap.overlay = await tab.eval(`[...document.querySelectorAll("[role=dialog]")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length`).catch(() => 0);
  }
  // A faint candidate counts only if the picture of it agrees (a wash hit-testing cannot see may be behind it).
  if (snap && Array.isArray(snap.faint) && snap.faint.length) {
    const kept = [];
    for (const f of snap.faint) {
      const d = await drawnContrast(tab, f);
      if (d && d.ratio < 3) kept.push({ ...f, ratio: d.ratio, drawnBg: d.bg });
    }
    snap.faint = kept;
  }
  const win = tab.window();
  const ms = Date.now() - t0;
  tally.loads += 1;
  tally.pages.add(page.key);
  const key = page.key;
  const base = { phase, page: key, cell };
  judgeWindow({ win, snap, page, cell, notes, tally, phase });
  if (nav.errorText) {
    notes.note({ ...base, area: "page", check: "no-load", target: key, severity: "high", title: `${key} did not load`, expected: "the page loads", actual: nav.errorText });
  } else if (snap && snap.error) {
    notes.note({ ...base, area: "page", check: "no-answer", target: key, severity: "high", title: `${key} did not answer after loading`, expected: "the page answers", actual: snap.error });
  } else if (snap) {
    const mainEmpty = !snap.text || snap.text.trim().length < 3;
    if (!snap.shell || (mainEmpty && page.route !== "map" && page.route !== "app")) {
      notes.note({ ...base, area: "page", check: "blank", target: key, severity: "high", title: `${key} is blank`, expected: "the shell and the page draw", actual: snap.shell ? "the shell drew but the page is empty" : "no shell" });
    }
    if (page.expect === "page") {
      if (snap.notFound && !page.missingId) notes.note({ ...base, area: "page", check: "not-found", target: key, severity: "high", title: `${key} says there is no page here`, expected: "the page draws", actual: `hash ${snap.hash}` });
      if (snap.building) notes.note({ ...base, area: "page", check: "being-built", target: key, severity: "high", title: `${key} says it is being built`, expected: "the page draws", actual: `hash ${snap.hash}` });
    } else if (page.expect === "notfound") {
      if (!snap.notFound) notes.note({ ...base, area: "page", check: "nomatch", target: key, severity: "medium", title: "An address that matches nothing does not say so", expected: "\"There is no page here\"", actual: (snap.h1 || snap.text.slice(0, 80)) });
    } else if (page.expect.startsWith("redirect:")) {
      const want = page.expect.slice(9);
      if (snap.hash !== want) notes.note({ ...base, area: "page", check: "redirect", target: key, severity: "high", title: `${page.hash || "the bare address"} does not move to ${want}`, expected: want, actual: snap.hash || "(no hash)" });
    }
    if (page.open && !page.narrowOnly && !(page.wideOnly && cell.width < 860) && !snap.overlay) {
      notes.note({ ...base, area: "page", check: "overlay", target: key, severity: "high", title: `"?open=${page.open}" did not open its panel`, expected: "the panel is open", actual: "no dialog on screen" });
    }
    if (snap.scrollWidth > snap.innerWidth + 1) {
      notes.note({ ...base, area: "page", check: "sideways-scroll", target: `${key}: ${cell.width}`, severity: "medium", title: `${key} scrolls sideways at ${cell.width} px`, expected: `page width <= ${snap.innerWidth}`, actual: `scroll width ${snap.scrollWidth}; ${snap.wide.join(", ")}` });
    }
    for (const c of snap.clipped || []) {
      notes.note({ ...base, area: "page", check: "clipped-text", target: `${key}: ${c.tag}.${norm(c.cls, 40)}`, severity: "medium", title: `Text cut off on ${key} with no way to read it`, expected: "the whole text can be read (shown, a title, or a link to it)", actual: `${c.tag}.${c.cls}: "${c.text}"` });
    }
    for (const f of snap.faint || []) {
      notes.note({ ...base, area: "page", check: "faint-text", target: `${key}: ${cell.theme} ${f.tag}.${norm(f.cls, 40)}`, severity: "medium", title: `Text too faint to read on ${key} (${cell.theme})`, expected: "contrast 3:1 or more", actual: `${f.tag}.${f.cls} "${f.text}" ${f.ratio}:1` });
    }
    if (snap.busy > 0) {
      notes.note({ ...base, area: "page", check: "spinner-left", target: key, severity: "medium", title: `${key} still shows a loading state after settling`, expected: "no loading state 5 s after the page settled", actual: `${snap.busy} loading element(s)` });
    }
  }
  if (loadsFile) {
    mkdirSync(dirname(loadsFile), { recursive: true });
    appendFileSync(loadsFile, `${JSON.stringify({
      at: new Date().toISOString(), phase, page: key, hash: page.hash, cell, ms,
      fcpMs: snap && snap.paints ? snap.paints["first-contentful-paint"] ?? null : null,
      longTasks: snap && snap.longtasks ? snap.longtasks : [], exceptions: win.exceptions.length, console: win.console.length,
      failed: win.failed.length, requests: win.requests.length, nodes: snap ? snap.nodes : null,
    })}\n`);
  }
  return { snap, win, ms };
}
