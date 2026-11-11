import { test } from "node:test";
import assert from "node:assert/strict";
import Page, { groupCount } from "../../pages/search.js";

test("search: the page is a component", () => {
  assert.equal(typeof Page, "function");
});

test("search: groupCount adds up results across groups", () => {
  assert.equal(groupCount([{ results: [1, 2] }, { results: [3] }, { results: [] }]), 3);
  assert.equal(groupCount([]), 0);
});

test("search: groupCount survives odd input", () => {
  assert.equal(groupCount(undefined), 0);
  assert.equal(groupCount([null, {}, { results: "x" }]), 0);
});

import { groupLabel } from "../../pages/search.js";

test("search: the groups Jobs and Files carry the owner's words", () => {
  assert.equal(groupLabel({ source: "jobs", label: "Jobs" }), "Jobs");
  assert.equal(groupLabel({ source: "brain", label: "Files" }), "Files");
  assert.equal(groupLabel({ source: "knowledge", label: "Docs" }), "Files");
  assert.equal(groupLabel({ source: "goals", label: "Goals" }), "Tasks");
  assert.equal(groupLabel({ source: "other", label: "Other" }), "Other");
  assert.equal(groupLabel(null), "");
});
