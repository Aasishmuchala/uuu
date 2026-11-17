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

// T65: the team as one kit table, with the model each agent runs on.
test("team: the table's words are pinned, and the model column comes only with the models' answer", () => {
  assert.deepEqual({ ...page.WORDS }, { agent: "Agent", role: "What it does", state: "State", now: "On now", model: "Model", nothing: "Nothing right now" });
  assert.deepEqual(page.teamColumns(false).map((c) => c.key), ["agent", "role", "state", "now"]);
  assert.deepEqual(page.teamColumns(true).map((c) => c.label), ["Agent", "What it does", "State", "On now", "Model"]);
});

test("team: the model is the plan's, or Omega Plus's pick while that is on", () => {
  const models = shape("models");
  assert.equal(models.mode, "plans");
  assert.equal(page.modelOf("builder", models), "sonnet");
  assert.equal(page.modelOf("builder", { ...models, mode: "provider" }), "Fable 5.1");
  assert.equal(page.modelOf("builder", { mode: "provider", agents: [{ slug: "builder", pick: "x-model" }] }), "x-model");
  assert.equal(page.modelOf("nobody", models), "");
  assert.equal(page.modelOf("builder", null), "");
  assert.equal(page.modelOf("", models), "");
  assert.equal(page.modelOf("a", { mode: "plans", agents: [{ slug: "a", plansModel: "y".repeat(90) }] }).length, 40);
});

test("team: the department is a link with its line icon, not a coloured chip", () => {
  const v = page.DeptChip({ department: { id: "marketing", title: "Marketing" } });
  const flat = JSON.stringify(v, (k, x) => (k === "__o" || k === "_owner" ? undefined : x));
  assert.doesNotMatch(flat, /k-chip|dot/);
  assert.match(flat, /Marketing/);
  assert.doesNotMatch(readFileSync(new URL("../../pages/team.js", import.meta.url), "utf8"), /Creature/);
});

// ---- Mounted in the shared test DOM with a fake fetch (PLAN-3D-ALL U10). ----
const dom = await import("../kit/_dom.mjs");
const { html, render } = dom;
const { AppContext } = await import("../../lib/context.js");
const { HOSTILE } = await import("../../world/fixtures.js");
const { glimpseSrc, GLIMPSES } = await import("../../kit/room.js");
const byCls = (root, c) => dom.elements(root).filter((e) => dom.classesOf(e).includes(c));

// Mounts #/team with `answers(path)` (undefined: never answered); every request is recorded as `METHOD path`.
async function mountTeam(answers, { query = "" } = {}) {
  dom.installDom();
  globalThis.document.visibilityState = "visible";
  const hash = `#/team${query ? `?${query}` : ""}`;
  globalThis.location = { hash, href: `/${hash}`, search: "" };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    const m = opts.method || "GET";
    calls.push(`${m} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}${m === "GET" ? "" : ` ${JSON.stringify(opts.headers)}`}`);
    const data = answers(String(path), m);
    if (data === undefined) return new Promise(() => {});
    return data ? { ok: true, status: 200, json: async () => data } : { ok: false, status: 500, json: async () => ({}) };
  };
  const tops = [];
  const nothing = () => {};
  const ctx = { shell: shape("shell"), refreshShell: nothing, announce: nothing, openComposer: nothing, openNeeds: nothing, dock: [], setTop: (t) => tops.push(t), settings: { motion: "off", theme: "dark" } };
  const root = new dom.FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${page.default} route=${{ id: "team", parts: ["team"], query: new URLSearchParams(query) }} /><//>`, root);
  await dom.settle();
  return { root, calls, tops, done: async () => { render(null, root); root.remove(); await dom.settle(50); globalThis.fetch = real; delete globalThis.location; } };
}

const SEEDED = (over = {}) => (path) => {
  const all = { "/api/team": shape("team"), "/api/map": shape("map"), "/api/models": shape("models"), ...over };
  return Object.hasOwn(all, path) ? all[path] : null;
};

test("team: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  const off = { ...shape("team"), connected: false, notConnected: { reason: "The board is switched off, so agents and tasks cannot be reached.", next: "Open Health to see how to start it." } };
  for (const answers of [SEEDED(), SEEDED({ "/api/team": off }), SEEDED({ "/api/team": undefined }), SEEDED({ "/api/team": null })]) {
    const m = await mountTeam(answers);
    try { seen.push(...m.calls); } finally { await m.done(); }
  }
  // Recorded on the page before PLAN-3D-ALL U10 changed it.
  const RECORDED = [
    "GET /api/team",
    "GET /api/map",
    "GET /api/models",
    "GET /api/team",
    "GET /api/map",
    "GET /api/models",
    "GET /api/team",
    "GET /api/map",
    "GET /api/models",
    "GET /api/team",
    "GET /api/map",
    "GET /api/models",
  ];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});
