// The Tasks page's pure helpers, on the pinned `tasks` and `task-card` shapes (CONTRACTS-V2 17.2, CONTRACTS-V3 30 and 33.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => {
  let d = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const c = join(d, "server", "test", "shapes");
    if (existsSync(c)) return c;
    const p = dirname(d);
    if (p === d) throw new Error("shape files not found");
    d = p;
  }
})();

const shape = (name) => JSON.parse(readFileSync(resolve(SHAPES, `${name}.json`), "utf8"));

const mod = await import("../../pages/tasks.js");

const card = shape("task-card");
const sample = shape("tasks");
const hour = (h) => `2026-11-11T${String(h).padStart(2, "0")}:00:00.000Z`;
const cardIn = (column, n, more = {}) => ({
  ...card, id: `${card.id}-${column}-${n}`, identifier: `STH-${n}`, column, waitingForYou: false, live: false,
  createdAt: hour(1), updatedAt: hour(1), ...more,
});

// All six columns, as the server sends them: done holds its newest 20 cards and counts more.
function sixColumns() {
  return {
    columns: [
      { id: "backlog", label: "Backlog", count: 1, tasks: [cardIn("backlog", 1)] },
      { id: "in_progress", label: "In progress", count: 2, tasks: [cardIn("in_progress", 2, { updatedAt: hour(3) }), cardIn("in_progress", 3, { updatedAt: hour(5), waitingForYou: true })] },
      { id: "pending_review", label: "Pending review", count: 2, tasks: [cardIn("pending_review", 4, { updatedAt: hour(4), waitingForYou: true }), cardIn("pending_review", 5, { updatedAt: hour(6) })] },
      { id: "done", label: "Done", count: 23, tasks: Array.from({ length: 20 }, (_, i) => cardIn("done", 10 + i, { updatedAt: hour(i) })) },
      { id: "failed", label: "Failed", count: 1, tasks: [cardIn("failed", 30, { waitingForYou: true, updatedAt: hour(2) })] },
      { id: "canceled", label: "Canceled", count: 1, tasks: [cardIn("canceled", 40)] },
    ],
    total: 29,
    generatedAt: "2026-11-11T09:00:00.000Z",
  };
}

test("tasks: the page is a component", () => {
  assert.equal(typeof mod.default, "function");
});

test("tasks: address keeps the view, the person and the department in the address", () => {
  assert.equal(mod.address({}), "#/tasks");
  assert.equal(mod.address(), "#/tasks");
  assert.equal(mod.address({ view: "list" }), "#/tasks");
  assert.equal(mod.address({ view: "board" }), "#/tasks?view=board");
  assert.equal(mod.address({ who: "marketer" }), "#/tasks?who=marketer");
  assert.equal(mod.address({ d: "sales" }), "#/tasks?d=sales");
  assert.equal(mod.address({ view: "board", who: "chief-of-staff", d: "operations" }), "#/tasks?view=board&who=chief-of-staff&d=operations");
  assert.equal(mod.address({ view: "board", who: "", d: "" }), "#/tasks?view=board");
});

test("tasks: apiPath passes ?who= and ?d= to the server", () => {
  assert.equal(mod.apiPath({}), "/api/tasks");
  assert.equal(mod.apiPath({ who: "sales" }), "/api/tasks?who=sales");
  assert.equal(mod.apiPath({ d: "books" }), "/api/tasks?d=books");
  assert.equal(mod.apiPath({ who: "artist", d: "studio" }), "/api/tasks?who=artist&d=studio");
});

test("tasks: older counts what the answer left out of a column", () => {
  const cols = sixColumns().columns;
  assert.equal(mod.older(cols[3]), 3);
  assert.equal(mod.older(cols[0]), 0);
  assert.equal(mod.older(sample.columns[0]), 0);
  assert.equal(mod.older({ id: "done", count: 5 }), 5);
  assert.equal(mod.older({ id: "done", count: "x", tasks: [] }), 0);
  assert.equal(mod.older(null), 0);
});

