// The departments and jobs model of version 3 (CONTRACTS-V3 31, 32.4, 33.2): lib/departments.mjs,
// lib/jobs.mjs, lib/brainfiles.mjs and the task card's new keys, on the version 3 seed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { benchSeed } from "../../../test/stubs/seed.mjs";
import { createBench } from "../lib/bench.mjs";
import { createBoard } from "../lib/board.mjs";
import { createDecisions } from "../lib/decisions.mjs";
import { basics, BASICS, brainFiles, brainFileState, brainTitle, brainToken, roomFiles } from "../lib/brainfiles.mjs";
import { departmentLoad, departmentOf, loadDepartments } from "../lib/departments.mjs";
import { forgetNeeds, jobView, loadCatalogue, needsState, readiness, runsIndex } from "../lib/jobs.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { findTask, forgetComments, loadTaskContext, outcomeOf, taskCard } from "../lib/tasks.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const issueId = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALL_NEEDS = { books: true, quotations: true, "cad-tools": true, "artist-tools": true, slides: true, video: true, speech: true };
const DOORS_OFF = { internet: false, generation: false, browser: false };

let h;
before(async () => { h = await startV2({ inbox: ["board", "goals"] }); });
after(async () => { await h?.close(); });

// A handler's ctx, made the way lib/app.mjs makes it, against a stub home's board, books and state.
function makeCtx(home = h) {
  const config = home.config;
  const ids = () => JSON.parse(readFileSync(config.paths.ids, "utf8"));
  return {
    config, ids, log: () => {},
    board: createBoard({ baseUrl: config.urls.board, ids, companyName: config.paperclip.companyName }),
    bench: createBench({ baseUrl: config.urls.bench, site: config.bench.site, keyFile: config.paths.benchOwnerKey, booksDir: config.paths.books }),
    decisions: createDecisions(join(config.paths.homeData, "decisions.json")),
    home: home.app.home,
  };
}

