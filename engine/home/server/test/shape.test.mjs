// The shape files and the shape checker (CONTRACTS-V2 16.5 and 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readShape, sameShape } from "../lib/shape.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "shapes");
const names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));

test("there are at least twenty-six shape files", () => assert.ok(names.length >= 26, `only ${names.length}`));

test("every shape file is valid JSON with no placeholder left", () => {
  for (const n of names) {
    const text = fs.readFileSync(path.join(dir, `${n}.json`), "utf8");
    assert.doesNotThrow(() => JSON.parse(text), n);
    assert.doesNotMatch(text, /"<[a-z-]*>"/, n);
  }
});

test("every shape fits itself", () => {
  for (const n of names) assert.deepEqual(sameShape(readShape(n), readShape(n)), [], n);
});

test("settings lists six accents and five later entries", () => {
  const s = readShape("settings");
  assert.equal(s.accents.length, 6);
  assert.equal(s.later.length, 5);
});

test("a removed nested key is reported with its path", () => {
  const t = readShape("task");
  delete t.task.who.slug;
  assert.deepEqual(sameShape(readShape("task"), t), ["task.who.slug: missing"]);
});

test("a wrong type is reported", () => {
  const t = readShape("task-card");
  t.round = "two";
  const p = sameShape(readShape("task-card"), t);
  assert.equal(p.length, 1);
  assert.match(p[0], /^round: expected number, got string/);
});

test("null in the actual value fits; an empty array fits; extra keys fit", () => {
  const t = readShape("task-card");
  t.stage = null; t.schedule = null; t.extra = 1;
  assert.deepEqual(sameShape(readShape("task-card"), t), []);
  const tasks = readShape("tasks");
  tasks.columns[0].tasks = [];
  assert.deepEqual(sameShape(readShape("tasks"), tasks), []);
});

test("every element of an array is checked against the example", () => {
  const tasks = readShape("tasks");
  const card = readShape("task-card");
  delete card.title;
  tasks.columns[0].tasks = [readShape("task-card"), card];
  assert.deepEqual(sameShape(readShape("tasks"), tasks), ["columns[0].tasks[1].title: missing"]);
});

test("null in the example fits anything", () => {
  assert.deepEqual(sameShape({ a: null }, { a: [1] }), []);
});
