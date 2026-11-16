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

test("tasks: a group's head is a quiet filled band, 32 px on a 6 px corner in the raised tone; the filters are edged and 32 px (R6-H)", () => {
  const css = readFileSync(new URL("../../styles/pages/tasks.css", import.meta.url), "utf8");
  const fold = /\.p-tasks \.p-tasks__fold \{([^}]*)\}/.exec(css)[1];
  assert.match(fold, /min-height: var\(--s-8\)/, "32 px");
  assert.match(fold, /border-radius: var\(--r-1\)/, "a 6 px corner");
  assert.match(fold, /background: var\(--raise\)/, "the raised tone");
  assert.match(fold, /border: 0/);
  assert.match(fold, /box-shadow: none/);
  const trigger = /\.p-tasks \.p-tasks__filter \.k-menu__trigger \{([^}]*)\}/.exec(css)[1];
  assert.match(trigger, /min-height: var\(--s-8\)/);
  assert.match(trigger, /border-color: var\(--line-2\)/);
  assert.match(trigger, /background: transparent/);
});

test("tasks: every row is one line of one height: the glyph, the title with its own words after it, then the state's quiet chip, the ID and the date (R6-H)", () => {
  const src = readFileSync(new URL("../../pages/tasks.js", import.meta.url), "utf8");
  assert.match(src, /class="p-tasks__title"/);
  assert.match(src, /class="p-tasks__id"><\$\{Mono\}/);
  assert.match(src, /\$\{own && html`<span class="p-tasks__say">\$\{own\}<\/span>`\}/, "the row's own words only when it has them");
  assert.match(src, /class="p-tasks__when" datetime=/);
  assert.match(src, /<\$\{Tag\} tone=\$\{CHIP_TONES\[showChip\] \|\| "neutral"\} dot=\$\{true\} quiet=\$\{true\}>\$\{showChip\}<\/\/>/, "the state as quiet words with a dot");
  assert.deepEqual(mod.CHIP_TONES, { Stuck: "warn", Working: "info" }, "only Stuck warn and Working info");
  assert.match(src, /title=\$\{sentence \|\| undefined\}/, "the whole sentence on hover");
  assert.match(src, /<span class="k-sr">\. \$\{sentence\}\.<\/span>/, "and in the row's spoken words");
  const css = readFileSync(new URL("../../styles/pages/tasks.css", import.meta.url), "utf8");
  const line = /\.p-tasks \.p-tasks__line \{([^}]*)\}/.exec(css)[1];
  assert.match(line, /min-height: 44px/, "one height");
  assert.match(line, /padding: 0 var\(--s-3\)/);
  assert.match(/\.p-tasks \.p-tasks__main \{([^}]*)\}/.exec(css)[1], /display: flex;\s*align-items: baseline;/, "the own words on the title's line");
  assert.match(/\.p-tasks \.p-tasks__title \{([^}]*)\}/.exec(css)[1], /font-size: var\(--fs-body\);[\s\S]*font-weight: var\(--fw-medium\)/, "title 14 px 500");
  assert.match(/\.p-tasks \.p-tasks__id \.k-mono \{([^}]*)\}/.exec(css)[1], /color: var\(--ink-3\);[\s\S]*font-family: var\(--font-mono\);[\s\S]*font-size: var\(--fs-label\)/, "ID 12 px mono, third ink");
  const say = /\.p-tasks \.p-tasks__say \{([^}]*)\}/.exec(css)[1];
  assert.match(say, /color: var\(--ink-2\);[\s\S]*font-size: var\(--fs-note\)/, "own words 13 px, second ink");
  assert.match(say, /text-overflow: ellipsis/, "cut with an ellipsis");
});

test("tasks: glyphOf is in the third ink, the warn tone only on a row that is stuck (R5-H)", () => {
  assert.deepEqual(mod.glyphOf({ ...card, waitingForYou: true, plainState: "Finished" }), { column: "pending_review", tone: "", word: "Waiting for you" });
  assert.deepEqual(mod.glyphOf({ ...card, waitingForYou: true, plainState: "Stuck, needs you" }), { column: "pending_review", tone: "warn", word: "Stuck, needs you" });
  assert.deepEqual(mod.glyphOf({ ...card, waitingForYou: false, live: true }), { column: "in_progress", tone: "", word: "Working" });
  assert.equal(mod.glyphOf({ ...card, waitingForYou: false, column: "done" }).tone, "");
  assert.equal(mod.glyphOf({ ...card, waitingForYou: false, column: "failed", plainState: "" }).tone, "");
  assert.equal(mod.glyphOf({ ...card, waitingForYou: true, column: "failed", plainState: "Stuck, needs you" }).tone, "warn");
  assert.equal(mod.glyphOf({ ...card, waitingForYou: true, column: "failed" }).column, "failed", "the column's own shape");
  assert.deepEqual(mod.glyphOf(null), { column: "backlog", tone: "", word: "Backlog" });
});

