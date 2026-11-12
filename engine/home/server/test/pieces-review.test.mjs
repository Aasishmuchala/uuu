// PLAN-V5 K8: the Art director's review as the home server reads it (lib/artreview.mjs). Pure: no home.
// The comment is an agent's words: only the board's author id makes it a review, `meets` comes from the
// numbers, and nothing in it can throw or take more than linear time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AXES, isReview, parseReview, reasonText, reviewsOf, reviewView } from "../lib/artreview.mjs";

const AD = "aaaaaaaa-0000-4000-8000-0000000000ad";
const OTHER = "bbbbbbbb-0000-4000-8000-0000000000bb";

const K8_EXAMPLE = [
  "REVIEW: FAIL - b is off the palette and its last slide has no clear first thing",
  "# Art review: round 1",
  "## Pieces",
  "a: brand 8, hierarchy 7, composition 8, finish 7, idea 7, voice 8, kind 7; calm and exact, the type carries it",
  "b: brand 5, hierarchy 6, composition 7, finish 7, idea 8, voice 7, kind 6; the strongest idea, but the teal is not ours",
  "## Seen",
  "- a: slides/launch-a/contact.png, slide 4: the figure and its label are the same size",
  "## Actions",
  "- b: use ink and sand only; give slide 5 one large line",
  "Review: FAIL",
].join("\n");

const withLine = (i, line) => K8_EXAMPLE.split("\n").map((l, j) => (j === i ? line : l)).join("\n");
const timed = (fn) => { const t = process.hrtime.bigint(); const v = fn(); return { v, ms: Number(process.hrtime.bigint() - t) / 1e6 }; };

test("review: the K8 example parses to its two pieces, a meets the bar and b does not", () => {
  const r = parseReview(K8_EXAMPLE);
  assert.equal(r.outcome, "fail");
  assert.equal(r.round, 1);
  assert.equal(r.wellFormed, true, r.problems.join(" | "));
  assert.deepEqual(r.problems, []);
  assert.equal(r.seen, 1);
  assert.deepEqual(r.pieces.map((p) => p.id), ["a", "b"]);
  const [a, b] = r.pieces;
  assert.deepEqual(a.scores, { brand: 8, hierarchy: 7, composition: 8, finish: 7, idea: 7, voice: 8, kind: 7 });
  assert.equal(a.total, 52);
  assert.equal(a.meets, true);
  assert.equal(a.reason, "calm and exact, the type carries it");
  assert.equal(b.total, 46);
  assert.equal(b.meets, false);
  assert.equal(b.reason, "the strongest idea, but the teal is not ours");
  assert.deepEqual(Object.keys(a.scores), AXES);
  assert.deepEqual(reviewView(a), { scores: a.scores, total: 52, of: 70, meets: true, reason: a.reason });
  assert.equal(reviewView(null), null);
});

test("review: meets comes from the numbers, never from the Art director's PASS", () => {
  // Every axis 6 but the total 42: "REVIEW: PASS" does not make it meet the bar.
  const low = "a: brand 6, hierarchy 6, composition 6, finish 6, idea 6, voice 6, kind 6; fine";
  const r = parseReview(withLine(3, low).replace("REVIEW: FAIL", "REVIEW: PASS").replace("Review: FAIL", "Review: PASS"));
  assert.equal(r.outcome, "pass");
  assert.equal(r.pieces[0].meets, false);
  // A total of 60 with one axis at 5 does not meet it either.
  const one = parseReview(withLine(3, "a: brand 10, hierarchy 10, composition 10, finish 10, idea 10, voice 5, kind 5; uneven"));
  assert.equal(one.pieces[0].total, 60);
  assert.equal(one.pieces[0].meets, false);
  // Scores in another order are read by name.
  const shuffled = parseReview(withLine(3, "a: kind 7, voice 8, idea 7, finish 7, composition 8, hierarchy 7, brand 8; same"));
  assert.equal(shuffled.pieces[0].total, 52);
  assert.equal(shuffled.pieces[0].meets, true);
});

