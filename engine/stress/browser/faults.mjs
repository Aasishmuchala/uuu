// A part off, slow or broken, seen in the browser (PLAN-STRESS T3). For each part and each fault mode, Map, Needs you,
// Tasks, Health, Settings, Setup, Jobs and the page that owns the part are opened at once (1280, light, `normal`).
// Pass means: the shell draws, nothing throws, no loading state is left 15 s after the load, and on the part's own
// page and on Health a plain sentence that was not there before says the part is off or not answering. Then the part
// is brought back (stage.setFault(part, null), the home server untouched) and within 10 s each page, opened again,
// draws with no exception and with no such sentence left over.
//   faultCells(quick) -> [{ part, mode }]
//   runFault({ browser, stage, part, mode, pages, baseline, notes, tally, cell, log }) -> result
import { norm } from "./notes.mjs";
import { judgeWindow } from "./loads.mjs";
import { openTab, sleep } from "./recorder.mjs";
import { FAULT_PAGES, OWNER_PAGE, urlOf } from "./pages.mjs";

export const FAULT_PARTS = ["board", "books", "gate", "relay", "web", "generate", "viewer", "apps", "brain"];
export const FAULT_MODES = ["off", "slow3", "500", "badjson", "cut", "wrongshape", "html", "reset"];
export const SAYS_FAULT = /(not answering|switched off|turned off|cannot be (shown|reached|loaded|read)|can't be (shown|reached|loaded)|not available|unavailable|\bis off\b|\bare off\b|not running|\bis down\b|not connected|could not be (loaded|reached|read)|did not answer|cannot reach|could not reach|is not on\b|not reachable|unreachable|offline|is not working|not responding|went wrong|no answer)/i;

export function faultCells() {
  const out = [];
  for (const part of FAULT_PARTS) {
    for (const mode of FAULT_MODES) out.push({ part, mode });
    if (part === "board" || part === "books") out.push({ part, mode: "slow30" });
  }
  return out;
}

const sentences = (text) => String(text || "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

// The fault sentences on a page that its healthy look did not have.
export function newFaultSentences(text, baselineText) {
  const before = new Set(sentences(baselineText));
  return sentences(text).filter((s) => !before.has(s) && SAYS_FAULT.test(s));
}

export function faultPagesFor(part, pages) {
  const keys = [...new Set([...FAULT_PAGES, OWNER_PAGE[part]])];
  return keys.map((k) => pages.find((p) => p.key === k)).filter(Boolean);
}

// The healthy look of every page any fault cell opens: { key: text }.
export async function baselines({ browser, stage, pages }) {
  const keys = new Set(FAULT_PAGES);
  for (const k of Object.values(OWNER_PAGE)) keys.add(k);
  const tab = await openTab(browser, { stage, width: 1280, height: 900 });
  const out = {};
  try {
    for (const k of keys) {
      const p = pages.find((x) => x.key === k);
      if (!p) continue;
      await tab.load(urlOf(stage, p, "light"), { maxMs: 8000 });
      await sleep(500);
      const s = await tab.snapshot().catch(() => null);
      out[k] = s ? s.bodyText : "";
      tab.window();
    }
  } finally {
    await tab.close().catch(() => {});
  }
  return out;
}

export async function runFault({ browser, stage, part, mode, pages, baseline, notes, tally, cell, log }) {
  const target = `${part}:${mode}`;
  const base = { phase: "faults", cell, extra: { part, mode } };
  const list = faultPagesFor(part, pages);
  const result = { part, mode, pages: {} };
  const homePid = (stage.pids.home || {}).pid;
  try {
    await stage.setFault(part, mode);
  } catch (e) {
    notes.note({ ...base, page: part, area: "faults", check: "harness", target, severity: "low", title: `The stage could not plant ${mode} on ${part}`, expected: "the fault server starts", actual: String(e.message || e).slice(0, 300) });
    return result;
  }
  tally.faultCells += 1;
  const tabs = [];
  try {
    for (const p of list) tabs.push({ p, tab: await openTab(browser, { stage, width: 1280, height: 900 }) });
    const loadedAt = Date.now();
    await Promise.all(tabs.map(({ p, tab }) => tab.load(urlOf(stage, p, "light"), { settle: false }).catch(() => {})));
    // 15 s from the load, then look.
    await sleep(Math.max(0, 15000 - (Date.now() - loadedAt)));
    for (const { p, tab } of tabs) {
      const snap = await tab.snapshot().catch((e) => ({ error: String(e.message || e) }));
      const win = tab.window();
      const r = { exceptions: win.exceptions.length, busy: snap.busy || 0, shell: !!snap.shell, said: [] };
      result.pages[p.key] = r;
      const pg = { key: `${p.key} (${target})` };
      judgeWindow({ win, snap, page: pg, cell, notes, tally, phase: "faults", planted: true, area: "faults" });
      if (snap.error || !snap.shell) {
        notes.note({ ...base, page: p.key, area: "faults", check: "blank", target: `${p.key}: ${target}`, severity: "high", title: `${p.key} does not draw while ${part} is ${mode}`, expected: "the shell draws", actual: snap.error || "no shell" });
        continue;
      }
      if (r.busy > 0) {
        notes.note({ ...base, page: p.key, area: "faults", check: "spinner", target: `${p.key}: ${target}`, severity: "medium", title: `${p.key} is still loading 15 s after it opened while ${part} is ${mode}`, expected: "no loading state left after 15 s", actual: `${r.busy} loading element(s)` });
      }
      r.said = newFaultSentences(snap.bodyText, baseline[p.key]);
      // slow3 answers after 3 s, so by 15 s the page has its answer and needs to say nothing.
      const mustSay = mode !== "slow3" && (p.key === OWNER_PAGE[part] || p.key === "health");
      if (mustSay && !r.said.length && !SAYS_FAULT.test(snap.bodyText) ) {
        notes.note({ ...base, page: p.key, area: "faults", check: "no-sentence", target: `${p.key}: ${target}`, severity: "medium", title: `${p.key} does not say ${part} is off or not answering (${mode})`, expected: "a plain sentence that the part is off or not answering", actual: norm(snap.text, 200) });
      }
    }
    // Bring it back; the home server is not touched. From the moment the part answers again, each page has 10 s
    // (all at once) to draw as it did before: opened again, no exception, no loading left, no fault sentence left.
    await stage.setFault(part, null);
    const backAt = Date.now();
    await Promise.all(tabs.map(async ({ p, tab }) => {
      let ok = false;
      let last = null;
      do {
        await tab.load(urlOf(stage, p, "light"), { maxMs: 4000 });
        let snap = await tab.snapshot().catch(() => null);
        while (snap && snap.busy > 0 && Date.now() - backAt < 10000) {
          await sleep(300);
          snap = await tab.snapshot().catch(() => snap);
        }
        const win = tab.window();
        const left = snap ? newFaultSentences(snap.bodyText, baseline[p.key]) : ["the page did not answer"];
        last = { exceptions: win.exceptions, busy: snap ? snap.busy : -1, left };
        ok = !!snap && snap.shell && !win.exceptions.length && !snap.busy && !left.length;
        if (!ok) await sleep(500);
      } while (!ok && Date.now() - backAt < 10000);
      if (result.pages[p.key]) result.pages[p.key].back = ok;
      if (!ok) {
        notes.note({ ...base, page: p.key, area: "faults", check: "no-recovery", target: `${p.key}: ${target}`, severity: "high", title: `${p.key} does not work again within 10 s after ${part} comes back from ${mode}`, expected: "the page draws as before, the home server untouched", actual: `${last.exceptions.length} exception(s) ${last.exceptions.slice(0, 1).join("")}, ${last.busy} loading, still says: ${last.left.slice(0, 2).join(" / ")}` });
      }
    }));
    const nowPid = (stage.pids.home || {}).pid;
    if (!(await stage.healthy("home"))) {
      notes.note({ ...base, page: "home", area: "faults", check: "home-down", target: `home: ${target}`, severity: "critical", title: `The home server stopped answering after ${part} was ${mode}`, expected: "the home answers throughout", actual: "no answer on /healthz" });
    } else if (homePid && nowPid !== homePid) {
      notes.note({ ...base, page: "home", area: "faults", check: "home-restarted", target: `home: ${target}`, severity: "high", title: `The home server did not last through ${part} being ${mode}`, expected: "the same home process throughout", actual: `pid ${homePid} -> ${nowPid || "none"}` });
    }
  } finally {
    for (const { tab } of tabs) await tab.close().catch(() => {});
    // Whatever happened, the real part is back.
    if (stage.faults && stage.faults[part]) await stage.setFault(part, null).catch((e) => log(`could not bring ${part} back: ${e.message}`));
  }
  return result;
}
