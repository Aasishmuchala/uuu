// Team page: the pure helpers, fed with the contract's shape files as sample data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();

const shape = (name) => JSON.parse(readFileSync(join(SHAPES, `${name}.json`), "utf8"));
const page = await import("../../pages/team.js");

const MAP_DEPARTMENTS = [
  { id: "operations", title: "Operations", agents: [{ slug: "chief-of-staff", name: "Chief of staff" }, { slug: "builder", name: "Builder" }] },
  { id: "studio", title: "Studio", agents: [{ slug: "drafter", name: "Drafter" }, { slug: "artist", name: "Artist" }] },
  { id: "sales", title: "Sales", agents: ["sales"] },
];

test("team: the default export is a component", () => {
  assert.equal(typeof page.default, "function");
});

test("team: an agent's department is the map's, in plain words", () => {
  const team = shape("team");
  assert.deepEqual(page.departmentOf(team.agents[0].slug, MAP_DEPARTMENTS), { id: "studio", title: "Studio" });
  assert.deepEqual(page.departmentOf("chief-of-staff", MAP_DEPARTMENTS), { id: "operations", title: "Operations" });
  assert.deepEqual(page.departmentOf("sales", MAP_DEPARTMENTS), { id: "sales", title: "Sales" }, "an agent may be named by slug alone");
});

test("team: the department is taken from the map's departments, not from the agent card's old department", () => {
  const map = shape("map");
  const slug = map.departments[0].agents[0].slug;
  assert.deepEqual(page.departmentOf(slug, map.departments), { id: map.departments[0].id, title: map.departments[0].title });
  // The agent card's own `department` (CONTRACTS-V2) is "customers" for Sales; the chip says Sales.
  assert.equal(page.departmentOf("sales", MAP_DEPARTMENTS).id, "sales");
});

test("team: no chip while the map is not read, or for an agent it does not name", () => {
  assert.equal(page.departmentOf("artist", []), null);
  assert.equal(page.departmentOf("artist", undefined), null);
  assert.equal(page.departmentOf("nobody", MAP_DEPARTMENTS), null);
  assert.equal(page.departmentOf("", MAP_DEPARTMENTS), null);
  assert.equal(page.departmentOf("x", [{ id: "../bad", title: "Bad", agents: ["x"] }]), null, "an odd department id is skipped");
});

test("team: an agent not set up yet carries the note, in words and with no command", () => {
  const agent = { ...shape("agent-card"), applied: false };
  assert.deepEqual(page.cardNotes(agent), ["Not set up yet."]);
  assert.deepEqual(page.cardNotes(shape("agent-card")), []);
});

test("team: with the board off (applied not known) no card tells the owner to set the agent up (M51 F1)", () => {
  const off = { ...shape("agent-card"), applied: null, state: "free", plainState: "Not known" };
  assert.deepEqual(page.cardNotes(off), []);
});

test("team: the not-connected next step is words and a link to Health, never a command", () => {
  const v = page.HealthNext({ text: "Run: engine start" });
  const flat = JSON.stringify(v, (k, x) => (k === "__o" || k === "_owner" ? undefined : x));
  assert.ok(!/engine start/.test(flat));
  assert.match(flat, /#\/health/);
});

test("team: the lead line counts agents and who is working", () => {
  const a = shape("agent-card");
  assert.equal(page.teamLead([]), "");
  assert.equal(page.teamLead([a]), "1 agent. None is working right now.");
  assert.equal(page.teamLead([a, { ...a, slug: "x", state: "working" }]), "2 agents. 1 working now.");
});

test("team: the department chip is a link to the department, and nothing without one", () => {
  assert.equal(page.DeptChip({ department: null }), null);
  assert.equal(page.DeptChip({ department: { id: "javascript:x", title: "X" } }), null);
  const v = page.DeptChip({ department: { id: "sales", title: "Sales" } });
  assert.ok(v && v.props, "renders a link");
  assert.equal(v.props.href, "#/departments/sales");
});

test("team: a next step that already says Open Health links those words, not a second time", () => {
  const v = page.HealthNext({ text: "Open Health to see how to start it." });
  const flat = JSON.stringify(v, (k, x) => (k === "__o" || k === "_owner" ? undefined : x));
  assert.equal((flat.match(/Open Health/g) || []).length, 1);
  assert.match(flat, /to see how to start it\./);
});
