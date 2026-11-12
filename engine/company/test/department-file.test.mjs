// Tests for engine/company/lib/department-file.mjs and engine/company/departments.json
// (CONTRACTS-V3 31.1): the real file as the table pins it, then the loader on fixture files,
// one per rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DASHBOARDS, loadDepartmentFile } from "../lib/department-file.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "v3", "departments");
const COMPANY = join(HERE, "..");
const ROLES = [{ slug: "chief-of-staff" }, { slug: "builder" }, { slug: "sales" }];

// The seven of 31.1, in the order around the map: id, title, line, agents, dashboard, clusters.
const PINNED = [
  ["operations", "Operations", "plans · documents · checks", ["chief-of-staff", "builder", "checker", "art-director"], null,
    [["brain", "Company brain"], ["documents", "Documents"], ["planning", "Planning"]]],
  ["sales", "Sales", "leads · calls · deals", ["sales"], "customers", [["leads", "Leads"], ["calls", "Calls"], ["deals", "Deals"]]],
  // PLAN-V5 K10: the Researcher and its cluster, first in the order work goes.
  ["marketing", "Marketing", "ideas · writing · design", ["marketer", "researcher"], "marketing",
    [["research", "Research"], ["ideas", "Ideas"], ["writing", "Writing"], ["design", "Design"], ["review", "Review and memory"]]],
  ["studio", "Studio", "parts · pictures · motion", ["drafter", "artist"], "studio", [["parts", "Parts"], ["pictures", "Pictures"], ["motion", "Motion and video"]]],
  ["support", "Support", "requests · replies · answers", ["support"], "support", [["requests", "Requests"], ["replies", "Replies"], ["learning", "Learning"]]],
  ["people", "People", "staff · leave · joining", ["people"], "people", [["records", "Staff records"], ["leave", "Leave and attendance"], ["joining", "Joining"]]],
  ["books", "Books", "selling · buying · month end", ["bookkeeper"], "books", [["selling", "Selling"], ["buying", "Buying"], ["month-end", "Month end"]]],
];

const realRoles = () => JSON.parse(readFileSync(join(COMPANY, "company.json"), "utf8")).agents.map((a) => ({ slug: a.slug }));

test("departments.json is exactly the table of 31.1, in the order around the map", () => {
  const doc = JSON.parse(readFileSync(join(COMPANY, "departments.json"), "utf8"));
  assert.deepEqual(Object.keys(doc), ["departments"]);
  assert.deepEqual(doc.departments.map((d) => [d.id, d.title, d.line, d.agents, d.dashboard, d.clusters.map((c) => [c.id, c.title])]), PINNED);
  for (const d of doc.departments) {
    assert.deepEqual(Object.keys(d), ["id", "title", "line", "agents", "dashboard", "clusters"], d.id);
    for (const c of d.clusters) assert.deepEqual(Object.keys(c), ["id", "title"], `${d.id}/${c.id}`);
  }
});

test("departments.json loads with no problem against the company file", () => {
  const { departments, problems } = loadDepartmentFile(join(COMPANY, "departments.json"), realRoles());
  assert.deepEqual(problems, []);
  assert.equal(departments.length, 7);
  assert.equal(departments.reduce((n, d) => n + d.clusters.length, 0), 23);
});

test("every agent of the company file is in exactly one department", () => {
  const doc = JSON.parse(readFileSync(join(COMPANY, "departments.json"), "utf8"));
  const all = doc.departments.flatMap((d) => d.agents);
  assert.deepEqual([...all].sort(), realRoles().map((r) => r.slug).sort());
});

test("dashboards are the six department pages of version 2", () => {
  assert.deepEqual(DASHBOARDS, ["books", "customers", "support", "people", "marketing", "studio"]);
});

test("a valid fixture loads as written", () => {
  const { departments, problems } = loadDepartmentFile(join(FIX, "valid.json"), ROLES);
  assert.deepEqual(problems, []);
  assert.deepEqual(departments.map((d) => [d.id, d.dashboard, d.clusters.map((c) => c.id)]), [["operations", null, ["brain", "planning"]], ["sales", "customers", ["leads", "calls"]]]);
});

test("a missing file is one problem and no department", () => {
  assert.deepEqual(loadDepartmentFile(join(FIX, "no-such-file.json"), ROLES), { departments: [], problems: [{ file: "no-such-file.json", problem: "It does not exist." }] });
});

// File -> [what the one problem says, the departments that still load].
const BROKEN = {
  "extra-key": [/^The department sales has keys a department does not take: colour\.$/, ["operations"]],
  "missing-key": [/^The department sales has no line\.$/, ["operations"]],
  "bad-id": [/^Department 2 needs an id of 2 to 31 lower-case letters/, ["operations"]],
  "same-id": [/^The department operations is listed twice\.$/, ["operations"]],
  "agent-twice": [/^The agent builder is in the department operations and in the department sales; an agent works in one department\.$/, ["operations"]],
  "agent-missing": [/^These agents of the company file are in no department: sales\.$/, ["operations", "sales"]],
  "unknown-agent": [/^The department sales names agents that are not in the company file: cashier\.$/, ["operations"]],
  "bad-dashboard": [/^The department sales needs a dashboard of books, customers, support, people, marketing or studio, or none\.$/, ["operations"]],
  "no-clusters": [/^The department sales must have 1 to 5 clusters\.$/, ["operations"]],
  "six-clusters": [/^The department sales must have 1 to 5 clusters\.$/, ["operations"]],
  "not-json": [/^It is not valid JSON\.$/, []],
};

test("every broken fixture has an expectation", () => {
  const files = readdirSync(FIX).filter((f) => f !== "valid.json").map((f) => f.replace(/\.json$/, ""));
  assert.deepEqual(files.sort(), Object.keys(BROKEN).sort());
});

for (const [name, [problem, left]] of Object.entries(BROKEN)) {
  test(`a broken department file is reported in one plain sentence: ${name}`, () => {
    const { departments, problems } = loadDepartmentFile(join(FIX, `${name}.json`), ROLES);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.equal(problems[0].file, `${name}.json`);
    assert.match(problems[0].problem, problem);
    assert.deepEqual(departments.map((d) => d.id), left);
  });
}
