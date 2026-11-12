// The version 3 shape files (CONTRACTS-V3 33.2, 33.3, 33.5, 33.6, 36.2, 37.4).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readShape, sameShape } from "../lib/shape.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "shapes");
const NAMES = ["map", "department", "jobs", "job", "ask", "brain", "brain-file", "studio-slides", "studio-videos"];

test("there are twenty-five shape files in all", () => {
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length, 25);
});

for (const n of NAMES) {
  test(`shape ${n}: valid JSON, no placeholder left, fits itself`, () => {
    const text = fs.readFileSync(path.join(dir, `${n}.json`), "utf8");
    assert.doesNotThrow(() => JSON.parse(text));
    assert.doesNotMatch(text, /"<[a-z-]*>"/);
    assert.deepEqual(sameShape(readShape(n), readShape(n)), []);
  });
}

test("a removed nested key is reported with its path", () => {
  const m = readShape("map");
  delete m.departments[0].clusters[0].jobs[0].stage;
  assert.deepEqual(sameShape(readShape("map"), m), ["departments[0].clusters[0].jobs[0].stage: missing"]);
  const d = readShape("department");
  delete d.agents[0].slug;
  assert.deepEqual(sameShape(readShape("department"), d), ["agents[0].slug: missing"]);
  const a = readShape("ask");
  delete a.answer.sources[0].found;
  assert.deepEqual(sameShape(readShape("ask"), a), ["answer.sources[0].found: missing"]);
});

test("the prose pins are filled: hand-offs, stages, basics, folders, starters", () => {
  const j = readShape("jobs");
  assert.equal(j.handoffs.length, 3);
  assert.equal(j.stages.length, 4);
  const b = readShape("brain");
  assert.equal(b.basics.items.length, 9);
  assert.equal(b.folders.length, 10);
  assert.ok(b.folders.some((f) => f.id === "loose"));
  assert.equal(b.starters.length, 9);
});

test("the job shape carries the who shape and the nested example", () => {
  const j = readShape("job");
  assert.deepEqual(j.who[0], readShape("who"));
  assert.equal(j.runs.last.identifier, "STH-21");
  assert.deepEqual(readShape("studio-slides").sets[0].slides[0], readShape("file-entry"));
});
