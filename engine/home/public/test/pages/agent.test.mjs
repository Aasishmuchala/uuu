// An agent's page: the pure helpers, fed with the contract's shape files as sample data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { existsSync as __ex } from "node:fs";
import { dirname as __dn, join as __jn } from "node:path";
import { fileURLToPath as __fp } from "node:url";
// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = __dn(__fp(import.meta.url)); for (;;) { const c = __jn(d, "server", "test", "shapes"); if (__ex(c)) return c; const p = __dn(d); if (p === d) throw new Error("shape files not found"); d = p; } })();

const shape = (name) => JSON.parse(readFileSync(__jn(SHAPES, `${name}.json`), "utf8"));
const page = await import("../../pages/agent.js");

test("agent: the default export is a component", () => {
  assert.equal(typeof page.default, "function");
});

test("agent: the tab comes from the address, Talk by default", () => {
  const q = (s) => new URLSearchParams(s);
  assert.equal(page.pickTab(q("")), "talk");
  assert.equal(page.pickTab(q("tab=lessons")), "lessons");
  assert.equal(page.pickTab(q("tab=profile")), "profile");
  assert.equal(page.pickTab(q("tab=nonsense")), "talk");
  assert.equal(page.pickTab(undefined), "talk");
  assert.equal(page.tabHref("artist", "talk"), "#/team/artist");
  assert.equal(page.tabHref("artist", "work"), "#/team/artist?tab=work");
});

test("agent: the limits read as one sentence", () => {
  const { profile } = shape("agent");
  assert.equal(page.limitsSentence(profile.limits), "Works on one task at a time, for up to 15 minutes a run.");
  assert.equal(page.limitsSentence({ runMinutes: 1, oneAtATime: true }), "Works on one task at a time, for up to 1 minute a run.");
  assert.equal(page.limitsSentence({ oneAtATime: false, runMinutes: 30 }), "Works on more than one task at a time, for up to 30 minutes a run.");
  assert.equal(page.limitsSentence(null), "Works on one task at a time.");
});

test("agent: Pause or Resume, hidden when not set up", () => {
  const { agent } = shape("agent");
  assert.equal(page.pauseAction(agent), "pause");
  assert.equal(page.pauseAction({ ...agent, state: "paused" }), "resume");
  assert.equal(page.pauseAction({ ...agent, state: "problem" }), "resume");
  assert.equal(page.pauseAction({ ...agent, applied: false }), null);
  assert.equal(page.pauseAction(null), null);
});

test("agent: the composer offers the jobs of its department that this agent does, ready ones first", () => {
  const department = shape("department");
  assert.deepEqual(page.jobsFor(department, "artist").map((j) => j.id), ["sales/proposal-from-a-call"]);
  assert.deepEqual(page.jobsFor(department, "sales"), []);
  const studio = { clusters: [
    { id: "parts", jobs: [{ id: "studio/plate", who: [{ slug: "drafter" }], ready: true }] },
    { id: "pictures", jobs: [{ id: "studio/icons", who: [{ slug: "artist" }], ready: false }, { id: "studio/badge", who: ["artist"], ready: true }] },
  ] };
  assert.deepEqual(page.jobsFor(studio, "artist").map((j) => j.id), ["studio/badge", "studio/icons"]);
  assert.deepEqual(page.jobsFor(studio, "drafter").map((j) => j.id), ["studio/plate"]);
  const ops = { clusters: [{ id: "planning", jobs: [{ id: "operations/week", who: [], ready: true }, { id: "operations/doc", who: [{ slug: "builder" }], ready: true }] }] };
  assert.deepEqual(page.jobsFor(ops, "chief-of-staff").map((j) => j.id), ["operations/week"], "the Chief of staff plans the jobs nobody is named for");
  assert.deepEqual(page.jobsFor(ops, "builder").map((j) => j.id), ["operations/doc"]);
  assert.deepEqual(page.jobsFor(null, "artist"), []);
});

test("agent: the department chip names the map's department of this agent", async () => {
  const team = await import("../../pages/team.js");
  const map = shape("map");
  const who = map.departments[0].agents[0];
  assert.deepEqual(team.departmentOf(who.slug, map.departments), { id: map.departments[0].id, title: map.departments[0].title });
});

test("agent: a task handed here names the agent, except the Chief of staff", () => {
  assert.deepEqual(page.goalBody({ text: "Draw a cat.", planFirst: false }, "artist"), { text: "Draw a cat.", to: "artist" });
  assert.deepEqual(page.goalBody({ text: "Plan it.", planFirst: true, template: "books/draft-an-invoice" }, "bookkeeper"),
    { text: "Plan it.", to: "bookkeeper", planFirst: true, template: "books/draft-an-invoice" });
  assert.deepEqual(page.goalBody({ text: "Sort it out." }, "chief-of-staff"), { text: "Sort it out." });
  assert.equal(page.composerPlaceholder("Artist"), "Hand Artist a task.  /  for its jobs");
});

