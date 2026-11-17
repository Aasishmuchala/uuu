// The Jobs page's pure helpers, on the pinned `jobs` and `brain` shapes (CONTRACTS-V3 30, 33.3, 33.6): the
// filters in the address, the filter itself, the build order's bands and rings, and the one problems line.
// Kept from the old Ready-made goals page: one department's jobs, or all of them (now ?d=). Dropped with the
// old page: ?open=<id> filling the compose dialog (a job now opens its own page, #/jobs/<department>/<id>).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const shape = (name) => JSON.parse(readFileSync(resolve(SHAPES, `${name}.json`), "utf8"));

const mod = await import("../../pages/jobs.js");
const kit = await import("../../kit/index.js");

const jobsShape = shape("jobs");
const brainShape = shape("brain");
const base = jobsShape.departments[0].clusters[0].jobs[0];

const job = (department, cluster, id, extra = {}) => ({ ...base, id: `${department}/${id}`, department: { id: department, title: department }, cluster: { id: cluster, title: cluster }, ...extra });
const CATALOGUE = {
  ...jobsShape,
  departments: [
    { id: "operations", title: "Operations", clusters: [
      { id: "brain", title: "Company brain", jobs: [job("operations", "brain", "what-the-brain-is-missing", { title: "What the company brain is missing", summary: "Gaps in the files.", handoff: "on-its-own", stage: 1, ready: true })] },
      { id: "planning", title: "Planning", jobs: [] },
    ] },
    { id: "sales", title: "Sales", clusters: [
      { id: "calls", title: "Calls", jobs: [
        job("sales", "calls", "call-write-up", { title: "Call write-up", summary: "Notes from a call, sorted.", handoff: "on-its-own", stage: 2, ready: true, runs: { ...base.runs, accepted: 1 } }),
        job("sales", "calls", "proposal-from-a-call", { stage: 4, ready: true }),
      ] },
    ] },
    { id: "books", title: "Books", clusters: [
      { id: "selling", title: "Selling", jobs: [job("books", "selling", "quotation-from-a-call", { title: "Quotation from a call write-up", summary: "A draft quotation in the books.", handoff: "you-approve", stage: 4, ready: false, why: { text: "The books are switched off.", link: { page: "health" } } })] },
    ] },
  ],
  problems: [],
};

test("jobs: the page is a component", () => {
  assert.equal(typeof mod.default, "function");
});

test("jobs: readFilters reads each filter from the address and leaves out what is odd", () => {
  const f = mod.readFilters(new URLSearchParams("d=sales&handoff=you-approve&stage=4&show=ready&q=call%20write"));
  assert.deepEqual(f, { d: "sales", handoff: "you-approve", stage: 4, ready: true, q: "call write", view: "list" });
  assert.deepEqual(mod.readFilters(new URLSearchParams("d=Sales!&handoff=maybe&stage=7&show=all&view=board")), { d: "", handoff: "", stage: 0, ready: false, q: "", view: "list" });
  assert.equal(mod.readFilters("view=order").view, "order");
  assert.equal(mod.readFilters(null).view, "list");
  assert.equal(mod.readFilters(new URLSearchParams(`q=${"a".repeat(300)}`)).q.length, 100);
  assert.equal(mod.readFilters(new URLSearchParams("stage=1.5")).stage, 0);
});

test("jobs: address writes the filters back in the route table's order, and the build order alone", () => {
  assert.equal(mod.address({}), "#/jobs");
  assert.equal(mod.address(), "#/jobs");
  assert.equal(mod.address({ d: "sales", handoff: "on-its-own", stage: 2, ready: true, q: "call notes" }), "#/jobs?d=sales&handoff=on-its-own&stage=2&show=ready&q=call%20notes");
  assert.equal(mod.address({ d: "sales", view: "order" }), "#/jobs?view=order");
  assert.equal(mod.address({ d: "Nope!", handoff: "x", stage: 9, q: "  " }), "#/jobs");
  // What address writes, readFilters reads back.
  const f = { d: "books", handoff: "you-lead", stage: 3, ready: false, q: "invoice & tax", view: "list" };
  assert.deepEqual(mod.readFilters(mod.address(f).split("?")[1]), f);
});