test("tasks: the state's chip is the row's own words shortened by one pinned table (R5-H)", () => {
  assert.deepEqual(mod.CHIP_WORDS, {
    "Stuck, needs you": "Stuck", Working: "Working", "Being worked on": "Working", "Being checked": "Checking",
    "Waiting to start": "Waiting", "Waiting its turn": "Waiting", Finished: "Finished", Stopped: "Stopped",
    "Waiting for you": "Needs you", Backlog: "Backlog", "In progress": "In progress", "Pending review": "Review",
    Done: "Done", Failed: "Failed", Canceled: "Canceled",
  });
  assert.deepEqual(mod.GROUP_CHIP, { "needs-you": "Needs you", working: "Working", waiting: "Waiting", finished: "Finished", stopped: "Stopped" });
  const stuck = { ...card, outcome: null, job: null, live: false, waitingForYou: true, plainState: "Stuck, needs you", stage: { id: "brief", label: "Brief: waiting for you" }, round: 0 };
  assert.equal(mod.chipOf(stuck), "Stuck");
  assert.equal(mod.stateSentence(stuck), "Brief: waiting for you · Stuck, needs you", "the whole sentence, said once");
  assert.equal(mod.ownWords(stuck), "", "no second line: the state words are all the row has");
  assert.equal(mod.chipOf({ ...stuck, live: true }), "Stuck", "stuck before working");
  assert.equal(mod.chipOf({ ...card, live: true, plainState: "Being worked on" }), "Working");
  assert.equal(mod.chipOf({ ...card, live: false, waitingForYou: true, plainState: "Finished" }), "Finished");
  assert.equal(mod.chipOf({ ...card, live: false, waitingForYou: true, plainState: "" }), "Needs you");
  assert.equal(mod.chipOf({ ...card, live: false, waitingForYou: false, plainState: "", column: "pending_review" }), "Review");
  assert.equal(mod.chipOf({ ...card, live: false, waitingForYou: false, plainState: "Waiting its turn" }), "Waiting");
  assert.equal(mod.chipOf(null), "");
  for (const [long, short] of Object.entries(mod.CHIP_WORDS)) {
    const words = long.toLowerCase();
    assert.ok(short.toLowerCase().split(" ").every((w) => words.includes(w.slice(0, 4))) || long === "Waiting for you" || long === "Pending review",
      `${short} is made from ${long}`);
  }
});

test("tasks: a row keeps a second line only for its own words, an answer or a result's sentence (R5-H)", () => {
  const done = { ...card, waitingForYou: true, live: false, job: null };
  assert.equal(mod.ownWords(done), card.outcome, "the result's sentence, without the state");
  assert.equal(mod.ownWords({ ...done, job: { id: "x", title: "A small animated character" } }), `A small animated character · ${card.outcome}`);
  const q = { ...card, ask: true, job: null, stage: null, round: 0, waitingForYou: true, live: false, plainState: "Finished", outcome: "Customers can return an unused item [1]." };
  assert.equal(mod.ownWords(q), "A question · Customers can return an unused item.");
  assert.equal(mod.stateSentence(q), "A question · Waiting for you · Finished");
  assert.equal(mod.ownWords({ ...q, outcome: "" }), "");
  assert.equal(mod.stateSentence({ ...card, outcome: null, job: null, waitingForYou: true, live: true, stage: { id: "work", label: "Work" }, round: 0, plainState: "Being worked on" }),
    "Waiting for you · Work · Being worked on");
  assert.equal(mod.stateSentence(null), "");
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

test("tasks: the chosen item of a filter menu is current, and a row's chip is left out where it only says its group's name (T94, R5-H)", () => {
  const src = readFileSync(new URL("../../pages/tasks.js", import.meta.url), "utf8");
  assert.match(src, /icon: o\.current \? "check" : undefined, current: o\.current \? true : undefined/, "the check stays and the item is current");
  assert.match(src, /<\$\{Line\} task=\$\{forRow\(t\)\} group=\$\{g\.id\} \/>/, "each row knows its group");
  assert.match(src, /const showChip = chip && chip !== GROUP_CHIP\[group\] \? chip : "";/);
  const items = mod.chipLinks(mod.whoOptions([{ slug: "artist", name: "Artist" }], "artist"), "artist", (v) => `#/tasks?who=${v}`);
  assert.deepEqual(items.filter((o) => o.current).map((o) => o.value), ["artist"]);
});

// ---- Mounted in the test DOM with a fake fetch (PLAN-3D-ALL U5). ----
const { FakeElement, html, render, installDom, elements, classesOf, walkDom } = await import("../kit/_dom.mjs");
const { AppContext } = await import("../../lib/context.js");

async function mountTasks(data, { query = "", status = 200 } = {}) {
  installDom();
  globalThis.document.visibilityState = "visible";
  globalThis.location = { hash: `#/tasks${query ? `?${query}` : ""}`, href: `/#/tasks${query ? `?${query}` : ""}`, search: "" };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    calls.push(`${opts.method || "GET"} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}`);
    return { ok: status < 400, status, json: async () => data };
  };
  const tops = [];
  const ctx = { shell: { team: shape("shell").team, dock: [] }, setTop: (t) => tops.push(t), announce() {}, openComposer() {}, settings: { motion: "off", theme: "dark" } };
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${mod.default} route=${{ id: "tasks", parts: ["tasks"], query: new URLSearchParams(query) }} /><//>`, root);
  await new Promise((r) => setTimeout(r, 300));
  return { root, calls, tops, done: () => { render(null, root); root.remove(); globalThis.fetch = real; delete globalThis.location; } };
}

test("tasks: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  for (const [data, query] of [[sample, ""], [sixColumns(), ""], [sixColumns(), "view=board"], [sixColumns(), "who=artist&d=studio&state=working"], [{ columns: [] }, "d=sales"]]) {
    const m = await mountTasks(data, { query });
    try { seen.push(...m.calls); } finally { m.done(); }
  }
  // Recorded on the page before PLAN-3D-ALL U5 changed it.
  const RECORDED = ["GET /api/tasks", "GET /api/tasks", "GET /api/tasks", "GET /api/tasks?who=artist&d=studio", "GET /api/tasks?d=sales"];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});

