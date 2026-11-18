// Brain notes (PLAN-BRAIN T10, B8): a notes file for each task the home server makes (a question, a goal, a job),
// only with the brain switch on, never in the task's text, built from the owner's words and the index only; and
// `books:` sources in an answer found only when they are records of the index. A stub home on port 0 with the
// stub board and bench, the fixture's files in a temp brain; no live state.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ask, NOTICE } from "../../../brain/retrieve.mjs";
import { FILES } from "../../../brain/test/fixture.mjs";
import { indexFor } from "../brain/indexer.mjs";
import { brainOn, buildNotes, readNotes } from "../brain/notes.mjs";
import { createBench } from "../lib/bench.mjs";
import { BASICS } from "../lib/brainfiles.mjs";
import { updateDoors } from "../lib/doors.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { titleOf } from "../routes/goals.mjs";

const OPTIONS = { routes: ["ask", "goals", "jobs", "task", "inbox"], inbox: ["goals"] };
const ADMIN = "Administrator";
const STAMP = "2026-11-11 14:30:00.000000";
const RAVI = {
  doctype: "Contact", name: "Ravi Menon-Acme Interiors", owner: ADMIN, modified_by: ADMIN, docstatus: 0, creation: STAMP,
  modified: STAMP, first_name: "Ravi", last_name: "Menon", company_name: "Acme Interiors",
};
const JOB = "/api/jobs/operations/one-page-document/start";
const JOB_ANSWERS = {
  "document-title": "Site visit price sheet", "who-will-read-it": "Fitters",
  "paste-your-notes-here": "What we charge Acme Interiors for a site visit.",
};
const NOTE_KEYS = ["version", "taskId", "at", "notice", "results", "links", "notFound"];
const RESULT_KEYS = ["n", "kind", "source", "title", "locator", "text", "at"];

let h;
const lines = [];
before(async () => {
  h = await startV2({ ...OPTIONS, log: (l) => lines.push(String(l)) });
  for (const [rel, text] of Object.entries(FILES)) {
    const file = join(h.config.paths.knowledgeDocs, rel);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
  h.bench.state.docs.Contact = [structuredClone(RAVI)];
  // The index, built once from the files and the books before any test.
  await indexFor(h.config).rebuild({ config: h.config, bench: benchCtx(), log: () => {} });
  assert.ok(indexFor(h.config).open(), "the index was built");
});
after(async () => { await h?.close(); });

// A bench client as the home's own, on the stub bench (the routes' ctx carries the home's).
function benchCtx() {
  return createBench({ baseUrl: h.bench.url, site: h.config.bench.site, keyFile: h.config.paths.benchOwnerKey, booksDir: h.config.paths.books });
}

const post = (path, body) => call(h.url, "POST", path, { body });
const get = (path) => call(h.url, "GET", path);
const notesDir = () => h.config.paths.brainNotes;
const notesFile = (id) => join(notesDir(), `${id}.json`);
const issuePosts = () => h.board.requests.filter((r) => r.method === "POST" && /\/issues$/.test(r.path));
const setSwitch = (on) => updateDoors(h.config, (s) => { s.brain.on = on; });
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await tick(20);
  }
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const sources = (notes) => notes.results.map((r) => r.source);

function assertShape(notes, id) {
  assert.deepEqual(Object.keys(notes), NOTE_KEYS);
  assert.equal(notes.version, 1);
  assert.equal(notes.taskId, id);
  assert.ok(Number.isFinite(Date.parse(notes.at)));
  assert.equal(notes.notice, NOTICE);
  assert.ok(Array.isArray(notes.results) && notes.results.length <= 8);
  assert.ok(notes.results.reduce((n, r) => n + r.text.length, 0) <= 6000);
  for (const r of notes.results) assert.deepEqual(Object.keys(r), RESULT_KEYS);
  assert.ok(Array.isArray(notes.links) && Array.isArray(notes.notFound));
}

