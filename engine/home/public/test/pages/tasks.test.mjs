// The Tasks page's pure helpers, on the pinned `tasks` and `task-card` shapes (CONTRACTS-V2 17.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHAPES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../server/test/shapes");
const shape = (name) => JSON.parse(readFileSync(resolve(SHAPES, `${name}.json`), "utf8"));

const mod = await import("../../pages/tasks.js");

const card = shape("task-card");
const sample = shape("tasks");
const cardIn = (column, n) => ({ ...card, id: `${card.id}-${column}-${n}`, identifier: `STH-${n}`, column });

// All six columns, as the server sends them: done holds its newest cards and counts more.
function sixColumns() {
  return {
    columns: [
      { id: "backlog", label: "Backlog", count: 1, tasks: [cardIn("backlog", 1)] },
      { id: "in_progress", label: "In progress", count: 2, tasks: [cardIn("in_progress", 2), cardIn("in_progress", 3)] },
      { id: "pending_review", label: "Pending review", count: 0, tasks: [] },
      { id: "done", label: "Done", count: 23, tasks: Array.from({ length: 20 }, (_, i) => cardIn("done", 10 + i)) },
      { id: "failed", label: "Failed", count: 0, tasks: [] },
      { id: "canceled", label: "Canceled", count: 1, tasks: [cardIn("canceled", 40)] },
    ],
    total: 27,
    generatedAt: "2026-11-11T09:00:00.000Z",
  };
}

test("tasks: the page is a component", () => {
  assert.equal(typeof mod.default, "function");
});

test("tasks: address keeps the view and the person in the address", () => {
  assert.equal(mod.address({}), "#/tasks");
  assert.equal(mod.address({ view: "board" }), "#/tasks");
  assert.equal(mod.address({ view: "list" }), "#/tasks?view=list");
  assert.equal(mod.address({ who: "marketer" }), "#/tasks?who=marketer");
  assert.equal(mod.address({ view: "list", who: "chief-of-staff" }), "#/tasks?view=list&who=chief-of-staff");
  assert.equal(mod.address({ view: "list", who: "" }), "#/tasks?view=list");
  assert.equal(mod.address(), "#/tasks");
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

test("tasks: toList groups the non-empty columns in the server's order", () => {
  const groups = mod.toList(sixColumns().columns);
  assert.deepEqual(groups.map((g) => g.id), ["backlog", "in_progress", "done", "canceled"]);
  assert.deepEqual(groups.map((g) => g.label), ["Backlog", "In progress", "Done", "Canceled"]);
  const done = groups.find((g) => g.id === "done");
  assert.equal(done.tasks.length, 20);
  assert.equal(done.count, 23);
  assert.equal(done.older, 3);
  assert.equal(groups[1].tasks[0].identifier, "STH-2");

  const fromShape = mod.toList(sample.columns);
  assert.equal(fromShape.length, 1);
  assert.equal(fromShape[0].tasks[0].identifier, "STH-8");
  assert.equal(fromShape[0].older, 0);

  assert.deepEqual(mod.toList(null), []);
  assert.deepEqual(mod.toList([{ id: "nonsense", count: 3, tasks: [card] }, null]), []);
});

test("tasks: columnsOf always gives six well-formed columns", () => {
  const cols = mod.columnsOf(sample);
  assert.deepEqual(cols.map((c) => c.id), ["backlog", "in_progress", "pending_review", "done", "failed", "canceled"]);
  assert.deepEqual(cols.map((c) => c.label), ["Backlog", "In progress", "Pending review", "Done", "Failed", "Canceled"]);
  assert.equal(cols[0].tasks.length, 1);
  assert.equal(cols[5].count, 0);
  assert.deepEqual(mod.columnsOf(null).map((c) => c.count), [0, 0, 0, 0, 0, 0]);
  const odd = mod.columnsOf({ columns: [{ id: "done", count: 0, tasks: [card, null, "x"] }] });
  assert.equal(odd.find((c) => c.id === "done").count, 1);
});

test("tasks: whoOptions lists everyone, then the team, and keeps an unknown slug", () => {
  const team = shape("shell").team;
  const opts = mod.whoOptions(team, "");
  assert.deepEqual(opts[0], { value: "", label: "Everyone" });
  assert.deepEqual(opts[1], { value: "chief-of-staff", label: "Chief of staff" });
  assert.equal(mod.whoOptions(team, "artist").at(-1).value, "artist");
  assert.equal(mod.whoOptions(null, "").length, 1);
  assert.equal(mod.whoOptions([{ slug: "<b>", name: "x" }], "").length, 1);
});