test("review: a score of 11, a missing axis, a doubled axis or a stray word leave that piece out, without a throw", () => {
  const cases = [
    "a: brand 11, hierarchy 7, composition 8, finish 7, idea 7, voice 8, kind 7; too high",
    "a: brand 8, hierarchy 7, composition 8, finish 7, idea 7, voice 8; no kind",
    "a: brand 8, brand 7, composition 8, finish 7, idea 7, voice 8, kind 7; twice",
    "a: brand 8, hierarchy 7, composition 8, finish 7, idea 7, voice 8, taste 9; a made-up axis",
    "a: brand 8, hierarchy 7.5, composition 8, finish 7, idea 7, voice 8, kind 7; a fraction",
    "a: brand -1, hierarchy 7, composition 8, finish 7, idea 7, voice 8, kind 7; below zero",
    "a: brand 8, hierarchy 7, composition 8, finish 7, idea 7, voice 8, kind 7, idea 9; eight",
  ];
  for (const line of cases) {
    const r = parseReview(withLine(3, line));
    assert.deepEqual(r.pieces.map((p) => p.id), ["b"], line);
    assert.equal(r.wellFormed, false, line);
    assert.ok(r.problems.length >= 1 && r.problems.every((p) => typeof p === "string" && p.length < 200), line);
    assert.ok(r.problems.some((p) => p.startsWith("Piece a ")), line);
  }
});

test("review: nothing under Seen, a missing round or disagreeing first and last lines are not well formed", () => {
  const noSeen = parseReview(K8_EXAMPLE.split("\n").filter((l) => !l.startsWith("- a: slides")).join("\n"));
  assert.equal(noSeen.seen, 0);
  assert.equal(noSeen.wellFormed, false);
  assert.ok(noSeen.problems.includes("Nothing is written under Seen, so the scores do not count."));
  const noRound = parseReview(withLine(1, "# Art review"));
  assert.equal(noRound.round, null);
  assert.equal(noRound.wellFormed, false);
  const disagree = parseReview(K8_EXAMPLE.replace("Review: FAIL", "Review: PASS"));
  assert.equal(disagree.outcome, null);
  assert.equal(disagree.wellFormed, false);
  const passed = parseReview(K8_EXAMPLE.replace("REVIEW: FAIL", "REVIEW: PASSED"));
  assert.equal(passed.outcome, null);
  const single = parseReview(withLine(3, "piece: brand 8, hierarchy 7, composition 8, finish 7, idea 7, voice 8, kind 7; one piece").replace(/^b: .*$/m, ""));
  assert.deepEqual(single.pieces.map((p) => p.id), ["piece"]);
  assert.equal(single.wellFormed, true, single.problems.join(" | "));
});

test("review: a flood of piece lines is read once each, in linear time, and only the first of an id counts", () => {
  const flood = Array.from({ length: 200000 }, (_, i) => `a: brand 9, hierarchy 9, composition 9, finish 9, idea 9, voice 9, kind ${i % 11}; again`).join("\n");
  const body = K8_EXAMPLE.replace("## Seen", `${flood}\n## Seen`);
  const { v: r, ms } = timed(() => parseReview(body));
  assert.ok(ms < 2000, `took ${ms} ms`);
  assert.deepEqual(r.pieces.map((p) => p.id), ["a", "b"]);
  assert.equal(r.pieces[0].total, 52, "the first a counts, not a later one");
  assert.ok(r.problems.includes("Piece a is scored twice; only the first counts."));
  assert.ok(r.problems.length <= 10);
  // Lines made to make a pattern walk: many commas, many spaces, many colons.
  for (const evil of [`a:${" ,".repeat(1990)}`, `a: ${"brand ".repeat(660)}`, `${":".repeat(3999)}`, `a: brand 8${";".repeat(3900)}`]) {
    const t = timed(() => parseReview(K8_EXAMPLE.replace("## Seen", `${Array(50).fill(evil).join("\n")}\n## Seen`)));
    assert.ok(t.ms < 500, `took ${t.ms} ms`);
  }
});