test("tasks: columnsOf always gives six well-formed columns for the board", () => {
  const cols = mod.columnsOf(sample);
  assert.deepEqual(cols.map((c) => c.id), ["backlog", "in_progress", "pending_review", "done", "failed", "canceled"]);
  // Plain words, the list's own, whatever labels the answer carried (M50 F4).
  assert.deepEqual(cols.map((c) => c.label), ["Waiting to start", "Working", "Needs you", "Finished", "Stopped", "Stopped"]);
  assert.equal(cols[0].tasks.length, 1);
  assert.equal(cols[5].count, 0);
  assert.deepEqual(mod.columnsOf(null).map((c) => c.count), [0, 0, 0, 0, 0, 0]);
  const odd = mod.columnsOf({ columns: [{ id: "done", count: 0, tasks: [card, null, "x"] }] });
  assert.equal(odd.find((c) => c.id === "done").count, 1);
});

test("tasks: the board folds Failed and Canceled into one column, Stopped, newest first (M50 F4)", () => {
  const board = mod.boardColumns(mod.columnsOf(sixColumns()));
  assert.deepEqual(board.map((c) => c.label), ["Waiting to start", "Working", "Needs you", "Finished", "Stopped"]);
  const stopped = board[4];
  assert.equal(stopped.id, "failed");
  assert.equal(stopped.count, 2);
  assert.equal(stopped.tasks.length, 2);
  assert.ok(Date.parse(stopped.tasks[0].updatedAt || 0) >= Date.parse(stopped.tasks[1].updatedAt || 0) || !stopped.tasks[1].updatedAt);
  assert.deepEqual(mod.boardColumns(null), []);
  for (const w of ["Backlog", "In progress", "Pending review", "Canceled", "Failed"]) {
    assert.ok(!board.some((c) => c.label === w), `${w} is not a column name`);
  }
});

test("tasks: the empty page offers a way to the jobs it names (M50 F19)", () => {
  const src = readFileSync(new URL("../../pages/tasks.js", import.meta.url), "utf8");
  assert.match(src, /Start one, or pick a job\./);
  assert.match(src, /href="#\/jobs">See the jobs</);
});

test("tasks: groupsOf puts every card waiting for the owner under Needs you, then groups by column", () => {
  const groups = mod.groupsOf(mod.columnsOf(sixColumns()));
  assert.deepEqual(groups.map((g) => g.id), ["needs-you", "working", "waiting", "finished", "stopped"]);
  assert.deepEqual(groups.map((g) => g.label), ["Needs you", "Working", "Waiting to start", "Finished", "Stopped"]);
  const by = Object.fromEntries(groups.map((g) => [g.id, g.tasks.map((t) => t.identifier)]));
  assert.deepEqual(by["needs-you"], ["STH-3", "STH-4", "STH-30"]);
  assert.deepEqual(by.working, ["STH-5", "STH-2"]);
  assert.deepEqual(by.waiting, ["STH-1"]);
  assert.deepEqual(by.stopped, ["STH-40"]);
  assert.ok(groups.every((g) => g.tasks.every((t) => (g.id === "needs-you") === (t.waitingForYou === true))));
});

test("tasks: groupsOf orders each group newest first, the server's order breaking ties", () => {
  const groups = mod.groupsOf(mod.columnsOf(sixColumns()));
  const finished = groups.find((g) => g.id === "finished");
  assert.equal(finished.tasks[0].identifier, "STH-29");
  assert.equal(finished.tasks.at(-1).identifier, "STH-10");
  const tie = mod.groupsOf([{ id: "backlog", count: 2, tasks: [cardIn("backlog", 7), cardIn("backlog", 8)] }]);
  assert.deepEqual(tie[0].tasks.map((t) => t.identifier), ["STH-7", "STH-8"]);
  const noDate = mod.groupsOf([{ id: "backlog", count: 2, tasks: [cardIn("backlog", 7, { updatedAt: null, createdAt: null }), cardIn("backlog", 8)] }]);
  assert.deepEqual(noDate[0].tasks.map((t) => t.identifier), ["STH-8", "STH-7"]);
});

