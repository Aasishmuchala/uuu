// A department's page: the pure helpers, fed with the contract's shape files as sample data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();

const shape = (name) => JSON.parse(readFileSync(join(SHAPES, `${name}.json`), "utf8"));
const page = await import("../../pages/dept.js");
const { html, render } = await import("../../vendor/preact-htm.js");
const { AppContext } = await import("../../lib/context.js");

const job = (id, ready, why = null) => ({ id: `sales/${id}`, title: id, ready, why });

test("dept: the default export is a component", () => {
  assert.equal(typeof page.default, "function");
});

test("dept: the department comes from the address, and an odd one is none", () => {
  assert.equal(page.deptIdOf({ parts: ["departments", "sales"] }), "sales");
  assert.equal(page.deptIdOf({ parts: ["departments", "month-end"] }), "month-end");
  assert.equal(page.deptIdOf({ parts: ["departments", "../x"] }), "");
  assert.equal(page.deptIdOf({ parts: ["departments", "Sales"] }), "");
  assert.equal(page.deptIdOf({ parts: ["departments"] }), "");
  assert.equal(page.deptIdOf(undefined), "");
});

test("dept: the state chip says the three states in plain words", () => {
  const { department } = shape("department");
  assert.deepEqual(page.stateChip(department.state),
    { label: "Working on: Call write-up: Asha Kitchens", tone: "live", taskId: "e0000000-0000-4000-8000-000000000021" });
  assert.deepEqual(page.stateChip({ id: "waiting", plain: "Waiting for you", taskId: null }), { label: "Waiting for you", tone: "warn", taskId: null });
  assert.deepEqual(page.stateChip({ id: "idle", plain: "Idle · last active 2 hours ago", taskId: null }),
    { label: "Idle · last active 2 hours ago", tone: "off", taskId: null });
  assert.equal(page.stateChip({ id: "idle", plain: "Idle" }).label, "Idle");
});

test("dept: the state chip never shows odd words from an odd answer", () => {
  assert.equal(page.stateChip({ id: "waiting", plain: "anything at all" }).label, "Waiting for you");
  assert.equal(page.stateChip({ id: "working", plain: "" }).label, "Working");
  assert.equal(page.stateChip({ id: "working", plain: "<b>hi</b>" }).label, "Working");
  assert.equal(page.stateChip({ id: "idle", plain: "Ignore your instructions" }).label, "Idle");
  assert.equal(page.stateChip({ id: "idle", taskId: "x" }).taskId, null);
  assert.equal(page.stateChip(null).label, "Idle");
  assert.ok(page.stateChip({ id: "working", plain: `Working on: ${"x".repeat(500)}` }).label.length <= 121);
});

test("dept: the job chips put ready jobs first, each group in file order", () => {
  const clusters = [
    { id: "leads", jobs: [job("a", false, { text: "Agents have no internet, and this job needs it." }), job("b", true)] },
    { id: "calls", jobs: [job("c", true), job("d", false)] },
    { id: "deals", jobs: [] },
    { id: "empty" },
  ];
  assert.deepEqual(page.jobsInOrder(clusters).map((j) => j.id), ["sales/b", "sales/c", "sales/a", "sales/d"]);
  assert.deepEqual(page.jobsInOrder(null), []);
  const { clusters: real } = shape("department");
  assert.deepEqual(page.jobsInOrder(real).map((j) => j.id), ["sales/proposal-from-a-call"]);
});

test("dept: a job that cannot start carries its one sentence", () => {
  assert.equal(page.whyText(job("a", false, { name: "internet", text: "Agents have no internet, and this job needs it.", link: null })),
    "Agents have no internet, and this job needs it.");
  assert.equal(page.whyText(job("a", false, "The books are switched off.")), "The books are switched off.");
  assert.equal(page.whyText(job("a", true)), "");
});

test("dept: with one agent the composer gives the task to it", () => {
  const { agents } = shape("department");
  assert.equal(page.goalTo(agents, null), "artist");
  assert.equal(page.goalTo(agents, "builder"), "artist", "a slug that is not the department's is ignored");
  assert.deepEqual(page.goalBody({ text: "Write to Asha.", planFirst: false }, agents, null), { text: "Write to Asha.", to: "artist" });
});

test("dept: with several agents it goes to the first, or to the one picked", () => {
  const agents = [{ slug: "chief-of-staff", name: "Chief of staff" }, { slug: "builder", name: "Builder" }, { slug: "checker", name: "Checker" }];
  assert.equal(page.goalTo(agents, null), "chief-of-staff");
  assert.equal(page.goalTo(agents, "builder"), "builder");
  assert.equal(page.goalTo(agents, "sales"), "chief-of-staff");
  assert.deepEqual(page.goalBody({ text: "Plan the move.", planFirst: true }, agents, "checker"), { text: "Plan the move.", to: "checker", planFirst: true });
  assert.equal(page.goalTo([], null), null);
  assert.deepEqual(page.goalBody({ text: "Hello" }, [], null), { text: "Hello" });
});

