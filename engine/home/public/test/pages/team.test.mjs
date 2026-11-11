// Team page: the pure helpers, fed with the contract's shape files as sample data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shape = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../server/test/shapes/${name}.json`, import.meta.url)), "utf8"));
const page = await import("../../pages/team.js");

test("team: the default export is a component", () => {
  assert.equal(typeof page.default, "function");
});

test("team: an agent's department is shown in plain words", () => {
  const shell = shape("shell");
  const team = shape("team");
  assert.equal(page.departmentLabel(team.agents[0].department, shell.departments), "Studio");
  assert.equal(page.departmentLabel("books", shell.departments), "Books");
  assert.equal(page.departmentLabel(null, shell.departments), "Company");
  assert.deepEqual(page.cardNotes(team.agents[0], shell.departments), ["Studio"]);
});

test("team: an agent not set up yet carries the note", () => {
  const agent = { ...shape("agent-card"), applied: false };
  assert.deepEqual(page.cardNotes(agent, []), ["Studio", "Not set up yet. Run: engine setup"]);
});

test("team: the lead line counts agents and who is working", () => {
  const a = shape("agent-card");
  assert.equal(page.teamLead([]), "");
  assert.equal(page.teamLead([a]), "1 agent. None is working right now.");
  assert.equal(page.teamLead([a, { ...a, slug: "x", state: "working" }]), "2 agents. 1 working now.");
});