test("tasks: Finished keeps its newest 20 and counts the older ones", () => {
  const groups = mod.groupsOf(mod.columnsOf(sixColumns()));
  const finished = groups.find((g) => g.id === "finished");
  assert.equal(finished.tasks.length, 20);
  assert.equal(finished.older, 3);
  assert.equal(finished.count, 23);
  const many = mod.groupsOf([{ id: "done", count: 25, tasks: Array.from({ length: 25 }, (_, i) => cardIn("done", 100 + i, { updatedAt: hour(i % 24) })) }]);
  assert.equal(many[0].tasks.length, 20);
  assert.equal(many[0].older, 5);
  assert.equal(many[0].count, 25);
});

test("tasks: groupsOf leaves out empty groups and anything malformed", () => {
  const fromShape = mod.groupsOf(mod.columnsOf(sample));
  assert.deepEqual(fromShape.map((g) => g.id), ["needs-you"]);
  assert.equal(fromShape[0].tasks[0].identifier, "STH-8");
  assert.deepEqual(mod.groupsOf(null), []);
  assert.deepEqual(mod.groupsOf([{ id: "nonsense", count: 3, tasks: [card] }, null]), []);
  const counted = mod.groupsOf([{ id: "canceled", count: 4, tasks: [] }]);
  assert.deepEqual(counted.map((g) => [g.id, g.count, g.older, g.tasks.length]), [["stopped", 4, 4, 0]]);
});

test("tasks: a row's second line says the outcome, the stage and state, or that it is a question", () => {
  // A task with an outcome: the job it came from, then the outcome (the state first when it waits for the owner).
  assert.equal(mod.rowWords(card), `A small animated character · Waiting for you · ${card.outcome}`);
  assert.equal(mod.rowWords({ ...card, waitingForYou: false, job: null }), card.outcome);
  // A task at a stage, with no outcome: the stage, the round and the state in words.
  assert.equal(mod.rowWords({ ...card, outcome: null, job: null }), "Check · Round 2 · Finished");
  assert.equal(mod.rowWords({ ...card, outcome: null, job: null, round: 0, stage: { id: "work", label: "Work" }, plainState: "Being worked on" }), "Work · Being worked on");
  // A question to the company brain says so, then its answer or its state.
  const q = { ...card, ask: true, job: null, stage: null, round: 0, outcome: null, waitingForYou: false, live: true, plainState: "Being worked on" };
  assert.equal(mod.rowWords(q), "A question · Being worked on");
  assert.equal(mod.rowWords({ ...q, live: false, waitingForYou: true, outcome: "Customers can return an unused item." }), "A question · Waiting for you · Customers can return an unused item.");
  assert.equal(mod.forRow(q).job.title, "A question");
  assert.equal(mod.forRow(card), card);
  assert.equal(mod.rowWords(null), "");
});

test("tasks: the department chips come from the dock, or the seven departments, and link to ?d=", () => {
  const plain = mod.departmentOptions([], "");
  assert.equal(plain.length, 8);
  assert.deepEqual(plain[0], { value: "", label: "Every department" });
  assert.deepEqual(plain.map((o) => o.value).slice(1), ["operations", "sales", "marketing", "studio", "support", "people", "books"]);
  const dock = [{ id: "brain", title: "Company brain" }, { id: "sales", title: "Sales" }, { id: "books", title: "Books" }];
  assert.deepEqual(mod.departmentOptions(dock, "").map((o) => o.value), ["", "sales", "books"]);
  assert.equal(mod.departmentOptions(dock, "nope").at(-1).value, "nope");
  const chips = mod.chipLinks(mod.departmentOptions([], "sales"), "sales", (d) => mod.address({ view: "board", who: "sales", d }));
  assert.equal(chips[0].href, "#/tasks?view=board&who=sales");
  assert.equal(chips.find((c) => c.value === "sales").href, "#/tasks?view=board&who=sales&d=sales");
  assert.deepEqual(chips.filter((c) => c.current).map((c) => c.value), ["sales"]);
  assert.deepEqual(mod.chipLinks(mod.departmentOptions([], ""), "", (d) => mod.address({ d })).filter((c) => c.current).map((c) => c.value), [""]);
});

