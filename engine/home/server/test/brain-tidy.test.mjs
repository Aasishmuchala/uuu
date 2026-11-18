// Tidy-ups (PLAN-BRAIN T12, B11): the three fixed rules on the fixture's vectors, the inbox source's item shape,
// dismiss, a changed passage, agent suggestions (owner's decision of 18 Nov 2026: a quoted agent note that no press
// writes into the brain, kept outside knowledge/), and GET /api/inbox through the stub home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { buildFixtureIndex, FILES } from "../../../brain/test/fixture.mjs";
import { findings, labelLine, passedDate } from "../brain/tidy.mjs";
import brainSource, { AGENT_LABEL, NOTES_KEY, SWITCH_KEY, fileFromTask, fileSuggestion, setSuggestionsOn, suggestionKey } from "../inbox/brain.mjs";
import { indexFor } from "../brain/indexer.mjs";
import { brainToken } from "../brain/store.mjs";
import { createDecisions } from "../lib/decisions.mjs";
import { HomeError } from "../lib/errors.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = [join(HERE, "..", "inbox", "brain.mjs"), join(HERE, "..", "brain", "tidy.mjs")];

// The fixture's file passages as the index holds them.
function fixturePassages() {
  const dir = mkdtempSync(join(tmpdir(), "brain-tidy-"));
  try {
    const file = join(dir, "index.sqlite");
    buildFixtureIndex(file);
    const db = new DatabaseSync(file, { readOnly: true });
    try { return db.prepare("SELECT kind, trust, source, title, locator, ord, text FROM passages ORDER BY id").all(); } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const P = (source, text, extra = {}) => ({ kind: "file", trust: "owner", source, title: source, locator: source, ord: 0, text, ...extra });

test("B11 vectors on the fixture: one disagree, one passed, no repeat", () => {
  const got = findings(fixturePassages(), { today: "2026-11-18" });
  assert.deepEqual(got.map((f) => f.kind), ["disagree", "passed"]);
  const d = got[0];
  assert.equal(d.a.source, "policies/refunds.md");
  assert.equal(d.b.source, "policies/terms.md");
  assert.equal(d.why, "These two files give different figures for the same thing.");
  const p = got[1];
  assert.equal(p.a.source, "pricing/services.md");
  assert.equal(p.a.locator, "Services > Site visit");
  assert.equal(p.b, null);
  assert.equal(p.why, "This file gives a date that has passed.");
  for (const f of got) assert.match(f.key, /^[0-9a-f]{16}$/);
  assert.deepEqual(findings(fixturePassages(), { today: "2026-11-18" }), got, "the same input gives the same output");
});

test("with today 2026-01-01 there is no passed; a bad today gives nothing", () => {
  assert.deepEqual(findings(fixturePassages(), { today: "2026-01-01" }).map((f) => f.kind), ["disagree"]);
  assert.deepEqual(findings(fixturePassages(), { today: "yesterday" }), []);
  assert.deepEqual(findings(fixturePassages(), {}), []);
});

test("a planted row of a trust no reader knows, and a record, are never read", () => {
  const rows = fixturePassages();
  assert.ok(rows.some((r) => r.trust === "outside"));
  const extra = [...rows,
    P("policies/x.md", "Refund window: 30 days.", { trust: "outside" }),
    P("policies/y.md", "Refund window: 40 days.", { kind: "record", trust: "books" })];
  assert.deepEqual(findings(extra, { today: "2026-11-18" }).map((f) => f.kind), ["disagree", "passed"]);
  assert.equal(findings(extra, { today: "2026-11-18" })[0].b.source, "policies/terms.md");
});

test("a one-word label (Date: 2026-01-01) is never a disagree; label length and word rules", () => {
  const got = findings([P("company/a.md", "Date: 2026-01-01"), P("company/b.md", "Date: 2026-02-02")], { today: "2026-11-18" });
  assert.deepEqual(got, []);
  assert.equal(labelLine("Date: 2026-01-01"), null);
  assert.equal(labelLine("Refund window: soon"), null, "the value needs a digit");
  assert.equal(labelLine("Refund window: 7 days").label, "refund window");
  assert.equal(labelLine("- **Refund window**: 7 days").label, "refund window");
  assert.equal(labelLine("one two three four five six seven: 3"), null, "more than six words");
  assert.equal(labelLine(`${"a".repeat(41)} b: 3`), null, "longer than forty characters");
  assert.equal(labelLine("ab cd: 3"), null, "shorter than eight characters");
});

test("disagree needs different files in the named folders, the same label without regard to case, and differing values", () => {
  const same = findings([P("pricing/a.md", "Site visit fee: 2500"), P("pricing/b.md", "SITE  VISIT FEE:   2500")], { today: "2026-11-18" });
  assert.deepEqual(same, [], "same value after squeezing spaces");
  const diff = findings([P("pricing/a.md", "Site visit fee: 2500"), P("brand/b.md", "SITE VISIT FEE: 3000")], { today: "2026-11-18" });
  assert.equal(diff.length, 1);
  assert.equal(diff[0].kind, "disagree");
  const folder = findings([P("calls/a.md", "Site visit fee: 2500"), P("pricing/b.md", "Site visit fee: 3000")], { today: "2026-11-18" });
  assert.deepEqual(folder, [], "calls is not one of the four folders");
  const oneFile = findings([P("pricing/a.md", "Site visit fee: 2500\nSite visit fee: 3000")], { today: "2026-11-18" });
  assert.deepEqual(oneFile, [], "one file never disagrees with itself");
});

test("repeat: identical text of at least 200 characters in different files, white space and case aside", () => {
  const text = "The workshop opens at nine and closes at six. ".repeat(6).trim();
  assert.ok(text.length >= 200);
  const got = findings([P("company/a.md", text), P("policies/b.md", `${text.toUpperCase().replace(/ /g, "  ")}\n`)], { today: "2026-11-18" });
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, "repeat");
  assert.equal(got[0].why, "These two files say the same thing.");
  assert.deepEqual([got[0].a.source, got[0].b.source], ["company/a.md", "policies/b.md"]);
  const short = "x".repeat(199);
  assert.deepEqual(findings([P("company/a.md", short), P("company/b.md", short)], { today: "2026-11-18" }), []);
  assert.deepEqual(findings([P("company/a.md", text), P("company/a.md", text, { ord: 1 })], { today: "2026-11-18" }), [], "the same file is not a repeat");
});

test("passed: the words, the 20 character window, the folders, and a date that has not passed", () => {
  assert.equal(passedDate("Free until 2026-03-31.", "2026-11-18"), "2026-03-31");
  assert.equal(passedDate("Offer valid through the very end of 2026-03-31", "2026-11-18"), null, "more than 20 characters away");
  assert.equal(passedDate("Free until 2026-12-31.", "2026-11-18"), null);
  assert.equal(passedDate("Free until 2026-11-18.", "2026-11-18"), null, "today has not passed");
  assert.equal(passedDate("Free until 2026-13-45.", "2027-01-01"), null, "not a date");
  assert.equal(passedDate("Written on 2026-03-31.", "2026-11-18"), null, "no keyword");
  const inCalls = findings([P("calls/a.md", "Free until 2026-03-31.")], { today: "2026-11-18" });
  assert.deepEqual(inCalls, [], "calls is not a folder of this rule");
  const inBrand = findings([P("brand/a.md", "Free until 2026-03-31.")], { today: "2026-11-18" });
  assert.deepEqual(inBrand, [], "brand is not either");
});

test("at most ten of each kind, in a fixed order, and a changed passage is a new key", () => {
  const rows = [];
  for (let i = 0; i < 15; i += 1) rows.push(P(`pricing/f${String(i).padStart(2, "0")}.md`, `Old offer: valid until 2025-01-${String((i % 28) + 1).padStart(2, "0")}`));
  const got = findings(rows, { today: "2026-11-18" });
  assert.equal(got.filter((f) => f.kind === "passed").length, 10);
  assert.deepEqual(got.map((f) => f.a.source), [...got.map((f) => f.a.source)].sort());
  const before = findings([P("pricing/a.md", "Free until 2026-03-31.")], { today: "2026-11-18" })[0];
  const after = findings([P("pricing/a.md", "Free until 2026-03-30.")], { today: "2026-11-18" })[0];
  assert.notEqual(before.key, after.key);
});

test("the module imports nothing that changes the brain", () => {
  for (const f of SOURCES) {
    const text = readFileSync(f, "utf8");
    assert.equal((text.match(/\.add\(|\.move\(|\.remove\(|writeFile/g) || []).length, 0, f);
  }
});

// ---- the inbox source, with a real index built from the fixture's files

async function withHome(fn, { files = FILES, decisions } = {}) {
  const h = await startV2({ routes: ["inbox"], inbox: ["brain"], decisions });
  h.config.minFreeDiskGb = 0;
  try {
    const docs = h.config.paths.knowledgeDocs;
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(docs, rel)), { recursive: true });
      writeFileSync(join(docs, rel), text);
    }
    const lines = [];
    const ctx = { config: h.config, log: (l) => lines.push(l), decisions: createDecisions(join(h.config.paths.homeData, "decisions.json")), fail: (...a) => new HomeError(...a) };
    await indexFor(h.config).rebuild(ctx, { books: false });
    return await fn({ h, ctx, lines, docs });
  } finally { await h.close(); }
}
const brainItems = (r) => r.json.items.filter((i) => i.source === "brain");

test("no index yet: no items", async () => {
  const h = await startV2({ routes: ["inbox"], inbox: ["brain"] });
  try {
    h.config.minFreeDiskGb = 0;
    const ctx = { config: h.config, log() {}, decisions: createDecisions(join(h.config.paths.homeData, "decisions.json")) };
    const out = await brainSource.list(ctx);
    assert.deepEqual(out, { items: [] });
  } finally { await h.close(); }
});

test("the items have the contract's shape, and GET /api/inbox shows and counts them under brain", async () => {
  await withHome(async ({ h }) => {
    const r = await call(h.url, "GET", "/api/inbox");
    assert.equal(r.status, 200);
    const items = brainItems(r);
    assert.equal(items.length, 2);
    assert.equal(r.json.counts.bySource.brain, 2);
    assert.ok(!r.json.notConnected.some((n) => n.source === "brain"));
    const dis = items.find((i) => i.title === "Two files disagree");
    assert.match(dis.id, /^brain:[0-9a-f]{16}$/);
    assert.equal(dis.kind, "question");
    assert.equal(dis.severity, "normal");
    assert.equal(dis.raisedBy, "Home screen");
    assert.equal(dis.summary, "These two files give different figures for the same thing.");
    assert.deepEqual(dis.details.map((d) => d.label), ["Refunds", "Terms"]);
    assert.equal(dis.details[0].value, "Refund window: 7 days. Refunds are paid within seven days.");
    assert.deepEqual(dis.link, { page: "files", id: brainToken("policies/refunds.md") });
    assert.equal(dis.version, dis.id.slice("brain:".length));
    assert.deepEqual(dis.actions, [{ id: "dismiss", label: "Not a problem", style: "plain", needsNote: false }]);
    const passed = items.find((i) => i.title === "A date has passed");
    assert.equal(passed.details.length, 1);
    assert.deepEqual(passed.link, { page: "files", id: brainToken("pricing/services.md") });
  });
});

test("dismiss gives its sentence and the item is gone; another key and an unlisted id are refused", async () => {
  await withHome(async ({ h }) => {
    const first = brainItems(await call(h.url, "GET", "/api/inbox"));
    const target = first.find((i) => i.title === "Two files disagree");
    const r = await actAsSeen(h.url, { id: target.id, action: "dismiss" });
    assert.equal(r.status, 200);
    assert.equal(r.json.message, "This will not be shown again.");
    const after = brainItems(await call(h.url, "GET", "/api/inbox"));
    assert.deepEqual(after.map((i) => i.title), ["A date has passed"]);
    const bad = await actAsSeen(h.url, { id: "brain:0000000000000000", action: "dismiss" });
    assert.equal(bad.status, 404);
    const other = await actAsSeen(h.url, { id: after[0].id, action: "approve" });
    assert.equal(other.status, 400);
  });
});

test("changing the passage's text lists it again under a new key", async () => {
  await withHome(async ({ h, ctx, docs }) => {
    const items = () => call(h.url, "GET", "/api/inbox").then(brainItems);
    const before = (await items()).find((i) => i.title === "A date has passed");
    await actAsSeen(h.url, { id: before.id, action: "dismiss" });
    assert.equal((await items()).filter((i) => i.title === "A date has passed").length, 0);
    writeFileSync(join(docs, "pricing", "services.md"), FILES["pricing/services.md"].replace("2026-03-31", "2026-03-30"));
    await indexFor(h.config).rebuild(ctx, { books: false });
    const again = (await items()).find((i) => i.title === "A date has passed");
    assert.ok(again);
    assert.notEqual(again.id, before.id);
  });
});

// ---- suggestions filed by the Chief of staff

const NOTE = "Both refund files should say the same number of days.";
const AT = "2026-11-18T06:30:00.000Z";
// The records fileSuggestion keeps, written by hand, so the stub home (which reads its decisions when it starts)
// can be started with them.
const record = (path, note) => ({ key: suggestionKey(path, note), path, note, at: AT });
const seeded = (...rs) => ({ [SWITCH_KEY]: "on", [NOTES_KEY]: rs });
const suggestions = (r) => brainItems(r).filter((i) => i.title === "An agent suggests a tidy-up");

test("filing is off by default; with it on, only the Chief of staff and only a listed file", async () => {
  await withHome(async ({ ctx }) => {
    assert.throws(() => fileSuggestion(ctx, { agent: "chief-of-staff", path: "policies/terms.md", note: NOTE }), (e) => e.code === "tidy_off");
    setSuggestionsOn(ctx, true);
    assert.throws(() => fileSuggestion(ctx, { agent: "sales", path: "policies/terms.md", note: NOTE }), (e) => e.code === "tidy_not_allowed");
    assert.throws(() => fileSuggestion(ctx, { agent: "chief-of-staff", path: "policies/nothing.md", note: NOTE }), (e) => e.code === "tidy_bad_file");
    assert.throws(() => fileSuggestion(ctx, { agent: "chief-of-staff", path: "../../etc/passwd", note: NOTE }), (e) => e.code === "tidy_bad_file");
    assert.throws(() => fileSuggestion(ctx, { agent: "chief-of-staff", path: "policies/terms.md", note: "x".repeat(601) }), (e) => e.code === "tidy_bad_note");
    assert.throws(() => fileSuggestion(ctx, { agent: "chief-of-staff", path: "policies/terms.md", note: " \u200b\n " }), (e) => e.code === "tidy_bad_note");
    assert.throws(() => fileSuggestion(ctx, { agent: "chief-of-staff", path: "policies/terms.md", note: 42 }), (e) => e.code === "tidy_bad_note");
    assert.equal(ctx.decisions.get(NOTES_KEY), null, "nothing refused was kept");
    const ok = fileSuggestion(ctx, { agent: "chief-of-staff", path: "policies/terms.md", note: "x".repeat(600), now: new Date(AT) });
    assert.equal(ok.filed, true);
    assert.deepEqual(ctx.decisions.get(NOTES_KEY), [record("policies/terms.md", "x".repeat(600))]);
    assert.equal(fileSuggestion(ctx, { agent: "chief-of-staff", path: "policies/terms.md", note: `  ${"x".repeat(600)} ` }).filed, false);
    // Controls and direction marks are stripped before the note is kept.
    fileSuggestion(ctx, { agent: "chief-of-staff", path: "policies/terms.md", note: `  ${NOTE}\n\u202e hidden  `, now: new Date(AT) });
    assert.deepEqual(ctx.decisions.get(NOTES_KEY).at(-1), record("policies/terms.md", `${NOTE} hidden`));
  });
});

test("fifty waiting is the most", async () => {
  await withHome(async ({ ctx }) => {
    setSuggestionsOn(ctx, true);
    for (let i = 0; i < 50; i += 1) fileSuggestion(ctx, { agent: "chief-of-staff", path: "policies/terms.md", note: `${NOTE} ${i}` });
    assert.throws(() => fileSuggestion(ctx, { agent: "chief-of-staff", path: "policies/terms.md", note: "one more" }), (e) => e.status === 429);
  });
});

test("a suggestion is a quoted agent note with Open the file; opening and dismissing change nothing in the brain", async () => {
  const note = `${NOTE} hidden`;
  await withHome(async ({ h, docs }) => {
    const filesBefore = readdirSync(docs, { recursive: true }).sort();
    const bytesBefore = Object.fromEntries(Object.keys(FILES).map((k) => [k, readFileSync(join(docs, k), "utf8")]));
    const [s] = suggestions(await call(h.url, "GET", "/api/inbox"));
    assert.ok(s);
    assert.equal(s.raisedBy, "Chief of staff");
    assert.equal(s.id, `brain:${suggestionKey("policies/terms.md", note)}`);
    assert.equal(s.when, AT);
    const quoted = s.details.find((d) => d.label === AGENT_LABEL);
    assert.equal(quoted.value, `\u201c${note}\u201d`);
    assert.deepEqual(s.actions.map((a) => [a.id, a.label]), [["open", "Open the file"], ["dismiss", "Not a problem"]]);
    assert.deepEqual(s.link, { page: "files", id: brainToken("policies/terms.md") });
    const open = await actAsSeen(h.url, { id: s.id, action: "open" });
    assert.equal(open.status, 200);
    assert.match(open.json.message, /policies\/terms\.md/);
    assert.equal(suggestions(await call(h.url, "GET", "/api/inbox")).length, 1, "opening does not dismiss it");
    const gone = await actAsSeen(h.url, { id: s.id, action: "dismiss" });
    assert.equal(gone.json.message, "This will not be shown again.");
    assert.equal(suggestions(await call(h.url, "GET", "/api/inbox")).length, 0);
    assert.deepEqual(readdirSync(docs, { recursive: true }).sort(), filesBefore);
    for (const [k, v] of Object.entries(bytesBefore)) assert.equal(readFileSync(join(docs, k), "utf8"), v, `${k} is untouched`);
  }, { decisions: seeded(record("policies/terms.md", note)) });
});

test("agent text never reaches the company brain or the index (ADR 0008)", async () => {
  const MARK = "ZEBRAQUANTUM agent words";
  await withHome(async ({ h, ctx, docs }) => {
    const [s] = suggestions(await call(h.url, "GET", "/api/inbox"));
    assert.ok(s, "the suggestion is shown");
    await indexFor(h.config).rebuild(ctx, { books: false });
    const db = new DatabaseSync(h.config.paths.brainIndex, { readOnly: true });
    try {
      for (const t of ["passages", "fts", "entities", "aliases", "links", "mentions", "meta"]) {
        assert.ok(!JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()).includes("ZEBRAQUANTUM"), `${t} holds the agent's note`);
      }
      assert.deepEqual(db.prepare("SELECT rowid FROM fts WHERE fts MATCH 'zebraquantum'").all(), []);
    } finally { db.close(); }
    const knowledge = join(docs, "..");
    const holdsMark = () => readdirSync(knowledge, { recursive: true, withFileTypes: true })
      .filter((f) => f.isFile()).some((f) => readFileSync(join(f.parentPath, f.name)).includes("ZEBRAQUANTUM"));
    assert.equal(holdsMark(), false);
    assert.ok(readFileSync(join(h.config.paths.homeData, "decisions.json"), "utf8").includes("ZEBRAQUANTUM"), "kept under the home server's state");
    await actAsSeen(h.url, { id: s.id, action: "open" });
    await actAsSeen(h.url, { id: s.id, action: "dismiss" });
    assert.equal(holdsMark(), false);
  }, { decisions: seeded(record("policies/refunds.md", MARK)) });
});