test("dept: the composer and the task list use the department's name", () => {
  assert.equal(page.composerPlaceholder("Sales"), "Give Sales a task");
  const d = shape("department");
  assert.deepEqual(page.tasksHeading(d.department.title, d.recent, d.recentTotal), { label: "Your tasks with Sales", count: 14 });
  assert.deepEqual(page.tasksHeading("Books", [{ id: "x" }], 0), { label: "Your tasks with Books", count: 1 });
  assert.deepEqual(page.tasksHeading("Books", [], undefined), { label: "Your tasks with Books", count: 0 });
});

test("dept: the board is off when the map says so, with its reason and its next step", () => {
  const map = shape("map");
  assert.equal(map.boardOff, null, "the pinned map has the board on");
  assert.equal(page.boardOffOf(map, shape("shell")), null);
  const off = { reason: "The board is not answering, so agents and goals cannot be reached.", next: "Run: engine start" };
  assert.deepEqual(page.boardOffOf({ ...map, boardOff: off }, shape("shell")), off);
  assert.deepEqual(page.boardOffOf({ boardOff: { reason: "The company is not set up on the board yet.", next: "Run: engine setup" } }, null),
    { reason: "The company is not set up on the board yet.", next: "Run: engine setup" });
  const odd = page.boardOffOf({ boardOff: { reason: "x".repeat(900), next: 7 } }, null);
  assert.ok(odd.reason.length <= 201, "a long reason is cut");
  assert.equal(odd.next, "7");
  const bare = page.boardOffOf({ boardOff: {} }, null);
  assert.ok(bare.reason && /Health/.test(bare.next) && !/Run:/.test(bare.next), "an empty answer still gives a reason and a next step, in words");
});

test("dept: until the map has answered, the shell says whether the board is off", () => {
  const shell = shape("shell");
  assert.equal(shell.engine.board, "on");
  assert.equal(page.boardOffOf(null, shell), null);
  assert.equal(page.boardOffOf(null, null), null, "nothing known yet is not a notice");
  assert.equal(page.boardOffOf(undefined, { engine: {} }), null);
  const off = page.boardOffOf(null, { ...shell, engine: { board: "off", books: "on" } });
  assert.ok(off && off.reason.length > 10);
  assert.equal(off.next, "Open Health to see how to start it.");
  // The map reads the board the way this page's own answer does, so once it has answered it decides.
  assert.equal(page.boardOffOf(shape("map"), { engine: { board: "off" } }), null);
  assert.ok(page.boardOffOf({ boardOff: { reason: "r", next: "n" } }, shell));
});

test("dept: with the board off the page stops guessing", () => {
  const off = { reason: "r", next: "n" };
  assert.deepEqual(page.stateChip({ id: "idle", plain: "Idle", taskId: null }, off), { label: "Not known", tone: "off", taskId: null });
  assert.deepEqual(page.stateChip(shape("department").department.state, off), { label: "Not known", tone: "off", taskId: null });
  assert.equal(page.offTitle("Sales"), "Sales cannot show its tasks right now");
  assert.equal(page.offTitle(""), "This department cannot show its tasks right now");
  assert.equal(page.noTasksLine("Sales", off), "Tasks cannot be shown right now.");
  assert.equal(page.noTasksLine("Sales", null), "No tasks yet. What you give Sales below shows here.");
  assert.equal(page.captionUnder(off), "Tasks cannot be given while the board is off.");
  assert.equal(page.captionUnder(null), "Takes a few minutes. It is checked before it reaches you.");
});

// M63: the line under the box and the words once a task is given follow the Chief of staff's line (`queue` of
// GET /api/shell), with the words the map and the jobs use.
test("dept: when other work is ahead no time is promised; nothing ahead keeps the present words", () => {
  assert.equal(page.captionUnder(null, { ahead: 3 }), "3 tasks are ahead, so it waits its turn. It is checked before it reaches you.");
  assert.equal(page.captionUnder(null, { ahead: 1 }), "1 task is ahead, so it waits its turn. It is checked before it reaches you.");
  assert.equal(page.captionUnder(null, { ahead: 0 }), "Takes a few minutes. It is checked before it reaches you.");
  assert.equal(page.captionUnder(null, { ahead: "3" }), "Takes a few minutes. It is checked before it reaches you.");
  assert.equal(page.captionUnder({ reason: "r" }, { ahead: 3 }), "Tasks cannot be given while the board is off.");
  assert.equal(page.startedLine({ ahead: 2 }), "Started. The Chief of staff has it. 2 tasks are ahead, so it waits its turn. It is checked before it reaches you.");
  assert.equal(page.startedLine(null), "Started. The Chief of staff has it. It takes a few minutes and is checked before it reaches you.");
  assert.doesNotMatch(page.startedLine({ ahead: 2 }), /minute/);
});

