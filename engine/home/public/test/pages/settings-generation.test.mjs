// The Generation section of Settings (PLAN-V5 K13, T44): the pure helpers, a case per state of K13, the dollars,
// the check of a limit as typed, a ledger row's words, why the switch cannot be turned on, and what the source never
// does with the Runway key. The server's own sentences (T41) are read from its modules, so the two cannot drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Section, {
  CAPS, DOOR, MAX_CAP, MODEL_FIELDS, PROBLEMS, RESULT_TONES, WORDS, balanceLine, barTone, batchLine, blockerLines, capCheck, capFieldOf,
  capHint, capsLines, clockOf, creditWords, creditsAndDollars, dayFigures, dayWords, doorState, doorWord, dollars, filmHref, filmName,
  heroMark, isOpen, keyLine, keyMark, leftLine, ledgerLine, mergeDays, modelOptions, pausedLine, plain, problemLine, resultTone, rowWords,
  runningLine, sectionState, share, spentLine, spentMark, stateLines, switchLine, testResult,
} from "../../pages/settings-generation.js";
import Viewer from "../../pages/settings-viewer.js";
import {
  LEDGER_SENTENCES, NOT_STARTED_WORDS, OWN_PAUSE_SENTENCE, PAUSED_SENTENCE, RESULT_WORDS, RUNNING_WORDS, dollars as serverDollars, kindWords,
} from "../../../server/lib/generation.mjs";
import { BLOCKER_SENTENCES, DOOR_SENTENCES, MAX_CAP as SERVER_MAX_CAP, PROBLEM_SENTENCES, TEST_SENTENCES } from "../../../server/routes/generation.mjs";

// The same checks as pages.test.mjs, kept here so that file's tests do not run twice.
const stripJsComments = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
const importsOf = (src) => [...stripJsComments(src).matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
const hostsIn = (t) => [...String(t).matchAll(/\b(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\d+\.\d+\.\d+\.\d+)(?::\d+)?/gi)].map((m) => m[0]);

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(PUBLIC, "pages", "settings-generation.js"), "utf8");
const CODE = stripJsComments(SRC);
// The shape file sits beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const GEN = JSON.parse(readFileSync(join(SHAPES, "generation.json"), "utf8"));
const view = (over = {}) => ({ ...structuredClone(GEN), ...over });
const ready = (over = {}) => view({ on: true, key: { saved: true }, canSwitchOn: true, blockers: [], whyNot: null, ...over });
const spent = (over = {}) => ({ ok: true, day: 0, month: 0, dayLeft: 300, monthLeft: 1000, running: 0, ...over });
// A made-up key, built from parts: never a real one.
const KEY = `key_${"0a1b2c3d".repeat(16)}`;

test("generation: the section is a component, and so is the Page viewer's (T54)", () => {
  assert.equal(typeof Section, "function");
  assert.equal(typeof Viewer, "function");
});