test("a suggestion for a file that is gone is not shown, and one that was tampered with in the store is skipped", async () => {
  const bad = { ...record("policies/refunds.md", "Fine note."), note: "A different note." };
  await withHome(async ({ h, docs }) => {
    assert.equal(suggestions(await call(h.url, "GET", "/api/inbox")).length, 1, "only the sound one is shown");
    rmSync(join(docs, "policies", "terms.md"));
    assert.equal(suggestions(await call(h.url, "GET", "/api/inbox")).length, 0);
  }, { decisions: seeded(record("policies/terms.md", NOTE), bad, { key: "x", path: 5, note: {}, at: 1 }) });
});

test("the switch is off by default and the routine's file is read only when it is on", async () => {
  await withHome(async ({ ctx }) => {
    assert.equal(ctx.decisions.get(SWITCH_KEY), null);
    assert.equal(fileFromTask(ctx, "STH-1"), 0);
    setSuggestionsOn(ctx, true);
    assert.equal(fileFromTask(ctx, "STH-1"), 0, "no task folder, nothing read");
    setSuggestionsOn(ctx, false);
    assert.throws(() => fileSuggestion(ctx, { agent: "chief-of-staff", path: "policies/terms.md", note: NOTE }), (e) => e.code === "tidy_off");
  });
});

