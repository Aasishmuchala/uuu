// The brain's forms and starter packs (CONTRACTS-V3 32.3, 32.5, 33.6): the pure form code (a round trip for
// each kind, plain text that cannot make a heading or break a table, a hand-changed file read as far as its
// headings allow and nothing of it lost, the checks) and the three routes on the version 3 seed, with forms
// and starter pages of the tests' own in a fixture engine folder (and the repo's own forms where they are).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBrainForms } from "../../../company/lib/brain-files.mjs";
import {
  PLACEHOLDER, checkValues, cleanValues, emptyValues, parseForm, renderForm, stateOf,
} from "../brain/forms.mjs";
import { brainToken } from "../brain/store.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

// ---- fixtures

const BRAND = {
  id: "brand", folder: "brand", file: "brand.md", title: "Brand", lead: "How your company looks and sounds.",
  fields: [
    { id: "tone", label: "Three to five words for how you sound", kind: "list", required: true, max: 5, hint: "Such as: warm, plain, exact." },
    { id: "colours", label: "Your colours", kind: "colour", required: true, max: 5 },
    { id: "fonts", label: "Your typeface", kind: "choice", required: false, options: ["Helvetica Neue", "Avenir Next", "Futura", "Didot"] },
  ],
};
const TERMS = {
  id: "terms", folder: "pricing", file: "terms.md", title: "Terms", lead: "How you are paid.",
  fields: [
    { id: "payment", label: "Payment terms", kind: "line", required: true, hint: "Such as: half before, half after." },
    { id: "holds", label: "How long a quotation holds", kind: "line", required: true },
    { id: "other", label: "Anything else", kind: "text", required: false },
  ],
};
const SERVICES = {
  id: "services", folder: "pricing", file: "services.md", title: "Prices and services", lead: "What you sell.",
  fields: [{ id: "items", label: "What you sell", kind: "rows", required: true,
    columns: [{ id: "name", label: "Name" }, { id: "unit", label: "Unit" }, { id: "price", label: "Price" }, { id: "tax", label: "Tax rate" }, { id: "code", label: "Tax code" }] }],
};
// One field of each kind.
const ALL = {
  id: "all", folder: "company", file: "all.md", title: "Every kind", lead: "A test form.",
  fields: [
    { id: "a-line", label: "A line", kind: "line", required: true },
    { id: "a-text", label: "A text", kind: "text", required: false },
    { id: "a-list", label: "A list", kind: "list", required: false, max: 6 },
    { id: "a-colour", label: "A colour", kind: "colour", required: false, max: 3 },
    { id: "a-choice", label: "A choice", kind: "choice", required: false, options: ["One", "Two | three", "# Four"] },
    { id: "a-rows", label: "Some rows", kind: "rows", required: false, columns: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] },
  ],
};

const STARTERS = {
  "carousel.md": "# Carousel\n\nThe shape of a carousel: slides, sizes, lengths.\n\n## Slides\n- The first slide says one thing.\n",
  "post.md": "# Post\n\nThe shape of one post: a first line, a body, an ask.\n",
};

// A fixture engine folder holding only company/brain/forms and company/brain/starters/packs.
function fixtureEngine({ forms = [BRAND, TERMS, SERVICES], starters = STARTERS, none = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "uuu-brain-forms-"));
  if (none) return root;
  const f = join(root, "company", "brain", "forms");
  mkdirSync(f, { recursive: true });
  for (const form of forms) writeFileSync(join(f, `${form.id}.json`), JSON.stringify(form, null, 2));
  const p = join(root, "company", "brain", "starters", "packs");
  mkdirSync(p, { recursive: true });
  for (const [name, text] of Object.entries(starters)) writeFileSync(join(p, name), text);
  return root;
}

async function withHome(fn, engine = {}) {
  const h = await startV2({ routes: ["brain", "brain-forms"] });
  h.config.minFreeDiskGb = 0;
  const repo = h.config.engineDir;
  const fixture = engine === null ? null : fixtureEngine(engine);
  if (fixture) h.config.engineDir = fixture;
  try { return await fn(h, repo); } finally {
    await h.close();
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  }
}
const docs = (h, ...p) => join(h.state, "knowledge", "docs", ...p);
const get = (h, path) => call(h.url, "GET", path);
const post = (h, path, body) => call(h.url, "POST", path, { body });

const roundTrip = (form, values) => parseForm(form, renderForm(form, values)).values;

// ---- the pure code: a round trip for each kind