const { glimpseSrc, GLIMPSES } = await import("../../kit/room.js");
const { HOSTILE } = await import("../../world/fixtures.js");
const byCls = (root, c) => elements(root).filter((e) => classesOf(e).includes(c));
const LIVE_STUCK = () => ({
  columns: [
    { id: "in_progress", count: 2, tasks: [cardIn("in_progress", 2, { live: true, plainState: "Being worked on", outcome: null }), cardIn("in_progress", 3, { waitingForYou: true, plainState: "Stuck, needs you", outcome: null })] },
    { id: "done", count: 1, tasks: [cardIn("done", 4, { plainState: "Finished" })] },
  ],
});

test("tasks: the title and the bar stand in the room header with the desk's glimpse; one h1, crumbs as before (PLAN-3D-ALL U5)", async () => {
  const m = await mountTasks(sixColumns());
  try {
    const band = elements(m.root).filter((e) => e.localName === "header" && classesOf(e).includes("k-room"));
    assert.equal(band.length, 1);
    assert.equal(band[0].getAttribute("data-glimpse"), "desk");
    const h1 = elements(m.root).filter((e) => e.localName === "h1");
    assert.equal(h1.length, 1);
    assert.equal(h1[0].getAttribute("id"), "page-title");
    assert.ok(classesOf(h1[0]).includes("k-page-header__title"));
    assert.equal(byCls(band[0], "p-tasks__bar").length, 1, "the filters and the actions are in the band");
    const img = elements(m.root).filter((e) => e.localName === "img");
    assert.equal(img.length, 1, "one picture: the band's");
    assert.equal(img[0].getAttribute("src"), glimpseSrc("desk", { theme: "dark", width: 1280 }));
    assert.equal(img[0].getAttribute("alt"), "");
    assert.equal(img[0].getAttribute("aria-hidden"), "true");
    assert.equal(elements(m.root).filter((e) => e.localName === "canvas").length, 0, "a surface screen has no canvas");
    assert.equal(byCls(m.root, "k-page-header").length, 0, "PageHeader is replaced");
  } finally { m.done(); }
  const off = await mountTasks(sixColumns(), { query: "glimpse=off" });
  try {
    assert.equal(elements(off.root).filter((e) => e.localName === "img").length, 0, "glimpse=off: the band alone");
    assert.equal(byCls(off.root, "k-room--bare").length, 1);
  } finally { off.done(); }
});

