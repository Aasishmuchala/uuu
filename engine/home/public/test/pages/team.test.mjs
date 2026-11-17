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

const { lampOf } = await import("../../world/state.js");
const textNodes = (root) => [...dom.walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);
const imgs = (root) => dom.elements(root).filter((e) => e.localName === "img");
const cardAs = (slug, over) => ({ ...shape("agent-card"), id: `a-${slug}`, slug, name: slug, ...over });

test("team: the title and its line stand in the room header with the façade's glimpse; one h1; the table on the ground (PLAN-3D-ALL U10)", async () => {
  const m = await mountTeam(SEEDED());
  try {
    const band = dom.elements(m.root).filter((e) => e.localName === "header" && dom.classesOf(e).includes("k-room"));
    assert.equal(band.length, 1);
    assert.equal(band[0].getAttribute("data-glimpse"), "facade");
    const h1 = dom.elements(m.root).filter((e) => e.localName === "h1");
    assert.equal(h1.length, 1);
    assert.equal(h1[0].getAttribute("id"), "page-title");
    assert.equal(dom.textOf(h1[0]), "Team");
    assert.equal(imgs(m.root).length, 1, "one picture: the band's");
    assert.equal(imgs(m.root)[0].getAttribute("src"), glimpseSrc("facade", { theme: "dark", width: 1280 }));
    assert.equal(imgs(m.root)[0].getAttribute("alt"), "");
    assert.equal(byCls(m.root, "k-page-header").length, 0, "PageHeader is replaced");
    assert.equal(byCls(band[0], "p-team__table").length, 0, "the table is not in the band");
    assert.equal(dom.elements(m.root).filter((e) => e.localName === "canvas").length, 0);
  } finally { await m.done(); }
  const off = await mountTeam(SEEDED(), { query: "glimpse=off" });
  try {
    assert.equal(imgs(off.root).length, 0, "glimpse=off: the band alone");
  } finally { await off.done(); }
  const css = readFileSync(new URL("../../styles/pages/team.css", import.meta.url), "utf8");
  const [wide, phone] = [...css.matchAll(/\.p-team \.k-room \{([^}]*)\}/g)].map((x) => x[1]);
  assert.match(wide, /z-index: 1;\s*min-height: 120px;\s*margin-top: calc\(-1 \* var\(--s-6\)\);\s*margin-bottom: var\(--s-4\);/, "up into the pane's margin (D9)");
  assert.match(phone, /min-height: 96px;\s*margin-top: calc\(-1 \* var\(--s-2\)\);/);
  assert.ok(!/data-surface|k-sheet/.test(css) && !/data-surface|<\$\{Sheet\}/.test(readFileSync(new URL("../../pages/team.js", import.meta.url), "utf8")), "nothing on paper here");
});

test("team: beside each name the Map's lamp in five states; the state's words unchanged (PLAN-3D-ALL U10)", async () => {
  const agents = [
    cardAs("w-one", { state: "working", plainState: "Working" }),
    cardAs("a-one", { state: "free", plainState: "Free", waitingForYou: true }),
    cardAs("s-one", { state: "problem", plainState: "Stuck: it needs the books switched on." }),
    cardAs("i-one", { state: "free", plainState: "Free" }),
    cardAs("o-one", { state: "paused", plainState: "Paused" }),
  ];
  const m = await mountTeam(SEEDED({ "/api/team": { ...shape("team"), agents } }));
  try {
    const lines = byCls(m.root, "p-team__name-line");
    assert.equal(lines.length, 5);
    const want = ["on", "amber", "red", "off", "down"];
    lines.forEach((line, i) => {
      const [lamp, name] = dom.elements(line).slice(1);
      assert.ok(dom.classesOf(lamp).includes(`k-lamp--${want[i]}`), `${agents[i].slug}: ${want[i]}`);
      assert.equal(want[i], lampOf(agents[i]));
      assert.equal(lamp.getAttribute("aria-hidden"), "true");
      assert.equal(name.localName, "a", "the name follows its lamp");
    });
    const words = textNodes(m.root);
    for (const w of ["Working", "Waiting for you", "Stuck: it needs the books switched on.", "Paused", "Free"]) assert.ok(words.includes(w), w);
  } finally { await m.done(); }
});