test("tasks: the agent chips list everyone, then the team, keep an unknown slug, and link to ?who=", () => {
  const team = shape("shell").team;
  const opts = mod.whoOptions(team, "");
  assert.deepEqual(opts[0], { value: "", label: "Everyone" });
  assert.deepEqual(opts[1], { value: "chief-of-staff", label: "Chief of staff" });
  assert.equal(mod.whoOptions(team, "artist").at(-1).value, "artist");
  assert.equal(mod.whoOptions(null, "").length, 1);
  assert.equal(mod.whoOptions([{ slug: "<b>", name: "x" }], "").length, 1);
  const chips = mod.chipLinks(opts, "chief-of-staff", (who) => mod.address({ who, d: "operations" }));
  assert.equal(chips[0].href, "#/tasks?d=operations");
  assert.equal(chips[1].href, "#/tasks?who=chief-of-staff&d=operations");
  assert.equal(chips[1].current, true);
});

test("tasks: the state is the list's own filter, kept in the address as ?state= and dropped on the board (T61)", () => {
  assert.equal(mod.address({ state: "needs-you" }), "#/tasks?state=needs-you");
  assert.equal(mod.address({ who: "artist", d: "studio", state: "finished" }), "#/tasks?who=artist&d=studio&state=finished");
  assert.equal(mod.address({ view: "board", state: "working" }), "#/tasks?view=board");
  assert.equal(mod.address({ state: "nonsense" }), "#/tasks");
  assert.equal(mod.address({ state: "" }), "#/tasks");
});

test("tasks: the state filter offers every state, then the list's groups in their order (T61)", () => {
  const opts = mod.stateOptions();
  assert.deepEqual(opts[0], { value: "", label: "Every state" });
  assert.deepEqual(opts.slice(1).map((o) => o.value), ["needs-you", "working", "waiting", "finished", "stopped"]);
  assert.deepEqual(opts.slice(1).map((o) => o.label), ["Needs you", "Working", "Waiting to start", "Finished", "Stopped"]);
  const links = mod.chipLinks(opts, "working", (state) => mod.address({ d: "sales", state }));
  assert.equal(links[0].href, "#/tasks?d=sales");
  assert.equal(links.find((o) => o.current).href, "#/tasks?d=sales&state=working");
});

test("tasks: inState narrows the list to one group, or keeps every group (T61)", () => {
  const groups = mod.groupsOf(mod.columnsOf(sixColumns()));
  assert.deepEqual(mod.inState(groups, "working").map((g) => g.id), ["working"]);
  assert.deepEqual(mod.inState(groups, "").map((g) => g.id), groups.map((g) => g.id));
  assert.deepEqual(mod.inState(groups, "nonsense").map((g) => g.id), groups.map((g) => g.id));
  assert.deepEqual(mod.inState(mod.groupsOf(mod.columnsOf(sample)), "stopped"), []);
  assert.deepEqual(mod.inState(null, "working"), []);
});

test("tasks: a filter's button names the filter until a choice is made, then shows the choice (T61, R03)", () => {
  const depts = mod.departmentOptions([], "");
  assert.equal(mod.filterLabel("Department", depts, ""), "Department");
  assert.equal(mod.filterLabel("Department", depts, "sales"), "Sales");
  assert.equal(mod.filterLabel("Agent", mod.whoOptions([], "artist"), "artist"), "artist");
  assert.equal(mod.filterLabel("State", mod.stateOptions(), "finished"), "Finished");
  assert.equal(mod.filterLabel("State", null, "finished"), "State");
});

test("tasks: the page's own words are one table: the filters' names and a state with nothing in it (T61)", () => {
  const W = mod.WORDS;
  assert.deepEqual([W.state, W.department, W.agent, W.everyState], ["State", "Department", "Agent", "Every state"]);
  assert.equal(W.stateLabel, "Show the tasks in one state");
  assert.equal(W.departmentLabel, "Show the tasks of one department");
  assert.equal(W.agentLabel, "Show the tasks of one agent");
  assert.equal(W.views, "How to show the tasks");
  assert.equal(W.filters, "Filter the tasks");
  assert.deepEqual(Object.keys(W.none), mod.GROUPS.map((g) => g.id));
  assert.equal(W.none["needs-you"], "Nothing needs you right now.");
  assert.equal(W.none.stopped, "Nothing has stopped.");
  for (const s of Object.values(W.none)) assert.ok(!/—/.test(s), "no em dash");
});

