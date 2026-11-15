// The map's pure helpers (CONTRACTS-V3 29), on the pinned `map`, `ask` and `home` shapes: the words a hub, a dot and
// the brain get for a screen reader; which marks a dot shows; the count line for 0, 1 and several; the list
// twin's order against the layout's; the address; the ask routes' refusals. The page and both map modules load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const shape = (name) => JSON.parse(readFileSync(resolve(SHAPES, `${name}.json`), "utf8"));

const page = await import("../../pages/map.js");
const view = await import("../../map/map-view.js");
const list = await import("../../map/map-list.js");
const layout = await import("../../map/layout.js");

const map = shape("map");
const ask = shape("ask");
const home = shape("home");
const sales = map.departments[0];
const job = sales.clusters[0].jobs[0];

// A fuller map: seven departments, clusters with several jobs, some not ready, some at work.
function fullMap() {
  const ids = ["operations", "sales", "marketing", "studio", "support", "people", "books"];
  return {
    ...map,
    departments: ids.map((id, i) => ({
      ...sales,
      id,
      title: id[0].toUpperCase() + id.slice(1),
      counts: { jobs: i, ready: i, working: i % 2, needsYou: i % 3 },
      clusters: Array.from({ length: 1 + (i % 3) }, (_, c) => ({
        id: `c${c}`,
        title: `Cluster ${c}`,
        jobs: Array.from({ length: i + c }, (_, k) => ({ ...job, id: `${id}/job-${c}-${k}`, title: `A job called number ${c} ${k}`, ready: k % 3 !== 0 })),
      })),
    })),
  };
}

test("map: the page and both map modules load and export their parts", () => {
  assert.equal(typeof page.default, "function");
  for (const name of ["Overview", "CountLine"]) assert.equal(typeof view[name], "function", name);
  for (const name of ["MapList", "DepartmentSection", "DepartmentRows"]) assert.equal(typeof list[name], "function", name);
  // The zoomed drawing and the crown are gone: a department is chosen in place and its facts are in the rail (T63).
  for (const name of ["DepartmentView", "Crown", "TITLE_CHAR", "pillX", "departmentFrame", "hubOrigin"]) assert.equal(view[name], undefined, name);
});
test("map: the count line's words for none, one and several", () => {
  assert.equal(view.countLine({ jobs: 0 }), "No jobs yet");
  assert.equal(view.countLine({ jobs: 1 }), "1 job");
  assert.equal(view.countLine({ jobs: 9 }), "9 jobs");
  assert.equal(view.countLine(sales.counts), "9 jobs · 1 working · 2 need you");
  assert.equal(view.countLine({ jobs: 5, working: 0, needsYou: 1 }), "5 jobs · 1 needs you");
  assert.equal(view.countLine(null), "No jobs yet");
  assert.equal(view.countLine({ jobs: -3, working: "x" }), "No jobs yet");
  assert.deepEqual(view.countParts(sales.counts).map((p) => p.kind), ["jobs", "working", "needs"]);
});

test("map: the words a hub gets for a screen reader", () => {
  assert.equal(view.hubLabel(sales), "Sales, 9 jobs, 1 working, 2 need you");
  assert.equal(view.hubLabel({ ...sales, counts: { jobs: 9, working: 0, needsYou: 2 } }), "Sales, 9 jobs, 2 need you");
  assert.equal(view.hubLabel({ title: "People", counts: { jobs: 0 } }), "People, no jobs yet");
});

test("map: the brain's line and its words for a screen reader", () => {
  assert.equal(view.brainLine({ ...map.brain, asking: null }), "12 files · 4 of 9 basics filled");
  // The count stays while a question is open (M18-06): the ring and the chip say a question is being read.
  assert.equal(view.brainLine(map.brain), "12 files · 4 of 9 basics filled");
  assert.equal(view.brainLine({ files: 1, basics: { filled: 0, total: 9 } }), "1 file · 0 of 9 basics filled");
  assert.equal(view.brainLabel({ ...map.brain, asking: null }), "Company brain, 12 files, 4 of 9 basics filled");
  assert.equal(view.brainLabel(map.brain), "Company brain, 12 files, 4 of 9 basics filled, reading your files");
  assert.equal(view.brainLine(null), "");
});