test("jobs: matches filters by department, hand-off, stage and ready only", () => {
  const all = mod.allJobs(mod.departmentsOf(CATALOGUE));
  const ids = (f) => all.filter((j) => mod.matches(j, f)).map((j) => j.id);
  assert.equal(all.length, 4);
  assert.deepEqual(ids({}), all.map((j) => j.id));
  assert.deepEqual(ids({ d: "sales" }), ["sales/call-write-up", "sales/proposal-from-a-call"]);
  assert.deepEqual(ids({ handoff: "you-approve" }), ["sales/proposal-from-a-call", "books/quotation-from-a-call"]);
  assert.deepEqual(ids({ stage: 4 }), ["sales/proposal-from-a-call", "books/quotation-from-a-call"]);
  assert.deepEqual(ids({ stage: 4, ready: true }), ["sales/proposal-from-a-call"]);
  assert.equal(mod.matches(null, {}), false);
});

test("jobs: the search words must all be in the title or the summary, in any case", () => {
  const all = mod.allJobs(mod.departmentsOf(CATALOGUE));
  const ids = (q) => all.filter((j) => mod.matches(j, { q })).map((j) => j.id);
  assert.deepEqual(ids("call"), ["sales/call-write-up", "sales/proposal-from-a-call", "books/quotation-from-a-call"]);
  assert.deepEqual(ids("CALL sorted"), ["sales/call-write-up"]);
  assert.deepEqual(ids("draft books"), ["books/quotation-from-a-call"]);
  assert.deepEqual(ids("gaps"), ["operations/what-the-brain-is-missing"]);
  assert.deepEqual(ids("nothing-like-this"), []);
  assert.deepEqual(ids("   "), all.map((j) => j.id));
  assert.deepEqual(mod.wordsOf("  Call  Write "), ["call", "write"]);
});

test("jobs: filterJobs keeps the catalogue's order and drops empty clusters and departments", () => {
  const deps = mod.departmentsOf(CATALOGUE);
  const all = mod.filterJobs(deps, {});
  assert.deepEqual(all.map((d) => d.id), ["operations", "sales", "books"]);
  assert.deepEqual(all[0].clusters.map((c) => c.id), ["brain"]);
  const sales = mod.filterJobs(deps, { d: "sales", stage: 2 });
  assert.deepEqual(sales.map((d) => d.id), ["sales"]);
  assert.deepEqual(sales[0].clusters[0].jobs.map((j) => j.id), ["sales/call-write-up"]);
  assert.deepEqual(mod.filterJobs(deps, { ready: true, handoff: "you-approve", d: "books" }), []);
  assert.deepEqual(mod.filterJobs(null, {}), []);
  // The input is left as it was.
  assert.equal(deps[1].clusters[0].jobs.length, 2);
});

test("jobs: departmentsOf and tally read the pinned shape and survive odd answers", () => {
  const deps = mod.departmentsOf(jobsShape);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].title, "Sales");
  assert.deepEqual(mod.tally(deps), { jobs: 1, ready: 1 });
  assert.deepEqual(mod.tally(mod.departmentsOf(CATALOGUE)), { jobs: 4, ready: 3 });
  assert.deepEqual(mod.departmentsOf(null), []);
  assert.deepEqual(mod.departmentsOf({ departments: [null, { id: "../x" }, { id: "people", title: "People", clusters: [{ id: "a", jobs: [null, { id: 5 }] }] }] }),
    [{ id: "people", title: "People", clusters: [{ id: "a", title: "", jobs: [] }] }]);
  assert.equal(mod.filtering({}), false);
  assert.equal(mod.filtering({ q: "  " }), false);
  assert.equal(mod.filtering({ ready: true }), true);
});

