// A film in Studio (PLAN-V5 T45b): the pure helpers of pages/studio-film.js tried on the home server's pinned shape
// (shapes/films.json) and on hostile input, and the page's own source: agents' words as text, only /api/ addresses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TREE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const m = await import("../../pages/studio-film.js");
const { studioHref } = await import("../../pages/studio.js");
const SRC = readFileSync(join(TREE, "pages", "studio-film.js"), "utf8");
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");

function shape(name) {
  for (let d = TREE; d !== dirname(d); d = dirname(d)) {
    const f = join(d, "server", "test", "shapes", `${name}.json`);
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  }
  return null;
}
const AWAY = ["https:", "", ["elsewhere", "example"].join(".")].join("/");

test("credit words: spent of budget, in credits and dollars", () => {
  assert.equal(m.creditWords(175, 600), "175 of 600 credits");
  assert.equal(m.totalWords(175, 600), "175 of 600 credits ($1.75 of $6.00)");
  assert.equal(m.totalWords(0, 220), "0 of 220 credits ($0.00 of $2.20)");
  assert.match(m.creditWords(null, 600), /not known/);
  assert.equal(m.totalWords(null, 600), "Spent so far not known, of 600 credits ($6.00)");
  assert.equal(m.takeCredits(25), "25 credits");
  assert.equal(m.takeCredits(1), "1 credit");
  assert.equal(m.takeCredits("x"), "");
  assert.equal(m.dollarsOf(-5), "");
  assert.equal(m.spentShare(110, 220), 50);
  assert.equal(m.spentShare(500, 220), 100);
  assert.equal(m.spentShare(null, 220), 0);
  assert.equal(m.spentShare(5, 0), 0);
});

test("take states and verdicts in words", () => {
  assert.deepEqual(["making", "made", "refused", "failed", "x"].map(m.takeStateWords), ["Being made", "Made", "Refused by Runway", "Failed", "Not known"]);
  assert.equal(m.verdictWords({ verdict: "keep", reason: "fine", round: 1 }), "Keep");
  assert.equal(m.verdictWords({ verdict: "retake", reason: "the tower bends", round: 1 }), "Retake: the tower bends");
  assert.equal(m.verdictWords({ verdict: "retake", reason: "x".repeat(900) }).length, "Retake: ".length + 200);
  assert.equal(m.verdictWords(null), "Not looked at yet");
  assert.equal(m.verdictWords({ verdict: "other" }), "Not looked at yet");
  assert.deepEqual(["making", "done", "stopped", "needs you", "ended"].map(m.filmStateWords), ["Being made", "Done", "Stopped", "Needs you", "Approval ended"]);
  assert.equal(m.clipsWords(3, 2), "3 clips made, 2 kept");
  assert.equal(m.clipsWords(1, 0), "1 clip made, 0 kept");
  assert.equal(m.takeName("t2"), "Take 2");
  assert.equal(m.takeName("../x"), "Take");
});

test("the banners: a frozen newest batch, a changed shotlist, the server's own problem", () => {
  const f = shape("films").film;
  assert.deepEqual(m.filmBanners(f), []);
  const frozen = { ...f, batches: [{ ...f.batches[0], frozen: false }, { ...f.batches[0], frozen: true }], problem: m.FROZEN_WORDS };
  assert.deepEqual(m.filmBanners(frozen).map((b) => b.text), ["Runway refused two pictures or prompts in this film. It needs you."]);
  assert.equal(m.filmBanners({ ...f, batches: [{ frozen: true }, { frozen: false }] }).length, 0, "only the newest batch counts");
  const both = m.filmBanners({ ...frozen, changedAfterApproval: true });
  assert.deepEqual(both.map((b) => b.key), ["frozen", "changed"]);
  assert.equal(both[1].text, "The shotlist was changed after you approved it. The clips follow what you approved.");
  assert.equal(m.filmBanners({ ...f, problem: "The ledger could not be read." })[0].text, "The ledger could not be read.");
  assert.deepEqual(m.filmBanners(null), []);
  assert.equal(m.anyMaking({ shots: [{ takes: [{ state: "made" }, { state: "making" }] }] }), true);
  assert.equal(m.anyMaking(f), false);
  assert.equal(m.STILL_CHARGING, "Runway may still charge for clips that are being made.");
});

test("the sent picture, the prompt and the edit link", () => {
  const f = shape("films").film;
  assert.equal(m.sentKind(f.shots[0].takes[0].sent), "picture");
  assert.equal(m.sentKind("gone"), "gone");
  assert.equal(m.sentKind(null), "none");
  assert.equal(m.sentKind(`${AWAY}/x.png`), "none");
  assert.equal(m.GONE_WORDS, "No longer kept: the door keeps sent pictures for a day");
  assert.equal(m.clampWords("short"), "short");
  const c = m.clampWords("word ".repeat(200));
  assert.ok(c.length <= 241 && c.endsWith("…"));
  assert.equal(m.editHref(f.edit), "#/dashboards/studio?video=STH-41%2Flake-film");
  assert.equal(m.editHref({ identifier: "../x", name: "a" }), null);
  assert.equal(m.editHref(null), null);
});

test("studioHref opens a film by its task id", () => {
  assert.equal(studioHref({ film: "e0000000-0000-4000-8000-000000000041" }), "#/dashboards/studio?film=e0000000-0000-4000-8000-000000000041");
  assert.equal(studioHref({ film: "a&b" }), "#/dashboards/studio?film=a%26b");
  assert.equal(studioHref({ film: 5 }), "#/dashboards/studio");
});

test("the page: every address passes safeApi, agent words are text, nothing outside /api/", () => {
  assert.doesNotMatch(code, /innerHTML|dangerouslySetInnerHTML|\beval\(|new Function|fetch\(/);
  assert.doesNotMatch(code, /https?:\/\//);
  for (const field of ["take.clip", "take.sent", "shot.board"]) assert.ok(code.includes(`safeApi(${field})`), field);
  assert.match(code, /stills\.map\(safeApi\)/);
  assert.match(code, /useResource\(id \? `\/api\/studio\/films\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(code, /<video class="p-film__video" controls preload="none"/);
  assert.match(code, /useBringIntoView\(/);
  const studio = readFileSync(join(TREE, "pages", "studio.js"), "utf8");
  assert.match(studio, /query\.get\("film"\)/);
  assert.match(studio, /"\/api\/studio\/films", \{ every: EVERY \}/);
  assert.match(studio, /No films yet\./);
  assert.match(studio, /Start "A film from your renders" in <a href="#\/jobs\/studio\/a-film-from-your-renders">Jobs<\/a>/);
});