test("tasks: states follow the lamps: a working glyph lit, a stuck one amber, a finished row quiet (PLAN-3D-ALL U5, D5)", async () => {
  const m = await mountTasks(LIVE_STUCK());
  try {
    const marks = byCls(m.root, "p-tasks__mark");
    assert.equal(byCls(m.root, "p-tasks__mark--lamp").length, 1, "the working row's glyph is lit");
    assert.equal(byCls(m.root, "p-tasks__mark--warn").length, 1, "the stuck row's glyph is amber");
    assert.equal(marks.length, 3);
    assert.ok(byCls(m.root, "p-tasks__mark--lamp").every((e) => !classesOf(e).includes("p-tasks__mark--warn")));
    assert.equal(byCls(m.root, "p-tasks__group--finished").length, 1);
  } finally { m.done(); }
  const css = readFileSync(new URL("../../styles/pages/tasks.css", import.meta.url), "utf8");
  assert.match(/\.p-tasks \.p-tasks__mark--lamp \{([^}]*)\}/.exec(css)[1], /color: var\(--accent\)/, "the lamp's tone");
  assert.match(css, /\.p-tasks \.p-tasks__group--finished \.p-tasks__title \{[^}]*color: var\(--ink-2\)/, "a finished row quiet");
  // The quiet look's control fill under the pointer was replaced by the lamp's pool (PLAN-3D-ALL U5).
  assert.match(css, /\.p-tasks \.p-tasks__line:hover,\s*\.p-tasks \.p-tasks__line:focus-visible \{\s*background-color: var\(--lamp-pool\);/);
  assert.match(css, /\.p-tasks \.p-tasks__line:focus-visible \{\s*outline: 2px solid var\(--accent\);/, "the 2 px ring");
  const kit = readFileSync(new URL("../../styles/kit/task-card.css", import.meta.url), "utf8");
  assert.match(kit, /\.k-task-card__state--live \{\s*color: var\(--accent\);/, "a working card's glyph in the lamp's tone, not green");
  assert.match(kit, /\.k-task-row__mark--live \{ color: var\(--accent\); \}/);
  assert.match(kit, /\.k-task-row:hover \{\s*background-color: var\(--lamp-pool\);/);
});

test("tasks: the band keeps the first row near the top: up into the pane's margin, 16 px over the first group (PLAN-3D-ALL U5, D9)", () => {
  const css = readFileSync(new URL("../../styles/pages/tasks.css", import.meta.url), "utf8");
  const [wide, phone] = [...css.matchAll(/\.p-tasks \.k-room \{([^}]*)\}/g)].map((x) => x[1]);
  assert.match(wide, /margin-top: calc\(-1 \* var\(--s-6\)\);\s*margin-bottom: var\(--s-4\);/);
  assert.match(phone, /margin-top: calc\(-1 \* var\(--s-2\)\);\s*margin-bottom: var\(--s-4\);/);
  assert.ok(!/paper/.test(css), "no paper on this page");
  const src = readFileSync(new URL("../../pages/tasks.js", import.meta.url), "utf8");
  assert.ok(!/data-surface|<\$\{Sheet\}/.test(src), "no paper on this page");
});

test("tasks: hostile server text stays text: no script, img, iframe or object beyond the band's; no on* attribute; no fixture text in href, src or style (PLAN-3D-ALL)", async () => {
  const tags = (root) => ["script", "img", "iframe", "object"].map((t) => elements(root).filter((e) => e.localName === t).length);
  const bad = (i) => HOSTILE[i % HOSTILE.length];
  const hostile = () => ({
    columns: ["backlog", "in_progress", "pending_review", "done", "failed", "canceled"].map((id, c) => ({
      id, label: bad(c), count: 3, tasks: [0, 1, 2].map((n) => cardIn(id, c * 3 + n, {
        title: bad(c + n), plainState: bad(c + n + 1), outcome: bad(c + n + 2), identifier: bad(c + n + 3),
        job: { id: bad(n), title: bad(c + n + 4) }, who: { slug: "artist", name: bad(c + n + 5) }, department: bad(c),
        stage: { id: "x", label: bad(c + n + 6) }, live: n === 0, waitingForYou: n === 1, updatedAt: bad(n), ask: n === 2,
      })),
    })),
    connected: true,
  });
  for (const query of ["", "view=board"]) {
    const s = await mountTasks(sixColumns(), { query });
    let base;
    try { base = tags(s.root); } finally { s.done(); }
    const m = await mountTasks(hostile(), { query });
    try {
      assert.deepEqual(tags(m.root), base, query);
      for (const e of elements(m.root)) {
        for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
        for (const h of HOSTILE) {
          for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
        }
        if (e.localName === "img") {
          assert.ok(GLIMPSES.some((k) => [1280, 390].some((w) => ["dark", "light"].some((theme) => glimpseSrc(k, { theme, width: w }) === e.getAttribute("src")))), "the band's picture is a table key's");
        }
      }
      const nodes = [...walkDom(m.root)].filter((n) => n.nodeType === 3).map((n) => n.data);
      if (!query) assert.ok(nodes.includes(bad(0)), "a hostile title is a text node");
    } finally { m.done(); }
  }
});
