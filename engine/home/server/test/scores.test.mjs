// The Checker's scores (CONTRACTS-V3 36.3): scoresOf reads only the pinned form, at most 20, in linear time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scoresOf } from "../lib/scores.mjs";

// The pinned pattern, for comparing on short texts only (it can take very long on a long one).
const PINNED = /^scores:\s*((?:[a-z0-9-]{1,40} (?:10|[0-9])(?:, )?)+);/;

test("scoresOf reads the pinned form", () => {
  assert.deepEqual(scoresOf("scores: concept-1 9, concept-2 8; every concept keeps to the brand's words"), [
    { slug: "concept-1", score: 9 }, { slug: "concept-2", score: 8 },
  ]);
  assert.deepEqual(scoresOf("scores: tone 10, clarity 7, brand-fit 0;"), [
    { slug: "tone", score: 10 }, { slug: "clarity", score: 7 }, { slug: "brand-fit", score: 0 },
  ]);
  assert.deepEqual(scoresOf("scores:slide-1 8;"), [{ slug: "slide-1", score: 8 }]);
});

test("scoresOf: a score over 10 is not a score", () => {
  assert.deepEqual(scoresOf("scores: a 11;"), []);
  assert.deepEqual(scoresOf("scores: a 12, b 9;"), []);
});

test("scoresOf: a slug with a space, capitals or a long slug is not read", () => {
  assert.deepEqual(scoresOf("scores: concept 1 9;"), []);
  assert.deepEqual(scoresOf("scores: Concept-1 9;"), []);
  assert.deepEqual(scoresOf(`scores: ${"a".repeat(41)} 9;`), []);
  assert.deepEqual(scoresOf(`scores: ${"a".repeat(40)} 9;`), [{ slug: "a".repeat(40), score: 9 }]);
});

test("scoresOf: anything else gives an empty list", () => {
  for (const s of [
    "", "scores:", "scores: ;", "scores: a 9", "scores: a 9,", "Scores: a 9;", " scores: a 9;", "the scores: a 9;",
    "scores: a 9 b 8;", "scores: a  9;", "scores: a 9,b 8;", "VERDICT: PASS - scores: a 9;", null, undefined, 42, { reason: "scores: a 9;" },
  ]) assert.deepEqual(scoresOf(s), [], String(s));
});

test("scoresOf keeps the first 20 of 30 scores", () => {
  const all = Array.from({ length: 30 }, (_, i) => `piece-${i + 1} ${i % 11}`).join(", ");
  const got = scoresOf(`scores: ${all}; the rest`);
  assert.equal(got.length, 20);
  assert.deepEqual(got[0], { slug: "piece-1", score: 0 });
  assert.deepEqual(got[19], { slug: "piece-20", score: 19 % 11 });
});

test("scoresOf agrees with the pinned pattern on short texts, 10 read before 1", () => {
  const cases = [
    "scores: a 10;", "scores: a 10 5;", "scores: a 1b 2;", "scores: a 1, ;", "scores: a 10, b 1;", "scores: x 100 1;",
    "scores: a 10b 9;", "scores: a 9, b 8; c 7;", "scores:\ta 3;", "scores: a 1, , b 2;",
  ];
  for (const s of cases) assert.equal(scoresOf(s).length > 0, PINNED.test(s), s);
  assert.deepEqual(scoresOf("scores: a 1b 2;"), [{ slug: "a", score: 1 }, { slug: "b", score: 2 }]);
  assert.deepEqual(scoresOf("scores: a 1, ;"), [{ slug: "a", score: 1 }]);
  assert.deepEqual(scoresOf("scores: a 10 5;"), [{ slug: "a", score: 1 }, { slug: "0", score: 5 }]);
  assert.deepEqual(scoresOf("scores: a 10;"), [{ slug: "a", score: 10 }]);
});

test("scoresOf reads 100,000 characters within 200 ms, matching or not", () => {
  const texts = [
    `scores: ${"a 10".repeat(25000)}`,                      // every "10" is two ways; no ";" at the end
    `scores: ${"a 1, ".repeat(20000)}`,
    `scores: ${"x".repeat(100000)}`,
    `scores: ${"a 10".repeat(24999)};`,
    `scores: ${"a 10".repeat(24990)} x;`,                    // a ";" at the end, and no way to reach it
    "scores: " + "b".repeat(39) + " 9, ".repeat(1) + "c 1".repeat(33000),
  ];
  for (const t of texts) {
    const start = performance.now();
    scoresOf(t);
    const ms = performance.now() - start;
    assert.ok(ms < 200, `${t.length} characters took ${ms.toFixed(1)} ms`);
  }
  assert.equal(scoresOf(`scores: ${"a 10".repeat(24999)};`).length, 20);
});

test("scores.mjs is pure: no file, network or process code", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "lib", "scores.mjs"), "utf8");
  assert.doesNotMatch(src, /\bimport\b|require\(|fetch\(|process\./);
});
