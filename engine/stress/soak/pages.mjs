// The soak's and the recovery's pages (PLAN-STRESS T6): a Chrome page on the staged home that keeps every
// exception, console error, error log line (CSP and network included) and failed request it sees, a walker over
// the home's 21 page addresses that never reloads, the theme switch the owner presses, forced collections with
// Performance.getMetrics, and heap snapshots summed by constructor. Built-in modules only; Chrome by lib/cdp.mjs.
import { call } from "../lib/http.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const first = (list) => (Array.isArray(list) && list.length ? list[0] : null);

// The 21 addresses of engine/home/public/routes.js ROUTES, one per page, with ids read from the staged data. Where
// the dataset has no record of a kind, a made-up id is used and the page's own "not here" answer is walked;
// `fallback: true` marks it, so the 404 that page's data call gets is not counted as an error.
export async function pageAddresses(stage) {
  const get = async (path) => {
    try {
      const r = await call(`${stage.urls.home}${path}`, { timeoutMs: 30000 });
      return r.status === 200 ? r.json : null;
    } catch {
      return null;
    }
  };
  const [tasks, jobs, team, map, apps] = await Promise.all(["/api/tasks", "/api/jobs", "/api/team", "/api/map", "/api/apps"].map(get));
  const taskId = (() => {
    for (const c of (tasks && tasks.columns) || []) { const t = first(c.tasks); if (t && t.id) return t.id; }
    return null;
  })();
  const dept = first(jobs && jobs.departments);
  const job = dept && first(dept.jobs);
  const deptId = (first(map && map.departments) || {}).id || null;
  const agent = first(team && team.agents);
  const app = first(apps && apps.apps);
  const one = (id, hash, fb) => ({ id, hash, fallback: !!fb });
  return [
    one("map", "map"),
    one("needs-you", "needs-you"),
    one("tasks", "tasks"),
    one("task", `tasks/${encodeURIComponent(taskId || "no-such-task")}`, !taskId),
    one("dashboards", "dashboards"),
    one("dashboard", "dashboards/books"),
    one("marketing", "dashboards/marketing"),
    one("studio", "dashboards/studio"),
    one("files", "files"),
    one("jobs", "jobs"),
    job && dept
      ? one("job", `jobs/${encodeURIComponent(dept.id)}/${encodeURIComponent(job.id || job.slug)}`)
      : one("job", "jobs/marketing/no-such-job", true),
    one("dept", `departments/${encodeURIComponent(deptId || "operations")}`, !deptId),
    one("team", "team"),
    one("agent", `team/${encodeURIComponent((agent && (agent.slug || agent.id)) || "chief-of-staff")}`, !agent),
    one("routines", "routines"),
    one("health", "health"),
    one("settings", "settings"),
    one("setup", "setup"),
    one("search", "search"),
    one("apps", "apps"),
    one("app", `apps/${encodeURIComponent((app && app.slug) || "no-such-app")}`, !app),
  ];
}

// watchPage(page, name) -> { errors, current(route), stop() }. errors: [{ at, page, route, kind, text, url }],
// kind one of exception | console | log | failed. A request Chrome cancelled (a page moved on) is not a failure.
export function watchPage(page, name) {
  const errors = [];
  let route = null;
  const push = (kind, text, url = null) => errors.push({ at: new Date().toISOString(), page: name, route, kind, text: String(text || "").slice(0, 400), url });
  const off = page.on((m) => {
    const p = m.params || {};
    if (m.method === "Runtime.exceptionThrown") {
      const d = p.exceptionDetails || {};
      push("exception", (d.exception && d.exception.description) || d.text, d.url);
    } else if (m.method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "assert")) {
      push("console", (p.args || []).map((a) => (a.value !== undefined ? a.value : a.description)).join(" "));
    } else if (m.method === "Log.entryAdded" && p.entry && p.entry.level === "error") {
      push(p.entry.source === "security" ? "csp" : "log", p.entry.text, p.entry.url);
    } else if (m.method === "Network.loadingFailed" && !p.canceled && p.errorText !== "net::ERR_ABORTED") {
      push("failed", p.errorText, null);
    }
  });
  return {
    errors,
    current(r) { route = r; },
    stop() { off(); },
  };
}

