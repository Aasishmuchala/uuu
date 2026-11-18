// The Generation section of Settings (PLAN-V5 K13, T44): the pure helpers, a case per state of K13, the dollars,
// the check of a limit as typed, a ledger row's words, why the switch cannot be turned on, and what the source never
// does with the Runway key. The server's own sentences (T41) are read from its modules, so the two cannot drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Section, {
  CAPS, DOOR, GROUPS, HF_AUTHORIZE, HF_WORDS, RW_AUTHORIZE, RW_WORDS, rwMark, rwRateCheck, rwReturnOf, rwSignInUrl, rwState, rwTestResult, wayIn, wayLine, MAX_CAP, MODEL_FIELDS, PROBLEMS, RESULT_TONES, WORDS, balanceLine, barTone, batchLine, blockerLines, capCheck, capFieldOf,
  capHint, capsLines, clockOf, creditWords, creditsAndDollars, dayFigures, dayWords, doorState, doorWord, dollars, filmHref, filmName,
  hashWithoutReturn, heroMark, hfMark, hfReturnOf, hfSignInUrl, hfState, hfSwitchLine, hfTestResult, isOpen, keyLine, keyMark, leftLine, ledgerLine, mergeDays, modelOptions, pausedLine, plain, rateCheck, serviceName, centsText, problemLine, resultTone, rowWords,
  priceOf, runningLine, sectionState, share, spentLine, spentMark, stateLines, statusLine, switchLine, testResult,
} from "../../pages/settings-generation.js";
import Viewer from "../../pages/settings-viewer.js";
import {
  LEDGER_SENTENCES, NOT_STARTED_WORDS, OWN_PAUSE_SENTENCE, PAUSED_SENTENCE, RESULT_WORDS, RUNNING_WORDS, dollars as serverDollars, kindWords,
} from "../../../server/lib/generation.mjs";
import {
  BLOCKER_SENTENCES, DOOR_SENTENCES, HF_SENTENCES, HF_SWITCH_REFUSED, HF_TEST_SENTENCES, MAX_CAP as SERVER_MAX_CAP, PROBLEM_SENTENCES, RW_NO_WAY_IN,
  RW_SENTENCES, RW_TEST_SENTENCES, TEST_SENTENCES,
} from "../../../server/routes/generation.mjs";

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
  assert.equal(WORDS.intro, "The Artist and your apps can make pictures and clips with Runway and Higgsfield, two paid services, from your own renders.");
  assert.equal(WORDS.sent, "When this is on, the renders and prompts you approve are sent to Runway. Runway's terms say it may use them to train its models unless you have an Enterprise agreement. Do not use it for client work you may not share.");
  assert.equal(WORDS.money, "Runway and Higgsfield share these limits. Nothing is spent until you approve a shotlist, press Start on a job, or allow an app to spend.");
  assert.equal(WORDS.keyField, "Runway key");
  assert.equal(WORDS.daily, "Most to spend in a day ($)");
  assert.equal(WORDS.monthly, "Most to spend in a month ($)");
  assert.deepEqual(CAPS.map((c) => c.label), ["Most to spend in a day ($)", "Most to spend in a month ($)"]);
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
  // The groups, in the order they are drawn (T54), and the labels of the limits' table.
  assert.deepEqual(GROUPS, {
    runway: "Runway", runwayAccount: "Runway account", limits: "Limits and what was spent", higgsfield: "Higgsfield", models: "Models", films: "Films you approved",
    ledger: "Every job", newest: "Newest first", saveLimits: "Save limits", putBack: "Put back",
  });
  for (const k of ["runway", "runwayAccount", "limits", "higgsfield", "models", "films", "ledger"]) assert.ok(CODE.includes(`title=\${GROUPS.${k}}`), k);
  assert.ok(CODE.indexOf("<${RunwayGroup}") < CODE.indexOf("<${LimitsGroup}"), "the control first, then the limits");
  for (const w of ["Limit", "Spent", "Left", "Kind of work", "Model", "Price", "Film", "Approved", "Budget", "Amount"]) assert.ok(CODE.includes(`label: "${w}"`), w);
  assert.equal(WORDS.limitsSay, "Neither the Artist nor an app can spend more than these, even inside what you approved. A day and a month are counted in India time.");
  assert.equal(WORDS.door, "The generation door");
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
  assert.equal(creditsAndDollars(25), "$0.25");
  assert.equal(spentLine(120, 300), "$1.20 of $3.00");
  assert.equal(spentLine(0, 0), "$0.00 of $0.00");
  assert.equal(spentLine(1200, 3000), "$12.00 of $30.00");
  assert.equal(spentLine(null, 300), "Cannot be read");
  assert.equal(leftLine(180), "$1.80 left");
  assert.equal(batchLine({ spent: 50, budget: 300 }), "$0.50 of $3.00");
  assert.equal(batchLine({ spent: null, budget: 300 }), "Budget $3.00");
});

