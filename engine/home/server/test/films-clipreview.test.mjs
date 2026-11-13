// PLAN-V5 T41c, lib/clipreview.mjs: the Art director's clip review (K14 step 4, C11). The model in the role file
// parses to a well-formed review; the outcome is the clips' own; nothing an agent can write makes it throw, take a
// clip that is not a film's (s01-t1 to s12-t2), or count a comment the Art director did not write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_DIR } from "../lib/app.mjs";
import { CLIP_ID, clipReviewsOf, isClipReview, parseClipReview, usableClipReview } from "../lib/clipreview.mjs";

const AD = "aaaaaaaa-0000-4000-8000-0000000000ad";
const ARTIST = "aaaaaaaa-0000-4000-8000-0000000000a1";

// The model comment in section 7 of the Art director's role, exactly as the role file holds it.
function roleModel() {
  const text = readFileSync(join(SERVER_DIR, "..", "..", "company", "roles", "art-director.md"), "utf8");
  const from = text.indexOf("### 7. A film's clips");
  assert.ok(from > 0, "the role has its section 7");
  const open = text.indexOf("```\nCLIPS:", from);
  const close = text.indexOf("```", open + 3);
  assert.ok(open > from && close > open, "section 7 holds the model");
  return text.slice(open + 4, close);
}

const review = (lines) => lines.join("\n");
const KEEP_ROUND2 = review([
  "CLIPS: KEEP - the retake of s03 holds its lines",
  "# Clip review: round 2",
  "## Clips",
  "s03-t1: keep; the smaller fault: one window flickers in the last still",
  "## Seen",
  "- clips/s03-t2/frame-04.png: the tower's edge still bends",
  "Clips: KEEP",
]);

test("the model in art-director.md section 7 parses to a well-formed review: retake, round 1, three clips", () => {
  const r = parseClipReview(roleModel());
  assert.deepEqual(r.problems, []);
  assert.equal(r.wellFormed, true);
  assert.equal(r.outcome, "retake");
  assert.equal(r.round, 1);
  assert.equal(r.seen, 3);
  assert.deepEqual(r.clips, [
    { clip: "s01-t1", verdict: "keep", reason: "the approach is steady and the windows hold their light" },
    { clip: "s02-t1", verdict: "keep", reason: "the pan follows the board and the courtyard stays whole" },
    { clip: "s03-t1", verdict: "retake", reason: "the tower's edge bends in the last two stills" },
  ]);
  assert.equal(usableClipReview(r), true);
});

test("a second round is KEEP and may name the earlier take; CRLF line ends read the same", () => {
  const r = parseClipReview(KEEP_ROUND2);
  assert.equal(r.wellFormed, true);
  assert.equal(r.outcome, "keep");
  assert.equal(r.round, 2);
  assert.deepEqual(r.clips.map((c) => [c.clip, c.verdict]), [["s03-t1", "keep"]]);
  assert.deepEqual(parseClipReview(KEEP_ROUND2.replace(/\n/g, "\r\n")), r);
});

test("the outcome is the clips' own: one retake makes it a retake whatever the first line says, and it is not well formed", () => {
  const r = parseClipReview(review([
    "CLIPS: KEEP - all fine",
    "# Clip review: round 1",
    "## Clips",
    "s01-t1: keep; steady",
    "s02-t1: RETAKE; the door vanishes",
    "## Seen",
    "- clips/s02-t1/frame-03.png: the door is gone",
    "Clips: KEEP",
  ]));
  assert.equal(r.outcome, "retake");
  assert.equal(r.wellFormed, false);
  assert.ok(r.problems.some((p) => /first line says KEEP, but the clips say RETAKE/.test(p)), r.problems.join(" | "));
  assert.deepEqual(r.clips.map((c) => c.verdict), ["keep", "retake"]);
});

test("first and last lines that disagree, a missing round, no Seen: not well formed, the verdicts still read", () => {
  const disagree = parseClipReview(review(["CLIPS: KEEP - fine", "# Clip review: round 1", "## Clips", "s01-t1: keep; fine", "## Seen", "- x: y", "Clips: RETAKE"]));
  assert.equal(disagree.wellFormed, false);
  assert.ok(disagree.problems.includes("The clip review's first and last lines disagree."));
  const noRound = parseClipReview(review(["CLIPS: KEEP - fine", "## Clips", "s01-t1: keep; fine", "## Seen", "- x: y", "Clips: KEEP"]));
  assert.equal(noRound.round, null);
  assert.equal(noRound.wellFormed, false);
  const noSeen = parseClipReview(review(["CLIPS: KEEP - fine", "# Clip review: round 1", "## Clips", "s01-t1: keep; fine", "Clips: KEEP"]));
  assert.equal(noSeen.seen, 0);
  assert.equal(usableClipReview(noSeen), false);
  assert.ok(noSeen.problems.includes("Nothing is written under Seen, so the verdicts do not count."));
});

test("a clip that is not a film's (s01-t9, s13-t1, s1-t1, s01-t3, s01-t1x, a path) is never taken", () => {
  for (const bad of ["s01-t9", "s13-t1", "s00-t1", "s1-t1", "s01-t3", "s01-t0", "s01-t1x", "S01-T1", "clips/s01-t1", "s01-t1.mp4"]) {
    const r = parseClipReview(review(["CLIPS: RETAKE - x", "# Clip review: round 1", "## Clips", `${bad}: retake; bad`, "## Seen", "- a: b", "Clips: RETAKE"]));
    assert.deepEqual(r.clips, [], bad);
    assert.equal(r.outcome, null, bad);
    assert.equal(r.wellFormed, false, bad);
  }
  for (const good of ["s01-t1", "s12-t2", "s09-t2"]) assert.ok(CLIP_ID.test(good), good);
});

