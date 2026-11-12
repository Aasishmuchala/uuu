import { test } from "node:test";
import assert from "node:assert/strict";
import Page, { proofLine, diskLine } from "../../pages/health.js";

test("health: the page is a component", () => {
  assert.equal(typeof Page, "function");
});

test("health: proofLine says when and how the proof came out", () => {
  assert.equal(proofLine(null), "The proof has not been run on this Mac yet.");
  const held = proofLine({ ranAt: "2026-11-11T08:30:00.000Z", result: "holds", passed: 3, failed: 0 });
  assert.match(held, /^The fence held when it was last checked on /);
  assert.match(held, /3 checks passed\.$/);
  const bad = proofLine({ ranAt: "2026-11-11T08:30:00.000Z", result: "broken", passed: 1, failed: 2 });
  assert.match(bad, /^The fence did not hold/);
  assert.match(bad, /1 check passed, 2 failed\.$/);
});

test("health: diskLine puts free space against the floor", () => {
  assert.equal(diskLine({ freeGb: 40, floorGb: 20, ok: true }), "40 GB free. The engine keeps at least 20 GB free.");
  assert.equal(diskLine({ freeGb: null, floorGb: 20, ok: false }), "Free space on this Mac is not known.");
  assert.equal(diskLine(undefined), "Free space on this Mac is not known.");
});

import { waitingFor, problemLine } from "../../pages/health.js";

const J = (title, ready, why) => ({ id: `x/${title}`, title, ready, why });
const jobs = { departments: [{ id: "studio", clusters: [{ id: "motion", jobs: [
  J("A", false, { name: "video", text: "The Artist's video tool is not installed yet.", link: { page: "health" } }),
  J("B", false, { name: "video", text: "The Artist's video tool is not installed yet.", link: { page: "health" } }),
  J("C", false, { name: "speech", text: "The speech model is not in place yet.", link: { page: "health" } }),
  J("D", false, { name: "reads", text: 'Fill in "Brand" first.', link: { page: "files", id: "x" } }),
  J("E", true, null),
] }] }] };

test("health: waitingFor groups the dim jobs by what they wait for and leaves out files", () => {
  const w = waitingFor(jobs);
  assert.equal(w.length, 2);
  assert.equal(w[0].text, "The Artist's video tool is not installed yet.");
  assert.equal(w[0].count, 2);
  assert.deepEqual(w[0].titles, ["A", "B"]);
  assert.match(w[1].step, /^Run: /);
  assert.deepEqual(waitingFor(null), []);
  assert.deepEqual(waitingFor({ departments: [null, { clusters: "x" }] }), []);
});

test("health: problemLine says what was left out and what to do", () => {
  assert.equal(problemLine({ file: "sales/x.json", problem: "no title" }), "The job file sales/x.json was left out: no title. Fix the file, then look here again.");
  assert.match(problemLine("odd"), /Fix the file/);
  assert.match(problemLine(null), /^A job file was left out/);
});