test("jobs: the build order has four bands with the words of section 25, and stage 1 is the nine basics", () => {
  const bands = mod.buildOrder(CATALOGUE, brainShape);
  assert.deepEqual(bands.map((b) => b.n), [1, 2, 3, 4]);
  assert.deepEqual(bands.map((b) => b.label), ["Foundations", "Take in", "Make", "Hand on"]);
  assert.equal(bands[0].about, "Fill the company brain, so work sounds like your company.");
  assert.equal(bands[3].about, "Work passed from one agent to the next, with nothing copied by hand.");
  assert.deepEqual(bands[0].ring, { value: 4, total: 9, words: "4 of 9 basics filled" });
  assert.equal(bands[0].basics.length, 9);
  const terms = bands[0].basics.find((b) => b.form === "terms");
  assert.deepEqual(terms, { form: "terms", title: "Terms", filled: false, href: "#/files?new=form:terms" });
  const brand = bands[0].basics.find((b) => b.form === "brand");
  assert.deepEqual(brand, { form: "brand", title: "Brand", filled: true, href: "#/files?file=YnJhbmQvYnJhbmQubWQ" });
  for (const b of bands[0].basics.filter((x) => !x.filled)) assert.match(b.href, /^#\/files\?new=form:[a-z-]+$/);
  assert.deepEqual(bands[0].groups.map((g) => g.id), ["operations"]);
});

test("jobs: stages 2 to 4 count the jobs tried of the jobs in the stage", () => {
  const bands = mod.buildOrder(CATALOGUE, brainShape);
  // From the server's stage figures when it sends them.
  assert.deepEqual(bands[1].ring, { value: 1, total: 12, words: "1 of 12 jobs tried" });
  assert.deepEqual(bands[3].ring, { value: 0, total: 16, words: "0 of 16 jobs tried" });
  assert.deepEqual(bands[3].groups.map((g) => [g.id, g.jobs.map((j) => j.id)]), [["sales", ["sales/proposal-from-a-call"]], ["books", ["books/quotation-from-a-call"]]]);
  // Counted from the jobs themselves when it does not.
  const own = mod.buildOrder({ ...CATALOGUE, stages: undefined }, brainShape);
  assert.deepEqual(own[1].ring, { value: 1, total: 1, words: "1 of 1 job tried" });
  assert.deepEqual(own[2].ring, { value: 0, total: 0, words: "0 of 0 jobs tried" });
  assert.deepEqual(own[2].groups, []);
});

test("jobs: before the company brain answers, stage 1 has no ring and no rows", () => {
  const bands = mod.buildOrder(CATALOGUE, null);
  assert.equal(bands[0].ring, null);
  assert.equal(bands[0].basics, null);
  assert.equal(mod.buildOrder(null, null).length, 4);
  // A basic with an odd id is left out; one with no token links by its path.
  const rows = mod.basicsRows({ basics: { items: [{ form: "x/../y", state: "empty" }, { form: "about", title: "About", file: "company/about.md", state: "filled", token: "not a token!" }] } });
  assert.deepEqual(rows, [{ form: "about", title: "About", filled: true, href: "#/files?file=Y29tcGFueS9hYm91dC5tZA" }]);
  assert.equal(mod.formHref("ideal-customer"), "#/files?new=form:ideal-customer");
  assert.equal(mod.formHref("<script>"), null);
});

test("jobs: problems in job files are one quiet line, never their details", () => {
  assert.equal(mod.problemLine([]), null);
  assert.equal(mod.problemLine(undefined), null);
  assert.equal(mod.problemLine([{ file: "sales/broken.json", problem: "It has no title." }]), "1 job file could not be read.");
  assert.equal(mod.problemLine([{}, {}, {}]), "3 job files could not be read.");
  const src = readFileSync(new URL("../../pages/jobs.js", import.meta.url), "utf8");
  assert.match(src, /href="#\/health"/);
  assert.doesNotMatch(src, /\.problem\b/);
});

test("jobs: the legend and the bands use the kit's words of section 25, and the build order says no stage is locked", () => {
  assert.deepEqual(Object.keys(kit.HANDOFFS), ["you-lead", "you-approve", "on-its-own"]);
  assert.deepEqual(Object.values(kit.HANDOFFS).map((h) => h.label), ["You lead", "You approve", "On its own"]);
  const src = readFileSync(new URL("../../pages/jobs.js", import.meta.url), "utf8");
  assert.ok(src.includes("Later stages work best once the stage before is in place."));
  assert.ok(src.includes("HANDOFFS[id].about"));
  assert.ok(src.includes("STAGES[n].about"));
});

test("jobs: the narrow Filter chip counts the chip rows that are on (M51 F23)", async () => {
  const m = await import("../../pages/jobs.js");
  assert.equal(m.chipsOn({}), 0);
  assert.equal(m.chipsOn({ d: "sales", handoff: "", stage: 0 }), 1);
  assert.equal(m.chipsOn({ d: "sales", handoff: "you-lead", stage: 3, ready: true, q: "x" }), 3, "Ready only and the search stay in sight, so they are not counted");
});

// PLAN-COOK T62: the list pattern of the Tasks page, jobs as cards, no creature and no department colour.
test("jobs: the words the page adds are pinned (T62)", () => {
  assert.deepEqual({ ...mod.JOBS_WORDS }, {
    filters: "Filter the jobs",
    department: "Department",
    handoff: "Hand-off",
    stage: "Stage",
    allDepartments: "Every department",
    anyHandoff: "Any hand-off",
    anyStage: "Any stage",
    views: "Show the jobs as",
    ready: "Ready only",
    search: "Search jobs",
    searchLabel: "Search the jobs",
  });
  assert.ok(Object.isFrozen(mod.JOBS_WORDS));
});

test("jobs: a department's one sentence is its clusters' own names, joined plainly (T62)", () => {
  const deps = mod.departmentsOf(CATALOGUE);
  assert.equal(mod.deptSentence(deps[0]), "Company brain and Planning.");
  assert.equal(mod.deptSentence(deps[1]), "Calls.");
  assert.equal(mod.deptSentence({ clusters: [{ title: "A" }, { title: "B" }, { title: "C" }] }), "A, B and C.");
  assert.equal(mod.deptSentence({ clusters: [{ title: "" }] }), "");
  assert.equal(mod.deptSentence(null), "");
});

test("jobs: a department is its line icon, as the sidebar draws it; anything else is the jobs icon (T62, O2, O7)", () => {
  assert.deepEqual(["brain", "operations", "sales", "marketing", "studio", "support", "people", "books", "x"].map(mod.deptIcon),
    ["brain", "layers", "trend", "horn", "film", "buoy", "team", "book", "jobs"]);
});

test("jobs: a filter menu's choices carry their address and mark the current one (T62)", () => {
  const make = (v) => mod.address({ d: v });
  const got = mod.menuChoices([{ value: "", label: "Every department" }, { value: "sales", label: "Sales" }], "sales", make);
  assert.deepEqual(got, [
    { id: "all", label: "Every department", href: "#/jobs", current: false },
    { id: "sales", label: "Sales", href: "#/jobs?d=sales", current: true },
  ]);
  assert.equal(mod.menuChoices([{ value: "", label: "Any" }], "", make)[0].current, true);
  assert.deepEqual(mod.menuChoices(null, "", make), []);
});

test("jobs: no creature, no glass and no department colour; cards are the kit's JobCard in the kit's frame (T62, TB3)", () => {
  const src = readFileSync(new URL("../../pages/jobs.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../styles/pages/jobs.css", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Creature|u-glass|u-serif|u-over|data-dept/);
  assert.doesNotMatch(css, /--dept\b|var\(--glass|--hairline|--text\b/);
  assert.match(src, /<\$\{Card\} padding="none" class="p-jobs__card-box"><\$\{JobCard\} job=\$\{job\} \/><\/\/>/);
  assert.doesNotMatch(src, /JobRow|k-job__go/, "no separate Open button on a card");
  assert.match(css, /\.p-jobs \.p-jobs__cards \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*gap: var\(--s-6\);/, "two across with a 24 px gutter");
});

// PLAN-COOK TB3: the whole card answers the click, the ring is the card's; the bar's controls at 32 px; a
// department's head at 16 px (R5-F) with its Open as a small ghost; the search beside the filters (R5-F).
test("jobs: the card is the click and the ring is round the card; the bar at 32 px with the search beside the filters; the department's head (TB3, R5-F)", () => {
  const src = readFileSync(new URL("../../pages/jobs.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../styles/pages/jobs.css", import.meta.url), "utf8");
  assert.match(css, /\.p-jobs \.p-jobs__card-box \{\s*position: relative;/, "the frame holds the name's cover");
  assert.match(css, /\.p-jobs \.p-jobs__card-box:has\(\.k-jobcard__link:focus-visible\) \{\s*outline: 2px solid var\(--accent\);/);
  assert.match(css, /\.p-jobs \.p-jobs__filter \.k-menu__trigger \{\s*min-height: var\(--s-8\);[^}]*border-color: var\(--line-2\);\s*background: transparent;/);
  assert.match(css, /\.p-jobs \.p-jobs__search \{[^}]*width: 280px;/);
  assert.doesNotMatch(css, /\.p-jobs \.p-jobs__find \{[^}]*margin-left: auto;/, "the search beside the filters, not at the far edge");
  assert.match(css, /\.p-jobs \.p-jobs__find \{[^}]*flex: 1 1 280px;/, "R6-F: and on to the column's right edge");
  assert.match(css, /\.p-jobs \.p-jobs__dept-name \{[^}]*font-size: var\(--fs-section\);[^}]*font-weight: var\(--fw-bold\);/);
  assert.match(css, /\.p-jobs \.p-jobs__dept-head \{[^}]*border-bottom: 1px solid var\(--line\);/);
  assert.match(src, /<\$\{Button\} size="sm" variant="ghost" class="p-jobs__dept-open" href=\$\{`#\/departments\/\$\{d\.id\}`\}>Open \$\{d\.title\}<\/\/>/);
  assert.match(src, /<\$\{Chip\} icon=\$\{f\.ready \? "check" : undefined\} on=\$\{f\.ready\}/, "Ready only says its state as a toggle chip");
  assert.match(src, /placeholder=\$\{W\.search\}/);
});

// ---- Mounted in the test DOM with a fake fetch (PLAN-3D-ALL U11). ----
const { FakeElement, html, render, installDom, elements, classesOf, walkDom, fire } = await import("../kit/_dom.mjs");
const { AppContext } = await import("../../lib/context.js");

async function mountJobs(data, { query = "", brain = brainShape, status = 200 } = {}) {
  installDom();
  // Hidden, so the page's 10 s refresh never ticks during a mount: on a busy machine a mount can outlast it, and the
  // wire list is what the page sends on its own, not what the clock adds. The first load does not wait for it.
  globalThis.document.visibilityState = "hidden";
  globalThis.location = { hash: `#/jobs${query ? `?${query}` : ""}`, href: `/#/jobs${query ? `?${query}` : ""}`, search: "", pathname: "/" };
  const calls = [];
  const real = globalThis.fetch;
  const answer = (code, body) => ({ ok: code < 400, status: code, json: async () => body });
  globalThis.fetch = async (path, opts = {}) => {
    calls.push(`${opts.method || "GET"} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}`);
    if (String(path) === "/api/brain") return answer(200, brain);
    return status === 200 ? answer(200, data) : answer(status, { error: { code: "error", message: "The jobs could not be read." } });
  };
  const tops = [];
  const ctx = { shell: { company: { name: "Sthyra" } }, setTop: (t) => tops.push(t), announce() {}, openComposer() {}, settings: { motion: "off", theme: "dark" } };
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${mod.default} route=${{ id: "jobs", parts: ["jobs"], query: new URLSearchParams(query) }} /><//>`, root);
  await new Promise((r) => setTimeout(r, 300));
  return { root, calls, tops, done: () => { render(null, root); root.remove(); globalThis.fetch = real; delete globalThis.location; } };
}

test("jobs: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  for (const [data, opts] of [[CATALOGUE, {}], [jobsShape, {}], [CATALOGUE, { query: "d=sales&handoff=you-approve&stage=4&show=ready&q=call" }],
    [CATALOGUE, { query: "view=order" }], [CATALOGUE, { query: "view=order", brain: { basics: { items: [] } } }], [{ departments: [] }, {}], [null, { status: 503 }]]) {
    const m = await mountJobs(data, opts);
    try { seen.push(...m.calls); } finally { m.done(); }
  }
  // Words typed in the search and Ready only pressed change the address alone.
  const m = await mountJobs(CATALOGUE);
  const was = globalThis.history;
  globalThis.history = { state: null, replaceState() {} };
  try {
    const box = elements(m.root).find((e) => e.localName === "input" && e.getAttribute("type") === "search");
    fire(box, "input", { target: { value: "call" } });
    await new Promise((r) => setTimeout(r, 300));
    const chip = elements(m.root).find((e) => e.localName === "button" && classesOf(e).includes("k-chip"));
    fire(chip, "click");
    await new Promise((r) => setTimeout(r, 300));
    seen.push(...m.calls);
  } finally { m.done(); globalThis.history = was; }
  // Recorded on the page before PLAN-3D-ALL U11 changed it.
  const RECORDED = ["GET /api/jobs", "GET /api/jobs", "GET /api/jobs", "GET /api/jobs", "GET /api/brain", "GET /api/jobs", "GET /api/brain", "GET /api/jobs", "GET /api/jobs", "GET /api/jobs"];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});

const { glimpseSrc, GLIMPSES } = await import("../../kit/room.js");
const { HOSTILE } = await import("../../world/fixtures.js");
const byCls = (root, c) => elements(root).filter((e) => classesOf(e).includes(c));
const inside = (outer, el) => { for (let x = el; x; x = x.parentNode) if (x === outer) return true; return false; };
const textNodes = (root) => [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);

test("jobs: the title, the view switch and the bar stand in the room header with the Studio's table; one h1, the cards on the ground (PLAN-3D-ALL U11)", async () => {
  for (const [query, title] of [["", "Jobs"], ["view=order", "The build order"]]) {
    const m = await mountJobs(CATALOGUE, { query });
    try {
      const band = elements(m.root).filter((e) => e.localName === "header" && classesOf(e).includes("k-room"));
      assert.equal(band.length, 1);
      assert.equal(band[0].getAttribute("data-glimpse"), "table");
      const h1 = elements(m.root).filter((e) => e.localName === "h1");
      assert.equal(h1.length, 1);
      assert.equal(h1[0].getAttribute("id"), "page-title");
      assert.equal(textNodes(h1[0]).join(""), title);
      assert.equal(byCls(band[0], "k-seg").length, 1, "the view switch is in the band");
      assert.equal(byCls(band[0], "p-jobs__bar").length, query ? 0 : 1, "the bar is in the band");
      assert.equal(byCls(band[0], "p-jobs__card").length, 0, "no card in the band");
      const img = elements(m.root).filter((e) => e.localName === "img");
      assert.equal(img.length, 1, "one picture: the band's");
      assert.equal(img[0].getAttribute("src"), glimpseSrc("table", { theme: "dark", width: 1280 }));
      assert.equal(img[0].getAttribute("alt"), "");
      assert.equal(img[0].getAttribute("aria-hidden"), "true");
      assert.equal(elements(m.root).filter((e) => e.localName === "canvas").length, 0, "a surface screen has no canvas");
      assert.equal(elements(m.root).filter((e) => e.getAttribute("data-surface")).length, 0, "no paper on this page");
      assert.equal(byCls(m.root, "k-page-header").length, 0, "PageHeader is replaced");
      if (query) assert.deepEqual(m.tops.at(-1).crumbs, [{ label: "Jobs", href: "#/jobs" }, { label: "The build order" }]);
    } finally { m.done(); }
  }
  const off = await mountJobs(CATALOGUE, { query: "glimpse=off" });
  try {
    assert.equal(elements(off.root).filter((e) => e.localName === "img").length, 0, "glimpse=off: the band alone");
    assert.equal(byCls(off.root, "k-room--bare").length, 1);
  } finally { off.done(); }
});

test("jobs: the band rises into the pane's margin a layer above the cards; controls keep their fill over the picture; a card in the lamp's pool (PLAN-3D-ALL U11)", () => {
  const css = readFileSync(new URL("../../styles/pages/jobs.css", import.meta.url), "utf8");
  const [wide, small] = [...css.matchAll(/\.p-jobs \.k-room \{([^}]*)\}/g)].map((x) => x[1]);
  assert.match(wide, /z-index: 1;\s*margin-top: calc\(-1 \* var\(--s-6\)\);/);
  assert.match(small, /margin-top: calc\(-1 \* var\(--s-2\)\);/);
  assert.match(css, /\.p-jobs \.k-room \.p-jobs__filter \.k-menu__trigger,[^{]*\{\s*background: var\(--ctl\);/);
  // The quiet look's edge alone under the pointer gave way to the lamp's pool (PLAN-3D-ALL U11).
  assert.match(css, /\.p-jobs \.p-jobs__card-box:hover,\s*\.p-jobs \.p-jobs__card-box:has\(\.k-jobcard__link:focus-visible\) \{[^}]*box-shadow: inset 0 0 0 100vmax var\(--lamp-pool\), var\(--shadow-card\);/);
  assert.ok(!/paper/.test(css), "no paper on this page");
});

test("jobs: hostile server text stays text: no script, img, iframe or object beyond the band's; no on* attribute; no fixture text in href, src or style (PLAN-3D-ALL)", async () => {
  const bad = (i) => HOSTILE[i % HOSTILE.length];
  let n = 0;
  const hostile = {
    departments: CATALOGUE.departments.map((d) => ({ ...d, title: bad(n++), clusters: d.clusters.map((c) => ({ ...c, title: bad(n++), jobs: c.jobs.map((j) => ({
      ...j, title: bad(n++), summary: bad(n++), department: { id: j.department.id, title: bad(n++) }, cluster: { id: "x", title: bad(n++) },
      why: j.ready === false ? { text: bad(n++), link: { page: "health" } } : j.why,
    })) })) })),
    stages: CATALOGUE.stages, problems: [{ file: bad(1), problem: bad(2) }],
  };
  const brain = { ...brainShape, basics: { ...brainShape.basics, items: brainShape.basics.items.map((b, i) => ({ ...b, title: bad(i) })) } };
  const tags = (root) => ["script", "img", "iframe", "object", "embed"].map((t) => elements(root).filter((e) => e.localName === t).length);
  for (const query of ["", "view=order"]) {
    const s = await mountJobs(CATALOGUE, { query });
    let base;
    try { base = tags(s.root); } finally { s.done(); }
    const m = await mountJobs(hostile, { query, brain });
    try {
      assert.deepEqual(tags(m.root), base, query);
      for (const e of elements(m.root)) {
        for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
        for (const h of HOSTILE) for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
        if (e.localName === "img") {
          assert.ok(GLIMPSES.some((k) => ["dark", "light"].some((theme) => [1280, 390].some((w) => glimpseSrc(k, { theme, width: w }) === e.getAttribute("src")))), "the band's picture is a table key's");
        }
      }
      if (!query) assert.ok(textNodes(m.root).includes(hostile.departments[0].clusters[0].jobs[0].title), "a hostile title is a text node");
    } finally { m.done(); }
  }
});