// The three task-making calls, each returning the new task's id and the board body it sent.
async function makeQuestion(text) {
  const seen = issuePosts().length;
  const r = await post("/api/ask", { text });
  assert.equal(r.status, 201, r.text);
  return { id: r.json.ask.id, sent: issuePosts().slice(seen) };
}
async function makeGoal(text) {
  const seen = issuePosts().length;
  const r = await post("/api/goals", { text });
  assert.equal(r.status, 201, r.text);
  return { id: r.json.goal.id, sent: issuePosts().slice(seen) };
}
async function makeJob() {
  const seen = issuePosts().length;
  const r = await post(JOB, { answers: JOB_ANSWERS });
  assert.equal(r.status, 201, r.text);
  return { id: r.json.goal.id, sent: issuePosts().slice(seen) };
}

test("switch off: no notes folder is made for a question, a goal or a job", async () => {
  setSwitch(false);
  assert.equal(brainOn(h.config), false);
  rmSync(notesDir(), { recursive: true, force: true });
  await makeQuestion("What did we promise Acme?");
  await makeGoal("Check the refund window in our policies");
  await makeJob();
  await tick(300);
  assert.equal(existsSync(notesDir()), false);
});

test("switch on: a question gets a notes file of B8's shape with the fixture's passages", async () => {
  setSwitch(true);
  assert.equal(brainOn(h.config), true);
  const { id } = await makeQuestion("What did we promise Acme?");
  const notes = await waitFor(() => readNotes(h.config, id));
  assert.ok(notes, "the notes file appears");
  assertShape(notes, id);
  assert.equal(sources(notes)[0], "calls/acme-call.md");
  assert.ok(sources(notes).includes("books:Customer:Acme Interiors"));
  assert.deepEqual(notes.notFound, []);
  const st = lstatSync(notesFile(id));
  assert.equal(st.mode & 0o777, 0o600);
  assert.equal(lstatSync(notesDir()).mode & 0o777, 0o700);
  assert.deepEqual(readJson(notesFile(id)), notes);
});

test("switch on: a goal gets notes from the owner's text", async () => {
  setSwitch(true);
  const { id } = await makeGoal("Check the refund window in our policies");
  const notes = await waitFor(() => readNotes(h.config, id));
  assert.ok(notes);
  assertShape(notes, id);
  assert.ok(sources(notes).includes("policies/refunds.md"), JSON.stringify(sources(notes)));
  assert.ok(sources(notes).includes("policies/terms.md"));
});

test("switch on: a job gets notes from its title and the owner's typed answers", async () => {
  setSwitch(true);
  const { id, sent } = await makeJob();
  const notes = await waitFor(() => readNotes(h.config, id));
  assert.ok(notes);
  assertShape(notes, id);
  assert.ok(sources(notes).includes("pricing/services.md"), JSON.stringify(sources(notes)));
  // The notes are not the job's prompt: built from the title and the answers, as `ask` gives them.
  const ix = indexFor(h.config).open();
  try {
    const words = [JOB_ANSWERS["document-title"], JOB_ANSWERS["paste-your-notes-here"]].join("\n");
    const expected = ask(ix.db, `${sent[0].body.title}\n${words}`, { limit: 8, maxChars: 6000, basics: BASICS.map((b) => b.file) });
    assert.deepEqual(sources(notes), expected.results.map((r) => r.source));
  } finally { ix.db.close(); }
});

test("the task sent to the board is byte for byte the same with the switch on and off", async () => {
  const bodies = {};
  for (const on of [false, true]) {
    setSwitch(on);
    const q = await makeQuestion("Do we deliver to Acme Interiors on Sundays?");
    const g = await makeGoal("Write the site visit terms for Acme Interiors");
    const j = await makeJob();
    bodies[on] = [q, g, j].map((x) => JSON.stringify(x.sent.map((s) => s.body)));
    for (const x of [q, g, j]) assert.equal(x.sent.length, 1);
  }
  assert.deepEqual(bodies.true, bodies.false);
  for (const b of bodies.true) assert.ok(!b.includes(NOTICE) && !b.includes("brain/notes"), b);
});