test("generation: a limit as typed in dollars, kept in cents, and a refusal at its field", () => {
  const ok = (t, cents) => assert.deepEqual(capCheck(t), { value: cents, error: "" }, String(t));
  ok("3", 300); ok("2.5", 250); ok("0.01", 1); ok("3.00", 300); ok("$3", 300); ok(" $ 2.50 ", 250); ok("1,000", 100000); ok("1 000.5", 100050);
  ok("0", 0); ok("0.00", 0); ok(".5", 50); ok("10000", 1_000_000); ok("10000.00", 1_000_000); ok("9999.99", 999_999);
  for (const bad of ["", "  ", "$", ".", "abc", "1.234", "-1", "3e2", "0x10", "1.", "1,00,0x", "3 dollars", null, undefined]) {
    const c = capCheck(bad);
    assert.equal(c.value, null, String(bad));
    assert.equal(c.error, WORDS.capType, String(bad));
  }
  assert.deepEqual(capCheck("10000.01"), { value: null, error: "The most is $10,000.00." });
  assert.deepEqual(capCheck("10001"), { value: null, error: "The most is $10,000.00." });
  assert.equal(capCheck("99999999999").value, null);
  assert.equal(MAX_CAP, 1_000_000);
  // And back: whole cents as the text of a field.
  assert.equal(centsText(300), "3.00");
  assert.equal(centsText(1), "0.01");
  assert.equal(centsText(250), "2.50");
  assert.equal(centsText(1_000_000), "10000.00");
  assert.equal(centsText(0), "0.00");
  assert.equal(centsText(null), "0.00");
  for (const c of [0, 1, 99, 100, 250, 999_999, 1_000_000]) assert.equal(capCheck(centsText(c)).value, c);
  assert.equal(capHint("0"), "A limit of 0 stops all making.");
  assert.equal(capHint("3"), "");
  assert.equal(capHint("x"), "");
  // The server names the field in its message (T41's bad_cap); the section shows it at that field.
  assert.equal(capFieldOf("\"Most to spend in a day\" must be from $0 to $10,000, in whole cents."), "daily");
  assert.equal(capFieldOf("\"Most to spend in a month\" must be from $0 to $10,000, in whole cents."), "monthly");
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
  assert.deepEqual(dayFigures({ credits: 75, jobs: 3, refused: 3 }), { credits: "$0.75", jobs: "3 jobs", refused: "3 refused" });
  assert.deepEqual(dayFigures({ credits: 25, jobs: 1, refused: 0 }), { credits: "$0.25", jobs: "1 job", refused: "" });
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
  assert.deepEqual(modelOptions(GEN, "video"), [{ value: "gen4_turbo", label: "Gen-4 Turbo on Runway: $0.05 a second" }]);
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
  // The address bar is touched in two small functions only (Higgsfield's return and its sign-in); neither takes anything typed.
  const bars = [...CODE.matchAll(/function (\w+)\([^)]*\) \{\n([\s\S]*?)\n\}\n/g)].filter((m) => /\b(history|location)\./.test(m[2]));
  assert.deepEqual(bars.map((m) => m[1]), ["takeReturn", "openHiggsfield", "openRunway"]);
  const outside = bars.reduce((c, m) => c.replace(m[0], ""), CODE);
  for (const bad of [/localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /\bhistory\./, /location\./, /\bconsole\./, /caches\./, /postMessage/, /navigator\./]) {
    assert.doesNotMatch(outside, bad, `settings-generation.js does not use ${bad}`);
  }
  for (const m of bars) assert.doesNotMatch(m[2], /typed|rate|draft|key\b/, m[1]);
  assert.match(CODE, /function openHiggsfield\(url\) \{\n  window\.location\.assign\(url\);/);
  assert.match(CODE, /function openRunway\(url\) \{\n  window\.location\.assign\(url\);\n\}/);
  assert.match(CODE, /type="password" name="runway-key" autocomplete="off"/);
  // The field is only ever filled by the owner's typing, and emptied after Save.
  assert.match(CODE, /value=\$\{typed\}/);
  assert.match(CODE, /if \(ok\) setTyped\(""\)/);
  assert.doesNotMatch(CODE, /setTyped\((?!""|e\.currentTarget\.value)/);
  assert.equal((CODE.match(/\btyped\b/g) || []).length, 5, "typed is held once and read only by the field, Save's check, the filled flag and the one POST");
  assert.match(CODE, /"\/api\/generation\/key", \{ key: typed \}/);
  // No message the section builds holds what was typed: failures carry the server's words only.
  assert.doesNotMatch(CODE, /announce\([^)]*typed/);
  assert.doesNotMatch(CODE, /message:[^,}]*typed/);
  assert.equal(SRC.includes(KEY), false);
});