test("tasks: the filters are the kit's menus and every group folds by its header (T61)", () => {
  const src = readFileSync(new URL("../../pages/tasks.js", import.meta.url), "utf8");
  assert.match(src, /<\$\{Menu\} label=\$\{filterLabel\(/);
  assert.match(src, /class="p-tasks__fold" aria-expanded=/);
  assert.match(src, /aria-controls=\$\{rows\}/);
  assert.ok(!/u-glass/.test(src), "the rows sit on the ground, not on glass");
  assert.ok(!/<\$\{Chip\}/.test(src), "no chip rows of filters");
});

test("tasks: Needs you is said by the rows' glyph and words, never by an outline or a tint (T61, TB5a)", () => {
  const css = readFileSync(new URL("../../styles/pages/tasks.css", import.meta.url), "utf8");
  const amber = css.replace(/\.p-tasks \.p-tasks__mark--warn \{ color: var\(--warn\); \}/, "");
  assert.ok(!/--warn|--border-warm|--bg-warm/.test(amber), "amber only on the glyph of a row that waits for the owner");
  assert.ok(!/needs-you[^{]*\{/.test(css), "no rule for the Needs you group alone");
  assert.ok(!/k-task-row__who/.test(css), "no rule for a class the row no longer has");
  assert.match(css, /\.p-tasks \.p-tasks__list \{[^}]*max-width: var\(--content-max\)/);
});

test("tasks: a group bar is flat, a step off the ground with 8 px corners; the filters are edged and 32 px (TB5a)", () => {
  const css = readFileSync(new URL("../../styles/pages/tasks.css", import.meta.url), "utf8");
  const fold = /\.p-tasks \.p-tasks__fold \{([^}]*)\}/.exec(css)[1];
  assert.match(fold, /background: color-mix\(in srgb, var\(--ink\) 5%, transparent\)/, "a tint of the ink: a step lighter in dark, a step darker on the white pane");
  assert.match(fold, /box-shadow: none/);
  assert.match(fold, /border: 0/);
  assert.match(fold, /border-radius: var\(--r-2\)/);
  const trigger = /\.p-tasks \.p-tasks__filter \.k-menu__trigger \{([^}]*)\}/.exec(css)[1];
  assert.match(trigger, /min-height: var\(--s-8\)/);
  assert.match(trigger, /border-color: var\(--line-2\)/);
  assert.match(trigger, /background: transparent/);
});

test("tasks: a row is the state's glyph, the title with its ID, the state's sentence under it and the date at the right (TB5a)", () => {
  const src = readFileSync(new URL("../../pages/tasks.js", import.meta.url), "utf8");
  assert.match(src, /class="p-tasks__title"/);
  assert.match(src, /class="p-tasks__id"><\$\{Mono\}/);
  assert.match(src, /class="p-tasks__say"/);
  assert.match(src, /class="p-tasks__when" datetime=/);
  const css = readFileSync(new URL("../../styles/pages/tasks.css", import.meta.url), "utf8");
  assert.match(/\.p-tasks \.p-tasks__title \{([^}]*)\}/.exec(css)[1], /font-size: var\(--fs-body\);[\s\S]*font-weight: var\(--fw-medium\)/, "title 14 px 500");
  assert.match(/\.p-tasks \.p-tasks__id \.k-mono \{([^}]*)\}/.exec(css)[1], /color: var\(--ink-3\);[\s\S]*font-family: var\(--font-mono\);[\s\S]*font-size: var\(--fs-label\)/, "ID 12 px mono, third ink");
  assert.match(/\.p-tasks \.p-tasks__say \{([^}]*)\}/.exec(css)[1], /color: var\(--ink-2\);[\s\S]*font-size: var\(--fs-note\)/, "sentence 13 px, second ink");
});