// PLAN-3D-ALL S1, checklist item 8.
test("team: a stuck agent's sentence and the board-off notice's reason and next step are whole, as sent (PLAN-3D-ALL U10)", async () => {
  const need = "Stuck: it needs the books switched on before it can draft the invoice, and it will wait for you until then.";
  const off = { reason: "The board is switched off, so agents and tasks cannot be reached right now, and nothing here is current.", next: "Start the board from Health, then come back here." };
  const m = await mountTeam(SEEDED({ "/api/team": { connected: false, notConnected: off, agents: [cardAs("s-one", { state: "problem", plainState: need })] } }));
  try {
    const words = textNodes(m.root);
    for (const s of [need, off.reason, off.next]) assert.ok(words.includes(s), `one text node: ${s}`);
  } finally { await m.done(); }
  const css = readFileSync(new URL("../../styles/pages/team.css", import.meta.url), "utf8");
  for (const r of css.matchAll(/\.p-team[^{]*(k-agent__state|k-st|k-notice|p-team__next|p-team__name-line)[^{]*\{([^}]*)\}/g)) {
    assert.doesNotMatch(r[2], /text-overflow|line-clamp|overflow: hidden|(^|[^-])height:/, r[0]);
  }
});

test("team: hostile server text stays text: no script, img, iframe or object beyond the band's; no on* attribute; no fixture text in href, src or style (PLAN-3D-ALL)", async () => {
  const bad = (i) => HOSTILE[i % HOSTILE.length];
  const tags = (root) => ["script", "img", "iframe", "object"].map((t) => dom.elements(root).filter((e) => e.localName === t).length);
  const agents = HOSTILE.map((_, i) => cardAs(`h-agent-${i}`, {
    name: bad(i), summary: bad(i + 1), plainState: bad(i + 2), state: ["working", "problem", "paused", "free"][i % 4], waitingForYou: i % 5 === 0,
    doingNow: { title: bad(i + 3), taskId: "t1" }, applied: i % 3 === 0 ? false : true,
  }));
  const map = { ...shape("map"), departments: [{ id: "sales", title: bad(0), agents: agents.slice(0, 3).map((a) => ({ slug: a.slug, name: a.name })) }, { id: bad(1), title: bad(2), agents: agents.slice(3).map((a) => a.slug) }] };
  const models = { mode: "provider", agents: agents.map((a, i) => ({ slug: a.slug, pickName: bad(i), plansModel: bad(i + 1) })) };
  const s = await mountTeam(SEEDED());
  let base;
  try { base = tags(s.root); } finally { await s.done(); }
  const m = await mountTeam(SEEDED({ "/api/team": { connected: false, notConnected: { reason: bad(0), next: bad(2) }, agents }, "/api/map": map, "/api/models": models }));
  try {
    assert.deepEqual(tags(m.root), base);
    for (const e of dom.elements(m.root)) {
      for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
      for (const h of HOSTILE) for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
      if (e.localName === "img") assert.ok(GLIMPSES.some((k) => ["dark", "light"].some((theme) => [1280, 390].some((w) => glimpseSrc(k, { theme, width: w }) === e.getAttribute("src")))));
      if (dom.classesOf(e).includes("k-lamp")) assert.ok(/^k-lamp k-lamp--(on|amber|red|off|down) k-lamp--(disc|halo|ring|hollow|line)$/.test(e.getAttribute("class")));
    }
    assert.ok(textNodes(m.root).includes(bad(0)), "a hostile name is a text node");
  } finally { await m.done(); }
});
