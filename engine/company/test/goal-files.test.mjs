// Tests for engine/company/lib/goal-files.mjs (CONTRACTS-V2 section 19): first the loader on
// fixture files, one valid folder and one broken folder per rule; then the shared tests of
// section 23 for the real ready-made goal files, which skip while a file does not exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blanksOf, DEPARTMENTS, loadGoalFiles } from "../lib/goal-files.mjs";
import { TOOL_NAMES } from "../lib/routine-files.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "goals");
const REAL = join(HERE, "..", "goals");
const ROLES = [{ slug: "chief-of-staff" }, { slug: "checker" }, { slug: "bookkeeper" }];

test("valid goal files load in the pinned department order", () => {
  const { departments, problems } = loadGoalFiles(join(FIX, "valid"), ROLES);
  assert.deepEqual(problems, []);
  assert.deepEqual(departments.map((d) => [d.id, d.title, d.goals.length]), [["general", "Company", 6], ["books", "Books", 4]]);
  assert.deepEqual(departments[1].goals[1], {
    id: "goal-2", title: "Goal number 2", summary: "A short line the owner reads on the card.",
    text: "Draft a letter to [customer] about [what was sold], number 2.", to: null, planFirst: true, size: "M",
  });
});

test("a missing folder is an empty list", () => {
  assert.deepEqual(loadGoalFiles(join(FIX, "no-such-folder"), ROLES), { departments: [], problems: [] });
});

test("blanks are the texts inside [ ], in order, without repeats", () => {
  assert.deepEqual(blanksOf("Bill [customer] for [amount], then thank [customer]."), ["customer", "amount"]);
  assert.deepEqual(blanksOf("No blanks here."), []);
});

// Folder -> [file, what the one problem says, whether the rest of the file still loads].
const BROKEN = {
  "extra-key": ["books.json", /^It has keys a goal file does not take: colour\.$/, false],
  "wrong-department": ["books.json", /^Its department must be books, as the file name says\.$/, false],
  "wrong-title": ["books.json", /^Its title must be Books\.$/, false],
  "three-goals": ["books.json", /^It must have 4 to 8 goals\.$/, false],
  "nine-goals": ["books.json", /^It must have 4 to 8 goals\.$/, false],
  "not-json": ["books.json", /^It is not valid JSON\.$/, false],
  "not-a-department": ["finance.json", /^It is not named after a department\.$/, false],
  "goal-extra-key": ["books.json", /^Goal 2 has keys a goal does not take: colour\.$/, true],
  "goal-no-text": ["books.json", /^Goal 2 has no text\.$/, true],
  "goal-bad-id": ["books.json", /^Goal 2 needs an id of lower-case letters/, true],
  "goal-same-id": ["books.json", /^Goal 2 has the same id as another goal in the file\.$/, true],
  "goal-long-title": ["books.json", /^Goal 2 needs a title of 1 to 60 characters\.$/, true],
  "goal-long-summary": ["books.json", /^Goal 2 needs a summary of 1 to 140 characters\.$/, true],
  "goal-short-text": ["books.json", /^Goal 2 needs a text of 20 to 1500 characters\.$/, true],
  "goal-path-text": ["books.json", /^Goal 2's text names a full path on this Mac\.$/, true],
  "goal-tool-text": ["books.json", /^Goal 2's text names a tool by name\.$/, true],
  "goal-capital-blank": ["books.json", /^Goal 2's text has something to fill in that is not a few lower-case words in \[ \]\.$/, true],
  "goal-open-blank": ["books.json", /^Goal 2's text has a \[ or \] that does not close\.$/, true],
  "goal-unknown-agent": ["books.json", /^Goal 2 goes to an agent that is not in the company file\.$/, true],
  "goal-plan-first": ["books.json", /^Goal 2 needs planFirst as true or false\.$/, true],
  "goal-size": ["books.json", /^Goal 2 needs a size of XS, S, M, L or XL\.$/, true],
};

test("every broken folder has an expectation", () => {
  assert.deepEqual(readdirSync(join(FIX, "broken")).sort(), Object.keys(BROKEN).sort());
});

for (const [folder, [file, problem, rest]] of Object.entries(BROKEN)) {
  test(`a broken goal file is reported in one plain sentence: ${folder}`, () => {
    const { departments, problems } = loadGoalFiles(join(FIX, "broken", folder), ROLES);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.equal(problems[0].file, file);
    assert.match(problems[0].problem, problem);
    if (rest) {
      assert.equal(departments.length, 1);
      assert.deepEqual(departments[0].goals.map((g) => g.id), ["goal-1", "goal-3", "goal-4"], "the other goals still load");
    } else assert.deepEqual(departments, []);
  });
}

// ---- Section 23: the real goal files (V38 to V41). Each skips while its file does not exist.

// The roles straight from the company file, so these tests do not depend on the role files.
function realRoles() {
  const doc = JSON.parse(readFileSync(join(HERE, "..", "company.json"), "utf8"));
  return doc.agents.map((a) => ({ slug: a.slug, department: a.department ?? null }));
}

for (const { id: dep } of DEPARTMENTS) {
  const file = join(REAL, `${dep}.json`);
  const skip = existsSync(file) ? false : `${dep}.json does not exist yet`;
  const goalsOf = () => JSON.parse(readFileSync(file, "utf8")).goals;

  test(`goals ${dep}: is a valid file`, { skip }, () => {
    const { departments, problems } = loadGoalFiles(REAL, realRoles());
    assert.deepEqual(problems.filter((p) => p.file === `${dep}.json`), []);
    const mine = departments.find((d) => d.id === dep);
    assert.ok(mine, "the department loads");
    assert.equal(mine.goals.length, goalsOf().length, "every goal loads");
  });

  test(`goals ${dep}: every goal reads as the owner would say it`, { skip }, () => {
    for (const g of goalsOf()) {
      const all = `${g.title} ${g.summary} ${g.text}`;
      for (const t of TOOL_NAMES) assert.ok(!new RegExp(`\\b${t}\\b`, "i").test(all), `${g.id} names ${t}`);
      assert.doesNotMatch(all, /\/Users\/|~\/|\/private\/|\/tmp\/|https?:|www\./, `${g.id}: no path or address`);
      assert.doesNotMatch(all, /[`$<>{}\\]/, `${g.id}: no code, markup or variables`);
      assert.doesNotMatch(g.text, /^(FOR|ROUTINE|SIZE|RESULT|PLAN READY|PLAN FIRST|STOPPED|VERDICT)\b/m, `${g.id}: no markers`);
      assert.match(g.text, /^[A-Z[]/, `${g.id}: starts as a sentence`);
      assert.match(g.text.trim(), /[.?!\]]$/, `${g.id}: ends as a sentence`);
      for (const b of blanksOf(g.text)) assert.match(b, /^[a-z][a-z'-]*( [a-z][a-z'-]*){0,5}$/, `${g.id}: blank [${b}]`);
    }
  });

  test(`goals ${dep}: goes to an agent of that department or to nobody`, { skip }, () => {
    const roles = realRoles();
    for (const g of goalsOf()) {
      if (g.to === null) continue;
      const role = roles.find((r) => r.slug === g.to);
      assert.ok(role, `${g.id}: ${g.to} is in the company file`);
      if (dep === "general") assert.equal(g.to, "builder", `${g.id}: a company goal goes to the Builder or to nobody`);
      else assert.equal(role.department, dep, `${g.id}: ${g.to} works in ${dep}`);
    }
  });
}
