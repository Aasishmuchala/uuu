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