test("agent: a lesson is one line of 1 to 500 characters", () => {
  assert.equal(page.lessonProblem("Keep every frame the same size."), "");
  assert.notEqual(page.lessonProblem("   "), "");
  assert.notEqual(page.lessonProblem("two\nlines"), "");
  assert.notEqual(page.lessonProblem("a\u0007b"), "");
  assert.notEqual(page.lessonProblem("x".repeat(501)), "");
  assert.equal(page.lessonProblem("x".repeat(500)), "");
});

test("agent: a lesson's date is the calendar day only, with no clock time", () => {
  assert.equal(page.lessonDate("2026-11-10"), "10 Nov 2026");
  assert.equal(page.lessonDate("2026-01-05"), "5 Jan 2026");
  assert.equal(page.lessonDate(""), "");
  assert.equal(page.lessonDate(undefined), "");
  assert.doesNotMatch(page.lessonDate("2026-11-10"), /\d:\d/);
});

test("agent: the header's note shows only when the board answered without the agent, never a command (M51 F1, F17)", () => {
  const { agent } = shape("agent");
  assert.equal(page.headerNote({ ...agent, applied: false }), "Not set up yet.");
  assert.equal(page.headerNote({ ...agent, applied: null }), "", "board off: not known, so nothing is said");
  assert.equal(page.headerNote(agent), "");
});

// T65: one column; the old tabs are its sections, and the address still opens each.
test("agent: every old tab is a section the address can open", () => {
  assert.deepEqual(page.TABS.map((t) => t.id), ["talk", "profile", "work", "instructions", "lessons"]);
  assert.equal(page.sectionId("lessons"), "p-agent-lessons");
  assert.equal(page.sectionId("work"), "p-agent-work");
  assert.equal(page.sectionId("nonsense"), "p-agent-talk");
});

test("agent: the words the page adds are pinned", () => {
  assert.deepEqual({ ...page.WORDS }, {
    working: "Working on", recent: "Recent work", setup: "How it is set up", lessons: "Lessons", instructions: "Instructions",
    readInstructions: "Read its standing instructions", talk: "Talk", give: "Give it a task",
    may: "What it may do", mayNot: "What it may not do", tool: "Works with", limits: "Limits", reports: "Reports to", dept: "Works in", model: "Model",
  });
});

test("agent: the recent work leaves out the task it is on now, shown above it", () => {
  const { recent, agent } = shape("agent");
  assert.deepEqual(page.recentOthers(recent, agent.doingNow), []);
  assert.equal(page.recentOthers(recent, null).length, recent.length);
  assert.deepEqual(page.recentOthers([{ id: "a" }, { id: "b" }, null], { taskId: "a" }).map((t) => t.id), ["b"]);
  assert.deepEqual(page.recentOthers(undefined, null), []);
});