test("map: the list twin's order equals the layout's order", () => {
  for (const data of [map, fullMap()]) {
    const dots = layout.layoutOverview(view.overviewInput(data)).dots.map((d) => d.id);
    assert.deepEqual(list.listOrder(data), dots);
    assert.equal(dots.length, new Set(dots).size);
  }
  assert.deepEqual(list.listOrder(map), ["sales/call-write-up"]);
});

test("map: the overview holds at most 16 dots a hub, and the seven fallback hubs while loading", () => {
  const many = { ...map, departments: [{ ...sales, clusters: [{ id: "calls", title: "Calls", jobs: Array.from({ length: 30 }, (_, k) => ({ ...job, id: `sales/j-${k}` })) }] }] };
  assert.equal(layout.layoutOverview(view.overviewInput(many)).dots.length, 16);
  assert.equal(list.listOrder(many).length, 16);
  assert.deepEqual(view.departmentsOf(null).map((d) => d.id), ["operations", "sales", "marketing", "studio", "support", "people", "books"]);
  const odd = { departments: [{ id: "../x", title: "Bad" }, { ...sales, clusters: [{ id: "calls", jobs: [{ id: "javascript:alert(1)" }, job] }] }] };
  assert.deepEqual(list.listOrder(odd), ["sales/call-write-up"]);
});

test("map: the address of each state, and reading it back", () => {
  const route = (parts, qs = "") => ({ id: "map", parts, query: new URLSearchParams(qs) });
  assert.deepEqual(page.readAddress(route(["map"])), { dept: null, view: "map", ask: null, bad: false });
  assert.deepEqual(page.readAddress(route(["map", "sales"], "view=list&ask=e0000000-0000-4000-8000-000000000019")),
    { dept: "sales", view: "list", ask: "e0000000-0000-4000-8000-000000000019", bad: false });
  assert.equal(page.readAddress(route(["map", "Not a dept!"])).bad, true);
  assert.equal(page.readAddress(route(["map"], "ask=<script>")).ask, null);
  assert.equal(page.mapHref({}), "#/map");
  assert.equal(page.mapHref({ dept: "sales" }), "#/map/sales");
  assert.equal(page.mapHref({ view: "list", ask: ask.id }), `#/map?view=list&ask=${ask.id}`);
  assert.equal(page.mapHref({ dept: "../x", ask: "a b" }), "#/map");
  assert.equal(page.titleFor("sales", map), "Sales on the map");
  assert.equal(page.titleFor(null, map), "Map");
});

test("map: the ask routes' refusals become plain sentences", () => {
  assert.equal(page.askProblem(null), null);
  assert.equal(page.askProblem({ status: 404, code: "not_found", message: "There is nothing here." }).kind, "not-ready");
  assert.equal(page.askProblem({ status: 404, code: "not_found" }).message, page.ASK_NOT_READY.message);
  assert.equal(page.askProblem({ status: 404, code: "ask_not_found" }).message, "That question was not found.");
  const other = page.askProblem({ status: 502, code: "offline", message: "The engine is not answering.", next: "Run: engine start" });
  assert.deepEqual(other, { kind: "error", message: "The engine is not answering.", next: "Run: engine start" });
  for (const p of [page.ASK_NOT_READY, page.ASK_NOT_FOUND]) assert.doesNotMatch(`${p.message} ${p.next}`, /\b(404|api|route|ask_)\b/i);
});

