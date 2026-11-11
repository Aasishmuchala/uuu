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
  for (const name of ["Overview", "DepartmentView", "Crown", "CountLine"]) assert.equal(typeof view[name], "function", name);
  for (const name of ["MapList", "DepartmentSection", "DepartmentRows"]) assert.equal(typeof list[name], "function", name);
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

test("map: the words a dot gets for a screen reader", () => {
  assert.equal(view.dotLabel({ ...job, working: 0 }), "Call write-up, On its own, ready");
  assert.equal(view.dotLabel(job), "Call write-up, On its own, ready, being worked on");
  assert.equal(view.dotLabel({ ...job, ready: false, working: 0, needsYou: 1, handoff: "you-approve" }), "Call write-up, You approve, cannot start yet, needs you");
  assert.equal(view.dotLabel({ title: "x".repeat(90), handoff: "nobody" }), `${"x".repeat(60)}, ready`);
});

test("map: which marks a dot shows", () => {
  assert.deepEqual(view.dotMarks({ ...job, working: 0 }), ["ready"]);
  assert.deepEqual(view.dotMarks(job), ["ready", "working"]);
  assert.deepEqual(view.dotMarks({ ready: false, working: 0, needsYou: 2 }), ["blocked", "needs-you"]);
  assert.deepEqual(view.dotMarks({ ready: false, working: 1, needsYou: 1 }), ["blocked", "working", "needs-you"]);
  assert.deepEqual(view.dotMarks(null), ["ready"]);
});

test("map: the brain's line and its words for a screen reader", () => {
  assert.equal(view.brainLine({ ...map.brain, asking: null }), "12 files · 4 of 9 basics filled");
  assert.equal(view.brainLine(map.brain), "Reading your files");
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

test("map: a zoomed job's label leaves room for its hand-off pill, and the layout keeps labels apart", () => {
  const input = view.departmentInput(fullMap().departments[6]);
  for (const c of input.clusters) {
    for (const j of c.jobs) {
      const title = j.title.trimEnd();
      const room = layout.labelWidth(j.title);
      assert.ok(room >= 6.6 * title.length + 10 + view.pillWidth("You approve"), `${title} has room for its pill`);
    }
  }
  const lay = layout.layoutDepartment(input);
  const boxes = lay.jobs.map((j) => layout.labelBox(j.label));
  for (let i = 0; i < boxes.length; i++) {
    for (let k = i + 1; k < boxes.length; k++) {
      const a = boxes[i];
      const b = boxes[k];
      assert.ok(!(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom), "two labels overlap");
    }
  }
});

test("map: Tab walks a zoomed department column by column, top to bottom", () => {
  const jobs = [
    { id: "b1", cluster: "b", x: 800, y: 300 }, { id: "a2", cluster: "a", x: 300, y: 200 },
    { id: "a1", cluster: "a", x: 300, y: 400 }, { id: "b0", cluster: "b", x: 800, y: 100 },
  ];
  assert.deepEqual(view.readingOrder(jobs).map((j) => j.id), ["a2", "a1", "b0", "b1"]);
  const lay = layout.layoutDepartment(view.departmentInput(fullMap().departments[5]));
  assert.equal(view.readingOrder(lay.jobs).length, lay.jobs.length);
  const stems = view.stems(lay);
  assert.equal(stems.length, lay.clusters.length + lay.jobs.length, "one line to each cluster and one to each job");
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

test("map: an open question is read every 5 seconds until it is answered", () => {
  assert.equal(page.askEvery(null), 5000);
  assert.equal(page.askEvery({ ...ask, state: "reading" }), 5000);
  for (const state of ["answered", "became_task", "needs_you", "stopped"]) assert.equal(page.askEvery({ ...ask, state }), 0);
});

test("map: the Today panel reads the brief of /api/home", () => {
  assert.deepEqual(page.briefItems(home), home.brief.items);
  assert.deepEqual(page.briefItems(null), []);
  assert.deepEqual(page.briefItems({ brief: { items: [null, 3, { id: "x" }] } }), [{ id: "x" }]);
});

test("map: long sentences wrap at spaces into at most four lines", () => {
  assert.deepEqual(view.wrapWords("Agents have no internet, and this job needs it.", 20), ["Agents have no", "internet, and this", "job needs it."]);
  assert.deepEqual(view.wrapWords("", 20), []);
  assert.equal(view.wrapWords("word ".repeat(100), 10).length, 4);
});

test("map: a hub's name sits outward from its point", () => {
  const lay = layout.layoutOverview(view.overviewInput(fullMap()));
  assert.deepEqual(view.labelShift(lay.hubs[0]), { x: -50, y: -100 });
  assert.equal(view.labelShift(lay.hubs[2]).x, 0);
  assert.equal(view.labelShift(lay.hubs[5]).x, -100);
  assert.equal(view.labelShift(lay.hubs[3]).y, 0);
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
  for (const d of departments) assert.ok(layout.layoutDepartment(view.departmentInput(d)).jobs.length <= 40);
});
