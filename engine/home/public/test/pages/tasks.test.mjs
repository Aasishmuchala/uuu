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