test("map: the error and the words around it are plain (M50 F16, M18-C2)", () => {
  assert.match(page.MAP_ERROR, /^The map could not be read\./);
  assert.doesNotMatch(page.MAP_ERROR, /board|Retry|api|\d{3}/i);
  const src = readFileSync(new URL("../../pages/map.js", import.meta.url), "utf8");
  assert.match(src, />Back to the map</);
  assert.doesNotMatch(src, />All departments</);
  // A map that could not be read shows the error on the stage in place of the cards, never a drawing of nothing.
  assert.match(src, /failed \? html`<div class="p-map__stage-error">/);
});
test("map: keyboard and screen-reader fixes (M52 K4, K9; T63): the chosen card says so, Esc gives focus back to it; count links say whose", () => {
  const src = readFileSync(new URL("../../pages/map.js", import.meta.url), "utf8");
  // Back from a department (Esc, the shell's map-back), focus returns to the card that was chosen.
  assert.match(src, /\.p-map__node\[data-node="\$\{id\}"\]/);
  const viewSrc = readFileSync(new URL("../../map/map-view.js", import.meta.url), "utf8");
  assert.match(viewSrc, /aria-current=\$\{on \? "true" : undefined\}/);
  assert.match(viewSrc, /aria-label=\$\{title \? `\$\{title\}: \$\{p\.text\}`/);
  const listSrc = readFileSync(new URL("../../map/map-list.js", import.meta.url), "utf8");
  assert.match(listSrc, />Open \$\{clip\(dept\.title, 40\)\}</, "\"Open\" says what it opens");
  assert.doesNotMatch(listSrc, />Open</);
});
test("map: an open question is read every 5 seconds until it is answered", () => {
  // M63: the hint and the chip never promise a time when other work is ahead (the server's count only).
  assert.equal(page.askHint({ queue: null }), "Enter to send. A real agent reads your files, so an answer takes a minute or two.");
  assert.equal(page.askHint({ queue: { ahead: 0 } }), "Enter to send. A real agent reads your files, so an answer takes a minute or two.");
  assert.equal(page.askHint(null), "Enter to send. A real agent reads your files, so an answer takes a minute or two.");
  assert.equal(page.askHint({ queue: { ahead: 1 } }), "Enter to send. 1 task is ahead, so it waits its turn.");
  assert.equal(page.askHint({ queue: { ahead: 4 } }), "Enter to send. 4 tasks are ahead, so it waits its turn.");
  assert.equal(page.askingChip({ id: "e1", queue: { ahead: 2 } }), "Waiting its turn");
  assert.equal(page.askingChip({ id: "e1", queue: null }), "Reading your files");
  assert.equal(page.askEvery(null), 5000);
  assert.equal(page.askEvery({ ...ask, state: "reading" }), 5000);
  for (const state of ["answered", "became_task", "needs_you", "stopped"]) assert.equal(page.askEvery({ ...ask, state }), 0);
});

test("map: the real catalogue lays out with every job once, in the list's order", { skip: !existsSync(resolve(SHAPES, "../../../../company/jobs")) && "no catalogue" }, () => {
  const root = resolve(SHAPES, "../../../../company");
  const departments = JSON.parse(readFileSync(join(root, "departments.json"), "utf8")).departments.map((d) => ({
    id: d.id,
    title: d.title,
    clusters: d.clusters.map((c) => ({ id: c.id, title: c.title, jobs: [] })),
  }));
  for (const d of departments) {
    const dir = join(root, "jobs", d.id);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const c = d.clusters.find((x) => x.id === j.cluster);
      if (c) c.jobs.push({ id: `${d.id}/${j.id}`, title: j.title, handoff: j.handoff, ready: true });
    }
  }
  const data = { departments };
  assert.deepEqual(list.listOrder(data), layout.layoutOverview(view.overviewInput(data)).dots.map((d) => d.id));
  assert.equal(layout.layoutNodes({ ids: departments.map((d) => d.id), width: 856, height: 640 }).fits, departments.length <= 8);
});


// ---- T63: the map as a stage page ----

const homeFull = {
  needsYou: {
    total: 4,
    items: [
      { id: "a", kind: "result", title: "Finished: a sprite", department: "studio", when: "2026-11-11T09:00:00.000Z", link: { page: "tasks", id: "STH-8" } },
      { id: "b", kind: "approval", title: "Plan ready", department: "operations", when: "2026-11-11T10:00:00.000Z" },
      { id: "c", kind: "problem", title: "Builder run failed", department: "operations", severity: "high", when: "2026-11-10T10:00:00.000Z", agent: { slug: "builder", name: "Builder" } },
      { id: "d", kind: "draft", title: "New post", department: "marketing", when: "2026-11-11T08:00:00.000Z" },
    ],
  },
  running: [
    { taskId: "t1", identifier: "STH-1", title: "Write the price list", who: { slug: "builder", name: "Builder" }, live: true },
    { taskId: "t2", identifier: "STH-15", title: "Captions", who: { slug: "marketer", name: "Marketer" }, live: true },
    { taskId: "t3", title: "No one", who: null },
  ],
};
const ops = { id: "operations", title: "Operations", agents: [{ slug: "chief-of-staff", name: "Chief of staff" }, { slug: "builder", name: "Builder" }, { slug: "../x", name: "Bad" }], counts: { jobs: 8, ready: 8, working: 1, needsYou: 7 } };

test("map: the page's own words are pinned (T63)", () => {
  assert.deepEqual({ ...page.MAP_WORDS }, {
    company: "The whole company", department: "Department", stage: "Company map", needsYou: "Needs you", working: "Working now",
    results: "Newest results", agents: "Agents", doing: "Being worked on", openQueue: "Open the queue", openDept: "Open the department",
    seeJobs: "See its jobs", question: "Your question", showAs: "Show the map as", noNeeds: "Nothing needs you right now.",
    noNeedsHere: "Nothing here needs you right now.", noWorking: "Nobody is working on anything right now.", noResults: "No new results.",
    noAgents: "No agents yet.",
  });
  assert.ok(Object.isFrozen(page.MAP_WORDS));
  for (const w of Object.values(page.MAP_WORDS)) assert.doesNotMatch(w, /\u2014/, "no em dash");
});

test("map: a card's words after its dot, and the dot's tone (T63)", () => {
  assert.equal(view.nodeLine(sales.counts), "1 working, 2 need you");
  assert.equal(view.nodeLine({ jobs: 5, working: 0, needsYou: 1 }), "1 needs you");
  assert.equal(view.nodeLine({ jobs: 9, working: 1 }), "1 working");
  assert.equal(view.nodeLine({ jobs: 9 }), "Nothing running");
  assert.equal(view.nodeLine(null), "Nothing running");
  assert.equal(view.nodeTone({ working: 1, needsYou: 2 }), "warn");
  assert.equal(view.nodeTone({ working: 1 }), "live");
  assert.equal(view.nodeTone({ jobs: 3 }), "wait");
  assert.equal(view.nodeTone(null), "wait");
});

test("map: the jobs line, the brain's meter and each team's line icon (T63)", () => {
  assert.equal(view.jobsLine(sales.counts), "9 jobs, 7 ready to start");
  assert.equal(view.jobsLine({ jobs: 1, ready: 1 }), "1 job, 1 ready to start");
  assert.equal(view.jobsLine({ jobs: 2, ready: 9 }), "2 jobs, 2 ready to start");
  assert.equal(view.jobsLine({ jobs: 0 }), "No jobs yet");
  assert.equal(view.basicsShare(map.brain), 44);
  assert.equal(view.basicsShare({ basics: { filled: 12, total: 9 } }), 100);
  assert.equal(view.basicsShare(null), 0);
  assert.deepEqual(["brain", "operations", "sales", "marketing", "studio", "support", "people", "books"].map(view.iconOf),
    ["brain", "layers", "trend", "horn", "film", "buoy", "team", "book"]);
  assert.equal(view.iconOf("unknown"), "layers");
});

test("map: the line over the stage and the whole company's counts (T63)", () => {
  assert.equal(page.stageLine(fullMap()), "7 departments, 21 jobs");
  assert.equal(page.stageLine(map), "1 department, 9 jobs");
  assert.equal(page.stageLine(null), "");
  assert.deepEqual(page.companyCounts(map), { working: 2, needsYou: 5 });
  assert.deepEqual(page.companyCounts(null), { working: 0, needsYou: 0 });
  assert.equal(view.nodeLine(page.companyCounts(map)), "2 working, 5 need you");
});

test("map: what needs the owner, in the rail: urgent then newest, results apart, one department's share (T63)", () => {
  const all = page.needsOf(homeFull);
  assert.deepEqual(all.map((i) => i.id), ["c", "b", "a", "d"]);
  assert.deepEqual(page.asksOf(all).map((i) => i.id), ["c", "b", "d"]);
  assert.deepEqual(page.resultsOf(all).map((i) => i.id), ["a"]);
  assert.deepEqual(page.needsOf(homeFull, "operations", [ops]).map((i) => i.id), ["c", "b"]);
  assert.deepEqual(page.needsOf(null), []);
  assert.deepEqual(page.needsOf(home).map((i) => i.id), home.needsYou.items.map((i) => i.id));
  assert.equal(page.queueWords(1), "Open it in the queue");
  assert.equal(page.queueWords(7), "Open all 7 in the queue");
});

test("map: who is working, and a department's agents with their state (T63)", () => {
  assert.deepEqual(page.workingOf(homeFull).map((r) => r.taskId), ["t1", "t2"]);
  assert.deepEqual(page.workingOf(homeFull, ops).map((r) => r.taskId), ["t1"]);
  assert.deepEqual(page.workingOf(home).map((r) => r.taskId), [home.running[0].taskId]);
  assert.deepEqual(page.workingOf(null), []);
  const agents = page.agentsOf(ops, homeFull);
  assert.deepEqual(agents.map((a) => [a.slug, a.state]), [["chief-of-staff", ""], ["builder", "working"]], "a bad slug is dropped");
  assert.equal(agents[0].plainState, "Free");
  const waiting = page.agentsOf(ops, { needsYou: { items: [{ id: "x", agent: { slug: "chief-of-staff" } }] } });
  assert.equal(waiting[0].state, "waiting_for_you");
  assert.deepEqual(page.agentsOf(null, homeFull), []);
});

test("map: the stage's cards fit the stage at 1280 x 900, and the arrows walk them clockwise (T63)", () => {
  const ids = view.departmentsOf(fullMap()).map((d) => d.id);
  const lay = layout.layoutNodes({ ids, width: 856, height: 640 });
  assert.equal(lay.fits, true);
  assert.deepEqual(lay.nodes.map((n) => n.id), ids);
  assert.equal(layout.nearestHub(ids, "operations", "ArrowRight"), "sales");
  assert.equal(layout.nearestHub(ids, "operations", "ArrowLeft"), "books");
});

test("map: the sheet has no watermark, serif, zoom timing or department colour, and moves only within --t-med (T63)", () => {
  const css = readFileSync(new URL("../../styles/pages/map.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /fs-ghost|font-serif|t-zoom|var\(--dept/);
  assert.doesNotMatch(css, /text-transform|letter-spacing/);
  for (const m of css.matchAll(/transition:\s*([^;]+);/g)) assert.match(m[1], /^none$|var\(--t-(fast|med)\)/, m[1]);
  assert.match(css, /\.p-map__node--chosen[^{]*\{[^}]*border-color: var\(--accent\)/);
  const viewSrc = readFileSync(new URL("../../map/map-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(viewSrc, /Creature|TITLE_CHAR|ghost/);
});

// PLAN-COOK TB4: the cards, the connectors, the canvas and the foot.
test("map: a card's line is its jobs and who is working; what needs you is its warn chip, never said twice (TB4)", () => {
  assert.equal(view.cardLine({ jobs: 20, working: 1, needsYou: 3 }), "20 jobs · 1 working");
  assert.equal(view.cardLine({ jobs: 11, needsYou: 5 }), "11 jobs");
  assert.equal(view.cardLine({ jobs: 0 }), "No jobs yet");
  assert.equal(view.cardLine({ jobs: 9, working: 1 }, true), "1 working", "the smaller card leaves the jobs out");
  const src = readFileSync(new URL("../../map/map-view.js", import.meta.url), "utf8");
  assert.match(src, /<\$\{Tag\} tone="warn">\$\{needs\}<\/\/>/, "the count of what needs you is a warn chip");
  assert.match(src, /p-map__node-dot p-map__node-dot--\$\{edge\}/, "the state a 6 px dot beside the count (R6-G)");
  assert.doesNotMatch(src, /p-map__node--warn|p-map__line--warn/, "waiting on the owner gives no edge and no tinted line (R5-G)");
  assert.match(src, /class="p-map__port" cx=\$\{l\.end\.x\}/, "a connector ends in a dot on the card's edge");
});

test("map: an edge only for a department at work (good) or stuck (bad); stuck is a problem of its own waiting (R5-G)", () => {
  assert.equal(view.edgeTone({ working: 1, needsYou: 3 }), "live", "at work, even while it needs the owner");
  assert.equal(view.edgeTone({ jobs: 11, needsYou: 5 }), "", "waiting on the owner alone: a neutral edge");
  assert.equal(view.edgeTone({ working: 1, needsYou: 2 }, true), "bad");
  assert.equal(view.edgeTone(null), "");
  assert.deepEqual(view.stuckOf([
    { kind: "problem", department: "operations" }, { kind: "problem", department: "operations" },
    { kind: "decision", department: "marketing" }, { kind: "result", department: "studio" },
    { kind: "problem", department: "Bad Slug" }, { kind: "problem" }, null,
  ]), ["operations"]);
  assert.deepEqual(view.stuckOf(null), []);
  // Six of seven waiting on the owner still draw six neutral edges and lines.
  const src = readFileSync(new URL("../../pages/map.js", import.meta.url), "utf8");
  assert.match(src, /stuck=\$\{stuckOf\(needsOf\(home\.data\)\)\}/);
});

test("map: the sheet draws the TB4 map: a dot grid, 1.5 px connectors with 4 px dots, state edges, a 6 px brain bar, one foot bar", () => {
  const css = readFileSync(new URL("../../styles/pages/map.css", import.meta.url), "utf8");
  assert.match(css, /\.p-map \.k-work__stage \{\s*background: var\(--bg\);/, "the canvas a step lighter than the stage in light");
  assert.match(css, /\.p-map__grid-dot \{\s*fill: var\(--ink\);\s*fill-opacity: \.1;/, "the grid a little clearer (R6-G)");
  assert.match(readFileSync(new URL("../../pages/map.js", import.meta.url), "utf8"), /<pattern id="p-map-dots" width="16" height="16"/, "16 px apart");
  assert.match(css, /\.p-map__wire \{[^}]*stroke-width: 1\.5;/);
  assert.match(readFileSync(new URL("../../map/map-view.js", import.meta.url), "utf8"), /class="p-map__port"[^/]*r="2"/, "4 px dots");
  assert.match(css, /\.p-map \.p-map__line \{\s*--p-map-wire: color-mix\(in srgb, var\(--ink\) 14%, transparent\);/, "lines neutral, the ink at 14 percent (R5-G)");
  assert.match(css, /\.p-map__line--bad \{[^}]*var\(--bad\)/, "the connector of a department that is stuck is tinted");
  assert.doesNotMatch(css, /p-map__line--warn|p-map__node--warn|p-map__node--(live|bad)/, "no stripe on a card (R6-G)");
  assert.doesNotMatch(/\.p-map \.p-map__node \{([^}]*)\}/.exec(css)[1], /inset/);
  assert.match(css, /\.p-map \.p-map__node-dot \{\s*width: 6px;\s*height: 6px;/);
  assert.match(css, /\.p-map__node-dot--bad \{\s*background: var\(--bad\);/);
  assert.match(css, /\.p-map__node-dot--live \{\s*background: var\(--good\);/);
  assert.match(css, /\.p-map \.p-map__node--brain \{[^}]*border-color: var\(--accent\);/, "the brain edged in the accent (R6-G)");
  assert.match(css, /\.p-map__meter \{[^}]*height: 6px;/);
  assert.match(css, /\.p-map \.p-map__ask::before \{[^}]*grid-row: 1 \/ 3;[^}]*background: var\(--card\);[^}]*box-shadow: var\(--shadow-card\);/, "the foot is one bar, its hint inside it (R5-G)");
  assert.match(css, /\.p-map \.p-map__ask \{[^}]*margin: 0 auto calc\(var\(--s-6\) - var\(--s-5\)\);/, "the bar 24 px from the stage's foot (R5-G)");
  assert.match(css, /\.p-map__box \.k-composer__field \{\s*min-height: 44px;/, "a 44 px field");
  assert.match(css, /\.p-map__items > li \+ li \{\s*border-top: 1px solid var\(--line\);/, "hairlines between the rail's rows");
  assert.match(css, /\.p-map__item-title \{[^}]*font-size: var\(--fs-ui\);[^}]*font-weight: var\(--fw-medium\);/, "titles 14 px 500");
  assert.match(css, /\.p-map__item-sub \{[^}]*font-size: var\(--fs-label\);/, "a 12 px line");
  assert.match(readFileSync(new URL("../../pages/map.js", import.meta.url), "utf8"), /aside=\$\{countChip\(total, "warn"\)\}/, "group heads carry count chips");
});