test("agent: one filled primary at most, and no creature", () => {
  const src = readFileSync(new URL("../../pages/agent.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Creature|creature=/);
  assert.doesNotMatch(src, /type="submit" variant="primary"/, "Add a lesson is not a second filled button");
});

// PLAN-COOK TB4: the head one row, the work one list, a 160 px label column.
test("agent: the head is one row with the 40 px avatar, the state as a chip, Give it a task the one primary and Pause a ghost", () => {
  const src = readFileSync(new URL("../../pages/agent.js", import.meta.url), "utf8");
  assert.match(src, /<\$\{Avatar\} slug=\$\{a\.slug\} name=\$\{a\.name\} size=\$\{40\} \/>/);
  assert.match(src, /<\$\{AgentState\} agent=\$\{a\} chip \/>/);
  assert.match(src, /<\$\{Button\} variant="primary" icon="send" onClick=\$\{toComposer\}>\$\{WORDS\.give\}/, "the primary at the default 32 px (R6-A, R6-G)");
  assert.match(src, /<\$\{Button\} variant="ghost" busy=\$\{busy\} onClick=\$\{go\}>/, "Pause and Resume are ghosts, so one primary");
  assert.equal((src.match(/variant="primary"/g) || []).length, 2, "Give it a task, and Save in a lesson's own edit row");
  assert.match(src, /function Work\(/, "Working on and Recent work are one list");
  const css = readFileSync(new URL("../../styles/pages/agent.css", import.meta.url), "utf8");
  assert.match(css, /\.p-agent__fact \{[^}]*grid-template-columns: 160px minmax\(0, 1fr\);/);
  assert.match(css, /\.p-agent__label \{[^}]*color: var\(--ink-3\);[^}]*font-size: var\(--fs-label\);[^}]*font-weight: var\(--fw-medium\);[^}]*line-height: var\(--lh-ui\);/, "labels 12 px 500 on the value's first line (R5-G)");
  assert.match(css, /\.p-agent__list \{[^}]*list-style: none;/, "lists as plain lines");
  assert.match(css, /\.p-agent__head \.k-page-header__lede \{\s*max-width: 560px;/, "the description runs up to 560 px (R5-G)");
});

// PLAN-COOK R5-G: group labels over a hairline, a long line ends in an ellipsis, the links read as links.
test("agent: the work's group labels sit over a hairline with no band; a long line ends in an ellipsis; Reports to and Works in are links (R5-G, R6-G)", () => {
  const css = readFileSync(new URL("../../styles/pages/agent.css", import.meta.url), "utf8");
  const head = /\.p-agent \.p-agent__group-title \{([^}]*)\}/.exec(css)[1];
  assert.match(head, /border-bottom: 1px solid var\(--line\);/);
  assert.doesNotMatch(head, /background/, "no filled band");
  assert.match(css, /\.p-agent__rows \.k-task-row__line \{[^}]*overflow: hidden;[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
  assert.match(css, /a\.k-agent--chip:hover \.k-agent__name,[^{]*a\.p-team__dept:hover \.p-team__dept-name \{[^}]*text-decoration: underline;/, "underlined on hover only (R6-G)");
  assert.doesNotMatch(css, /a\.k-agent--chip \.k-agent__name[,\s{]/, "no underline at rest");
  assert.doesNotMatch(/\.p-agent \.p-agent__facts \{([^}]*)\}/.exec(css)[1], /background|box-shadow/, "the set-up flat under hairlines (R6-G)");
  const src = readFileSync(new URL("../../pages/agent.js", import.meta.url), "utf8");
  assert.match(src, /const Count = \(\{ n \}\) => \(n \? html`<span class="p-agent__count">\$\{n\}<\/span>`/, "a count is a muted figure");
});

// ---- Mounted in the shared test DOM with a fake fetch (PLAN-3D-ALL U10). ----
const dom = await import("../kit/_dom.mjs");
const { html, render } = dom;
const { AppContext } = await import("../../lib/context.js");
const { HOSTILE } = await import("../../world/fixtures.js");
const { glimpseSrc, GLIMPSES } = await import("../../kit/room.js");
const byCls = (root, c) => dom.elements(root).filter((e) => dom.classesOf(e).includes(c));
const fire = (el, type, ev = {}) => { for (const f of el.listeners[type] || []) f.call(el, { type, preventDefault() {}, stopPropagation() {}, ...ev }); };
const button = (root, words) => dom.elements(root).find((e) => e.localName === "button" && dom.textOf(e).trim() === words);

// Mounts #/team/<slug> with `answers(path, method)` (undefined: never answered); every request is recorded as
// `METHOD path body headers` (the body and headers only when there are any to send).
async function mountAgent(answers, { slug = "artist", query = "" } = {}) {
  dom.installDom();
  globalThis.document.visibilityState = "visible";
  globalThis.document.getElementById = () => null;
  const hash = `#/team/${slug}${query ? `?${query}` : ""}`;
  globalThis.location = { hash, href: `/${hash}`, search: "" };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    const m = opts.method || "GET";
    calls.push(`${m} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}${m === "GET" ? "" : ` ${JSON.stringify(opts.headers)}`}`);
    const data = answers(String(path), m);
    if (data === undefined) return new Promise(() => {});
    return data ? { ok: true, status: 200, json: async () => data } : { ok: false, status: 404, json: async () => ({ error: { code: "not_found", message: "Not found" } }) };
  };
  const tops = [];
  const said = [];
  const nothing = () => {};
  const ctx = { shell: shape("shell"), refreshShell: nothing, announce: (s) => said.push(s), openComposer: nothing, openNeeds: nothing, dock: [], setTop: (t) => tops.push(t), settings: { motion: "off", theme: "dark" } };
  const root = new dom.FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${page.default} route=${{ id: "agent", parts: ["team", slug], query: new URLSearchParams(query) }} /><//>`, root);
  await dom.settle();
  return { root, calls, tops, said, done: async () => { render(null, root); root.remove(); await dom.settle(50); globalThis.fetch = real; delete globalThis.location; } };
}

const agentWith = (over = {}) => { const d = shape("agent"); return { ...d, agent: { ...d.agent, ...over } }; };
const SEEDED = (over = {}) => (path, method) => {
  if (method !== "GET") return path === "/api/goals" ? { goal: { id: "e0000000-0000-4000-8000-000000000099", identifier: "STH-99" } } : { ok: true };
  const all = { "/api/team/artist": shape("agent"), "/api/map": shape("map"), "/api/models": shape("models"), "/api/map/sales": shape("department"), ...over };
  return Object.hasOwn(all, path) ? all[path] : null;
};

test("agent: the page sends what it sent before: the reads, Pause, Resume, a lesson and a task (PLAN-3D-ALL)", async () => {
  const seen = [];
  for (const [answers, opts] of [
    [SEEDED(), {}],
    [SEEDED({ "/api/team/artist": { ...shape("agent"), connected: false, notConnected: { reason: "r", next: "n" } } }), {}],
    [SEEDED(), { slug: "nobody" }],
    [SEEDED({ "/api/team/artist": undefined }), {}],
    [SEEDED(), { query: "tab=lessons" }],
  ]) {
    const m = await mountAgent(answers, opts);
    try { seen.push(...m.calls); } finally { await m.done(); }
  }
  // Pause, as the owner clicks it.
  let m = await mountAgent(SEEDED({ "/api/team/artist": agentWith({ state: "working", plainState: "Working" }) }));
  try {
    fire(button(m.root, "Pause"), "Click");
    await dom.settle();
    seen.push(...m.calls);
  } finally { await m.done(); }
  // Resume, on a paused agent and on a stuck one.
  for (const state of ["paused", "problem"]) {
    m = await mountAgent(SEEDED({ "/api/team/artist": agentWith({ state, plainState: state === "paused" ? "Paused" : "Stuck: it needs the books switched on." }) }));
    try {
      fire(button(m.root, "Resume"), "Click");
      await dom.settle();
      seen.push(...m.calls);
    } finally { await m.done(); }
  }
  // A lesson added, and a task given from the composer.
  m = await mountAgent(SEEDED());
  try {
    const field = dom.elements(m.root).find((e) => e.localName === "input" && e.getAttribute("aria-label") === "A new lesson");
    fire(field, "Input", { currentTarget: { value: "Keep the frames square." } });
    await dom.settle(50);
    const form = dom.elements(m.root).find((e) => e.localName === "form");
    fire(form, "Submit");
    await dom.settle();
    const [box] = dom.elements(m.root).filter((e) => e.localName === "textarea");
    fire(box, "Input", { currentTarget: { value: "Draw a cat.", selectionStart: 11 } });
    await dom.settle(50);
    fire(box, "KeyDown", { key: "Enter", shiftKey: false });
    await dom.settle();
    seen.push(...m.calls);
  } finally { await m.done(); }
  // Recorded on the page before PLAN-3D-ALL U10 changed it.
  const RECORDED = [
    "GET /api/team/artist",
    "GET /api/map",
    "GET /api/models",
    "GET /api/map/sales",
    "GET /api/team/artist",
    "GET /api/map",
    "GET /api/models",
    "GET /api/map/sales",
    "GET /api/team/nobody",
    "GET /api/map",
    "GET /api/models",
    "GET /api/team/artist",
    "GET /api/map",
    "GET /api/models",
    "GET /api/team/artist",
    "GET /api/map",
    "GET /api/models",
    "GET /api/map/sales",
    "GET /api/team/artist",
    "GET /api/map",
    "GET /api/models",
    "GET /api/map/sales",
    `POST /api/company/agents/a0000000-0000-4000-8000-000000000010/pause {} {"Accept":"application/json","Content-Type":"application/json","X-Engine":"1"}`,
    "GET /api/team/artist",
    "GET /api/team/artist",
    "GET /api/map",
    "GET /api/models",
    "GET /api/map/sales",
    `POST /api/company/agents/a0000000-0000-4000-8000-000000000010/resume {} {"Accept":"application/json","Content-Type":"application/json","X-Engine":"1"}`,
    "GET /api/team/artist",
    "GET /api/team/artist",
    "GET /api/map",
    "GET /api/models",
    "GET /api/map/sales",
    `POST /api/company/agents/a0000000-0000-4000-8000-000000000010/resume {} {"Accept":"application/json","Content-Type":"application/json","X-Engine":"1"}`,
    "GET /api/team/artist",
    "GET /api/team/artist",
    "GET /api/map",
    "GET /api/models",
    "GET /api/map/sales",
    `POST /api/team/artist/lessons {"text":"Keep the frames square."} {"Accept":"application/json","Content-Type":"application/json","X-Engine":"1"}`,
    "GET /api/team/artist",
    `POST /api/goals {"text":"Draw a cat.","to":"artist"} {"Accept":"application/json","Content-Type":"application/json","X-Engine":"1"}`,
    "GET /api/team/artist",
  ];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});