test("generation: K13's Settings words are used as written", () => {
  assert.equal(WORDS.title, "Generation");
  assert.equal(WORDS.intro, "The Artist can make video clips and pictures with Runway, a paid service, from your own renders.");
  assert.equal(WORDS.sent, "When this is on, the renders and prompts you approve are sent to Runway. Runway's terms say it may use them to train its models unless you have an Enterprise agreement. Do not use it for client work you may not share.");
  assert.equal(WORDS.money, "One credit is one US cent. Nothing is spent until you approve a shotlist and its cost.");
  assert.equal(WORDS.keyField, "Runway key");
  assert.equal(WORDS.daily, "Most to spend in a day (credits)");
  assert.equal(WORDS.monthly, "Most to spend in a month (credits)");
  assert.deepEqual(CAPS.map((c) => c.label), ["Most to spend in a day (credits)", "Most to spend in a month (credits)"]);
  assert.deepEqual(CAPS.map((c) => c.key), ["daily", "monthly"]);
  assert.equal(WORDS.noKey, "No key yet. Paste the one from your Runway developer account.");
  assert.equal(WORDS.refused, "Runway refused this key.");
  assert.equal(balanceLine(1000), "Runway says you have 1,000 credits.");
  assert.equal(WORDS.overDay, "Today's limit is reached. Nothing more will be made until tomorrow, or raise the limit.");
  assert.equal(WORDS.paused, "Runway refused three requests in a day. Generation is paused so your account stays safe.");
  assert.equal(WORDS.startAgain, "Start again");
  assert.equal(WORDS.off, "Off. Nothing is sent to Runway.");
  assert.equal(WORDS.on, "On. Only the Artist can ask, and only inside what you approved.");
  // T44's own words.
  assert.equal(WORDS.switchLabel, "Let the Artist use Runway");
  assert.equal(WORDS.saveKey, "Save key");
  assert.equal(WORDS.keySaved, "A key is saved.");
  assert.equal(WORDS.removeKey, "Remove key");
  assert.equal(`${WORDS.removeAsk} ${WORDS.removeWhy}`, "Remove the Runway key? Nothing can be made until you paste one again.");
  assert.equal(WORDS.zero, "A limit of 0 stops all making.");
  assert.equal(WORDS.noFilms, "No film has been approved yet.");
  assert.equal(WORDS.nothingSpent, "Nothing has been spent yet.");
  assert.equal(WORDS.showOlder, "Show older");
  assert.equal(WORDS.restart, "This section appears after the home screen is restarted: engine stop, then engine start.");
  assert.deepEqual(MODEL_FIELDS.map((m) => m.label), ["Clips from a render", "Clips marked best, and clips from words alone", "Variations of a still", "Larger stills"]);
  assert.deepEqual(MODEL_FIELDS.map((m) => m.key), ["video", "videoBest", "still", "upscale"]);
  assert.equal(WORDS.test, "Test");
  for (const w of ["Limits", "Spent", "Models", "Approved films", "What was spent", "Save limits"]) assert.ok(SRC.includes(`>${w}<`), w);
});

test("generation: the server's sentences and the section's are the same (T41)", () => {
  assert.equal(WORDS.paused, PAUSED_SENTENCE);
  assert.equal(WORDS.unreadable, LEDGER_SENTENCES.unreadable);
  assert.deepEqual([WORDS.pasteFirst, WORDS.doorOff, WORDS.noArtist], [BLOCKER_SENTENCES.no_key, BLOCKER_SENTENCES.door_off, BLOCKER_SENTENCES.no_artist]);
  assert.deepEqual(Object.fromEntries(Object.entries(DOOR).map(([k, d]) => [k, d.sentence])), DOOR_SENTENCES);
  assert.deepEqual([WORDS.noKey, WORDS.refused, WORDS.limited, WORDS.doorOff, WORDS.noAnswer],
    [TEST_SENTENCES.no_key, TEST_SENTENCES.key_refused, TEST_SENTENCES.limited, TEST_SENTENCES.door_off, TEST_SENTENCES.no_answer]);
  assert.equal(PROBLEMS.state_unreadable, PROBLEM_SENTENCES.state_unreadable);
  assert.equal(MAX_CAP, SERVER_MAX_CAP);
  for (const n of [0, 1, 5, 150, 300, 999, 1000]) assert.equal(dollars(n), serverDollars(n), String(n));
});