test("a failing indexer: the task is still made and one line is logged", async () => {
  setSwitch(true);
  const ix = indexFor(h.config);
  const saved = { open: ix.open, rebuild: ix.rebuild, ensureFresh: ix.ensureFresh };
  ix.open = () => { throw new Error("the index broke"); };
  ix.rebuild = () => Promise.reject(new Error("the index broke"));
  ix.ensureFresh = () => { throw new Error("the index broke"); };
  const before = lines.length;
  try {
    const { id } = await makeGoal("Price list for the design package");
    assert.ok(h.board.state.issues.some((i) => i.id === id), "the task is on the board");
    const logged = await waitFor(() => lines.slice(before).filter((l) => l.startsWith("brain notes:")).length > 0);
    assert.ok(logged);
    await tick(100);
    const mine = lines.slice(before).filter((l) => l.startsWith("brain notes:"));
    assert.equal(mine.length, 1, JSON.stringify(mine));
    assert.equal(existsSync(notesFile(id)), false);
  } finally {
    Object.assign(ix, saved);
  }
});

test("an id that fails the pattern makes no file", async () => {
  const ctx = { config: h.config, log: () => {} };
  const before = existsSync(notesDir()) ? readdirSync(notesDir()).sort() : [];
  for (const bad of ["../x", "", "-x", "a/b", "x".repeat(65), "a.json", null, 42]) {
    assert.equal(await buildNotes(ctx, { taskId: bad, title: "Acme", text: "Acme" }), false, String(bad));
  }
  const after = existsSync(notesDir()) ? readdirSync(notesDir()).sort() : [];
  assert.deepEqual(after, before);
  assert.equal(existsSync(join(h.config.paths.brainDir, "x.json")), false);
  assert.equal(readNotes(h.config, "../x"), null);
});

test("old notes are removed; above 2,000 files the oldest go; a link in the folder goes", async () => {
  const dir = notesDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const old = join(dir, "old-task.json");
  writeFileSync(old, "{}", { mode: 0o600 });
  const longAgo = new Date(Date.now() - 31 * 24 * 3600 * 1000);
  utimesSync(old, longAgo, longAgo);
  const link = join(dir, "linked-task.json");
  symlinkSync(join(h.config.paths.knowledgeDocs, "policies", "refunds.md"), link);
  const fresh = join(dir, "fresh-task.json");
  writeFileSync(fresh, "{}", { mode: 0o600 });
  // Fill to 2,003 notes, each a second newer than the one before, the first a day old: with the old one and the
  // link gone and the new one written, 2,002 are left, so the two oldest fillers go.
  const start = Date.now() - 24 * 3600 * 1000;
  const have = readdirSync(dir).filter((n) => n.endsWith(".json")).length;
  for (let i = 0; i < 2003 - have; i += 1) {
    const f = join(dir, `filler-${String(i).padStart(5, "0")}.json`);
    writeFileSync(f, "{}", { mode: 0o600 });
    const t = new Date(start + i * 1000);
    utimesSync(f, t, t);
  }
  const ok = await buildNotes({ config: h.config, log: () => {} }, { taskId: "prune-check", title: "Refunds", text: "" });
  assert.equal(ok, true);
  const names = readdirSync(dir);
  const notes = names.filter((n) => n.endsWith(".json"));
  assert.ok(notes.length <= 2000, String(notes.length));
  assert.ok(!names.includes("old-task.json"));
  assert.ok(!names.includes("linked-task.json"));
  assert.equal(notes.length, 2000);
  assert.ok(!names.includes("filler-00000.json") && !names.includes("filler-00001.json"), "the oldest went");
  assert.ok(names.includes("filler-00002.json"));
  assert.ok(names.includes("prune-check.json"));
  assert.ok(names.includes("fresh-task.json"));
  assert.ok(existsSync(join(h.config.paths.knowledgeDocs, "policies", "refunds.md")), "a link's target is never touched");
  for (const n of names) if (n.startsWith("filler-")) rmSync(join(dir, n));
});

