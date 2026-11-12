// Tests for engine/company/lib/brain-files.mjs (CONTRACTS-V3 32.3 and 32.5): first the loaders
// on fixture files; then the shared tests of section 39 for the nine real forms and the nine real
// starter packs, which skip while a file does not exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBrainForms, loadStarters, statesAFact } from "../lib/brain-files.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "v3");
const COMPANY = join(HERE, "..");
const FORMS = join(COMPANY, "brain", "forms");
const STARTERS = join(COMPANY, "brain", "starters");

test("valid forms load by file name, as written", () => {
  const { forms, problems } = loadBrainForms(join(FIX, "forms", "valid"));
  assert.deepEqual(problems, []);
  assert.deepEqual(forms.map((f) => [f.id, f.folder, f.file]), [["brand", "brand", "brand.md"], ["team", "people", "team.md"]]);
  assert.deepEqual(forms[1].fields[0].columns.map((c) => c.id), ["name", "job", "days"]);
});

test("a missing forms folder is an empty list", () => {
  assert.deepEqual(loadBrainForms(join(FIX, "forms", "no-such-folder")), { forms: [], problems: [] });
});

const BROKEN_FORMS = {
  "extra-key": /^It has keys a form does not take: colour\.$/,
  "default-value": /^Its field 1 has keys a field of this kind does not take: default\.$/,
  "unknown-folder": /^Its folder must be one of company, brand, /,
  "id-not-file-name": /^Its id must match the file name \(brands\.json\)\.$/,
  "bad-kind": /^Its field 2 needs a kind of line, text, list, rows, colour or choice\.$/,
  "choice-without-options": /^Its field 3 has no options\.$/,
  "hint-not-an-example": /^Its field 1 has a hint that is not 1 to 140 characters saying it is an example/,
  "same-field-id": /^Two of its fields have the same id\.$/,
  "none-required": /^It must have at least one required field\.$/,
  "not-json": /^It is not valid JSON\.$/,
};

test("every broken forms folder has an expectation", () => {
  assert.deepEqual(readdirSync(join(FIX, "forms", "broken")).sort(), Object.keys(BROKEN_FORMS).sort());
});

for (const [folder, problem] of Object.entries(BROKEN_FORMS)) {
  test(`a broken form is left out and reported in one plain sentence: ${folder}`, () => {
    const { forms, problems } = loadBrainForms(join(FIX, "forms", "broken", folder));
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.equal(problems[0].file, "brand.json");
    assert.match(problems[0].problem, problem);
    assert.deepEqual(forms, []);
  });
}

test("valid starters load with their folder and title", () => {
  const { starters, problems } = loadStarters(join(FIX, "starters", "valid"));
  assert.deepEqual(problems, []);
  assert.deepEqual(starters.map((s) => [s.id, s.folder, s.file, s.title]), [["carousel", "packs", "carousel.md", "Carousel"], ["post", "packs", "post.md", "Post"]]);
  assert.ok(starters[0].text.startsWith("# Carousel\n"));
});

test("a missing starters folder is an empty list", () => {
  assert.deepEqual(loadStarters(join(FIX, "starters", "no-such-folder")), { starters: [], problems: [] });
});

test("a fact is a price in rupees or a percentage", () => {
  assert.equal(statesAFact("Costs ₹500."), "names a price in rupees");
  assert.equal(statesAFact("Up 20% on last year."), "names a percentage");
  assert.equal(statesAFact("Up 20 % on last year."), "names a percentage");
  assert.equal(statesAFact("Five to eight slides, about 20 words each."), null);
});

const BROKEN_STARTERS = {
  price: ["packs/carousel.md", /^It names a price in rupees, which is a fact about a company; a starter page states none\.$/],
  percent: ["packs/carousel.md", /^It names a percentage, which is a fact about a company/],
  "no-title": ["packs/carousel.md", /^It must start with its title on one line/],
  "too-long": ["packs/carousel.md", /^It is longer than one page\.$/],
  "tool-name": ["packs/carousel.md", /^It names a tool by name\.$/],
  "not-a-brain-folder": ["secrets", /^It is not a folder named after a folder of the company brain\.$/],
};

test("every broken starters folder has an expectation", () => {
  assert.deepEqual(readdirSync(join(FIX, "starters", "broken")).sort(), Object.keys(BROKEN_STARTERS).sort());
});

for (const [folder, [file, problem]] of Object.entries(BROKEN_STARTERS)) {
  test(`a broken starter is left out and reported in one plain sentence: ${folder}`, () => {
    const { starters, problems } = loadStarters(join(FIX, "starters", "broken", folder));
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.equal(problems[0].file, file);
    assert.match(problems[0].problem, problem);
    assert.deepEqual(starters, []);
  });
}