// ---- the routine's way in: a finished run of the Chief of staff's routine `brain-tidy` (inbox/goals.mjs)

test("a finished run of the tidy-up routine is read once, by the board's link to the routine, only with suggestions on", async () => {
  const h = await startV2({ routes: ["inbox", "brain-door"], inbox: ["goals", "brain"] });
  try {
    h.config.minFreeDiskGb = 0;
    const docs = h.config.paths.knowledgeDocs;
    for (const [rel, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(docs, rel)), { recursive: true });
      writeFileSync(join(docs, rel), text);
    }
    const ctx = { config: h.config, log() {}, decisions: createDecisions(join(h.config.paths.homeData, "decisions.json")) };
    await indexFor(h.config).rebuild(ctx, { books: false });
    const ROUTINE = "70000000-0000-4000-8000-0000000000b7";
    const ids = JSON.parse(readFileSync(h.config.paths.ids, "utf8"));
    ids.routines = { ...(ids.routines || {}), "brain-tidy": ROUTINE };
    writeFileSync(h.config.paths.ids, JSON.stringify(ids));
    const MARK = "ZEBRAQUANTUM the two refund files differ.";
    let n = 0;
    const run = (changes, list = [{ path: "policies/terms.md", note: MARK }, { path: "../../etc/passwd", note: "x" }]) => {
      n += 1;
      const t = new Date().toISOString();
      const issue = {
        id: `e0000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`, identifier: `STH-7${n}`,
        companyId: ids.companyId, projectId: ids.projectId, parentId: null, goalId: null, title: "Tidy-up suggestions",
        description: "ROUTINE: brain-tidy", status: "done", priority: "medium", assigneeAgentId: ids.agents["chief-of-staff"],
        createdAt: t, updatedAt: t, ...changes,
      };
      h.board.state.issues.push(issue);
      mkdirSync(join(h.config.paths.projectFolder, issue.identifier), { recursive: true });
      writeFileSync(join(h.config.paths.projectFolder, issue.identifier, "brain-tidy.json"), JSON.stringify(list));
      return issue;
    };
    const shown = async () => {
      await call(h.url, "GET", "/api/inbox");
      return suggestions(await call(h.url, "GET", "/api/inbox"));
    };
    // Its words alone, or a link to another routine, are not a run of the tidy-up routine.
    run({});
    run({ originKind: "routine_execution", originId: "70000000-0000-4000-8000-000000000001" });
    const real = run({ originKind: "routine_execution", originId: ROUTINE });
    // Off: nothing is read, and nothing is marked as read.
    assert.deepEqual(await shown(), []);
    const stored = () => JSON.parse(readFileSync(join(h.config.paths.homeData, "decisions.json"), "utf8"));
    assert.equal(stored()[`braintidyread:${real.id}`], undefined);
    // On, through Settings: the run's file is read; only the listed file is filed.
    const sw = await call(h.url, "POST", "/api/brain-door/tidy", { body: { on: true } });
    assert.equal(sw.status, 200);
    assert.equal(sw.json.tidy.on, true);
    const got = await shown();
    assert.equal(got.length, 1);
    assert.ok(stored()[`braintidyread:${real.id}`]);
    for (const other of h.board.state.issues.filter((i) => i.title === "Tidy-up suggestions" && i.id !== real.id)) {
      assert.equal(stored()[`braintidyread:${other.id}`], undefined, other.identifier);
    }
    assert.equal(got[0].raisedBy, "Chief of staff");
    assert.equal(got[0].details.find((d) => d.label === AGENT_LABEL).value, `“${MARK}”`);
    // Read once: a changed file in the same run files nothing more.
    writeFileSync(join(h.config.paths.projectFolder, real.identifier, "brain-tidy.json"), JSON.stringify([{ path: "policies/refunds.md", note: "Another." }]));
    assert.equal((await shown()).length, 1);
    // The agent's words never reach the brain or the index (ADR 0008).
    await indexFor(h.config).rebuild(ctx, { books: false });
    const db = new DatabaseSync(h.config.paths.brainIndex, { readOnly: true });
    try {
      for (const t of ["passages", "fts", "entities", "aliases", "links", "mentions", "meta"]) {
        assert.ok(!JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()).includes("ZEBRAQUANTUM"), t);
      }
    } finally { db.close(); }
    const holds = readdirSync(join(docs, ".."), { recursive: true, withFileTypes: true })
      .filter((f) => f.isFile()).some((f) => readFileSync(join(f.parentPath, f.name)).includes("ZEBRAQUANTUM"));
    assert.equal(holds, false);
  } finally { await h.close(); }
});

test("an action on a brain item while the brain source cannot be read gives that source's reason (PREFIX_SOURCE)", async () => {
  const { createActor } = await import("../lib/inbox.mjs");
  const fails = (id, words) => ({ id, list: async () => { throw new HomeError(502, words, "", "source_unread"); }, act: async () => ({ message: "ok" }) });
  const sources = [fails("board", "The board is not answering."), fails("brain", "The brain could not be read just now.")];
  await assert.rejects(createActor(sources)({ log() {} }, { id: "brain:0123456789abcdef", action: "dismiss" }),
    (e) => e.message === "The brain could not be read just now.");
});