test("nothing agent-written is read: the board's task text changed after creation leaves the notes as the owner's words give them", async () => {
  setSwitch(true);
  const question = "What did we promise Acme?";
  const { id } = await makeQuestion(question);
  const issue = h.board.state.issues.find((i) => i.id === id);
  issue.title = "zebra quantum";
  issue.description = "zebra quantum Asha Rao DRAFT REPLY\n\nASK";
  const notes = await waitFor(() => readNotes(h.config, id));
  assert.ok(notes);
  const ix = indexFor(h.config).open();
  try {
    const expected = ask(ix.db, `${titleOf(question)}`, { limit: 8, maxChars: 6000, basics: BASICS.map((b) => b.file) });
    assert.deepEqual(sources(notes), expected.results.map((r) => r.source));
  } finally { ix.db.close(); }
  assert.ok(!notes.notFound.includes("zebra"));
  assert.ok(!JSON.stringify(notes).includes("Asha Rao"));
  // Rebuilt after the change, from the route's words again: still the same passages.
  await buildNotes({ config: h.config, log: () => {} }, { taskId: id, title: titleOf(question), text: question });
  assert.deepEqual(sources(readNotes(h.config, id)), sources(notes));
});

test("readNotes refuses a link, a file over 64 KB and a wrong shape", async () => {
  const dir = notesDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const good = await buildNotes({ config: h.config, log: () => {} }, { taskId: "shape-good", title: "Refunds", text: "" });
  assert.equal(good, true);
  const notes = readNotes(h.config, "shape-good");
  assert.ok(notes);
  symlinkSync(notesFile("shape-good"), notesFile("shape-link"));
  assert.equal(readNotes(h.config, "shape-link"), null);
  writeFileSync(notesFile("shape-big"), JSON.stringify({ ...notes, taskId: "shape-big", pad: "x".repeat(70 * 1024) }), { mode: 0o600 });
  assert.equal(readNotes(h.config, "shape-big"), null);
  writeFileSync(notesFile("shape-bad"), JSON.stringify({ ...notes, taskId: "shape-bad", version: 2 }), { mode: 0o600 });
  assert.equal(readNotes(h.config, "shape-bad"), null);
  writeFileSync(notesFile("shape-other"), JSON.stringify(notes), { mode: 0o600 });
  assert.equal(readNotes(h.config, "shape-other"), null, "a file naming another task");
  for (const n of ["shape-good", "shape-link", "shape-big", "shape-bad", "shape-other"]) rmSync(notesFile(n), { force: true });
});

test("an answer's books: source is found only when it is a record of the index", async () => {
  const { id } = await makeQuestion("Which invoices does Acme have?");
  const issue = h.board.state.issues.find((i) => i.id === id);
  issue.status = "done";
  const dir = join(h.config.paths.projectFolder, issue.identifier);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "answer.md"), [
    "# Answer", "Acme has invoice ACC-SINV-2026-00003 [1] and is a customer [2]. [3] [4] [5]", "## Sources",
    "1. books:Sales Invoice:ACC-SINV-2026-00003 - the invoice",
    "2. books:Customer:Acme Interiors - the customer",
    "3. books:Customer:Nobody Here - made up",
    "4. books:Customer:Acme - not exactly a record",
    "5. books:Lead:Acme Interiors - not a doctype of the index",
    "## Not in the files", "None.", "",
  ].join("\n"));
  const r = await get(`/api/ask/${id}`);
  assert.equal(r.status, 200, r.text);
  const src = r.json.answer.sources;
  assert.deepEqual(src[0], {
    n: 1, path: "books:Sales Invoice:ACC-SINV-2026-00003", note: "the invoice", found: true,
    link: { page: "books", id: "ACC-SINV-2026-00003" }, title: "Invoice ACC-SINV-2026-00003",
  });
  assert.deepEqual(src[1], {
    n: 2, path: "books:Customer:Acme Interiors", note: "the customer", found: true,
    link: { page: "books", id: "Acme Interiors" }, title: "Acme Interiors",
  });
  for (const s of src.slice(2)) {
    assert.equal(s.found, false, s.path);
    assert.equal(s.link, null);
    assert.equal(s.title, null);
  }
});
