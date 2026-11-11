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