test("tasks: glyphOf is neutral unless the state asks for the eye (TB5a)", () => {
  assert.deepEqual(mod.glyphOf({ ...card, waitingForYou: true }), { column: "pending_review", tone: "warn", word: "Waiting for you" });
  assert.deepEqual(mod.glyphOf({ ...card, waitingForYou: false, live: true }), { column: "in_progress", tone: "info", word: "Working" });
  assert.equal(mod.glyphOf({ ...card, waitingForYou: false, column: "done" }).tone, "good");
  assert.equal(mod.glyphOf({ ...card, waitingForYou: false, column: "failed", plainState: "" }).tone, "bad");
  assert.equal(mod.glyphOf({ ...card, waitingForYou: false, column: "backlog" }).tone, "");
  assert.equal(mod.glyphOf({ ...card, waitingForYou: false, column: "in_progress" }).tone, "", "in progress but not running: neutral");
  assert.equal(mod.glyphOf({ ...card, waitingForYou: true, column: "failed" }).column, "failed", "the column's own shape");
  assert.deepEqual(mod.glyphOf(null), { column: "backlog", tone: "", word: "Backlog" });
});

test("tasks: rowWhen is relative while recent, then the plain date (TB5a)", () => {
  const now = new Date(2026, 10, 16, 15, 0);
  const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();
  assert.equal(mod.rowWhen(new Date(now.getTime() - 20000).toISOString(), now), "Just now");
  assert.equal(mod.rowWhen(at(16, 14, 48), now), "12 min ago");
  assert.equal(mod.rowWhen(at(16, 12, 0), now), "3 h ago");
  assert.equal(mod.rowWhen(at(16, 8, 5), now), "Today 08:05");
  assert.equal(mod.rowWhen(at(15, 9, 10), now), "Yesterday 09:10");
  assert.equal(mod.rowWhen(at(11, 14, 5), now), "Wed 14:05");
  assert.equal(mod.rowWhen(at(3, 14, 5), now), "3 Nov");
  assert.equal(mod.rowWhen(new Date(2025, 10, 3).toISOString(), now), "3 Nov 2025");
  assert.equal(mod.rowWhen("", now), "");
  assert.equal(mod.rowWhen("nonsense", now), "");
});

test("tasks: the page stands on the white pane: its root carries k-page--plain, painted in light by shell.css (TB5a)", () => {
  const src = readFileSync(new URL("../../pages/tasks.js", import.meta.url), "utf8");
  assert.match(src, /class=\$\{`p-tasks p-tasks--\$\{view\} k-page--plain`\}/);
  const shell = readFileSync(new URL("../../styles/shell.css", import.meta.url), "utf8");
  for (const theme of ["light", "auto"]) {
    for (const part of ["", " .s-top", " .s-tabbar"]) {
      const sel = `:root[data-theme="${theme}"] .s-app:has(.k-page--plain)${part}`;
      assert.ok(shell.includes(sel), `shell.css paints ${sel}`);
    }
  }
  assert.match(shell, /:root\[data-theme="light"\] \.s-app:has\(\.k-page--plain\) \.s-tabbar \{\s*background: var\(--panel\);/);
  assert.match(shell, /@media \(prefers-color-scheme: light\) \{\s*:root\[data-theme="auto"\] \.s-app:has\(\.k-page--plain\)/, "auto follows the system's light");
  assert.ok(!/data-theme="dark"[^{]*k-page--plain/.test(shell), "dark does not change");
});

test("tasks: the chosen item of a filter menu is current, and only Needs you's rows are quiet about waiting (T94)", () => {
  const src = readFileSync(new URL("../../pages/tasks.js", import.meta.url), "utf8");
  assert.match(src, /icon: o\.current \? "check" : undefined, current: o\.current \? true : undefined/, "the check stays and the item is current");
  assert.match(src, /quiet=\$\{g\.id === "needs-you" \? "waiting" : undefined\}/, "quiet only under Needs you");
  const items = mod.chipLinks(mod.whoOptions([{ slug: "artist", name: "Artist" }], "artist"), "artist", (v) => `#/tasks?who=${v}`);
  assert.deepEqual(items.filter((o) => o.current).map((o) => o.value), ["artist"]);
});
