// Tests for engine/company/lib/routine-files.mjs (CONTRACTS-V2 section 18): first the loader on
// fixture files, one valid folder and one broken file per rule; then the shared tests of
// section 23 for the real routine files, which skip while a file does not exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoutineFiles, TOOL_NAMES } from "../lib/routine-files.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "routines");
const REAL = join(HERE, "..", "routines");
const ROLES = [
  { slug: "chief-of-staff", limits: { runMinutes: 15 } },
  { slug: "checker", limits: { runMinutes: 15 } },
  { slug: "bookkeeper", limits: { runMinutes: 15 } },
];

test("valid routine files load in name order, and other files are not read", () => {
  const { routines, problems } = loadRoutineFiles(join(FIX, "valid"), ROLES);
  assert.deepEqual(problems, []);
  assert.deepEqual(routines.map((r) => r.id), ["morning-note", "weekly-sums"]);
  const sums = routines[1];
  assert.equal(sums.agent, "bookkeeper");
  assert.deepEqual(sums.when, { cron: "30 10 * * 1", timezone: "Asia/Kolkata", plain: "Mondays at 10:30" });
  assert.deepEqual(sums.produces, ["sums.md", "sheets/*.csv"]);
  assert.equal(sums.file, "weekly-sums.json");
});

test("a missing folder is an empty list", () => {
  assert.deepEqual(loadRoutineFiles(join(FIX, "no-such-folder"), ROLES), { routines: [], problems: [] });
});

const BROKEN = {
  "Bad_Id.json": /^Its id must be lower-case letters/,
  "bad-cron.json": /^Its schedule must be five cron fields/,
  "bad-timezone.json": /^Its timezone must look like Asia\/Kolkata\.$/,
  "extra-key.json": /^It has keys a routine does not take: colour\.$/,
  "four-fields.json": /^Its schedule must be five cron fields/,
  "half-minutes.json": /^Its run time must be a whole number/,
  "long-plain.json": /^Its plain schedule must be 1 to 40 characters\.$/,
  "long-run.json": /^Its run time is longer than the agent's limit of 15 minutes\.$/,
  "long-title.json": /^Its title must be 1 to 80 characters\.$/,
  "no-produces.json": /^It must list 1 to 5 files it produces\.$/,
  "no-title.json": /^It has no title\.$/,
  "not-json.json": /^It is not valid JSON\.$/,
  "path-ask.json": /^Its ask names a full path on this Mac\.$/,
  "produces-full.json": /^Each file it produces must be a relative path/,
  "produces-up.json": /^Each file it produces must be a relative path/,
  "short-ask.json": /^Its ask must be 20 to 2000 characters\.$/,
  "tool-ask.json": /^Its ask names a tool by name\.$/,
  "unknown-agent.json": /^It names an agent that is not in the company file\.$/,
  "when-extra.json": /^Its when has keys it does not take: every\.$/,
  "wrong-id.json": /^Its id must match the file name \(another-id\.json\)\.$/,
  "zero-minutes.json": /^Its run time must be a whole number/,
};

test("each broken file is left out with one plain sentence for the rule it breaks", () => {
  const { routines, problems } = loadRoutineFiles(join(FIX, "broken"), ROLES);
  assert.deepEqual(routines, []);
  const files = readdirSync(join(FIX, "broken")).sort();
  assert.deepEqual(files, Object.keys(BROKEN).sort(), "every broken fixture has an expectation");
  for (const file of files) {
    const mine = problems.filter((p) => p.file === file);
    assert.equal(mine.length, 1, `${file}: ${JSON.stringify(mine)}`);
    assert.match(mine[0].problem, BROKEN[file], file);
    assert.doesNotMatch(mine[0].problem, /[{}<>`]|undefined|null/, file);
  }
});

test("a title used twice: the second file is refused", () => {
  const { routines, problems } = loadRoutineFiles(join(FIX, "duplicate"), ROLES);
  assert.deepEqual(routines.map((r) => r.id), ["a-first"]);
  assert.deepEqual(problems, [{ file: "b-second.json", problem: "Its title is already used by a-first.json." }]);
});

test("without the agent in the company file, a valid routine is refused", () => {
  const { routines, problems } = loadRoutineFiles(join(FIX, "valid"), ROLES.filter((r) => r.slug !== "bookkeeper"));
  assert.deepEqual(routines.map((r) => r.id), ["morning-note"]);
  assert.deepEqual(problems, [{ file: "weekly-sums.json", problem: "It names an agent that is not in the company file." }]);
});

// ---- Section 23: the real routine files (V36, V37). Each skips while its file does not exist.

// The roles straight from the company file, so these tests do not depend on the role files.
function realRoles() {
  const doc = JSON.parse(readFileSync(join(HERE, "..", "company.json"), "utf8"));
  return doc.agents.map((a) => ({ slug: a.slug, name: a.name, limits: { runMinutes: a.limits?.runMinutes ?? doc.defaults.limits.runMinutes } }));
}

const PINNED = {
  "daily-brief": { agent: "chief-of-staff", cron: "0 9 * * *", plain: "Daily at 09:00", produces: ["brief.md"], runMinutes: 10 },
  "weekly-content-plan": { agent: "marketer", cron: "0 10 * * 1", plain: "Mondays at 10:00", produces: ["content/*.md"], runMinutes: 15 },
};

for (const [id, pin] of Object.entries(PINNED)) {
  const file = join(REAL, `${id}.json`);
  const skip = existsSync(file) ? false : `${id}.json does not exist yet`;

  test(`routine ${id}: is a valid routine file`, { skip }, () => {
    const { routines, problems } = loadRoutineFiles(REAL, realRoles());
    assert.deepEqual(problems.filter((p) => p.file === `${id}.json`), []);
    assert.ok(routines.some((r) => r.id === id));
  });

  test(`routine ${id}: has the pinned schedule and agent`, { skip }, () => {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(doc.id, id);
    assert.equal(doc.agent, pin.agent);
    assert.equal(doc.when.cron, pin.cron);
    assert.equal(doc.when.timezone, "Asia/Kolkata");
    assert.equal(doc.when.plain, pin.plain);
    assert.deepEqual(doc.produces, pin.produces);
    assert.equal(doc.runMinutes, pin.runMinutes);
  });

  test(`routine ${id}: asks in plain words`, { skip }, () => {
    const { title, ask } = JSON.parse(readFileSync(file, "utf8"));
    for (const t of TOOL_NAMES) assert.ok(!new RegExp(`\\b${t}\\b`, "i").test(`${title} ${ask}`), `names ${t}`);
    assert.doesNotMatch(ask, /\/Users\/|~\/|\/private\/|\/tmp\/|https?:|www\./, "no path or address");
    assert.doesNotMatch(ask, /[`$<>{}\\]|\{\{/, "no code, markup or variables");
    assert.doesNotMatch(ask, /^(FOR|ROUTINE|SIZE|RESULT|PLAN READY|STOPPED|VERDICT):/m, "no markers; apply adds them");
    assert.match(ask, /^[A-Z]/, "starts as a sentence");
    assert.match(ask.trim(), /[.?!]$/, "ends as a sentence");
    assert.ok(ask.length >= 20 && ask.length <= 2000);
  });
}