test("round trip: a line, with the characters that could be Markdown", () => {
  for (const v of ["Half before, half after", "## Not a heading", "# Nor this", "\\ a backslash", "\\## escaped by hand", "---", "===", PLACEHOLDER, "a | b"]) {
    const values = { ...emptyValues(ALL), "a-line": v };
    assert.deepEqual(roundTrip(ALL, values), values, v);
  }
});

test("round trip: a text of many lines, blank lines and heading-like lines kept as text", () => {
  const values = { ...emptyValues(ALL), "a-line": "x", "a-text": "First line.\n\n## Fake heading\n# Fake title\n  ## indented\n---\n\\back\n(not filled in yet)\n| a | b |\n\n\nLast." };
  assert.deepEqual(roundTrip(ALL, values), values);
});

test("round trip: a list", () => {
  const values = { ...emptyValues(ALL), "a-line": "x", "a-list": ["warm", "## plain", "- exact", PLACEHOLDER, "a | b", "\\x"] };
  assert.deepEqual(roundTrip(ALL, values), values);
});

test("round trip: colours", () => {
  const values = { ...emptyValues(ALL), "a-line": "x", "a-colour": ["#1f3a34", "#E8B04A", "#f4efe6"] };
  assert.deepEqual(roundTrip(ALL, values), values);
});

test("round trip: a choice, including options that hold # and |", () => {
  for (const c of ["One", "Two | three", "# Four", ""]) {
    const values = { ...emptyValues(ALL), "a-line": "x", "a-choice": c };
    assert.deepEqual(roundTrip(ALL, values), values, c);
  }
});

test("round trip: rows, with | and \\ inside a box and empty boxes", () => {
  const values = { ...emptyValues(ALL), "a-line": "x", "a-rows": [
    { x: "Base unit | walnut", y: "18000" }, { x: "", y: "only y" }, { x: "back\\slash\\", y: "" }, { x: "## not a heading", y: "|" },
  ] };
  assert.deepEqual(roundTrip(ALL, values), values);
});

test("round trip: every form in the repo, filled and empty", () => {
  const dir = join(import.meta.dirname, "..", "..", "..", "company", "brain", "forms");
  const { forms } = loadBrainForms(dir);
  for (const form of forms) {
    assert.deepEqual(roundTrip(form, emptyValues(form)), emptyValues(form), form.id);
    const values = {};
    for (const f of form.fields) {
      values[f.id] = {
        line: "A line | with # in it", text: "Two lines.\n## And a heading-like one.", list: ["one", "# two"].slice(0, f.max),
        colour: ["#1a3c5e"], choice: f.options?.[0], rows: [Object.fromEntries((f.columns || []).map((c) => [c.id, `${c.label} | 1`]))],
      }[f.kind];
    }
    assert.deepEqual(checkValues(form, values), [], form.id);
    assert.deepEqual(roundTrip(form, values), cleanValues(form, values), form.id);
    assert.equal(stateOf(form, values, renderForm(form, values)), "filled", form.id);
  }
});

// ---- plain text: no heading, no broken table