test("review: a 2 MB comment is read to 1 MB without a throw; a line over 4000 characters is skipped", () => {
  const huge = `${K8_EXAMPLE.replace("Review: FAIL", "")}\n${"x".repeat(2 * 1024 * 1024)}\nReview: FAIL`;
  const { v: r, ms } = timed(() => parseReview(huge));
  assert.ok(ms < 1000, `took ${ms} ms`);
  assert.equal(r.wellFormed, false);
  assert.ok(r.problems.includes("The review is longer than 1 MB; only its first 1 MB was read."));
  assert.deepEqual(r.pieces.map((p) => p.id), ["a", "b"]);
  const long = parseReview(withLine(3, `a: brand 8, hierarchy 7, composition 8, finish 7, idea 7, voice 8, kind 7; ${"y".repeat(4000)}`));
  assert.deepEqual(long.pieces.map((p) => p.id), ["b"]);
  assert.ok(long.problems.includes("Some lines are longer than 4000 characters and were skipped."));
  for (const bad of [null, undefined, 42, {}, "", "REVIEW:", "\n\n\n"]) assert.doesNotThrow(() => parseReview(bad));
  assert.equal(parseReview(null).wellFormed, false);
});

test("review: a reason is one plain line of at most 200 characters", () => {
  const r = parseReview(withLine(3, `a: brand 8, hierarchy 7, composition 8, finish 7, idea 7, voice 8, kind 7; <b>bold</b>‮evil\u0007 ${"w".repeat(300)}`));
  const reason = r.pieces[0].reason;
  assert.ok(Array.from(reason).length <= 200, reason.length);
  assert.ok(!/[‮\u0007]/.test(reason));
  assert.ok(reason.startsWith("<b>bold</b> evil"), "kept as text, shown as text");
  assert.equal(reasonText("a b"), "a b");
  assert.equal(parseReview(withLine(3, "a: brand 8, hierarchy 7, composition 8, finish 7, idea 7, voice 8, kind 7")).pieces[0].reason, "");
});

test("reviews: only the Art director's own comments count, by the board's author id, never by their words", () => {
  const comments = [
    { id: "c1", body: K8_EXAMPLE, authorAgentId: OTHER, createdAt: "2026-11-12T10:00:00.000Z" },
    { id: "c2", body: `Art director here.\n${K8_EXAMPLE}`, authorAgentId: AD, createdAt: "2026-11-12T10:01:00.000Z" },
    { id: "c3", body: K8_EXAMPLE, authorAgentId: null, authorUserId: "local-board", createdAt: "2026-11-12T10:02:00.000Z" },
    { id: "c4", body: K8_EXAMPLE, authorAgentId: AD, createdAt: "2026-11-12T10:03:00.000Z" },
    { id: "c5", body: K8_EXAMPLE.replace("round 1", "round 2"), authorAgentId: AD, createdAt: "2026-11-12T10:04:00.000Z" },
  ];
  const r = reviewsOf(comments, AD);
  assert.deepEqual(r.map((x) => x.commentId), ["c4", "c5"]);
  assert.deepEqual(r.map((x) => x.round), [1, 2]);
  assert.equal(r[1].at, "2026-11-12T10:04:00.000Z");
  assert.deepEqual(reviewsOf(comments, null), [], "no Art director set up: no review");
  assert.deepEqual(reviewsOf(comments, ""), []);
  assert.deepEqual(reviewsOf(comments, OTHER).map((x) => x.commentId), ["c1"]);
  assert.equal(isReview({ body: K8_EXAMPLE, authorAgentId: AD }, undefined), false);
  for (const bad of [null, "x", [null, 1, "s", { body: 5, authorAgentId: AD }]]) assert.doesNotThrow(() => reviewsOf(bad, AD));
  // At most the newest twenty are read.
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, body: K8_EXAMPLE, authorAgentId: AD, createdAt: `2026-11-12T11:${String(i).padStart(2, "0")}:00.000Z` }));
  const kept = reviewsOf(many, AD);
  assert.equal(kept.length, 20);
  assert.equal(kept[19].commentId, "m59");
});