test("a verdict that is neither keep nor retake, and a clip named twice: the first line only, problems said", () => {
  const r = parseClipReview(review([
    "CLIPS: KEEP - x", "# Clip review: round 1", "## Clips",
    "s01-t1: keeper; nearly", "s02-t1: keep; first", "s02-t1: retake; second", "s03-t1: maybe",
    "## Seen", "- a: b", "Clips: KEEP",
  ]));
  assert.deepEqual(r.clips, [{ clip: "s02-t1", verdict: "keep", reason: "first" }]);
  assert.ok(r.problems.some((p) => p.startsWith("Clip s01-t1 is neither kept")));
  assert.ok(r.problems.includes("Clip s02-t1 is named twice; only the first counts."));
  assert.ok(r.problems.some((p) => p.startsWith("Clip s03-t1 is neither kept")));
  assert.equal(r.wellFormed, false);
});

test("a reason is one plain line of at most 200 characters: control and direction characters become spaces", () => {
  const long = `the tower bends ${"x".repeat(400)}`;
  const r = parseClipReview(review([
    "CLIPS: RETAKE - x", "# Clip review: round 1", "## Clips",
    `s01-t1: retake; ${long}`, "s02-t1: keep; a‮b\u0007c d",
    "## Seen", "- a: b", "Clips: RETAKE",
  ]));
  assert.equal(Array.from(r.clips[0].reason).length, 200);
  assert.ok(r.clips[0].reason.endsWith("…"));
  assert.equal(r.clips[1].reason, "a b c d");
});

test("a flood of lines is read in linear time, and each clip counts once", () => {
  const lines = ["CLIPS: KEEP - x", "# Clip review: round 1", "## Clips"];
  for (let i = 0; i < 200000; i += 1) lines.push(`s${String((i % 12) + 1).padStart(2, "0")}-t${(Math.floor(i / 12) % 2) + 1}: keep; ${":;".repeat(20)}`);
  lines.push("## Seen", "- a: b", "Clips: KEEP");
  const started = Date.now();
  const r = parseClipReview(lines.join("\n"));
  assert.ok(Date.now() - started < 3000, "linear");
  assert.equal(r.clips.length, 24, "each clip once");
  assert.equal(r.wellFormed, false);
  const pathological = `CLIPS: KEEP - ${"s01-t1: keep; ".repeat(60000)}`;
  const t0 = Date.now();
  assert.doesNotThrow(() => parseClipReview(pathological));
  assert.ok(Date.now() - t0 < 3000);
});

test("a 2 MB comment: only its first 1 MB is read, no throw; lines over 4000 characters are skipped", () => {
  const head = ["CLIPS: KEEP - x", "# Clip review: round 1", "## Clips", "s01-t1: keep; fine", "## Seen", "- a: b"].join("\n");
  const body = `${head}\n${"y".repeat(2 * 1024 * 1024)}\ns02-t1: retake; past the first megabyte\nClips: KEEP`;
  const r = parseClipReview(body);
  assert.deepEqual(r.clips.map((c) => c.clip), ["s01-t1"]);
  assert.ok(r.problems.includes("The clip review is longer than 1 MB; only its first 1 MB was read."));
  assert.ok(r.problems.includes("Some lines are longer than 4000 characters and were skipped."));
  const longLine = parseClipReview(review(["CLIPS: KEEP - x", "# Clip review: round 1", "## Clips", `s01-t1: keep; ${"z".repeat(5000)}`, "## Seen", "- a: b", "Clips: KEEP"]));
  assert.deepEqual(longLine.clips, []);
});

test("anything that is not a comment's text never throws and takes nothing", () => {
  for (const body of [null, undefined, 7, {}, [], "", "   ", "\n\n\n", "CLIPS:", "Clips: KEEP"]) {
    const r = parseClipReview(body);
    assert.deepEqual(r.clips, []);
    assert.equal(r.outcome, null);
    assert.equal(r.wellFormed, false);
  }
  assert.deepEqual(clipReviewsOf(null, AD), []);
  assert.deepEqual(clipReviewsOf([null, 7, { body: 5 }], AD), []);
});

test("clipReviewsOf counts only the Art director's CLIPS comments, by the board's author id, oldest first", () => {
  const c = (id, body, author, at) => ({ id, body, authorAgentId: author, createdAt: at });
  const comments = [
    c("c1", KEEP_ROUND2, ARTIST, "2026-11-13T09:00:00.000Z"),
    c("c2", roleModel(), AD, "2026-11-13T09:01:00.000Z"),
    c("c3", "REVIEW: PASS - all three hold the brand\n# Art review: round 1", AD, "2026-11-13T09:02:00.000Z"),
    c("c4", `  ${KEEP_ROUND2}`, AD, "2026-11-13T09:03:00.000Z"),
    { id: "c5", body: KEEP_ROUND2, authorAgentId: null, authorUserId: "local-board", createdAt: "2026-11-13T09:04:00.000Z" },
  ];
  const got = clipReviewsOf(comments, AD);
  assert.deepEqual(got.map((r) => [r.commentId, r.outcome, r.round, r.at]), [
    ["c2", "retake", 1, "2026-11-13T09:01:00.000Z"],
    ["c4", "keep", 2, "2026-11-13T09:03:00.000Z"],
  ]);
  assert.deepEqual(clipReviewsOf(comments, null), [], "no Art director set up: nothing counts");
  assert.equal(isClipReview(comments[0], AD), false);
  assert.equal(isClipReview(comments[2], AD), false, "an art review is not a clip review");
});