test("generation: the source names no address but its own /api/ paths, and sets nothing as HTML", () => {
  const paths = [...CODE.matchAll(/["'`](\/[^"'`\s]*)/g)].map((m) => m[1]);
  assert.ok(paths.length >= 8, String(paths));
  for (const p of paths) {
    if (p === "/oauth2/authorize" || p === "/authorize") continue; // the one path of Higgsfield's and Runway's address that the sign-in checks
    assert.match(p, /^\/api\/generation(\/(key|key\/remove|switch|caps|models|test|resume|ledger|higgsfield\/(switch|rate|begin|forget|test)|runway\/(rate|begin|forget|test)))?(\?before=\$\{last\.day\})?$/, p);
  }
  const hashes = [...CODE.matchAll(/["'`](#[^"'`\s]*)/g)].map((m) => m[1]);
  for (const h of hashes) assert.ok(["#/dashboards/studio?film=${encodeURIComponent(id)}", "#/health", "#${path}${rest"].includes(h), h);
  assert.deepEqual(hostsIn(CODE), [], "no host is named as an address; Higgsfield's is built from its name and checked before it is opened");
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
  assert.match(CODE, /draft\[c\.key\] !== undefined \? draft\[c\.key\] : centsText\(num\(caps\[c\.key\]\)\)/);
  assert.match(CODE, /if \(ok\) setDraft\(\{\}\)/);
});

// ---------------------------------------------------------------------------------------------------------------
// Higgsfield (PLAN-V5 K20, K21, K23; T81)

const HF = (over = {}) => ({ on: false, signedIn: false, refused: false, centsPerCredit: 5, sentence: "Not signed in.", ...over });
const withHf = (h) => view({ higgsfield: HF(h) });

test("generation: Higgsfield's words are K23's, and the server's sentences are the same", () => {
  assert.equal(HF_WORDS.title, "Higgsfield");
  assert.equal(HF_WORDS.switchLabel, "Use Higgsfield");
  assert.equal(HF_WORDS.off, "Off. Nothing is sent to Higgsfield.");
  assert.equal(HF_WORDS.on, "On. Your apps and the Artist may use it, inside what you approve.");
  assert.equal(HF_WORDS.signIn, "Sign in to Higgsfield");
  assert.equal(HF_WORDS.signOut, "Sign out of Higgsfield");
  assert.equal(HF_WORDS.connected, "Higgsfield is connected.");
  assert.equal(HF_WORDS.notFinished, "The Higgsfield sign-in did not finish. Try again.");
  assert.equal(HF_WORDS.rate, "One Higgsfield credit counts as (cents)");
  assert.equal(HF_WORDS.rateHint, "Plus is about 5 cents a credit. Changing this does not change what you already approved.");
  // The owner's answer: Higgsfield may train on what is sent unless that is turned off in the owner's own account.
  assert.match(HF_WORDS.sent, /train its models\. Do not send client work you may not share\./);
  assert.doesNotMatch(HF_WORDS.sent, /unless|turn that off/, "no opt-out is promised: none is documented for a plan");
  assert.match(HF_WORDS.sent, /Do not send client work you may not share\./);
  assert.equal(HF_WORDS.signedOut, HF_SENTENCES.signedOut);
  assert.equal(HF_WORDS.signedIn, HF_SENTENCES.signedIn);
  assert.equal(HF_WORDS.refused, HF_SENTENCES.refused);
  assert.equal(HF_WORDS.notSignedInTest, HF_TEST_SENTENCES.signed_out);
  assert.equal(HF_WORDS.doorOff, HF_TEST_SENTENCES.door_off);
  assert.equal(HF_WORDS.noAnswer, HF_TEST_SENTENCES.no_answer);
  assert.equal(HF_SWITCH_REFUSED, "Sign in to Higgsfield first.");
  // The training sentence is drawn always, under its switch inside the panel (the row's one warning), with no
  // condition around it; Runway's the same.
  assert.match(CODE, /title=\$\{HF_WORDS\.switchLabel\}[^]*?warned=\$\{HF_WORDS\.sent\} \/>/);
  assert.match(CODE, /title=\$\{WORDS\.switchLabel\}[^]*?warned=\$\{WORDS\.sent\} \/>/);
});

test("generation: the sign-in address is opened only when it is Higgsfield's own authorize address", () => {
  // Addresses are built from parts so that no file of the tree holds a host as a literal (static.test.mjs).
  const S = `https:${"/"}${"/"}`;
  const H = "mcp.higgsfield.ai";
  const A = `${S}${H}/oauth2/authorize`;
  assert.equal(HF_AUTHORIZE, `${A}?`);
  const good = `${A}?response_type=code&client_id=abc&state=${"a".repeat(64)}`;
  assert.equal(hfSignInUrl(good), good);
  for (const bad of [
    null, undefined, 5, "", A, `http:${"/"}${"/"}${H}/oauth2/authorize?x=1`,
    `${S}${H}.evil.test/oauth2/authorize?x=1`, `${S}${H}@evil.test/oauth2/authorize?x=1`,
    `${S}evil.test/${S}${H}/oauth2/authorize?x=1`, `${S}${H}/oauth2/token?x=1`,
    `${S}${H}:8443/oauth2/authorize?x=1`, "javascript:alert(1)", ` ${A}?x=1`,
    `${A}?x=1 y`, `${A}?x=1\n`, `${good}${"a".repeat(5000)}`,
    `${S}user:pw@${H}/oauth2/authorize?x=1`,
  ]) assert.equal(hfSignInUrl(bad), null, String(bad).slice(0, 80));
  // The page goes there itself: no link, no new tab.
  assert.doesNotMatch(CODE, /window\.open|target="_blank"/);
});

test("generation: the return from Higgsfield's page is read once and taken out of the address", () => {
  assert.equal(hfReturnOf("#/settings?generation=connected"), "connected");
  assert.equal(hfReturnOf("#/settings?generation=failed"), "failed");
  assert.equal(hfReturnOf("#/settings?generation=other"), null);
  assert.equal(hfReturnOf("#/settings"), null);
  assert.equal(hfReturnOf("#/tasks?generation=connected"), null, "only on Settings");
  assert.equal(hfReturnOf(""), null);
  assert.equal(hashWithoutReturn("#/settings?generation=failed"), "#/settings");
  assert.equal(hashWithoutReturn("#/settings?generation=connected&x=1"), "#/settings?x=1");
  assert.equal(hashWithoutReturn("#/settings"), "#/settings");
});

test("generation: Higgsfield's state, its mark and its switch's sentence, a case each", () => {
  const out = withHf();
  assert.deepEqual(hfState(out), { key: "out", sentence: "Not signed in." });
  assert.deepEqual(hfMark(out), { tone: "off", word: "Off" });
  assert.equal(hfSwitchLine(out), "Off. Nothing is sent to Higgsfield.");
  const inOff = withHf({ signedIn: true, sentence: "Signed in." });
  assert.deepEqual(hfState(inOff), { key: "in", sentence: "Signed in." });
  assert.deepEqual(hfMark(inOff), { tone: "off", word: "Off" });
  const inOn = withHf({ on: true, signedIn: true, sentence: "Signed in." });
  assert.deepEqual(hfMark(inOn), { tone: "ok", word: "On" });
  assert.equal(hfSwitchLine(inOn), "On. Your apps and the Artist may use it, inside what you approve.");
  const refused = withHf({ on: true, refused: true, sentence: "Higgsfield asked you to sign in again." });
  assert.deepEqual(hfState(refused), { key: "refused", sentence: "Higgsfield asked you to sign in again." });
  assert.deepEqual(hfMark(refused), { tone: "warn", word: "Sign in again" });
  assert.match(hfSwitchLine(refused), /^On, but not signed in\./);
  assert.deepEqual(hfMark(withHf({ on: true })), { tone: "warn", word: "Sign in" });
  // An older server with no Higgsfield block: signed out and off.
  assert.deepEqual(hfState(view({ higgsfield: undefined })), { key: "out", sentence: "Not signed in." });
  assert.deepEqual(hfMark(null), { tone: "off", word: "Off" });
});

test("generation: the rate is a whole number of cents from 1 to 50", () => {
  for (const [t, v] of [["5", 5], [" 7 ", 7], ["1", 1], ["50", 50], ["050", 50]]) assert.deepEqual(rateCheck(t), { value: v, error: "" }, t);
  for (const bad of ["", "0", "51", "5.5", "-1", "abc", "1e1", "1000", null, undefined]) assert.deepEqual(rateCheck(bad), { value: null, error: HF_WORDS.rateType }, String(bad));
});

test("generation: Higgsfield's Test answer in words", () => {
  const ok = hfTestResult({ ok: true, credits: 3896, plan: "Plus", sentence: "Higgsfield says you have 3896 credits." });
  assert.deepEqual([ok.tone, ok.word, ok.sentence], ["ok", "Works", "Higgsfield says you have 3896 credits."]);
  assert.equal(hfTestResult({ ok: true, credits: 1, sentence: "" }).sentence, "Higgsfield says you have 1 credit.");
  assert.deepEqual(hfTestResult({ ok: false, sentence: "Not signed in to Higgsfield." }), { tone: "off", word: "Not signed in", sentence: "Not signed in to Higgsfield." });
  assert.equal(hfTestResult({ ok: false, sentence: "Higgsfield asked you to sign in again." }).word, "Sign in again");
  assert.equal(hfTestResult({ ok: false, sentence: "The generation door is off. Run: engine start" }).word, "Door off");
  assert.deepEqual(hfTestResult({ ok: false, sentence: "" }), { tone: "warn", word: "No answer", sentence: HF_WORDS.noAnswer });
  assert.equal(hfTestResult(null).word, "No answer");
});

test("generation: the service and an app's name in the ledger, and the models' words with their service", () => {
  assert.equal(serviceName({ provider: "higgsfield" }), "Higgsfield");
  assert.equal(serviceName({ provider: "runway" }), "Runway");
  assert.equal(serviceName({}), "Runway");
  assert.equal(serviceName(null), "Runway");
  const app = "Render to Film: picture, Nano Banana Pro";
  assert.equal(rowWords({ words: app, app: { slug: "render-to-film", name: "Render to Film" } }), app);
  assert.equal(rowWords({ kind: "still_variation", app: { slug: "render-to-film", name: "Render to Film" } }), "Render to Film: Variation");
  assert.equal(rowWords({ kind: "image_to_video", seconds: 5, app: null }), "Clip, 5 s");
  assert.equal(resultTone("Refused by Higgsfield"), "bad");
  assert.equal(resultTone("Higgsfield could not use the picture"), "warn");
  const two = view({ choices: { ...GEN.choices, still: [...GEN.choices.still, { model: "hf.flux_2", provider: "higgsfield", words: "FLUX.2 Max on Higgsfield: about $0.20 a picture" }] } });
  assert.deepEqual(modelOptions(two, "still").map((o) => o.label), ["Gen-4 Image on Runway: $0.08 a picture", "FLUX.2 Max on Higgsfield: about $0.20 a picture"]);
});

test("generation: the Higgsfield card's source holds what the owner asked", () => {
  // Sign-in only through begin; forget behind a confirm; the switch's refusal is shown at the switch.
  assert.match(CODE, /api\.post\("\/api\/generation\/higgsfield\/begin", \{\}\)/);
  assert.match(CODE, /const url = hfSignInUrl\(obj\(answer\) \? answer\.url : null\);[\s\S]*?openHiggsfield\(url\);/);
  assert.match(CODE, /<\$\{Dialog\} open=\$\{asking\} title=\$\{HF_WORDS\.signOutAsk\}/);
  assert.match(CODE, /act\("hf-forget", "\/api\/generation\/higgsfield\/forget"/);
  // A door opens only through a confirm, 18 Nov 2026: the switch's press sends only { on: false } itself; switching on
  // asks the Map's confirm, whose yes sends the request (test/pages/settings-doors.test.mjs).
  assert.match(CODE, /next \? setOpening\(true\) : act\("hf-switch", "\/api\/generation\/higgsfield\/switch", \{ on: false \}/);
  assert.match(CODE, /<\$\{Failure\} failure=\$\{failure\} where="hf-switch" \/>/);
  assert.match(CODE, /act\("hf-rate", "\/api\/generation\/higgsfield\/rate", \{ centsPerCredit: check\.value \}/);
  // The return notice is said once, from the address read when the section is first drawn.
  assert.match(CODE, /const \[returned\] = useState\(takeReturn\);/);
  // Nothing typed (the rate) goes anywhere but the one POST.
  assert.doesNotMatch(CODE, /announce\([^)]*rateText/);
  // No Higgsfield credential is held or named here.
  assert.doesNotMatch(CODE, /access_token|refresh_token|Authorization|\bcode_verifier\b/i);
});

// ---------------------------------------------------------------------------------------------------------------
// The section in the settings frame (PLAN-COOK T54)

test("generation: the state line for the list of sections and the title, a case per state", () => {
  const within = ready({ spent: spent({ day: 120, dayLeft: 180 }) });
  assert.equal(isOpen(within), true);
  assert.deepEqual(statusLine(within), { tone: "good", text: "On, within your limits" });
  assert.deepEqual(statusLine(view()), { tone: "neutral", text: "Off" });
  assert.deepEqual(statusLine(ready({ paused: { sentence: PAUSED_SENTENCE } })), { tone: "warn", text: "Paused" });
  assert.deepEqual(statusLine(ready({ spent: spent({ day: 300, dayLeft: 0 }) })), { tone: "bad", text: "Over today's limit" });
  assert.deepEqual(statusLine(ready({ spent: spent({ month: 1000, monthLeft: 0 }) })), { tone: "bad", text: "Over this month's limit" });
  assert.deepEqual(statusLine(ready({ caps: { daily: 0, monthly: 1000 } })), { tone: "warn", text: "On, a limit of 0 stops all making" });
  assert.deepEqual(statusLine(ready({ spent: { ok: false } })), { tone: "bad", text: "On, but spending cannot be read" });
  assert.deepEqual(statusLine(ready({ door: { state: "off" } })), { tone: "warn", text: "On, but the generation door is not running" });
  assert.deepEqual(statusLine(ready({ key: { saved: false } })), { tone: "warn", text: "On, but no key is saved" });
  assert.deepEqual(statusLine(null), { tone: "neutral", text: "Off" });
  for (const v of [within, view(), ready({ paused: {} }), ready({ spent: spent({ day: 300, dayLeft: 0 }) })]) {
    const s = statusLine(v);
    assert.ok(["good", "warn", "bad", "neutral"].includes(s.tone));
    assert.ok(s.text.length <= 60, s.text);
  }
});

test("generation: a model's words as its name and its price, every word kept", () => {
  assert.deepEqual(priceOf("Gen-4 Turbo on Runway: $0.05 a second"), { name: "Gen-4 Turbo on Runway", price: "$0.05 a second" });
  assert.deepEqual(priceOf("FLUX.2 Max on Higgsfield: about $0.20 a picture"), { name: "FLUX.2 Max on Higgsfield", price: "about $0.20 a picture" });
  assert.deepEqual(priceOf("Magnific Precision upscale on Runway: $0.25 a picture"), { name: "Magnific Precision upscale on Runway", price: "$0.25 a picture" });
  assert.deepEqual(priceOf("gen4_turbo: no price"), { name: "gen4_turbo: no price", price: "" });
  assert.deepEqual(priceOf(""), { name: "", price: "" });
  assert.deepEqual(priceOf(null), { name: "", price: "" });
  for (const list of Object.values(GEN.choices)) {
    for (const c of list) {
      const p = priceOf(c.words);
      assert.equal(`${p.name}: ${p.price}`, c.words, "nothing is shortened or reworded");
    }
  }
});

test("generation: the section is drawn with the kit's groups, rows and tables, into the frame's column", () => {
  // The frame draws the title and the state; the section draws no title of its own.
  assert.doesNotMatch(CODE, /<\$\{Section\}/);
  assert.match(CODE, /class="p-settings-generation" id="settings-generation"/);
  assert.match(CODE, /<\$\{Group\} title=\$\{GROUPS\.runway\}>\s*<\$\{Rows\}>/);
  // The limits: a kit table on a card, a MoneyInput a row that takes and gives a string, the spent figure over a
  // plain meter, Left at the right; Save is the primary and is enabled only when something changed.
  assert.match(CODE, /<\$\{DataTable\} columns=\$\{LIMIT_COLUMNS\}/);
  assert.match(CODE, /\{ key: "left", label: "Left", align: "end" \}/);
  assert.match(CODE, /<\$\{MoneyInput\} name=\$\{`cap-\$\{f\.key\}`\} label=\$\{f\.label\} value=\$\{f\.text\}/);
  assert.match(CODE, /onInput=\$\{\(text\) => setDraft\(\{ \.\.\.draft, \[f\.key\]: text \}\)\}/);
  assert.match(CODE, /<\$\{Meter\} plain=\$\{true\}/);
  assert.match(CODE, /const ready = fields\.every\(\(f\) => f\.check\.value !== null\) && fields\.some\(\(f\) => f\.changed\);/);
  assert.match(CODE, /variant=\$\{ready \? "primary" : "ghost"\} type="submit" busy=\$\{busy === "caps"\} disabled=\$\{Boolean\(busy\) \|\| !ready\}>\$\{GROUPS\.saveLimits\}/);
  assert.match(CODE, /variant=\$\{changed && check\.value !== null \? "primary" : "ghost"\} type="submit" busy=\$\{busy === "hf-rate"\} disabled=\$\{Boolean\(busy\) \|\| !changed \|\| check\.value === null\}/);
  // The key's field is shown in place only on Replace (or when no key is saved), and emptied on Cancel and Save.
  assert.match(CODE, /const open = editing \|\| !saved;/);
  assert.match(CODE, /function cancel\(\) \{\n    setTyped\(""\);\n    setEditing\(false\);/);
  // Only the over-a-limit row's Left takes the bad colour; the limit lines are said with a warn glyph, not in red.
  assert.match(CODE, /p-settings-generation__left--over/);
  assert.doesNotMatch(CODE, /tone=\$\{l === WORDS\.zero \? "warn" : "bad"\}/);
  // The harness and the return from Higgsfield find the section and its group by these.
  assert.match(CODE, /id="settings-higgsfield"/);
});

test("generation: the section's own sheet holds its classes and keeps the page rules", () => {
  const css = readFileSync(join(PUBLIC, "styles", "pages", "settings-generation.css"), "utf8");
  const sels = [...css.replace(/\/\*[\s\S]*?\*\//g, " ").matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter((x) => !/^\d|^from|^to/.test(x));
  assert.ok(sels.length > 10);
  for (const list of sels) for (const sel of list.split(",")) assert.match(sel.trim(), /^\.p-settings-generation(?![\w-])/, sel);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|font-size:\s*[\d.]+px/);
  // Every class the section draws for itself is in its own sheet.
  const own = new Set([...CODE.matchAll(/p-settings-generation__[a-z-]+/g)].map((m) => m[0]));
  for (const c of own) assert.ok(css.includes(`.${c}`), c);
  assert.doesNotMatch(CODE, /p-settings__/);
});

test("fix round B2 and R5: the switch's list is the kit's Checklist; the key's Test is the small filled one, Replace and Remove small ghosts of one height; untested is the warn chip; the spent bar is 4 px in the second ink; the limit is the kit's 96 px money input", () => {
  assert.match(CODE, /<\$\{Checklist\} lead=\$\{WORDS\.switchWhen\}/);
  assert.equal((CODE.match(/size="sm" variant="primary" icon="play" onClick=\$\{runTest\}/g) || []).length, 3, "Test leads, for Runway's key, Runway account and Higgsfield");
  assert.equal((CODE.match(/size="sm" variant="ghost"/g) || []).length >= 3, true);
  assert.match(CODE, /mark\.tone === "wait" \? "warn"/);
  const css = readFileSync(join(PUBLIC, "styles", "pages", "settings-generation.css"), "utf8");
  assert.match(css, /__spent \.k-meter__track \{[^}]*height: 4px;[^}]*border-radius: 2px;/);
  assert.match(css, /__spent \.k-meter__fill \{[^}]*background: var\(--ink-2\);/);
  assert.match(css, /__node \{[^}]*height: 28px;/, "the chain's chips are 28 px");
  assert.doesNotMatch(css, /\.k-money-input \{[^}]*width/, "no wider well than the kit's");
});

test("fix round R6: a Save with nothing to save is a ghost, never a filled grey slab", () => {
  assert.equal((CODE.match(/variant=\$\{changed && check\.value !== null \? "primary" : "ghost"\} type="submit"/g) || []).length, 2, "Higgsfield's rate and Runway account's");
  for (const cond of ["filled", "ready", "changed && check.value !== null"]) {
    assert.ok(CODE.includes(`variant=\${${cond} ? "primary" : "ghost"} type="submit"`), cond);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Runway account (PLAN-ONBOARD R2)

const RWA = (over = {}) => ({ signedIn: false, refused: false, centsPerCredit: 3, sentence: "Not signed in to Runway.", used: false, ...over });
const withRw = (a, over = {}) => view({ runwayAccount: RWA(a), ...over });

test("Runway account: the block's words are the plan's, whole, and the server's sentences are the same", () => {
  assert.deepEqual(RW_WORDS, {
    title: "Runway account",
    signedOut: "Not signed in to Runway.",
    signedIn: "Signed in to Runway.",
    refused: "Runway asked you to sign in again.",
    connected: "Runway is connected.",
    notFinished: "The Runway sign-in did not finish. Try again.",
    byKey: "Your Runway key is used. The sign-in is the other way in, used when no key is saved.",
    byAccount: "Your Runway account is used. Prices are in your account's credits, turned into dollars at the rate below.",
    noWayIn: "Save a Runway key or sign in to Runway first.",
    library: "What you make this way is saved in your Runway library and spends your Runway account's credits.",
    terms: "Runway's terms say it may use what you send to train its models unless you have an Enterprise agreement. Do not use Generation for client work you may not share.",
    rate: "One Runway account credit counts as (cents)",
    rateHint: "It starts at 3. Change it to match your plan. It turns Runway's credits into cents so every price you read is in dollars, and changing it does not change what you already approved.",
    rateType: "Type a whole number of cents from 1 to 50, such as 3.",
    signIn: "Sign in to Runway",
    signOut: "Sign out of Runway",
    signOutAsk: "Sign out of Runway?",
    signOutWhy: "This deletes the sign-in kept on this Mac, and Runway is no longer used this way. Runway gives no way to end it from here, so you can also remove \"uuu engine on this Mac\" in your Runway account.",
    stay: "Stay signed in",
    testWhat: "Test asks Runway how many credits your account has. It costs nothing, and works while the switch is off.",
    signInFirst: "Sign in first, then Test can ask Runway.",
    waiting: "Waiting for Runway. This can take up to 75 seconds.",
    badAddress: "Runway's sign-in address was not what was expected, so it was not opened.",
    notSignedInTest: "Not signed in to Runway.",
    noAnswer: "Runway did not answer. Try again in a minute.",
    noCount: "Runway answered, but did not say how many credits your account has.",
    doorOff: "The generation door is off. Run: engine start",
    quoted: "While your Runway account is used, these prices are not what it charges: Runway names each job's price in your account's credits when the job is asked for.",
  });
  assert.deepEqual([RW_WORDS.signedOut, RW_WORDS.signedIn, RW_WORDS.refused], [RW_SENTENCES.signedOut, RW_SENTENCES.signedIn, RW_SENTENCES.refused]);
  assert.equal(RW_WORDS.noWayIn, RW_NO_WAY_IN);
  assert.deepEqual([RW_WORDS.notSignedInTest, RW_WORDS.refused, RW_WORDS.doorOff, RW_WORDS.noAnswer, RW_WORDS.noCount],
    [RW_TEST_SENTENCES.signed_out, RW_TEST_SENTENCES.refused, RW_TEST_SENTENCES.door_off, RW_TEST_SENTENCES.no_answer, RW_TEST_SENTENCES.no_count]);
  // No fixed price per model is promised for the sign-in: Runway names each job's price when it is asked.
  for (const w of Object.values(RW_WORDS)) assert.doesNotMatch(w, /\$\d|a second|a picture/, w);
  // The two sentences beside the sign-in are drawn always, with no condition around them.
  assert.match(CODE, /<span class="p-settings-generation__line">\$\{RW_WORDS\.library\}<\/span>/);
  assert.match(CODE, /warned=\$\{RW_WORDS\.terms\} \/>/);
  assert.match(CODE, /<span class="p-settings-generation__line">\$\{wayLine\(view\)\}<\/span>/);
  // Under the key: the Runway group, then the account's, then the limits.
  assert.ok(CODE.indexOf("<${RunwayGroup}") < CODE.indexOf("<${RunwayAccountGroup}") && CODE.indexOf("<${RunwayAccountGroup}") < CODE.indexOf("<${LimitsGroup}"));
  // No switch of its own: the group draws none.
  const group = /function RunwayAccountGroup\([\s\S]*?\n\}\n/.exec(CODE)[0];
  assert.doesNotMatch(group, /<\$\{Switch\}|\/switch"/);
});

test("Runway account: its state, its chip, which way is used, and the switch's reason in the server's words", () => {
  assert.deepEqual(rwState(withRw()), { key: "out", sentence: "Not signed in to Runway." });
  assert.deepEqual(rwMark(withRw()), { tone: "off", word: "Not signed in" });
  assert.deepEqual(rwState(withRw({ signedIn: true })), { key: "in", sentence: "Signed in to Runway." });
  assert.deepEqual(rwMark(withRw({ signedIn: true })), { tone: "ok", word: "Signed in" });
  assert.deepEqual(rwState(withRw({ refused: true })), { key: "refused", sentence: "Runway asked you to sign in again." });
  assert.deepEqual(rwMark(withRw({ refused: true })), { tone: "warn", word: "Sign in again" });
  assert.deepEqual(rwState(view({ runwayAccount: undefined })), { key: "out", sentence: "Not signed in to Runway." }, "an older server");
  assert.equal(wayLine(withRw({ signedIn: true, used: false }, { key: { saved: true } })), RW_WORDS.byKey);
  assert.equal(wayLine(withRw({ signedIn: true, used: true })), RW_WORDS.byAccount);
  assert.equal(wayLine(withRw()), RW_WORDS.noWayIn);
  // The account is a way in only while it is the one used; then the door can be open with no key.
  assert.equal(wayIn(withRw({ signedIn: true, used: true })), true);
  assert.equal(wayIn(withRw({ signedIn: true, used: "yes" })), false);
  assert.equal(isOpen(ready({ key: { saved: false }, runwayAccount: RWA({ signedIn: true, used: true }) })), true);
  assert.equal(isOpen(ready({ key: { saved: false } })), false);
  assert.deepEqual(statusLine(ready({ key: { saved: false }, runwayAccount: RWA({ signedIn: true, used: true }) })), { tone: "good", text: "On, within your limits" });
  // The switch's reason: the new sentence only when the server sends it; else today's.
  assert.deepEqual(blockerLines(view({ whyNot: RW_NO_WAY_IN })), [RW_NO_WAY_IN]);
  assert.deepEqual(blockerLines(view({ whyNot: "Something <b>else</b>" })), ["Paste your Runway key first."]);
});

test("Runway account: the sign-in address is opened only when it is Runway's own sign-in page", () => {
  const S = `https:${"/"}${"/"}`;
  const H = "mcp.runwayml.com";
  const A = `${S}${H}/authorize`;
  assert.equal(RW_AUTHORIZE, `${A}?`);
  const good = `${A}?response_type=code&client_id=abc&state=${"a".repeat(64)}`;
  assert.equal(rwSignInUrl(good), good);
  for (const bad of [
    null, undefined, 5, "", A, `http:${"/"}${"/"}${H}/authorize?x=1`, `${S}${H}.evil.test/authorize?x=1`, `${S}${H}@evil.test/authorize?x=1`,
    `${S}evil.test/${S}${H}/authorize?x=1`, `${S}${H}/token?x=1`, `${S}${H}:8443/authorize?x=1`, "javascript:alert(1)", ` ${A}?x=1`,
    `${A}?x=1 y`, `${A}?x=1\n`, `${good}${"a".repeat(5000)}`, `${S}user:pw@${H}/authorize?x=1`, `${S}dev.runwayml.com/authorize?x=1`,
    `${S}mcp.higgsfield.ai/oauth2/authorize?x=1`,
  ]) assert.equal(rwSignInUrl(bad), null, String(bad).slice(0, 80));
  assert.match(CODE, /const url = rwSignInUrl\(obj\(answer\) \? answer\.url : null\);[\s\S]*?openRunway\(url\);/);
});

test("Runway account: the return is read once and taken out of the address; Higgsfield's words are its own", () => {
  assert.equal(rwReturnOf("#/settings?s=generation&generation=runway-connected"), "connected");
  assert.equal(rwReturnOf("#/settings?generation=runway-failed"), "failed");
  assert.equal(rwReturnOf("#/settings?generation=connected"), null, "Higgsfield's");
  assert.equal(rwReturnOf("#/tasks?generation=runway-connected"), null, "only on Settings");
  assert.equal(rwReturnOf(""), null);
  assert.equal(hfReturnOf("#/settings?generation=runway-connected"), null);
  assert.equal(hashWithoutReturn("#/settings?s=generation&generation=runway-failed"), "#/settings?s=generation");
});

test("Runway account: the rate, and Test's answer in words", () => {
  for (const [t, v] of [["3", 3], ["1", 1], ["50", 50]]) assert.deepEqual(rwRateCheck(t), { value: v, error: "" }, t);
  for (const bad of ["", "0", "51", "2.5", "abc", null]) assert.deepEqual(rwRateCheck(bad), { value: null, error: RW_WORDS.rateType }, String(bad));
  assert.deepEqual(rwTestResult({ ok: true, credits: 1200, sentence: "Runway says your account has 1200 credits." }),
    { tone: "ok", word: "Works", sentence: "Runway says your account has 1,200 credits." });
  assert.equal(rwTestResult({ ok: true, credits: 1 }).sentence, "Runway says your account has 1 credit.");
  assert.deepEqual(rwTestResult({ ok: true, credits: null }), { tone: "ok", word: "Works", sentence: RW_WORDS.noCount });
  assert.equal(rwTestResult({ ok: false, sentence: RW_WORDS.notSignedInTest }).word, "Not signed in");
  assert.equal(rwTestResult({ ok: false, sentence: RW_WORDS.refused }).word, "Sign in again");
  assert.equal(rwTestResult({ ok: false, sentence: RW_WORDS.doorOff }).word, "Door off");
  assert.deepEqual(rwTestResult({ ok: false, sentence: "<img src=x onerror=1>" }), { tone: "warn", word: "No answer", sentence: RW_WORDS.noAnswer }, "unknown words are not shown");
  assert.equal(rwTestResult(null).word, "No answer");
});

// Mounted in the test DOM with a fake fetch that records every request: the block's buttons post to its own four
// paths only, and the money and safety sentences are each one whole text node.
test("Runway account (mounted): Sign in, Test, Sign out and Save post to their own paths only; the whole sentences are single text nodes", async () => {
  const { pathToFileURL } = await import("node:url");
  const D = await import("../kit/_dom.mjs");
  const { AppContext } = await import(pathToFileURL(join(PUBLIC, "lib", "context.js")).href);
  const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, type, extra = {}) => {
    const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
    assert.ok(key, `${el.localName} listens for ${type}`);
    const ev = { type: key, target: el, currentTarget: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
    for (const f of el.listeners[key]) f.call(el, ev);
  };
  const buttons = (root, words) => D.elements(root).filter((e) => e.localName === "button" && D.textOf(e).trim() === words);
  const texts = (root) => [...D.walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);
  const signedIn = view({ door: { state: "on", sentence: DOOR_SENTENCES.on }, runwayAccount: RWA({ signedIn: true, used: true, sentence: "Signed in to Runway." }) });
  const signedOut = view({ door: { state: "on", sentence: DOOR_SENTENCES.on }, whyNot: RW_NO_WAY_IN });
  let served = signedIn;
  const calls = [];
  const realFetch = globalThis.fetch;
  const assigned = [];
  D.installDom();
  globalThis.window = globalThis;
  globalThis.location = { hash: "#/settings?s=generation", pathname: "/", search: "", replace() {}, assign(u) { assigned.push(u); } };
  globalThis.history = { state: null, replaceState() {} };
  globalThis.fetch = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET", body: opts.body === undefined ? undefined : String(opts.body) });
    let body = { days: [], more: false, ok: true };
    if (path === "/api/generation") body = served;
    if (path === "/api/generation/runway/test") body = { ok: true, credits: 42, sentence: "Runway says your account has 42 credits." };
    if (path === "/api/generation/runway/forget") body = signedOut;
    if (path === "/api/generation/runway/rate") body = { ...served, runwayAccount: { ...served.runwayAccount, centsPerCredit: 4 } };
    if (path === "/api/generation/runway/begin") body = { url: `${RW_AUTHORIZE}response_type=code` };
    return { ok: true, status: 200, json: async () => body };
  };
  const said = [];
  const root = new D.FakeElement("div");
  globalThis.document.body.appendChild(root);
  try {
    D.render(D.html`<${AppContext.Provider} value=${{ announce: (s) => said.push(s), setTop() {} }}><${Section} /><//>`, root);
    await settle();
    const nodes = texts(root);
    for (const s of [RW_WORDS.library, RW_WORDS.terms, RW_WORDS.byAccount, RW_WORDS.rateHint, RW_WORDS.quoted, RW_WORDS.testWhat, WORDS.sent]) {
      assert.ok(nodes.includes(s), `one whole text node: ${s.slice(0, 50)}`);
    }
    assert.ok(D.elements(root).some((e) => e.getAttribute("id") === "settings-runway-account"));
    // Test.
    const tests = buttons(root, "Test");
    assert.equal(tests.length, 1, "only the account's Test while no key is saved");
    fire(tests[0], "click");
    await settle();
    assert.ok(said.includes("Runway says your account has 42 credits."));
    // The rate.
    const field = D.elements(root).find((e) => e.getAttribute("name") === "rw-rate");
    fire(field, "input", { currentTarget: { value: "4" } });
    await settle(50);
    const form = D.elements(root).find((e) => e.localName === "form" && e.getAttribute("id") === null && D.elements(e).includes(field));
    fire(form, "submit");
    await settle();
    // Sign out, behind its question.
    fire(buttons(root, RW_WORDS.signOut)[0], "click");
    await settle(50);
    assert.ok(texts(root).includes(RW_WORDS.signOutWhy), "the sign-out question says the whole sentence");
    const outs = buttons(root, RW_WORDS.signOut);
    fire(outs[outs.length - 1], "click");
    await settle();
    // Signed out now: Sign in goes to Runway's own page only.
    served = signedOut;
    fire(buttons(root, RW_WORDS.signIn)[0], "click");
    await settle();
    assert.deepEqual(assigned, [`${RW_AUTHORIZE}response_type=code`]);
    const posts = calls.filter((c) => c.method !== "GET");
    assert.deepEqual(posts.map((c) => [c.path, c.body]), [
      ["/api/generation/runway/test", "{}"],
      ["/api/generation/runway/rate", '{"centsPerCredit":4}'],
      ["/api/generation/runway/forget", "{}"],
      ["/api/generation/runway/begin", "{}"],
    ]);
    for (const c of calls) assert.match(c.path, /^\/api\/generation(\/ledger|\/runway\/(test|rate|forget|begin))?$/, c.path);
  } finally {
    D.render(null, root);
    root.remove();
    globalThis.fetch = realFetch;
    delete globalThis.window;
    delete globalThis.history;
  }
});