export async function evaluate(page, expression, { timeoutMs = 15000 } = {}) {
  let timer;
  const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("the page did not answer")), timeoutMs); });
  try {
    const r = await Promise.race([page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), t]);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result ? r.result.value : undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Keeps a page drawing and its timers running while it is not the front tab.
export async function keepAwake(page) {
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await page.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
}

// Opens a page on <home>/#/<hash> with its watcher.
export async function openOn(browser, home, hash, name) {
  const page = await browser.page();
  await keepAwake(page);
  const w = watchPage(page, name);
  w.current(hash);
  await page.send("HeapProfiler.enable").catch(() => {});
  const nav = await page.goto(`${home}/#/${hash}`);
  return { page, watch: w, nav };
}

// Moves a page to another address the way a link does (no reload).
export async function moveTo(p, hash) {
  p.watch.current(hash);
  await evaluate(p.page, `location.hash = ${JSON.stringify(`#/${hash}`)}; true`);
}

// Presses the owner's own theme switch ("Switch to light" / "Switch to dark"); -> the theme now, or null when the
// switch was not found (then the attribute is set as the switch would).
export async function switchTheme(p) {
  return evaluate(p.page, `(() => {
    const b = [...document.querySelectorAll("button,a,[role=button]")]
      .find((x) => /^Switch to (light|dark)$/.test((x.getAttribute("aria-label") || x.innerText || "").trim()));
    if (b) { b.click(); return document.documentElement.getAttribute("data-theme"); }
    const now = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", now === "light" ? "dark" : "light");
    return null;
  })()`);
}

// What the page shows now, in words (for "the page says so").
export async function pageText(p) {
  try {
    return String(await evaluate(p.page, "document.body ? document.body.innerText : ''", { timeoutMs: 5000 }) || "");
  } catch {
    return "";
  }
}

// After a forced collection: { heap, nodes, listeners, documents }.
export async function gcMetrics(p) {
  await p.page.send("HeapProfiler.collectGarbage").catch(() => {});
  const m = await p.page.metrics();
  return { heap: m.JSHeapUsedSize ?? null, nodes: m.Nodes ?? null, listeners: m.JSEventListeners ?? null, documents: m.Documents ?? null };
}

// A heap snapshot summed by constructor: { total, byName: { name: { count, size } } }. The snapshot itself is not
// kept (it can be tens of MB).
export async function heapByConstructor(p) {
  const chunks = [];
  const off = p.page.on((m) => { if (m.method === "HeapProfiler.addHeapSnapshotChunk") chunks.push(m.params.chunk); });
  try {
    await p.page.send("HeapProfiler.collectGarbage").catch(() => {});
    await p.page.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: false });
  } finally {
    off();
  }
  const snap = JSON.parse(chunks.join(""));
  const meta = snap.snapshot.meta;
  const fields = meta.node_fields;
  const width = fields.length;
  const iType = fields.indexOf("type");
  const iName = fields.indexOf("name");
  const iSize = fields.indexOf("self_size");
  const types = meta.node_types[iType];
  const byName = {};
  let total = 0;
  const nodes = snap.nodes;
  for (let i = 0; i < nodes.length; i += width) {
    const type = types[nodes[i + iType]];
    // JavaScript's own objects (DOM wrappers included); Blink's internal "native" nodes are left out.
    if (type !== "object" && type !== "closure" && type !== "array") continue;
    const name = type === "closure" ? "(closure)" : type === "array" ? "(array)" : snap.strings[nodes[i + iName]];
    const size = nodes[i + iSize];
    const e = byName[name] || (byName[name] = { count: 0, size: 0 });
    e.count += 1;
    e.size += size;
    total += size;
  }
  return { total, byName };
}

// The top `n` constructors that grew from snapshot a to b, by size: [{ name, countFrom, countTo, sizeFrom, sizeTo }].
export function growing(a, b, n = 3) {
  const names = new Set([...Object.keys(a.byName), ...Object.keys(b.byName)]);
  const rows = [];
  for (const name of names) {
    const x = a.byName[name] || { count: 0, size: 0 };
    const y = b.byName[name] || { count: 0, size: 0 };
    if (y.size > x.size) rows.push({ name, countFrom: x.count, countTo: y.count, sizeFrom: x.size, sizeTo: y.size, grew: y.size - x.size });
  }
  return rows.sort((p, q) => q.grew - p.grew).slice(0, n);
}

export { sleep };