// A config whose brain is a temp folder (the rest as the stub home's).
function withBrain(files) {
  const root = mkdtempSync(join(tmpdir(), "uuu-brain-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return { config: { ...h.config, paths: { ...h.config.paths, knowledgeDocs: root } }, root };
}

// ---- departments
test("loadDepartments: the seven of 31.1 in file order, read once until the file changes", () => {
  const a = loadDepartments(h.config);
  assert.deepEqual(a.departments.map((d) => d.id), ["operations", "sales", "marketing", "studio", "support", "people", "books"]);
  assert.deepEqual(a.problems, []);
  assert.equal(loadDepartments(h.config), a, "cached");
  assert.equal(a.departments.find((d) => d.id === "sales").dashboard, "customers");
});

test("departmentOf: an agent's slug, a Needs-you source, a department's id; anything else is null", () => {
  assert.equal(departmentOf("bookkeeper"), "books");
  assert.equal(departmentOf("chief-of-staff"), "operations");
  assert.equal(departmentOf("artist"), "studio");
  assert.equal(departmentOf("customers"), "sales");
  assert.equal(departmentOf("marketing"), "marketing");
  assert.equal(departmentOf("operations"), "operations");
  for (const x of ["nobody", "", null, undefined, 42, "goal"]) assert.equal(departmentOf(x), null, String(x));
});

test("departmentLoad: zero with the board off; live agents and Needs-you items by agent or dashboard", () => {
  const sales = loadDepartments(h.config).departments.find((d) => d.id === "sales");
  assert.deepEqual(departmentLoad(sales, null), { working: 0, needsYou: 0 });
  const tctx = {
    ids: { agents: { sales: "A-S" } }, agentList: [], agents: new Map(), liveByAgent: new Map([["A-S", {}]]),
    needsYou: [{ agent: { slug: "sales" } }, { source: "customers", agent: null }, { source: "books", agent: { slug: "bookkeeper" } }],
  };
  assert.deepEqual(departmentLoad(sales, tctx), { working: 1, needsYou: 2 });
  // A decorated item counts by its department only: a task's result raised by the Chief of staff counts for the
  // task's department (M50 F2), and an item placed nowhere counts for none.
  const decorated = { ...tctx, needsYou: [
    { agent: { slug: "chief-of-staff" }, source: "goal", department: "sales" },
    { agent: { slug: "sales" }, source: "goal", department: "studio" },
    { agent: null, source: "customers", department: null },
  ] };
  assert.deepEqual(departmentLoad(sales, decorated), { working: 1, needsYou: 1 });
});

// ---- the catalogue
test("loadCatalogue: the 72 jobs of 31.5 and since, keyed department/id, by department in file order, cached", () => {
  const c = loadCatalogue(h.config);
  assert.equal(c.jobs.size, 72);
  assert.deepEqual(c.problems, []);
  assert.ok(c.jobs.has("sales/proposal-from-a-call"));
  assert.equal(c.jobs.get("sales/proposal-from-a-call").title, "Proposal from a call write-up");
  const counts = Object.fromEntries([...c.byDepartment].map(([d, list]) => [d, list.length]));
  assert.deepEqual(counts, { operations: 8, sales: 9, marketing: 20, studio: 14, support: 5, people: 5, books: 11 });
  assert.equal(loadCatalogue(h.config), c, "cached while no file changes");
});

test("loadCatalogue: a broken job file is left out and listed; the others stay", () => {
  const dir = mkdtempSync(join(tmpdir(), "uuu-engine-"));
  try {
    cpSync(join(h.config.engineDir, "company"), join(dir, "company"), { recursive: true, filter: (p) => !p.includes(`${join("company", "test")}`) });
    writeFileSync(join(dir, "company", "jobs", "sales", "broken.json"), JSON.stringify({ id: "broken" }));
    const c = loadCatalogue({ ...h.config, engineDir: dir });
    assert.equal(c.jobs.size, 72);
    assert.ok(!c.jobs.has("sales/broken"));
    assert.ok(c.problems.length >= 1);
    assert.ok(c.problems.every((p) => p.file === "sales/broken.json" && typeof p.problem === "string" && p.problem.endsWith(".")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- what is in place
test("needsState: the version 3 seed has the books, quotations and every tool in place, and no door (no switches file)", async () => {
  forgetNeeds();
  assert.deepEqual(await needsState(makeCtx()), { ...ALL_NEEDS, ...DOORS_OFF });
});

test("needsState: quotations: false in the bench seed means no quotations; no books means neither", async () => {
  const h2 = await startV2({ benchSeed: benchSeed({ quotations: false }) });
  const h3 = await startV2({ benchInstalled: false });
  try {
    forgetNeeds();
    const n2 = await needsState(makeCtx(h2));
    assert.equal(n2.books, true);
    assert.equal(n2.quotations, false);
    const n3 = await needsState(makeCtx(h3));
    assert.equal(n3.books, false);
    assert.equal(n3.quotations, false);
    assert.equal(n3.slides, true, "the tools do not depend on the books");
  } finally {
    await h2.close();
    await h3.close();
  }
});

// ---- readiness
const job = (needs, reads = []) => ({ needs, reads });

test("readiness: the order of reasons of 31.4", () => {
  const none = {};
  const why = (j, n = none) => readiness(j, n, h.config).why?.name ?? null;
  assert.equal(why(job(["quotations", "books", "internet"])), "internet");
  assert.equal(why(job(["books", "account", "cad-tools"])), "account");
  assert.equal(why(job(["quotations", "books", "speech", "video"])), "video");
  assert.equal(why(job(["speech", "artist-tools", "cad-tools"])), "cad-tools");
  assert.equal(why(job(["slides", "artist-tools"])), "artist-tools");
  assert.equal(why(job(["quotations", "books"])), "books");
  assert.equal(why(job(["quotations", "books"]), { books: true }), "quotations");
  assert.equal(why(job(["quotations"], [{ file: "pricing/terms.md", need: "must" }]), { quotations: true }), "reads");
  assert.equal(why(job(["video"], [{ file: "pricing/terms.md", need: "must" }]), { video: true }), "reads");
  assert.deepEqual(readiness(job(["video"]), { video: true }, h.config), { ready: true, why: null });
});

test("readiness: account is never ready; internet, generation and browser only as needsState says (K9); each sentence and link is as pinned", () => {
  const r = (name) => readiness(job([name]), { ...ALL_NEEDS, internet: true, account: true, generation: true, browser: true }, h.config);
  assert.deepEqual(r("account").why, { name: "account", text: "Sending and publishing are switched off. Connect an account first.", link: { page: "health", id: null } });
  for (const name of ["internet", "generation", "browser"]) assert.deepEqual(r(name), { ready: true, why: null }, name);
  const settings = { page: "settings", id: null };
  const off = (name, needs = ALL_NEEDS) => readiness(job([name]), needs, h.config).why;
  assert.deepEqual(off("internet"), { name: "internet", text: "The web door is off. Switch it on in Settings.", link: settings });
  assert.deepEqual(off("generation"), { name: "generation", text: "Generation is off or has no key yet. Open Settings.", link: settings });
  assert.deepEqual(off("browser"), { name: "browser", text: "The page viewer is off. Switch it on in Settings.", link: settings });
  assert.equal(off("internet", { internet: "yes" }).name, "internet", "only true holds");
  assert.equal(readiness(job(["browser", "generation", "account", "internet"]), {}, h.config).why.name, "internet", "the order of NEEDS");
  assert.equal(readiness(job(["browser", "generation"]), {}, h.config).why.name, "generation");
  const sentences = {
    books: "The books are switched off.", quotations: "The books do not let the Bookkeeper draft quotations yet.",
    "cad-tools": "The Drafter's tools are not installed yet.", "artist-tools": "The Artist's tools are not installed yet.",
    slides: "The Artist's slide tool is not installed yet.", video: "The Artist's video tool is not installed yet.",
    speech: "The speech model is not in place yet.",
  };
  for (const [name, text] of Object.entries(sentences)) {
    assert.deepEqual(readiness(job([name]), {}, h.config).why, { name, text, link: { page: "health", id: null } }, name);
  }
});

test("readiness: a must file not filled gives its sentence and a link to it in Files; a helps file does not count", () => {
  const { config, root } = withBrain({ "pricing/services.md": "# What we sell\n\n## What do you sell?\n(not filled in yet)\n" });
  try {
    const r = readiness(job([], [{ file: "brand/brand.md", need: "helps" }, { file: "pricing/services.md", need: "must" }]), {}, config);
    assert.deepEqual(r, { ready: false, why: { name: "reads", text: 'Fill in "What we sell" first.', link: { page: "files", id: brainToken("pricing/services.md") } } });
    assert.equal(readiness(job([], [{ file: "references/", need: "must" }]), {}, config).why.text, 'Fill in "References" first.');
    assert.equal(readiness(job([], [{ file: "packs/recipe-log.md", need: "must" }]), {}, config).why.text, 'Fill in "recipe-log.md" first.');
    assert.equal(readiness(job([], [{ file: "brand/brand.md", need: "helps" }]), {}, config).ready, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- the brain's files
test("brainFileState: filled, empty, missing, by the rules of 32.4", () => {
  const long = "x".repeat(60);
  const { config, root } = withBrain({
    "pricing/services.md": `# What we sell\n\n## What do you sell?\n| Name | Price |\n|---|---|\n| A | 1 |\n`,
    "pricing/terms.md": "# Terms\n\n## When do customers pay?\n(not filled in yet)\n\n## Anything else?\nSomething here.\n",
    "brand/brand.md": "# Brand\n\n## Your typeface\n(not filled in yet)\n\n## Three to five words for how you sound\n- warm\n- plain\n",
    "company/about.md": "# About\n\n## One\n(not filled in yet)\n\n## Two\n(not filled in yet)\n",
    "packs/short.md": "tiny",
    "packs/notes.md": `${long}\n(not filled in yet)\n`,
    "calls/x.md": long,
    "references/.hidden": long,
    "loose.md": long,
  });
  try {
    assert.equal(brainFileState(config, "pricing/services.md"), "filled");
    assert.equal(brainFileState(config, "pricing/terms.md"), "empty", "a required heading holds the placeholder");
    assert.equal(brainFileState(config, "brand/brand.md"), "filled", "only an optional heading holds the placeholder");
    assert.equal(brainFileState(config, "company/about.md"), "empty", "nothing at all is filled in");
    assert.equal(brainFileState(config, "packs/short.md"), "empty", "under 40 bytes");
    assert.equal(brainFileState(config, "packs/notes.md"), "filled", "a file that is not a form's: 40 bytes are enough");
    assert.equal(brainFileState(config, "policies/refunds.md"), "missing");
    assert.equal(brainFileState(config, "calls/"), "filled");
    assert.equal(brainFileState(config, "references/"), "empty", "a dot file does not count");
    assert.equal(brainFileState(config, "people/"), "missing");
    assert.equal(brainFileState(config, "loose.md"), "filled");
    for (const bad of ["../secrets/x.md", "/etc/passwd", "pricing/../x.md", "nowhere/x.md", "", null]) assert.equal(brainFileState(config, bad), "missing", String(bad));
    symlinkSync(join(root, "pricing", "services.md"), join(root, "pricing", "linked.md"));
    assert.equal(brainFileState(config, "pricing/linked.md"), "missing", "a link is never followed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("basics: the nine of 32.3 in order, with the seed's states", () => {
  const b = basics(h.config);
  assert.deepEqual(b.map((x) => x.form), ["about", "brand", "cant-say", "services", "terms", "refunds", "support-promise", "team", "ideal-customer"]);
  assert.deepEqual(b.map((x) => x.file), BASICS.map((x) => x.file));
  const state = Object.fromEntries(b.map((x) => [x.form, x.state]));
  assert.equal(state.brand, "filled");
  assert.equal(state["cant-say"], "filled");
  assert.equal(state.services, "filled");
  assert.equal(state.about, "empty", "the seed's about.md holds only (not filled in yet)");
  assert.equal(state.terms, "missing");
  assert.equal(brainTitle("references/"), "References");
  assert.equal(brainTitle("brand/brand.md"), "Brand");
});

test("brainFiles and roomFiles: names only, newest first, no dot files, no links; [] when not there", () => {
  const calls = brainFiles(h.config, "calls");
  assert.deepEqual(calls.map((f) => f.path), ["calls/2026-11-10-asha-kitchens.md"]);
  assert.ok(brainFiles(h.config, "any").some((f) => f.path === "returns-policy.md"));
  assert.ok(brainFiles(h.config, "loose").every((f) => !f.path.includes("/")));
  assert.deepEqual(brainFiles(h.config, "nowhere"), []);
  const room = roomFiles(h.config);
  assert.deepEqual(room.map((f) => f.name), ["site-visit.mp4"]);
  assert.equal(typeof room[0].size, "number");
  assert.ok(Number.isFinite(Date.parse(room[0].changed)));
  const dir = join(h.config.paths.state, "media", "room");
  writeFileSync(join(dir, ".hidden.mp4"), "x");
  writeFileSync(join(dir, "notes.txt"), "x");
  symlinkSync(join(dir, "site-visit.mp4"), join(dir, "link.mp4"));
  try {
    assert.deepEqual(roomFiles(h.config).map((f) => f.name), ["site-visit.mp4"]);
  } finally {
    for (const n of [".hidden.mp4", "notes.txt", "link.mp4"]) rmSync(join(dir, n), { force: true });
  }
  assert.deepEqual(roomFiles({ paths: { state: join(tmpdir(), "uuu-no-such-state") } }), []);
});

// ---- runs and one job
test("runsIndex: from the template: records; STH-21 is working on the proposal, STH-20 accepted", async () => {
  const ctx = makeCtx();
  const tctx = await loadTaskContext(ctx);
  const runs = runsIndex(ctx, tctx);
  const p = runs.get("sales/proposal-from-a-call");
  assert.equal(p.total, 1);
  assert.equal(p.working, 1);
  assert.equal(p.accepted, 0);
  assert.equal(p.last.identifier, "STH-21");
  assert.equal(p.last.plainState, "Being worked on");
  const w = runs.get("sales/call-write-up");
  assert.deepEqual({ total: w.total, accepted: w.accepted, working: w.working }, { total: 1, accepted: 1, working: 0 });
  assert.ok(!JSON.stringify(w).includes("tasks"), "the task list is not sent");
  assert.equal(runs.get("marketing/five-concepts").accepted, 0);
  assert.equal(runs.has("sales/record-a-new-lead"), false);
});

test("runsIndex: a record that names a job no longer in the catalogue is not counted", async () => {
  const ctx = makeCtx();
  const tctx = await loadTaskContext(ctx, { withInbox: false, withComments: false });
  const records = new Map([[`template:${issueId(8)}`, "studio/no-such-job"], [`template:${issueId(14)}`, "operations/summary-of-the-week"]]);
  const runs = runsIndex({ ...ctx, decisions: { get: (k) => records.get(k) ?? null } }, tctx);
  assert.deepEqual([...runs.keys()], ["operations/summary-of-the-week"]);
});

test("jobView: fits shape job; the earlier task is offered from the accepted call write-ups", async () => {
  forgetNeeds();
  const ctx = makeCtx();
  const tctx = await loadTaskContext(ctx);
  const runs = runsIndex(ctx, tctx);
  const needs = await needsState(ctx);
  const cat = loadCatalogue(h.config);
  const v = jobView(cat.jobs.get("sales/proposal-from-a-call"), { needs, runs, config: h.config });
  assert.deepEqual(sameShape(readShape("job"), v), []);
  assert.equal(v.id, "sales/proposal-from-a-call");
  assert.deepEqual(v.department, { id: "sales", title: "Sales" });
  assert.deepEqual(v.cluster, { id: "calls", title: "Calls" });
  assert.deepEqual(v.who, [{ slug: "sales", name: "Sales" }]);
  // The title and the date, no task ref (M51 F8; C3 25 over the example in 33.3).
  assert.equal(v.asks[0].options.length, 1);
  assert.equal(v.asks[0].options[0].value, issueId(20));
  assert.match(v.asks[0].options[0].label, /^Call write-up: Asha Kitchens · \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  assert.ok(!/STH-/.test(v.asks[0].options[0].label));
  assert.equal(v.asks[0].options[0].ref, "STH-20", "the ref rides along for matching ?from=, off screen");
  assert.equal(v.asks[1].options, null);
  assert.deepEqual(v.takes, { from: ["sales/call-write-up"], label: "Write the proposal from this",
    after: [{ id: "sales/call-write-up", title: "Call write-up" }], waiting: null });
  assert.equal(v.ready, false, "the seed has no terms file");
  assert.equal(v.why.text, 'Fill in "Terms" first.');
  assert.equal(v.runs.working, 1);
  assert.equal(v.reads.find((r) => r.file === "pricing/services.md").state, "filled");
  assert.equal(v.reads.find((r) => r.file === "pricing/terms.md").state, "missing");
  for (const id of cat.jobs.keys()) assert.deepEqual(sameShape(readShape("job"), jobView(cat.jobs.get(id), { needs, runs, config: h.config })), [], id);
});

test("jobView: options for file, media and choice questions; none for the others", () => {
  const cat = loadCatalogue(h.config);
  const view = (id) => jobView(cat.jobs.get(id), { needs: ALL_NEEDS, runs: new Map(), config: h.config });
  const notes = view("operations/meeting-notes-to-actions").asks.find((a) => a.kind === "file");
  assert.deepEqual(notes.options, [{ value: "calls/2026-11-10-asha-kitchens.md", label: "2026-11-10-asha-kitchens.md", ref: null }]);
  const clip = view("studio/cut-the-pauses-out-of-a-video").asks.find((a) => a.kind === "media");
  assert.deepEqual(clip.options, [{ value: "site-visit.mp4", label: "site-visit.mp4", ref: null }]);
  const kind = view("marketing/five-concepts").asks.find((a) => a.kind === "choice");
  assert.deepEqual(kind.options.map((o) => o.value), ["post", "carousel", "newsletter"]);
  const earlier = view("sales/proposal-from-a-call").asks.find((a) => a.kind === "task");
  assert.deepEqual(earlier.options, [], "no runs, nothing offered");
  assert.ok(view("books/draft-a-quotation").asks.every((a) => a.options === null));
  assert.deepEqual(view("sales/proposal-from-a-call").runs, { total: 0, accepted: 0, working: 0, needsYou: 0, last: null });
});

// ---- the task card's new keys
test("taskCard: job, department, follows and ask come from the records", async () => {
  const tctx = await loadTaskContext(makeCtx());
  const c21 = taskCard(findTask(tctx, "STH-21"), tctx);
  assert.deepEqual(sameShape(readShape("task-card"), c21), []);
  assert.deepEqual(c21.job, { id: "sales/proposal-from-a-call", title: "Proposal from a call write-up" });
  assert.equal(c21.department, "sales");
  assert.deepEqual(c21.follows, { taskId: issueId(20), identifier: "STH-20" });
  assert.equal(c21.ask, false);
  assert.equal(c21.outcome, null, "an unfinished task has no outcome");
  const c22 = taskCard(findTask(tctx, "STH-22"), tctx);
  assert.equal(c22.ask, true);
  assert.equal(c22.job, null);
  assert.equal(c22.follows, null);
  const c24 = taskCard(findTask(tctx, "STH-24"), tctx);
  assert.equal(c24.department, "marketing", "a job's department, even when two agents share it");
  assert.equal(c24.follows.identifier, "STH-23");
  const c8 = taskCard(findTask(tctx, "STH-8"), tctx);
  assert.equal(c8.job, null);
  assert.equal(c8.department, departmentOf(c8.who.slug), "no job: the department of who works on it");
  for (const g of tctx.goals) assert.deepEqual(sameShape(readShape("task-card"), taskCard(g, tctx)), [], g.identifier);
});

test("taskCard: outcome is the first line after RESULT: of the newest result, for a finished task", async () => {
  forgetComments();
  const tctx = await loadTaskContext(makeCtx());
  assert.equal(taskCard(findTask(tctx, "STH-20"), tctx).outcome,
    "The call with Asha Kitchens is written up in call-write-up.md, with a note and a follow-up task on their record.");
  assert.equal(taskCard(findTask(tctx, "STH-19"), tctx).outcome,
    "Customers can return an unused item within 14 days for a full refund. Custom orders cannot be returned.", "an answer's source marks are taken out (M50 F8)");
  const none = await loadTaskContext(makeCtx(), { withInbox: false, withComments: false });
  assert.equal(taskCard(findTask(none, "STH-20"), none).outcome, null, "no comments read, no outcome");
});

test("outcomeOf: cut to 140 characters; only an agent's comment counts; the newest wins", () => {
  const agent = (body) => ({ body, authorAgentId: "a1" });
  const long = "word ".repeat(60);
  const out = outcomeOf([agent(`RESULT:\n${long}`)]);
  assert.equal(out.length, 140);
  assert.ok(out.endsWith("…"));
  assert.equal(outcomeOf([agent("RESULT: first"), agent("RESULT:\n\n  second line\nthird")]), "second line");
  assert.equal(outcomeOf([agent("RESULT: mine"), { body: "RESULT: the owner's", authorAgentId: null }]), "mine");
  assert.equal(outcomeOf([agent("Not a result")]), null);
  assert.equal(outcomeOf(undefined), null);
  // Markdown's marks never reach the task's row (M63: a live row showed `SAL-QTN-2026-00001` in back quotes).
  assert.equal(outcomeOf([agent("RESULT: The Bookkeeper fetched `SAL-QTN-2026-00001` and it is **approved**.")]),
    "The Bookkeeper fetched SAL-QTN-2026-00001 and it is approved.");
  assert.equal(outcomeOf([agent("RESULT:\n## Done\n- first point")]), "Done");
});

test("taskCard: a task whose text says JOB: with no record has job null; a record of a job no longer there gives null", () => {
  const goal = { id: "g1", identifier: "STH-99", title: "X", status: "todo", description: "Do X\n\nJOB: sales/call-write-up" };
  const base = {
    needsYou: [], accepted: () => false, stepsOf: () => [], comments: new Map(), agents: new Map(), roles: [],
    routines: new Map(), liveByIssue: new Map(), config: h.config, goals: [goal], outcomes: new Map(),
    catalogue: loadCatalogue(h.config),
  };
  const noRecord = taskCard(goal, { ...base, decisions: { get: () => null } });
  assert.equal(noRecord.job, null);
  assert.equal(noRecord.department, null);
  assert.equal(noRecord.ask, false);
  const gone = taskCard(goal, { ...base, decisions: { get: (k) => (k === "template:g1" ? "sales/no-longer-here" : null) } });
  assert.equal(gone.job, null);
  const there = taskCard(goal, { ...base, decisions: { get: (k) => (k === "template:g1" ? "sales/call-write-up" : null) } });
  assert.deepEqual(there.job, { id: "sales/call-write-up", title: "Call write-up" });
  assert.equal(there.department, "sales");
  const bare = taskCard(goal, { ...base, decisions: undefined, catalogue: undefined, config: {} });
  assert.deepEqual([bare.job, bare.ask, bare.follows, bare.outcome], [null, false, null, null], "a hand-made context still works");
});

test("jobView: a job that follows another names it, and the task of it that waits to be accepted (M51 F6)", async () => {
  forgetNeeds();
  const ctx = makeCtx();
  const tctx = await loadTaskContext(ctx);
  const runs = runsIndex(ctx, tctx);
  const cat = loadCatalogue(h.config);
  for (const [id, job] of cat.jobs) {
    if (!job.takes) continue;
    const v = jobView(job, { needs: ALL_NEEDS, runs, config: h.config });
    assert.deepEqual(v.takes.after.map((a) => a.id), job.takes.from, id);
    for (const a of v.takes.after) assert.equal(a.title, cat.jobs.get(a.id)?.title || a.id, id);
    if (v.takes.waiting) {
      const t = tctx.goals.find((g) => g.id === v.takes.waiting.taskId);
      assert.ok(t && t.status !== "cancelled", `${id}: the waiting task is not stopped`);
      assert.ok(tctx.needsYou.some((i) => i.taskId === t.id), `${id}: it is in Needs you`);
    }
  }
  const carousel = jobView(cat.jobs.get("marketing/carousel-from-a-concept"), { needs: ALL_NEEDS, runs, config: h.config });
  assert.equal(carousel.takes.after[0].title, "Five concepts before any design");
  assert.equal(carousel.takes.waiting?.title, "Five concepts before any design: Diwali offer", "the concepts wait in Needs you to be accepted");
});

test("jobView: a pack the job reads is named by the pack's title, not its file name (M51 F7)", () => {
  const cat = loadCatalogue(h.config);
  const v = jobView(cat.jobs.get("sales/proposal-from-a-call"), { needs: ALL_NEEDS, runs: new Map(), config: h.config });
  const pack = v.reads.find((r) => r.file.startsWith("packs/"));
  if (pack) assert.match(pack.title, /^The .+ pack$/);
  for (const r of v.reads) assert.ok(!/\.md$/.test(r.title), r.title);
});

test("jobView: a starter pack the job reads that is not in the company's files yet carries its starter id (M63 41)", () => {
  const cat = loadCatalogue(h.config);
  const job = cat.jobs.get("studio/captions-for-a-video");
  const empty = withBrain({});
  try {
    const v = jobView(job, { needs: ALL_NEEDS, runs: new Map(), config: empty.config });
    const pack = v.reads.find((r) => r.file === "packs/captions.md");
    assert.equal(pack.state, "missing");
    assert.equal(pack.starter, "captions");
    assert.equal(pack.title, "The captions pack");
  } finally { rmSync(empty.root, { recursive: true, force: true }); }
  const added = withBrain({ "packs/captions.md": readFileSync(join(h.config.engineDir, "company", "brain", "starters", "packs", "captions.md"), "utf8") });
  try {
    const v = jobView(job, { needs: ALL_NEEDS, runs: new Map(), config: added.config });
    const pack = v.reads.find((r) => r.file === "packs/captions.md");
    assert.equal(pack.state, "filled");
    assert.equal(pack.starter, null, "once it is there, nothing is offered");
  } finally { rmSync(added.root, { recursive: true, force: true }); }
  // A file that is not a starter pack never carries one, missing or not.
  const sales = jobView(cat.jobs.get("sales/proposal-from-a-call"), { needs: ALL_NEEDS, runs: new Map(), config: h.config });
  for (const r of sales.reads) if (!r.file.startsWith("packs/")) assert.equal(r.starter, null, r.file);
});

// ---- version 5 (PLAN-V5 K7, K9): craft, versions and time on the job; needs from the switches

// A config whose engine folder is a copy of engine/company with this craft table (the rest as the stub home's).
function withCraft(jobs, fn) {
  const dir = mkdtempSync(join(tmpdir(), "uuu-engine-"));
  try {
    cpSync(join(h.config.engineDir, "company"), join(dir, "company"), { recursive: true, filter: (p) => !p.includes(`${join("company", "test")}`) });
    writeFileSync(join(dir, "company", "brand", "craft.json"), JSON.stringify({ version: 1, jobs }));
    return fn({ ...h.config, engineDir: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CAROUSEL = { kind: "carousel", review: "art", variants: 3, playbooks: ["sthyra-copywriting", "aasish-design", "creative-director"] };
const PLAIN = { kind: "post", review: "none", variants: 1, playbooks: ["storycraft"] };
const TABLE = { "marketing/carousel-from-a-document": CAROUSEL, "support/most-common-questions-this-month": PLAIN };

test("jobView (v5): the three time vectors of K9", () => {
  withCraft(TABLE, (config) => {
    const cat = loadCatalogue(config);
    const big = cat.jobs.get("marketing/carousel-from-a-document");
    assert.equal(big.size, "L");
    assert.equal(big.who.length, 2);
    const v = jobView(big, { needs: ALL_NEEDS, runs: new Map(), config });
    assert.deepEqual(sameShape(readShape("job"), v), []);
    assert.deepEqual(v.craft, {
      kind: "carousel", review: "art", versions: [1, 3], default: 3, playbooks: CAROUSEL.playbooks,
      estimate: {
        1: { low: 30, high: 55, words: "About 30 to 55 minutes" },
        3: { low: 55, high: 100, words: "About 55 to 100 minutes" },
      },
      lastRuns: [],
    });
    const small = cat.jobs.get("support/most-common-questions-this-month");
    assert.deepEqual([small.size, small.who.length], ["S", 1]);
    const s = jobView(small, { needs: ALL_NEEDS, runs: new Map(), config });
    assert.deepEqual(s.craft.estimate, { 1: { low: 5, high: 10, words: "About 5 to 10 minutes" }, 3: null }, "5 + 3 = 8 minutes; three not offered");
    assert.deepEqual([s.craft.versions, s.craft.default, s.craft.review], [[1], 1, "none"]);
    assert.deepEqual(sameShape(readShape("job"), s), []);
    assert.equal(JSON.stringify(v.craft.estimate).includes('"1":'), true, "the keys are the numbers of versions");
  });
});

test("jobView (v5): a job with no craft entry is exactly as before but for craft: null", () => {
  const cat = loadCatalogue(h.config);
  const plain = jobView(cat.jobs.get("sales/proposal-from-a-call"), { needs: ALL_NEEDS, runs: new Map(), config: h.config });
  assert.equal(plain.craft, null);
  assert.equal(Object.keys(plain).at(-1), "craft", "one key added, last");
  withCraft(TABLE, (config) => {
    const c2 = loadCatalogue(config);
    for (const id of c2.jobs.keys()) {
      const before0 = jobView(cat.jobs.get(id), { needs: ALL_NEEDS, runs: new Map(), config: h.config });
      const after0 = jobView(c2.jobs.get(id), { needs: ALL_NEEDS, runs: new Map(), config });
      const { craft: a, ...restA } = before0;
      const { craft: b, ...restB } = after0;
      assert.deepEqual(restB, restA, id);
      if (!TABLE[id]) assert.equal(b, null, id);
      assert.deepEqual(sameShape(readShape("job"), after0), [], id);
    }
  });
});

test("jobView (v5): a broken craft entry is left out and named; the job shows craft: null", () => {
  withCraft({ "marketing/carousel-from-a-document": { ...CAROUSEL, variants: 2 }, "nowhere/at-all": PLAIN }, (config) => {
    const v = jobView(loadCatalogue(config).jobs.get("marketing/carousel-from-a-document"), { needs: ALL_NEEDS, runs: new Map(), config });
    assert.equal(v.craft, null);
  });
});

test("jobView (v5): lastRuns are the last three accepted runs, newest first, in whole minutes from the board's times", () => {
  withCraft(TABLE, (config) => {
    const big = loadCatalogue(config).jobs.get("marketing/carousel-from-a-document");
    const at = (m) => new Date(Date.UTC(2026, 10, 12, 8, 0) + m * 60000).toISOString();
    const own = { total: 6, accepted: 4, working: 0, needsYou: 0, last: null };
    Object.defineProperty(own, "tasks", { enumerable: false, value: [
      { accepted: false, at: at(0), doneAt: at(5) },
      { accepted: true, at: at(0), doneAt: at(42) },
      { accepted: true, at: at(0), doneAt: null },
      { accepted: true, at: at(0), doneAt: at(37.6) },
      { accepted: true, at: at(10), doneAt: at(0) },
      { accepted: true, at: at(0), doneAt: at(51) },
      { accepted: true, at: at(0), doneAt: at(70) },
    ] });
    assert.deepEqual(jobView(big, { needs: ALL_NEEDS, runs: own, config }).craft.lastRuns, [42, 38, 51]);
  });
});

test("runsIndex (v5): each run keeps the board's completedAt, not sent", async () => {
  const ctx = makeCtx();
  const tctx = await loadTaskContext(ctx);
  const w = runsIndex(ctx, tctx).get("sales/call-write-up");
  assert.ok("doneAt" in w.tasks[0]);
  assert.ok(!JSON.stringify(w).includes("doneAt"));
});

// The three doors' health addresses, as a stand-in on 127.0.0.1 (no door is ever called for real).
async function standInDoors({ part = (p) => p, hang = false } = {}) {
  const server = http.createServer((req, res) => {
    if (hang) return;
    const m = /^\/(web|gen|view)\/health$/.exec(req.url);
    if (!m) { res.writeHead(404); return res.end(); }
    const name = { web: "web", gen: "generate", view: "viewer" }[m[1]];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", part: part(name), on: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

// A ctx whose switches file and Runway key live in a temp folder, with the door addresses given.
function doorCtx(urls, { on = true, key = false, mode = 0o600, text } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "uuu-doors-"));
  const paths = { ...h.config.paths, doorsState: join(dir, "state.json"), runwayKey: join(dir, "runway-key") };
  const body = text !== undefined ? text : JSON.stringify({ version: 1, web: { on }, generate: { on }, viewer: { on } });
  if (body !== null) { writeFileSync(paths.doorsState, body, { mode }); chmodSync(paths.doorsState, mode); }
  if (key) writeFileSync(paths.runwayKey, "key_made-up-for-a-test\n", { mode: 0o600 });
  const ctx = { ...makeCtx(), config: { ...h.config, paths }, home: { urls: { ...h.config.urls, ...urls } } };
  return { ctx, done: () => rmSync(dir, { recursive: true, force: true }) };
}

async function doorNeedsOf(urls, options) {
  const { ctx, done } = doorCtx(urls, options);
  try {
    forgetNeeds();
    const n = await needsState(ctx);
    return { internet: n.internet, generation: n.generation, browser: n.browser };
  } finally { done(); forgetNeeds(); }
}

test("needsState (v5): with the switches on and the doors answering, internet and browser hold; generation also needs the key", async () => {
  const doors = await standInDoors();
  try {
    const urls = { web: doors.url, generate: doors.url, viewer: doors.url };
    assert.deepEqual(await doorNeedsOf(urls, { key: true }), { internet: true, generation: true, browser: true });
    assert.deepEqual(await doorNeedsOf(urls, { key: false }), { internet: true, generation: false, browser: true }, "no key saved");
    assert.deepEqual(await doorNeedsOf(urls, { on: false, key: true }), DOORS_OFF, "switches off: nothing is called, nothing holds");
  } finally { await doors.close(); }
});

test("needsState (v5): the three are false with no switches file, with a stub home's null addresses, and with an untrusted file", async () => {
  const doors = await standInDoors();
  try {
    const urls = { web: doors.url, generate: doors.url, viewer: doors.url };
    assert.deepEqual(await doorNeedsOf(urls, { key: true, text: null }), DOORS_OFF, "no switches file");
    assert.deepEqual(await doorNeedsOf({ web: null, generate: null, viewer: null }, { key: true }), DOORS_OFF, "a stub home");
    assert.deepEqual(await doorNeedsOf(urls, { key: true, mode: 0o666 }), DOORS_OFF, "a switches file others can write");
    assert.deepEqual(await doorNeedsOf(urls, { key: true, text: "not json" }), DOORS_OFF);
    assert.deepEqual(await doorNeedsOf(urls, { key: true, text: JSON.stringify({ web: { on: "yes" } }) }), DOORS_OFF, "a field of the wrong kind");
  } finally { await doors.close(); }
});

test("needsState (v5): a switch on but its door not answering, answering late, or answering as another part is false", async () => {
  const closed = await standInDoors();
  const gone = closed.url;
  await closed.close();
  assert.deepEqual(await doorNeedsOf({ web: gone, generate: gone, viewer: gone }, { key: true }), DOORS_OFF, "nothing listens");
  const hang = await standInDoors({ hang: true });
  try {
    const t0 = Date.now();
    assert.deepEqual(await doorNeedsOf({ web: hang.url, generate: hang.url, viewer: hang.url }, { key: true }), DOORS_OFF, "never answers");
    assert.ok(Date.now() - t0 < 2500, "each door is given one second, all at once");
  } finally { await hang.close(); }
  const wrong = await standInDoors({ part: () => "relay" });
  try {
    assert.deepEqual(await doorNeedsOf({ web: wrong.url, generate: wrong.url, viewer: wrong.url }, { key: true }), DOORS_OFF, "another part");
  } finally { await wrong.close(); }
  assert.deepEqual(await doorNeedsOf({ web: "http://example.com", generate: "http://10.0.0.1:1", viewer: "file:///etc" }, { key: true }), DOORS_OFF, "never a non-local address");
});