test("generation: the restart line drawn on screen says the plan's sentence", () => {
  const m = /function RestartLine\(\) \{\s*return html`([\s\S]*?)`;/.exec(SRC);
  assert.ok(m);
  assert.equal(m[1].replace(/<[^>]+>/g, ""), WORDS.restart);
});

test("generation: the automatic allowance for small jobs is shown nowhere (C5)", () => {
  for (const bad of [/autoUnderCredits/, /small jobs/i, /without asking/i, /0 means always ask/i]) assert.doesNotMatch(CODE, bad);
});

test("generation: the sentence of a view, a case per state of K13", () => {
  // Off, with no key: the shape's own example.
  assert.deepEqual(stateLines(view()), ["Off. Nothing is sent to Runway.", "No key yet. Paste the one from your Runway developer account."]);
  // On.
  assert.deepEqual(stateLines(ready()), ["On. Only the Artist can ask, and only inside what you approved.", "A key is saved."]);
  // Refused, and the balance: what Test found.
  assert.deepEqual(stateLines(ready({ on: false }), { ok: false, balance: null, monthlyMax: null, sentence: TEST_SENTENCES.key_refused }),
    ["Off. Nothing is sent to Runway.", "A key is saved.", "Runway refused this key."]);
  assert.deepEqual(stateLines(ready(), { ok: true, balance: 1000, monthlyMax: 100000, sentence: "Runway says you have 1000 credits." }).at(-1),
    "Runway says you have 1,000 credits.");
  // Over a cap: today's, then this month's.
  assert.deepEqual(stateLines(ready({ spent: spent({ day: 300, month: 300, dayLeft: 0, monthLeft: 700 }) })).at(-1), WORDS.overDay);
  assert.deepEqual(stateLines(ready({ caps: { daily: 300, monthly: 400 }, spent: spent({ day: 100, month: 400, dayLeft: 200, monthLeft: 0 }) })).at(-1),
    "This month's limit is reached. Nothing more will be made until next month, or raise the limit.");
  // A cap of 0.
  assert.deepEqual(capsLines(ready({ caps: { daily: 0, monthly: 1000 }, spent: spent({ dayLeft: 0 }) })), [WORDS.zero]);
  // Paused: the door's own pause, and the owner's own, each in the server's sentence.
  const paused = ready({ paused: { at: "2026-11-13T08:00:00.000Z", sentence: PAUSED_SENTENCE } });
  assert.deepEqual(stateLines(paused), [WORDS.on, WORDS.keySaved, PAUSED_SENTENCE]);
  assert.equal(pausedLine(ready({ paused: { at: null, sentence: OWN_PAUSE_SENTENCE } })), OWN_PAUSE_SENTENCE);
  assert.equal(pausedLine(ready({ paused: { at: null, sentence: "" } })), WORDS.paused);
  assert.equal(pausedLine(ready()), "");
  // The ledger unreadable or nearly full: its sentence, and no over-a-cap sentence from figures it cannot know.
  const unreadable = ready({ spent: { ok: false, day: null, month: null, dayLeft: 0, monthLeft: 0, running: null }, ledger: { ok: false, bytes: 0, nearlyFull: false, sentence: LEDGER_SENTENCES.unreadable } });
  assert.deepEqual(stateLines(unreadable), [WORDS.on, WORDS.keySaved, LEDGER_SENTENCES.unreadable]);
  assert.equal(ledgerLine(ready({ ledger: { ok: false, bytes: 0, nearlyFull: false, sentence: null } })), LEDGER_SENTENCES.unreadable);
  assert.equal(ledgerLine(ready({ ledger: { ok: true, bytes: 26e6, nearlyFull: true, sentence: LEDGER_SENTENCES.nearlyFull } })), LEDGER_SENTENCES.nearlyFull);
  assert.equal(ledgerLine(ready()), "");
  assert.deepEqual(stateLines(null), [WORDS.off, WORDS.noKey]);
  // The switch's own sentence.
  assert.equal(switchLine(false), WORDS.off);
  assert.equal(switchLine(true), WORDS.on);
  assert.equal(keyLine(view()), WORDS.noKey);
  assert.equal(keyLine(ready()), WORDS.keySaved);
});

test("generation: the marks of the switch, the door and Spent", () => {
  assert.deepEqual(heroMark(view()), { tone: "off", word: "Off" });
  assert.deepEqual(heroMark(ready()), { tone: "ok", word: "On" });
  assert.deepEqual(heroMark(ready({ door: { state: "off", sentence: "" } })), { tone: "warn", word: "On" }, "on, but nothing can go out");
  assert.deepEqual(heroMark(ready({ key: { saved: false } })), { tone: "warn", word: "On" });
  assert.deepEqual(heroMark(ready({ paused: { at: null, sentence: PAUSED_SENTENCE } })), { tone: "warn", word: "Paused" });
  assert.equal(isOpen(ready()), true);
  assert.equal(isOpen(ready({ problem: "state_unreadable" })), false);
  assert.equal(isOpen(null), false);
  assert.equal(doorWord(ready()), "Open");
  assert.equal(doorWord(view()), "Closed");
  assert.equal(doorWord(ready({ paused: { at: null, sentence: "x" } })), "Paused");
  assert.equal(doorWord(ready({ door: { state: "not_installed" } })), "Not installed");
  assert.equal(doorWord(ready({ door: { state: "unhealthy" } })), "Not answering");
  assert.equal(doorState({ state: "made up" }).state, "off");
  assert.equal(doorState(null).sentence, WORDS.doorOff);
  assert.deepEqual(spentMark(ready()), { tone: "ok", word: "Within your limits" });
  assert.deepEqual(spentMark(ready({ spent: spent({ day: 300, dayLeft: 0 }) })), { tone: "bad", word: "Limit reached" });
  assert.deepEqual(spentMark(ready({ paused: { at: null, sentence: "x" } })), { tone: "warn", word: "Paused" });
  assert.deepEqual(spentMark(ready({ spent: { ok: false } })), { tone: "bad", word: "Cannot be read" });
});

test("generation: why the switch cannot be turned on, in the server's order and words", () => {
  assert.deepEqual(blockerLines(view()), ["Paste your Runway key first."]);
  assert.deepEqual(blockerLines(view({ blockers: ["no_key", "door_off", "no_artist"], door: { state: "off" } })),
    ["Paste your Runway key first.", "The generation door is off. Run: engine start", "Run engine setup first, then try again."]);
  assert.deepEqual(blockerLines(view({ blockers: ["door_off"], door: { state: "unhealthy" } })),
    ["The generation door is running but not answering. Run: engine stop, then engine start."]);
  assert.deepEqual(blockerLines(view({ blockers: ["door_off"], door: { state: "not_installed" } })), ["The generation door is not installed yet."]);
  assert.deepEqual(blockerLines(view({ blockers: ["something new"], canSwitchOn: false, whyNot: "The server's reason." })), ["The server's reason."]);
  assert.deepEqual(blockerLines(view({ blockers: ["something new"], canSwitchOn: false, whyNot: null })), [WORDS.cannot]);
  assert.deepEqual(blockerLines(ready()), []);
  assert.deepEqual(blockerLines(null), []);
  // The drawn switch is disabled exactly when it is off and the server says it cannot be switched on.
  assert.match(CODE, /const locked = !on && !view\.canSwitchOn;/);
  assert.match(CODE, /disabled=\$\{locked \|\| Boolean\(busy\)\}/);
});

test("generation: Test's answer in words, K13's states and T41's sentences", () => {
  assert.deepEqual(testResult({ ok: true, balance: 1000, monthlyMax: 100000, sentence: "Runway says you have 1000 credits." }),
    { tone: "ok", word: "Works", sentence: "Runway says you have 1,000 credits.", more: "Your Runway plan lets you spend up to 100,000 credits a month." });
  assert.equal(testResult({ ok: true, balance: 1, monthlyMax: null, sentence: "" }).sentence, "Runway says you have 1 credit.");
  assert.equal(testResult({ ok: true, balance: 1, monthlyMax: null }).more, "");
  assert.equal(testResult({ ok: false, sentence: TEST_SENTENCES.key_refused }).tone, "bad");
  assert.equal(testResult({ ok: false, sentence: TEST_SENTENCES.key_refused }).sentence, "Runway refused this key.");
  assert.equal(testResult({ ok: false, sentence: TEST_SENTENCES.no_key }).sentence, WORDS.noKey);
  assert.equal(testResult({ ok: false, sentence: TEST_SENTENCES.limited }).word, "Busy");
  assert.equal(testResult({ ok: false, sentence: TEST_SENTENCES.door_off }).sentence, "The generation door is off. Run: engine start");
  assert.equal(testResult({ ok: false, sentence: TEST_SENTENCES.no_answer }).word, "No answer");
  assert.equal(testResult({ ok: false, sentence: "<b>odd</b>\u0000" }).sentence, "<b>odd</b>", "shown as plain text");
  assert.equal(testResult(null).sentence, WORDS.noAnswer);
  assert.equal(testResult({ ok: true, balance: -1 }).tone, "warn", "a balance that is not one is not a yes");
  assert.deepEqual(keyMark(view(), null), { tone: "off", word: "No key" });
  assert.deepEqual(keyMark(ready(), null), { tone: "wait", word: "Saved, not tested" });
  assert.deepEqual(keyMark(ready(), { ok: false, sentence: TEST_SENTENCES.key_refused }), { tone: "bad", word: "Refused" });
  assert.deepEqual(keyMark(ready(), { ok: true, balance: 5 }), { tone: "ok", word: "Works" });
});

test("generation: dollars and credits", () => {
  assert.equal(dollars(0), "$0.00");
  assert.equal(dollars(1), "$0.01");
  assert.equal(dollars(150), "$1.50");
  assert.equal(dollars(300), "$3.00");
  assert.equal(dollars(100000), "$1,000.00");
  assert.equal(dollars(1_000_000), "$10,000.00");
  assert.equal(dollars(-5), "$0.00");
  assert.equal(dollars("x"), "$0.00");
  assert.equal(creditWords(1), "1 credit");
  assert.equal(creditWords(1200), "1,200 credits");
  assert.equal(creditWords(null), "0 credits");
  assert.equal(creditsAndDollars(25), "25 credits ($0.25)");
  assert.equal(spentLine(120, 300), "120 of 300 credits ($1.20 of $3.00)");
  assert.equal(spentLine(0, 0), "0 of 0 credits ($0.00 of $0.00)");
  assert.equal(spentLine(1200, 3000), "1,200 of 3,000 credits ($12.00 of $30.00)");
  assert.equal(spentLine(null, 300), "Cannot be read");
  assert.equal(leftLine(180), "180 left");
  assert.equal(batchLine({ spent: 50, budget: 300 }), "50 of 300 credits");
  assert.equal(batchLine({ spent: null, budget: 300 }), "Budget 300 credits");
});

test("generation: a limit as typed, its dollars, and a refusal at its field", () => {
  assert.deepEqual(capCheck("300"), { value: 300, error: "" });
  assert.deepEqual(capCheck(" 1,000 "), { value: 1000, error: "" });
  assert.deepEqual(capCheck("1 000"), { value: 1000, error: "" });
  assert.deepEqual(capCheck("0"), { value: 0, error: "" });
  assert.deepEqual(capCheck("1000000"), { value: 1_000_000, error: "" });
  for (const bad of ["", "  ", "abc", "1.5", "-1", "3e2", "0x10", "1,00,0x", null, undefined]) {
    const c = capCheck(bad);
    assert.equal(c.value, null, String(bad));
    assert.equal(c.error, "Type a whole number of credits, such as 300.", String(bad));
  }
  assert.deepEqual(capCheck("1000001"), { value: null, error: "The most is 1,000,000 credits ($10,000.00)." });
  assert.equal(capCheck("99999999").value, null);
  assert.equal(capHint("300"), "300 credits is $3.00");
  assert.equal(capHint("1"), "1 credit is $0.01");
  assert.equal(capHint("12,500"), "12,500 credits is $125.00");
  assert.equal(capHint("0"), "A limit of 0 stops all making.");
  assert.equal(capHint("x"), "");
  // The server names the field in its message (T41's bad_cap); the section shows it at that field.
  assert.equal(capFieldOf("\"Most to spend in a day\" must be a whole number of credits from 0 to 1,000,000."), "daily");
  assert.equal(capFieldOf("\"Most to spend in a month\" must be a whole number of credits from 0 to 1,000,000."), "monthly");
  assert.equal(capFieldOf("The home screen sent something it could not read."), null);
  assert.equal(capFieldOf(undefined), null);
});

test("generation: the bars", () => {
  assert.equal(share(120, 300), 0.4);
  assert.equal(share(400, 300), 1);
  assert.equal(share(0, 300), 0);
  assert.equal(share(5, 0), 1, "a cap of 0 is full as soon as anything is spent");
  assert.equal(share(0, 0), 0);
  assert.equal(share(-3, 300), 0);
  assert.equal(barTone(120, 300), "ok");
  assert.equal(barTone(240, 300), "warn");
  assert.equal(barTone(300, 300), "bad");
  assert.equal(runningLine(0), "");
  assert.equal(runningLine(1), "1 job is running. It is counted as spent until it ends.");
  assert.equal(runningLine(2), "2 jobs are running. They are counted as spent until they end.");
});

test("generation: a ledger row's words, its result's colour, and its day and time", () => {
  for (const [kind, seconds] of [["image_to_video", 5], ["text_to_video", 10], ["still_variation", null], ["still_upscale", null], ["odd", null]]) {
    assert.equal(rowWords({ kind, seconds }), kindWords(kind, seconds), kind);
  }
  assert.equal(rowWords({ words: "Clip, 5 s", kind: "still_upscale" }), "Clip, 5 s", "the server's words first");
  assert.equal(rowWords(null), "Other");
  for (const w of [...Object.values(RESULT_WORDS), NOT_STARTED_WORDS, RUNNING_WORDS]) assert.ok(Object.hasOwn(RESULT_TONES, w), w);
  assert.equal(resultTone("Made"), "ok");
  assert.equal(resultTone("Refused by Runway"), "bad");
  assert.equal(resultTone("Running, counted until it ends"), "live");
  assert.equal(resultTone("Something new"), "warn");
  assert.deepEqual(dayFigures({ credits: 75, jobs: 3, refused: 3 }), { credits: "75 credits ($0.75)", jobs: "3 jobs", refused: "3 refused" });
  assert.deepEqual(dayFigures({ credits: 25, jobs: 1, refused: 0 }), { credits: "25 credits ($0.25)", jobs: "1 job", refused: "" });
  const now = Date.parse("2026-11-13T05:00:00.000Z");   // 10:30 in India, Friday 13 November
  assert.equal(dayWords("2026-11-13", now), "Today");
  assert.equal(dayWords("2026-11-12", now), "Yesterday");
  assert.equal(dayWords("2026-11-11", now), "Wed 11 Nov");
  assert.equal(dayWords("2025-12-31", now), "31 Dec 2025");
  assert.equal(dayWords("2026-11-13", Date.parse("2026-11-12T19:00:00.000Z")), "Today", "00:30 in India is already the 13th");
  assert.equal(dayWords("13 Nov", now), "");
  assert.equal(clockOf("2026-11-13T08:35:00.000Z"), "14:05");
  assert.equal(clockOf("not a time"), "");
});

test("generation: pages of days are one list, newest first, each day once", () => {
  const a = { day: "2026-11-13", credits: 50, jobs: 2, refused: 0, rows: [] };
  const a2 = { ...a, credits: 99 };
  const b = { day: "2026-11-12", credits: 25, jobs: 1, refused: 1, rows: [] };
  const c = { day: "2026-10-01", credits: 8, jobs: 1, refused: 0, rows: [] };
  assert.deepEqual(mergeDays([b, a], [a2, c, null, { day: "x" }, 4]), [a, b, c]);
  assert.deepEqual(mergeDays(null, undefined), []);
});

test("generation: the models' choices, and the films' links", () => {
  assert.deepEqual(modelOptions(GEN, "video"), [{ value: "gen4_turbo", label: "gen4_turbo: 5 credits a second" }]);
  const two = view({ choices: { ...GEN.choices, still: [{ model: "gen4_image", words: "gen4_image: 8 credits a picture" }, { model: "gen4_image_turbo", words: "gen4_image_turbo: 2 credits a picture" }] } });
  assert.deepEqual(modelOptions(two, "still").map((o) => o.value), ["gen4_image", "gen4_image_turbo"]);
  const gone = view({ models: { ...GEN.models, upscale: "old_model" } });
  assert.deepEqual(modelOptions(gone, "upscale")[0], { value: "old_model", label: "old_model: no price", disabled: true });
  assert.deepEqual(modelOptions(null, "video"), []);
  const task = GEN.batches[0].task;
  assert.equal(filmHref(task), `#/dashboards/studio?film=${task.id}`);
  assert.equal(filmHref("../x"), null);
  assert.equal(filmHref({ id: "a b" }), null);
  assert.equal(filmHref(null), null);
  assert.deepEqual(filmName(task), { identifier: "STH-7", title: "A film of the stair" });
  assert.deepEqual(filmName({ identifier: "STH-9‮", title: "" }), { identifier: "STH-9", title: "A film" });
  assert.equal(filmName(null).title, "A film whose task is not on the board");
});

test("generation: a damaged settings file, in the server's words first; loading, ready, an error, the routes not there", () => {
  assert.equal(problemLine(view({ problem: "state_unreadable", problemSentence: "From the server." })), "From the server.");
  assert.equal(problemLine(view({ problem: "state_unreadable", problemSentence: null })), PROBLEMS.state_unreadable);
  assert.ok(problemLine(view({ problem: "new_problem", problemSentence: null })).length > 0);
  assert.equal(problemLine(view()), "");
  assert.equal(sectionState({ loading: true }), "loading");
  assert.equal(sectionState({ data: {} }), "ready");
  assert.equal(sectionState({ error: { status: 404 } }), "restart");
  assert.equal(sectionState({ error: { status: 0 } }), "error");
  assert.equal(plain("x".repeat(500), 300).length, 300);
});

test("generation: the Runway key goes nowhere but the one POST", () => {
  for (const bad of [/localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /\bhistory\./, /location\./, /\bconsole\./, /caches\./, /postMessage/, /navigator\./]) {
    assert.doesNotMatch(CODE, bad, `settings-generation.js does not use ${bad}`);
  }
  assert.match(CODE, /type="password" name="runway-key" autocomplete="off"/);
  // The field is only ever filled by the owner's typing, and emptied after Save.
  assert.match(CODE, /value=\$\{typed\}/);
  assert.match(CODE, /if \(ok\) setTyped\(""\)/);
  assert.doesNotMatch(CODE, /setTyped\((?!""|e\.currentTarget\.value)/);
  assert.equal((CODE.match(/\btyped\b/g) || []).length, 5, "typed is held once and read only by the field, Save's two checks and the one POST");
  assert.match(CODE, /"\/api\/generation\/key", \{ key: typed \}/);
  // No message the section builds holds what was typed: failures carry the server's words only.
  assert.doesNotMatch(CODE, /announce\([^)]*typed/);
  assert.doesNotMatch(CODE, /message:[^,}]*typed/);
  assert.equal(SRC.includes(KEY), false);
});

test("generation: the source names no address but its own /api/ paths, and sets nothing as HTML", () => {
  const paths = [...CODE.matchAll(/["'`](\/[^"'`\s]*)/g)].map((m) => m[1]);
  assert.ok(paths.length >= 8, String(paths));
  for (const p of paths) assert.match(p, /^\/api\/generation(\/(key|key\/remove|switch|caps|models|test|resume|ledger))?(\?before=\$\{last\.day\})?$/, p);
  const hashes = [...CODE.matchAll(/["'`](#[^"'`\s]*)/g)].map((m) => m[1]);
  for (const h of hashes) assert.ok(["#/dashboards/studio?film=${encodeURIComponent(id)}", "#/health"].includes(h), h);
  assert.deepEqual(hostsIn(CODE), []);
  assert.doesNotMatch(SRC, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  for (const spec of importsOf(SRC)) {
    assert.ok(spec.startsWith("../"), spec);
    assert.ok(!spec.includes("/kit/") || spec === "../kit/index.js", spec);
  }
});

test("generation: the section reads the view every 10 seconds, and typing lives in the cards that keep it", () => {
  assert.match(CODE, /const EVERY = 10000;/);
  assert.match(CODE, /useResource\("\/api\/generation", \{ every: EVERY \}\)/);
  assert.match(CODE, /useResource\("\/api\/generation\/ledger", \{ every: EVERY \}\)/);
  // The limits keep what is typed until it is saved or put back; the view only fills an untouched field.
  assert.match(CODE, /draft\[c\.key\] !== undefined \? draft\[c\.key\] : String\(num\(caps\[c\.key\]\)\)/);
  assert.match(CODE, /if \(ok\) setDraft\(\{\}\)/);
});
