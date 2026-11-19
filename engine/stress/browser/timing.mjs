// Timing, last and alone (PLAN-STRESS T3): 5 cold loads a page at 1280 light, on `normal` and on `large`.
// A cold load is a new tab with the cache off. First contentful paint and long tasks come from the observers put on
// every new document; the move between pages is timed in the page, from setting the address to the new page's root
// drawn with no loading state, two frames later. A run whose one-minute load average is over 4.0 is marked `noisy`
// and makes no finding.
//   timePages({ browser, stage, pages, rounds, dataset, notes, log }) -> { <page>: { fcpMs, medianFcpMs, routeChangeMs, longTasks, tbtMs, noisy } }
import { loadavg } from "node:os";
import { openTab, sleep } from "./recorder.mjs";
import { urlOf } from "./pages.mjs";

export const TARGETS = {
  normal: { fcpMs: 800, routeMs: 300 },
  large: { fcpMs: 1500, routeMs: 600 },
  loadLongTaskMs: 200,
  tbtMs: 300,
};
export const NOISY_LOAD = 4.0;

const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};

const ROUTE_CHANGE = (hash, id) => `new Promise((resolve) => {
  const t0 = performance.now();
  location.hash = ${JSON.stringify(hash)};
  const done = () => {
    const main = document.getElementById("main");
    const root = main && main.querySelector(":scope > .p-${id}");
    return !!root && !main.querySelector("[aria-busy=true], .k-loading") && !(root.children.length === 0 && !root.textContent.trim());
  };
  const tick = () => {
    if (performance.now() - t0 > 10000) return resolve(null);
    if (done()) return requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`;

export async function timePages({ browser, stage, pages, rounds = 5, dataset, notes, log }) {
  const out = {};
  const list = pages.filter((p) => p.route && p.expect === "page" && !p.open);
  for (const p of list) out[p.key] = { route: p.route, fcpMs: [], medianFcpMs: null, routeChangeMs: [], medianRouteChangeMs: null, longTasks: [], tbtMs: [], noisy: false, load: [] };
  for (let r = 0; r < rounds; r += 1) {
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      const row = out[p.key];
      const la = loadavg()[0];
      row.load.push(Math.round(la * 100) / 100);
      if (la > NOISY_LOAD) row.noisy = true;
      const tab = await openTab(browser, { stage, width: 1280, height: 900 });
      try {
        await tab.page.send("Network.setCacheDisabled", { cacheDisabled: true });
        await tab.load(urlOf(stage, p, "light"), { maxMs: 10000 });
        await sleep(300);
        const s = await tab.eval("({ paints: window.__stress.paints, longtasks: window.__stress.longtasks })").catch(() => null);
        if (s) {
          row.fcpMs.push(s.paints["first-contentful-paint"] ?? null);
          const lts = s.longtasks.map((t) => ({ start: t.start, ms: t.ms, round: r }));
          row.longTasks.push(...lts);
          row.tbtMs.push(lts.reduce((a, t) => a + Math.max(0, t.ms - 50), 0));
        }
        // The move to the next page, from this one.
        const next = list[(i + 1) % list.length];
        if (next && next.key !== p.key) {
          const ms = await tab.eval(ROUTE_CHANGE(next.hash, next.route), { awaitPromise: true, timeoutMs: 15000 }).catch(() => null);
          out[next.key].routeChangeMs.push(ms);
        }
      } finally {
        tab.window();
        await tab.close().catch(() => {});
      }
    }
    log(`timing ${dataset}: round ${r + 1} of ${rounds} done`);
  }
  const t = TARGETS[dataset] || TARGETS.normal;
  for (const [key, row] of Object.entries(out)) {
    row.medianFcpMs = median(row.fcpMs);
    row.medianRouteChangeMs = median(row.routeChangeMs);
    row.medianTbtMs = median(row.tbtMs);
    if (row.noisy || !notes) continue;
    const base = { phase: "timing", page: key, cell: { dataset, theme: "light", width: 1280 } };
    if (row.medianFcpMs === null) {
      notes.note({ ...base, area: "timing", check: "no-fcp", target: `${key}: ${dataset}`, severity: "medium", title: `${key} reported no first contentful paint (${dataset})`, expected: "a first contentful paint", actual: "none in 5 cold loads" });
    } else if (row.medianFcpMs > t.fcpMs) {
      notes.note({ ...base, area: "timing", check: "fcp", target: `${key}: ${dataset}`, severity: "medium", title: `${key} first paints in ${row.medianFcpMs} ms cold (${dataset})`, expected: `median of 5 <= ${t.fcpMs} ms`, actual: `${row.fcpMs.join(", ")} ms` });
    }
    const rc = row.routeChangeMs.filter((x) => x !== null);
    if (row.routeChangeMs.length && rc.length < row.routeChangeMs.length) {
      notes.note({ ...base, area: "timing", check: "route-hang", target: `${key}: ${dataset}`, severity: "medium", title: `Moving to ${key} did not finish drawing in 10 s (${dataset})`, expected: `<= ${t.routeMs} ms`, actual: `${row.routeChangeMs.map((x) => (x === null ? "none" : x)).join(", ")}` });
    } else if (row.medianRouteChangeMs !== null && row.medianRouteChangeMs > t.routeMs) {
      notes.note({ ...base, area: "timing", check: "route", target: `${key}: ${dataset}`, severity: "medium", title: `Moving to ${key} takes ${row.medianRouteChangeMs} ms (${dataset})`, expected: `median <= ${t.routeMs} ms`, actual: `${row.routeChangeMs.join(", ")} ms` });
    }
    const worst = row.longTasks.reduce((a, x) => Math.max(a, x.ms), 0);
    if (worst > TARGETS.loadLongTaskMs) {
      notes.note({ ...base, area: "timing", check: "load-long-task", target: `${key}: ${dataset}`, severity: "medium", title: `A ${worst} ms long task while ${key} loads (${dataset})`, expected: `none over ${TARGETS.loadLongTaskMs} ms`, actual: `${row.longTasks.filter((x) => x.ms > TARGETS.loadLongTaskMs).length} over; worst ${worst} ms` });
    }
    if (row.medianTbtMs !== null && row.medianTbtMs > TARGETS.tbtMs) {
      notes.note({ ...base, area: "timing", check: "tbt", target: `${key}: ${dataset}`, severity: "medium", title: `${key} blocks for ${row.medianTbtMs} ms while it loads (${dataset})`, expected: `total blocking time <= ${TARGETS.tbtMs} ms`, actual: `${row.tbtMs.join(", ")} ms` });
    }
  }
  return out;
}