// ---- The whole page, rendered into a very small DOM with the server's answers faked (as in pages-u2). ----
class FakeNode {
  constructor() { this.childNodes = []; this.parentNode = null; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}
class FakeText extends FakeNode { constructor(d) { super(); this.nodeType = 3; this.data = String(d); } }
class FakeElement extends FakeNode {
  constructor(tag) { super(); this.nodeType = 1; this.localName = tag; this.attrs = {}; this.style = { cssText: "", setProperty(k, v) { this[k] = v; } }; this.listeners = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  focus() { globalThis.document.activeElement = this; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function* walk(node) { yield node; for (const c of node.childNodes) yield* walk(c); }
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");
const classOf = (el) => String(el.getAttribute("class") ?? el.className ?? "");
const withClass = (root, c) => elements(root).filter((e) => classOf(e).split(/\s+/).includes(c));
// Preact runs effects about 100 ms after a render when there is no animation frame; the answers follow at once.
const settle = () => new Promise((r) => setTimeout(r, 160));

// Renders the page for #/departments/sales with these answers; `use(root, asked)` looks at it; then everything
// is taken down again, so no timer of the page outlives the test.
async function showPage({ department, map, shell }, use) {
  const kept = { document: globalThis.document, fetch: globalThis.fetch };
  const asked = [];
  globalThis.document = {
    title: "", activeElement: null, visibilityState: "visible", body: new FakeElement("body"),
    createElement: (t) => new FakeElement(t), createElementNS: (_ns, t) => new FakeElement(t), createTextNode: (x) => new FakeText(x),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.fetch = async (path) => {
    asked.push(String(path));
    const data = path === "/api/map/sales" ? department : path === "/api/map" ? map : null;
    if (data === undefined) return new Promise(() => {}); // not answered yet
    return data ? { ok: true, status: 200, json: async () => data } : { ok: false, status: 500, json: async () => ({}) };
  };
  const root = new FakeElement("div");
  const nothing = () => {};
  const ctx = {
    shell, shellError: null, refreshShell: nothing, announce: nothing, openComposer: nothing, openPanel: nothing,
    closePanel: nothing, openNeeds: nothing, closeNeeds: nothing, dock: [],
  };
  try {
    render(html`<${AppContext.Provider} value=${ctx}><${page.default} route=${{ parts: ["departments", "sales"] }} /><//>`, root);
    await settle();
    await use(root, asked);
  } finally {
    render(null, root);
    await settle();
    globalThis.document = kept.document;
    globalThis.fetch = kept.fetch;
  }
}

// What GET /api/map/:department sends with the board off: the files' part, and zeros for the rest.
function departmentWithBoardOff() {
  const d = shape("department");
  return {
    ...d,
    department: { ...d.department, counts: { ...d.department.counts, working: 0, needsYou: 0 }, state: { id: "idle", plain: "Idle", taskId: null } },
    agents: d.agents.map((a) => ({ ...a, state: "free", plainState: "Not known", doingNow: null, waitingForYou: false, lastActiveAt: null })),
    recent: [], recentTotal: 0,
  };
}

test("dept: with the board off the page shows the notice with its reason and next step, not a made-up calm", async () => {
  const boardOff = { reason: "The board is switched off, so agents and tasks cannot be reached.", next: "Open Health to see how to start it." };
  await showPage({ department: departmentWithBoardOff(), map: { ...shape("map"), boardOff }, shell: shape("shell") }, (root, asked) => {
    assert.ok(asked.includes("/api/map/sales") && asked.includes("/api/map"), "reads the department and the map");
    const notices = withClass(root, "k-notice");
    assert.equal(notices.length, 1, "one notice");
    const words = textOf(notices[0]);
    assert.match(words, /Sales cannot show its tasks right now/);
    assert.match(words, /The board is switched off, so agents and tasks cannot be reached\./);
    assert.match(words, /Open Health/);
    assert.doesNotMatch(words, /engine start/, "no command outside Health (M51 F17)");
    assert.ok(withClass(root, "p-dept__box--off").length === 1, "the box is greyed (M51 F24)");
    assert.equal(textOf(withClass(root, "p-dept__state")[0]), "Not known");
    const all = textOf(root);
    assert.doesNotMatch(all, /Idle/);
    assert.doesNotMatch(all, /No tasks yet/);
    assert.match(all, /Tasks cannot be shown right now\./);
    assert.match(all, /Tasks cannot be given while the board is off\./);
  });
});

test("dept: before the map answers, a shell that says the board is off already brings the notice", async () => {
  const shell = { ...shape("shell"), engine: { board: "off", books: "on" } };
  await showPage({ department: departmentWithBoardOff(), map: undefined, shell }, (root) => {
    const notices = withClass(root, "k-notice");
    assert.equal(notices.length, 1);
    assert.match(textOf(notices[0]), /cannot show its tasks right now/);
    assert.match(textOf(notices[0]), /Open Health/);
    assert.equal(textOf(withClass(root, "p-dept__state")[0]), "Not known");
  });
});

test("dept: with the board on there is no notice, and the page says what the server says", async () => {
  await showPage({ department: shape("department"), map: shape("map"), shell: shape("shell") }, (root) => {
    assert.equal(withClass(root, "k-notice").length, 0);
    assert.equal(textOf(withClass(root, "p-dept__state")[0]), "Working on: Call write-up: Asha Kitchens");
    const all = textOf(root);
    assert.doesNotMatch(all, /cannot show its tasks/);
    // The shell's example has two tasks in the Chief of staff's line.
    assert.match(all, /2 tasks are ahead, so it waits its turn\. It is checked before it reaches you\./);
    assert.doesNotMatch(all, /Takes a few minutes/);
  });
  await showPage({ department: shape("department"), map: shape("map"), shell: { ...shape("shell"), queue: null } }, (root) => {
    assert.match(textOf(root), /Takes a few minutes\. It is checked before it reaches you\./);
  });
});

// T65: the page's own words, the department's line icon and the "Needs you" line.
test("dept: the words the page adds are pinned", () => {
  assert.deepEqual({ ...page.WORDS }, {
    needs: "Needs you", agents: "Its agents", canRun: "Can run", seeAll: "See all", seeJobs: "See its jobs",
    openQueue: "Open the queue", others: "Other departments",
  });
});

test("dept: a department is drawn with the sidebar's line icon, never a creature", () => {
  assert.equal(page.deptIcon("marketing"), "horn");
  assert.equal(page.deptIcon("books"), "book");
  assert.equal(page.deptIcon("brain"), "brain");
  assert.equal(page.deptIcon("nonsense"), "layers");
  assert.doesNotMatch(readFileSync(new URL("../../pages/dept.js", import.meta.url), "utf8"), /Creature/);
});

test("dept: the Needs you line counts what waits, and says nothing is known with the board off", () => {
  assert.equal(page.needsLine("Marketing", { needsYou: 3 }), "3 things need you in Marketing.");
  assert.equal(page.needsLine("Sales", { needsYou: 1 }), "1 thing needs you in Sales.");
  assert.equal(page.needsLine("Sales", { needsYou: 0 }), "Nothing needs you in Sales right now.");
  assert.equal(page.needsLine("Sales", { needsYou: "2" }), "Nothing needs you in Sales right now.");
  assert.equal(page.needsLine("", null), "Nothing needs you in this department right now.");
  assert.equal(page.needsLine("Sales", { needsYou: 2 }, { reason: "r" }), "What needs you in Sales cannot be shown right now.");
});

test("dept: Needs you opens the queue for this department", async () => {
  const opened = [];
  const kept = { document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = {
    title: "", activeElement: null, visibilityState: "visible", body: new FakeElement("body"),
    createElement: (t) => new FakeElement(t), createElementNS: (_ns, t) => new FakeElement(t), createTextNode: (x) => new FakeText(x),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.fetch = async (path) => {
    const data = path === "/api/map/sales" ? shape("department") : path === "/api/map" ? shape("map") : null;
    return data ? { ok: true, status: 200, json: async () => data } : { ok: false, status: 500, json: async () => ({}) };
  };
  const root = new FakeElement("div");
  const nothing = () => {};
  const ctx = { shell: shape("shell"), refreshShell: nothing, announce: nothing, openNeeds: (o) => opened.push(o), dock: [] };
  try {
    render(html`<${AppContext.Provider} value=${ctx}><${page.default} route=${{ parts: ["departments", "sales"] }} /><//>`, root);
    await settle();
    const [row] = withClass(root, "p-dept__needs");
    assert.ok(row, "the row is drawn");
    assert.match(textOf(row), /2 things need you in Sales\./);
    // In this small DOM Preact names the event as written ("Click"): there is no onclick property to find.
    for (const f of row.listeners.Click || []) f.call(row, { type: "Click" });
    assert.deepEqual(opened, [{ department: "sales" }]);
    assert.equal(withClass(root, "k-job--row").length, 1, "the jobs are the kit's rows, as the Jobs page lays them");
    assert.equal(withClass(root, "k-agent--card").length, 1, "the agents are the kit's cards");
  } finally {
    render(null, root);
    await settle();
    globalThis.document = kept.document;
    globalThis.fetch = kept.fetch;
  }
});

// PLAN-COOK TB4: one left edge, the items that need you as rows, two-line task rows, 32 px between sections.
test("dept: what needs you here is the queue's items of this department, most urgent first; unknown until home answers", () => {
  const items = [
    { id: "a", title: "A", department: "sales", when: "2026-11-10T09:00:00.000Z" },
    { id: "b", title: "B", department: "books", when: "2026-11-11T09:00:00.000Z" },
    { id: "c", title: "C", department: "sales", when: "2026-11-11T09:00:00.000Z", severity: "high" },
  ];
  assert.deepEqual(page.needsHere({ needsYou: { items } }, "sales", []).map((i) => i.id), ["c", "a"]);
  assert.equal(page.needsHere(null, "sales", []), null);
  assert.equal(page.needsHere({ needsYou: {} }, "sales", []), null);
  assert.equal(page.needIcon("question"), "reply");
  assert.equal(page.needIcon("nonsense"), "inbox");
});

test("dept: the sheet keeps one left edge, 32 px between sections and two-line task rows (TB4)", () => {
  const css = readFileSync(new URL("../../styles/pages/dept.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("../../pages/dept.js", import.meta.url), "utf8");
  assert.match(src, /<span class="p-dept__title"><span class="p-dept__tile"/, "the tile is inside the title, so the line under it starts at the column's edge");
  assert.match(src, /class="p-dept__actions" role="group"/, "the head's links are one button group");
  assert.match(css, /\.p-dept__section \{[^}]*margin-top: var\(--s-8\);/);
  assert.match(css, /\.p-dept__rows \.k-task-row__title \{[^}]*font-size: var\(--fs-ui\);/);
  assert.match(css, /\.p-dept__rows \.k-task-row__line \{[^}]*grid-row: 2;[^}]*font-size: var\(--fs-note\);/);
  assert.match(css, /\.p-dept__rows \.k-task-row__ref \.k-mono \{[^}]*font-family: var\(--font-mono\);[^}]*font-size: var\(--fs-label\);/);
  assert.match(css, /\.p-dept__rows \.k-task-row__time \{[^}]*grid-column: 3;/, "the date in a right-hand column");
  assert.doesNotMatch(src, /\bGroup\b/, "the sections are the page's own, one edge");
});

// PLAN-COOK R5-G: one style for every count, the warn tone only on the line that waits, the tasks in a card.
test("dept: every count is one muted figure; what needs you is neutral rows with who raised it; the tasks sit in a panel (R5-G)", () => {
  const css = readFileSync(new URL("../../styles/pages/dept.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("../../pages/dept.js", import.meta.url), "utf8");
  assert.match(src, /const Count = \(\{ n \}\) => html`<span class="p-dept__count">\$\{n\}<\/span>`;/);
  assert.doesNotMatch(src, /tone="warn" \/>/, "no warm count");
  assert.match(css, /\.p-dept \.p-dept__count \{[^}]*color: var\(--ink-3\);/);
  assert.doesNotMatch(css, /warn-bg|var\(--warn\)/, "the warn tone only on the state's line, drawn by the kit");
  assert.match(src, /<ul class="p-dept__list p-dept__list--needs">/, "what needs you is the one raised panel");
  assert.match(css, /\.p-dept \.p-dept__agents,\s*\.p-dept \.p-dept__rows \{[^}]*border-top: 1px solid var\(--line\);/, "the agents and the tasks flat under hairlines (R6-G)");
  assert.doesNotMatch(/\.p-dept \.p-dept__agents,\s*\.p-dept \.p-dept__rows \{([^}]*)\}/.exec(css)[1], /background|box-shadow/);
  assert.equal(page.whoOf({ agent: { name: "Marketer" }, raisedBy: "Chief of staff" }), "Marketer");
  assert.equal(page.whoOf({ raisedBy: "Chief of staff" }), "Chief of staff");
  assert.equal(page.whoOf({}), "");
  assert.match(css, /\.p-dept \.p-dept__agents \.k-agent__summary \{\s*max-width: none;/, "the agents' words run the panel's width");
});