test("a # or | typed by the owner cannot make a heading or break a table", () => {
  const values = { ...emptyValues(ALL), "a-line": "## Claims never to make", "a-text": "ok\n## Prices\n# Brand", "a-rows": [{ x: "a | b | c", y: "d" }] };
  const md = renderForm(ALL, values);
  const headings = md.split("\n").filter((l) => /^\s{0,3}#/.test(l));
  assert.deepEqual(headings, ["# Every kind", ...ALL.fields.map((f) => `## ${f.label}`)]);
  const table = md.split("\n").filter((l) => l.startsWith("|"));
  assert.equal(table.length, 3);
  for (const l of table) assert.equal(l.replace(/\\\\/g, "").replace(/\\\|/g, "").split("|").length - 2, 2, l);
});

test("the file has the title, each label as a heading, and the placeholder for each empty field", () => {
  const md = renderForm(BRAND, { tone: ["warm"], colours: ["#1f3a34"] });
  assert.equal(md, "# Brand\n\n## Three to five words for how you sound\n- warm\n\n## Your colours\n- #1f3a34\n\n## Your typeface\n(not filled in yet)\n");
});

// ---- a hand-changed file

test("a file changed by hand is read as far as its headings allow, and nothing of it is lost on the next save", () => {
  const hand = [
    "# Our brand book", "Written by the owner in March.", "",
    "## three to five WORDS for how you sound", "- warm", "* plain", "",
    "## Your colours", "Green and gold, mostly.", "",
    "## Our story", "We started in a garage.", "### Later", "Then a workshop.", "",
    "## Your typeface", "Comic Sans", "",
    "## Three to five words for how you sound", "- a second copy", "",
  ].join("\n");
  const parsed = parseForm(BRAND, hand);
  assert.deepEqual(parsed.values, { tone: ["warm", "plain"], colours: [], fonts: "" });
  assert.deepEqual(parsed.unknown.map((u) => u.heading), ["Your colours", "Our story", "Your typeface", "Three to five words for how you sound"]);
  assert.equal(parsed.intro, "# Our brand book\nWritten by the owner in March.");
  const saved = renderForm(BRAND, { ...parsed.values, colours: ["#1f3a34"] }, parsed);
  // Every line is still there; `* plain` is kept as its answer, written `- plain`.
  for (const line of hand.split("\n").filter((l) => l.trim() && !/^## /.test(l))) assert.ok(saved.includes(line.replace(/^\* /, "- ")), line);
  for (const s of parsed.unknown) assert.ok(saved.includes(s.text), s.heading);
  // Read again and saved again, it does not grow or move.
  const again = parseForm(BRAND, saved);
  assert.deepEqual(again.values, { tone: ["warm", "plain"], colours: ["#1f3a34"], fonts: "" });
  assert.equal(renderForm(BRAND, again.values, again), saved);
});

test("the seed's brand file: known headings become answers, the others are kept", () => {
  const seed = readFileSync(join(import.meta.dirname, "..", "..", "..", "test", "stubs", "state-seed", "knowledge", "docs", "brand", "brand.md"), "utf8");
  const parsed = parseForm(BRAND, seed);
  assert.deepEqual(parsed.values, { tone: ["warm", "plain", "exact"], colours: ["#1f3a34", "#e8b04a", "#f4efe6"], fonts: "Avenir Next" });
  assert.deepEqual(parsed.unknown.map((u) => u.heading), ["How you sign off", "Your logo's file in Brand"]);
});

// ---- the checks

test("checkValues: a required field empty gives empty, which does not refuse; the file counts as not filled", () => {
  const values = { tone: ["warm"], colours: [] };
  assert.deepEqual(checkValues(BRAND, values).map((p) => [p.field, p.code]), [["colours", "empty"]]);
  const md = renderForm(BRAND, values);
  assert.ok(md.includes(`## Your colours\n${PLACEHOLDER}`));
  assert.equal(stateOf(BRAND, values, md), "empty");
  assert.equal(stateOf(BRAND, { tone: ["warm"], colours: ["#000000"] }, renderForm(BRAND, { tone: ["warm"], colours: ["#000000"] })), "filled");
});

test("checkValues: bad colours, too long, too many, a line break, an option not offered, a wrong type", () => {
  const codes = (form, values) => checkValues(form, values).filter((p) => p.code !== "empty").map((p) => [p.field, p.code]);
  assert.deepEqual(codes(BRAND, { tone: ["a"], colours: ["#12345"] }), [["colours", "bad_colour"]]);
  assert.deepEqual(codes(BRAND, { tone: ["a"], colours: ["red"] }), [["colours", "bad_colour"]]);
  assert.deepEqual(codes(BRAND, { tone: ["a", "b", "c", "d", "e", "f"], colours: ["#123456"] }), [["tone", "too_many"]]);
  assert.deepEqual(codes(BRAND, { tone: ["x".repeat(201)], colours: ["#123456"] }), [["tone", "too_long"]]);
  assert.deepEqual(codes(BRAND, { tone: ["a"], colours: ["#123456"], fonts: "Wingdings" }), [["fonts", "not_an_option"]]);
  assert.deepEqual(codes(TERMS, { payment: "x".repeat(201), holds: "a" }), [["payment", "too_long"]]);
  assert.deepEqual(codes(TERMS, { payment: "a\nb", holds: "a" }), [["payment", "one_line"]]);
  assert.deepEqual(codes(TERMS, { payment: "a", holds: "a", other: "y".repeat(4001) }), [["other", "too_long"]]);
  assert.deepEqual(codes(TERMS, { payment: 5, holds: "a" }), [["payment", "bad_type"]]);
  assert.deepEqual(codes(SERVICES, { items: [{ name: "a\nb" }] }), [["items", "one_line"]]);
  assert.deepEqual(codes(SERVICES, { items: Array.from({ length: 61 }, (_, i) => ({ name: `n${i}` })) }), [["items", "too_many"]]);
  for (const p of checkValues(BRAND, { tone: ["a"], colours: ["#12"] })) assert.ok(p.message.includes("Your colours"));
  assert.deepEqual(codes(TERMS, { payment: "  fine  ", holds: "\u0007ok" }), []);
  assert.deepEqual(cleanValues(TERMS, { payment: "  fine  ", holds: "\u0007ok", stray: "x" }), { payment: "fine", holds: "ok", other: "" });
});

// ---- the routes

test("GET /api/brain/forms/:id: the form, the answers its file holds, its version and the headings kept", async () => {
  await withHome(async (h) => {
    const r = await get(h, "/api/brain/forms/brand");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.form, BRAND);
    assert.deepEqual(r.json.values, { tone: ["warm", "plain", "exact"], colours: ["#1f3a34", "#e8b04a", "#f4efe6"], fonts: "Avenir Next" });
    assert.equal(r.json.exists, true);
    assert.equal(r.json.version, String(Math.trunc(statSync(docs(h, "brand", "brand.md")).mtimeMs)));
    assert.deepEqual(r.json.unknown, ["How you sign off", "Your logo's file in Brand"]);
    const t = await get(h, "/api/brain/forms/terms");
    assert.deepEqual(t.json, { form: TERMS, values: { payment: "", holds: "", other: "" }, exists: false, version: null, unknown: [] });
    const n = await get(h, "/api/brain/forms/nope");
    assert.equal(n.status, 404);
    assert.equal(n.json.error.code, "form_not_found");
  });
});

test("POST /api/brain/forms/:id saves at the version, keeps the headings it does not know, and reads back the same", async () => {
  await withHome(async (h) => {
    const before = (await get(h, "/api/brain/forms/brand")).json;
    const values = { tone: ["calm", "## exact"], colours: ["#000000"], fonts: "Didot" };
    const r = await post(h, "/api/brain/forms/brand", { values, version: before.version });
    assert.equal(r.status, 200);
    assert.equal(r.json.state, "filled");
    assert.equal(r.json.file.path, "brand/brand.md");
    assert.equal(r.json.file.token, brainToken("brand/brand.md"));
    const text = readFileSync(docs(h, "brand", "brand.md"), "utf8");
    assert.ok(text.endsWith("## How you sign off\nWith care, from the workshop\n\n## Your logo's file in Brand\n(not filled in yet)\n"), text);
    const after = (await get(h, "/api/brain/forms/brand")).json;
    assert.deepEqual(after.values, values);
    assert.equal(after.version, r.json.file.version);
    assert.deepEqual(after.unknown, before.unknown);
    assert.equal(statSync(docs(h, "brand", "brand.md")).mode & 0o111, 0);
  });
});

test("POST: a required field left empty saves with state empty and the placeholder under its heading", async () => {
  await withHome(async (h) => {
    const r = await post(h, "/api/brain/forms/terms", { values: { payment: "Half before, half after." }, version: null });
    assert.equal(r.status, 200);
    assert.equal(r.json.state, "empty");
    const text = readFileSync(docs(h, "pricing", "terms.md"), "utf8");
    assert.ok(text.includes(`## How long a quotation holds\n${PLACEHOLDER}\n`));
    const b = await get(h, "/api/brain");
    assert.equal(b.json.basics.items.find((x) => x.form === "terms").state, "empty");
    const v = (await get(h, "/api/brain/forms/terms")).json;
    const full = await post(h, "/api/brain/forms/terms", { values: { payment: "Half before, half after.", holds: "Thirty days." }, version: v.version });
    assert.equal(full.json.state, "filled");
    assert.equal((await get(h, "/api/brain")).json.basics.items.find((x) => x.form === "terms").state, "filled");
  });
});

test("POST: a bad colour and a too-long value are 400 bad_value with the field's label; the file is untouched", async () => {
  await withHome(async (h) => {
    const file = docs(h, "brand", "brand.md");
    const was = readFileSync(file);
    const { version } = (await get(h, "/api/brain/forms/brand")).json;
    const c = await post(h, "/api/brain/forms/brand", { values: { tone: ["warm"], colours: ["#12g456"] }, version });
    assert.equal(c.status, 400);
    assert.equal(c.json.error.code, "bad_value");
    assert.ok(c.json.error.message.includes("Your colours"), c.json.error.message);
    const l = await post(h, "/api/brain/forms/brand", { values: { tone: ["x".repeat(300)], colours: ["#123456"] }, version });
    assert.equal(l.status, 400);
    assert.equal(l.json.error.code, "bad_value");
    assert.ok(l.json.error.message.includes("Three to five words for how you sound"), l.json.error.message);
    assert.deepEqual(readFileSync(file), was);
    const bad = await post(h, "/api/brain/forms/brand", { values: "nope", version });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "bad_request");
  });
});

test("POST: a stale version, no version for a file that is there, and a version for a file that is not, are 409; nothing written", async () => {
  await withHome(async (h) => {
    const file = docs(h, "brand", "brand.md");
    const was = readFileSync(file);
    const values = { tone: ["warm"], colours: ["#123456"] };
    for (const version of ["1", null, undefined]) {
      const r = await post(h, "/api/brain/forms/brand", { values, version });
      assert.equal(r.status, 409, String(version));
      assert.equal(r.json.error.code, "changed_since_seen");
    }
    assert.deepEqual(readFileSync(file), was);
    const t = await post(h, "/api/brain/forms/terms", { values: { payment: "a", holds: "b" }, version: "1794472200000" });
    assert.equal(t.status, 409);
    assert.equal(existsSync(docs(h, "pricing", "terms.md")), false);
  });
});

test("POST: # and | in the answers stay plain text through the route", async () => {
  await withHome(async (h) => {
    const { version } = (await get(h, "/api/brain/forms/services")).json;
    const values = { items: [{ name: "Base | walnut", unit: "## one", price: "18000", tax: "18%", code: "\\9403" }] };
    const r = await post(h, "/api/brain/forms/services", { values, version });
    assert.equal(r.status, 200);
    const text = readFileSync(docs(h, "pricing", "services.md"), "utf8");
    assert.equal(text.split("\n").filter((l) => l.startsWith("## ")).length, 1);
    assert.deepEqual((await get(h, "/api/brain/forms/services")).json.values, values);
  });
});

test("POST /api/brain/starters copies a page once and skips it the second time with its reason", async () => {
  await withHome(async (h) => {
    const r = await post(h, "/api/brain/starters", { ids: ["post", "carousel", "nope"] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.added, ["post"]);
    assert.deepEqual(r.json.skipped, [{ id: "carousel", why: "It is already in Packs." }, { id: "nope", why: "That starter page is not there." }]);
    assert.equal(readFileSync(docs(h, "packs", "post.md"), "utf8"), STARTERS["post.md"]);
    assert.equal(statSync(docs(h, "packs", "post.md")).mode & 0o111, 0);
    const again = await post(h, "/api/brain/starters", { ids: ["post"] });
    assert.deepEqual(again.json, { added: [], skipped: [{ id: "post", why: "It is already in Packs." }] });
    assert.equal((await get(h, "/api/brain")).json.starters.find((s) => s.id === "post").added, true);
    for (const body of [{}, { ids: [] }, { ids: ["../x"] }, { ids: [1] }, { ids: "post" }]) {
      const b = await post(h, "/api/brain/starters", body);
      assert.equal(b.status, 400, JSON.stringify(body));
    }
  });
});

test("with the repo's form and starter folders missing: form_not_found, nothing to add, no starters listed", async () => {
  await withHome(async (h) => {
    const f = await get(h, "/api/brain/forms/brand");
    assert.equal(f.status, 404);
    assert.equal(f.json.error.code, "form_not_found");
    const p = await post(h, "/api/brain/forms/brand", { values: {}, version: null });
    assert.equal(p.status, 404);
    const s = await post(h, "/api/brain/starters", { ids: ["carousel"] });
    assert.deepEqual(s.json, { added: [], skipped: [{ id: "carousel", why: "That starter page is not there." }] });
    assert.deepEqual((await get(h, "/api/brain")).json.starters, []);
  }, { none: true });
});

test("the repo's own forms open and save through the routes", async () => {
  await withHome(async (h, repo) => {
    h.config.engineDir = repo;
    const { forms } = loadBrainForms(join(repo, "company", "brain", "forms"));
    for (const form of forms) {
      const g = await get(h, `/api/brain/forms/${form.id}`);
      assert.equal(g.status, 200, form.id);
      assert.deepEqual(g.json.form, form);
      const values = { ...g.json.values };
      for (const f of form.fields.filter((x) => x.required)) {
        values[f.id] = { line: "Filled", text: "Filled in full.", list: ["one"], colour: ["#1a3c5e"], choice: f.options?.[0],
          rows: [Object.fromEntries((f.columns || []).map((c) => [c.id, "x"]))] }[f.kind];
      }
      const s = await post(h, `/api/brain/forms/${form.id}`, { values, version: g.json.version });
      assert.equal(s.status, 200, `${form.id}: ${s.text}`);
      assert.equal(s.json.state, "filled", form.id);
      assert.deepEqual((await get(h, `/api/brain/forms/${form.id}`)).json.unknown, g.json.unknown, form.id);
    }
    if (forms.length === 9) assert.equal((await get(h, "/api/brain")).json.basics.filled, 9);
  });
});
