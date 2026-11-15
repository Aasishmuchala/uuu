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

import { overall, partAt, WORDS } from "../../pages/health.js";

test("health: overall is the worst thing among the parts and the fence", () => {
  const held = { lastProof: { result: "holds", passed: 3, failed: 0 } };
  assert.equal(overall({ parts: [{ state: "on" }], fence: held }).tone, "good");
  assert.equal(overall({ parts: [{ state: "on" }, { state: "off" }], fence: held }).tone, "bad");
  assert.equal(overall({ parts: [{ state: "on" }], fence: { lastProof: { result: "broken", passed: 1, failed: 2 } } }).tone, "bad");
  assert.equal(overall({ parts: [{ state: "not_installed" }], fence: held }).text, WORDS.overall.warn);
  assert.equal(overall({ parts: [{ state: "on" }], fence: {} }).tone, "warn");
  assert.equal(overall(null).tone, "warn");
});

test("health: each part has a group and an icon; an unknown one goes with the engine", () => {
  assert.equal(partAt("gate")[0], "gate");
  assert.equal(partAt("web")[0], "doors");
  assert.equal(partAt("apps")[0], "apps");
  assert.equal(partAt("books")[0], "books");
  assert.equal(partAt("zzz")[0], "engine");
});

test("health: the page keeps the proof words and draws no card", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/health.js", import.meta.url), "utf8");
  assert.match(src, /Run the proof now/);
  assert.match(src, /Show technical details/);
  assert.doesNotMatch(src, /Card/);
});

import { tilesOf, ago, checksLine } from "../../pages/health.js";

test("health: the tiles count the parts and say when the proof ran, from the answer alone (TB5a)", () => {
  const now = new Date("2026-11-16T09:00:00.000Z");
  const parts = [{ state: "on" }, { state: "on" }, { state: "off" }, { state: "not_installed" }, null];
  const ran = "2026-11-11T08:30:00.000Z";
  const t = tilesOf({ parts, fence: { lastProof: { ranAt: ran, result: "holds", passed: 3, failed: 0 } } }, now);
  assert.deepEqual(t.map((x) => [x.id, x.value]), [["on", "2"], ["off", "1"], ["not_installed", "1"], ["proof", "5 days ago"]]);
  assert.equal(t[3].tone, "good");
  assert.match(t[3].foot, /^11 Nov 2026, /);
  // No unhealthy part: no tile for it; one appears when the answer has one.
  assert.ok(tilesOf({ parts: [{ state: "unhealthy" }] }, now).some((x) => x.id === "unhealthy" && x.value === "1"));
  // A proof that did not hold and has no time: its word, no foot; no proof at all: "Not run yet".
  const bad = tilesOf({ parts: [], fence: { lastProof: { result: "broken", passed: 1, failed: 2 } } }, now);
  assert.deepEqual(bad, [{ id: "proof", tone: "bad", label: WORDS.tiles.proof, value: "Did not hold", foot: "" }]);
  assert.equal(tilesOf({ parts: [], fence: { lastProof: null } }, now)[0].value, WORDS.tiles.notRun);
  // No fence in the answer: no proof tile; nothing at all: no tiles.
  assert.ok(!tilesOf({ parts }, now).some((x) => x.id === "proof"));
  assert.deepEqual(tilesOf(null, now), []);
});

test("health: ago says how long ago in words, and nothing for a missing time (TB5a)", () => {
  const now = new Date("2026-11-16T09:00:00.000Z");
  assert.equal(ago("2026-11-16T08:59:40.000Z", now), "Just now");
  assert.equal(ago("2026-11-16T08:48:00.000Z", now), "12 min ago");
  assert.equal(ago("2026-11-16T06:00:00.000Z", now), "3 h ago");
  assert.equal(ago("2026-11-15T08:00:00.000Z", now), "Yesterday");
  assert.equal(ago("2026-11-11T08:30:00.000Z", now), "5 days ago");
  assert.match(ago("2026-10-01T08:30:00.000Z", now), /^1 Oct$/);
  assert.equal(ago(undefined, now), "");
  assert.equal(ago("nonsense", now), "");
});

test("health: checksLine counts the last proof's checks, and is empty without one (TB5a)", () => {
  assert.equal(checksLine({ passed: 3, failed: 0 }), "3 checks passed");
  assert.equal(checksLine({ passed: 1, failed: 2 }), "1 check passed, 2 failed");
  assert.equal(checksLine(null), "");
});

test("health: the page's layout keeps its promises (TB5a)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/health.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../styles/pages/health.css", import.meta.url), "utf8");
  // The overall state is the kit's chip beside the title.
  assert.match(src, /<\$\{PageHeader\} title="Health"[^>]*>\s*<\$\{Tag\} tone=\$\{all\.tone\}>\$\{all\.text\}<\/\/>/);
  assert.match(css, /\.p-health \.k-page-header__more \{ grid-column: 2; grid-row: 1;/);
  // The fence's sentence once: the server's sentence, no second line saying the same.
  assert.doesNotMatch(src, /\$\{fence && fence\.sentence\} \$\{proofLine/);
  // Copy is a ghost icon button beside the command's mono chip, and the chip is 12.5 px.
  assert.match(src, /<code class="p-health__code">\$\{m\[2\]\}<\/code>\s*<\$\{Button\} variant="ghost" size="sm" icon=/);
  assert.match(css, /\.p-health \.p-health__code \{[^}]*font-family: var\(--font-mono\);[^}]*font-size: calc\(var\(--fs-label\) \+ \.5px\);/, "12.5 px");
  // 32 px tiles, 32 px between groups, a count beside a group's name.
  assert.match(css, /\.p-health \.p-health__tile \{[^}]*width: 32px;[^}]*height: 32px;/);
  assert.match(css, /\.p-health \.p-health__group \+ \.p-health__group \{ margin-top: var\(--s-8\); \}/);
  assert.equal(WORDS.partsOn(2, 4), "2 of 4 on");
  // The proof's button is a small ghost in the buttons' column, whose width every such button shares.
  assert.match(src, /act=\$\{html`<\$\{Button\} variant="ghost" size="sm" onClick=\$\{onRun\}/);
  assert.match(css, /\.p-health \.p-health__act \{[^}]*width: 152px;/);
});