// ---- Section 39: the nine real forms and the nine real starter packs. Each skips while its file does not exist.

// id -> [file, the kinds of its fields in order, how many of them are required (they come first)].
const NINE = {
  about: ["company/about.md", ["text", "text", "line", "line", "text", "line"], 3],
  brand: ["brand/brand.md", ["list", "colour", "choice", "line", "line"], 2],
  "cant-say": ["brand/cant-say.md", ["list", "list"], 2],
  services: ["pricing/services.md", ["rows"], 1],
  terms: ["pricing/terms.md", ["line", "line", "line", "text"], 2],
  refunds: ["policies/refunds.md", ["text", "line"], 1],
  "support-promise": ["policies/support-promise.md", ["line", "line", "list"], 2],
  team: ["people/team.md", ["rows"], 1],
  "ideal-customer": ["customers/ideal-customer.md", ["text", "text", "list"], 2],
};
const COLUMNS = { services: 5, team: 3 };
const TYPEFACES = ["Helvetica Neue", "Avenir Next", "Futura", "Gill Sans", "Georgia", "Baskerville", "Didot"];

let formsLoaded = null;
const realForms = () => (formsLoaded ||= loadBrainForms(FORMS));

for (const [id, [file, kinds, required]] of Object.entries(NINE)) {
  const path = join(FORMS, `${id}.json`);
  const skip = existsSync(path) ? false : `forms/${id}.json does not exist yet`;
  test(`form ${id}: is a valid form with the pinned file and required fields`, { skip }, () => {
    const { forms, problems } = realForms();
    assert.deepEqual(problems.filter((p) => p.file === `${id}.json`), []);
    const f = forms.find((x) => x.id === id);
    assert.ok(f, "the form loads");
    assert.equal(`${f.folder}/${f.file}`, file);
    assert.deepEqual(f.fields.map((x) => x.kind), kinds, "the kinds of its fields, in order");
    assert.deepEqual(f.fields.map((x) => x.required), kinds.map((_, i) => i < required), "the required fields come first");
    if (COLUMNS[id]) assert.equal(f.fields[0].columns.length, COLUMNS[id], "the columns of its table");
    if (id === "cant-say") for (const x of f.fields) assert.equal(x.max, 40);
    if (id === "brand") {
      assert.deepEqual(f.fields.slice(0, 3).map((x) => x.id), ["tone", "colours", "fonts"]);
      assert.equal(f.fields[0].max, 5);
      assert.equal(f.fields[1].max, 5);
      assert.deepEqual(f.fields[2].options, TYPEFACES);
    }
  });
}

const PACKS = ["call-write-up", "proposal", "carousel", "post", "newsletter", "title-card", "captions", "video-cut", "slow-reveal"];

// The names of the made-up companies of the stubs and the seed, and the company's own name.
function companyNames() {
  const names = new Set(["Sthyra", "Acme Interiors", "Northwind Traders", "Rao Interiors", "Asha Kitchens"]);
  const stubs = join(COMPANY, "..", "test", "stubs");
  for (const f of ["bench.mjs", "seed.mjs"]) {
    const p = join(stubs, f);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, "utf8").matchAll(/(?:customer_name|supplier_name|company_name|organization_name)"?\s*:\s*"([^"]{3,60})"/g)) names.add(m[1]);
  }
  names.add(JSON.parse(readFileSync(join(COMPANY, "company.json"), "utf8")).company.name);
  return [...names];
}

let startersLoaded = null;
const realStarters = () => (startersLoaded ||= loadStarters(STARTERS));

for (const id of PACKS) {
  const path = join(STARTERS, "packs", `${id}.md`);
  const skip = existsSync(path) ? false : `starters/packs/${id}.md does not exist yet`;
  test(`pack ${id}: is one page and states no company fact`, { skip }, () => {
    const { starters, problems } = realStarters();
    assert.deepEqual(problems.filter((p) => p.file === `packs/${id}.md`), []);
    assert.ok(starters.some((s) => s.folder === "packs" && s.id === id), "the pack loads");
    const text = readFileSync(path, "utf8");
    assert.ok(!text.includes("₹"), "no price in rupees");
    assert.doesNotMatch(text, /[0-9]%/, "no percentage");
    for (const n of companyNames()) assert.ok(!text.toLowerCase().includes(n.toLowerCase()), `names ${n}`);
  });
}
