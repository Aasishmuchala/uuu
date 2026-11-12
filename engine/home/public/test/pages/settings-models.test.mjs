import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Section, {
  NEEDS, PROBLEMS, WORDS, blockerLines, keyStatus, missingLine, modeLine, orderOptions, problemLine, sectionState, testLine, usageLine,
} from "../../pages/settings-models.js";

// The same checks as pages.test.mjs, kept here so that file's tests do not run twice.
const stripJsComments = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
const importsOf = (src) => [...stripJsComments(src).matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
const hostsIn = (t) => [...String(t).matchAll(/\b(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\d+\.\d+\.\d+\.\d+)(?::\d+)?/gi)].map((m) => m[0]);

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = join(PUBLIC, "pages", "settings-models.js");
const SRC = readFileSync(FILE, "utf8");
const AT = "2026-11-12T10:00:00.000Z";

const view = (over = {}) => ({
  mode: "plans", key: { saved: false, savedAt: null, state: "none" }, relay: { state: "on" }, catalogue: { readAt: AT, count: 19 },
  agents: [{ slug: "builder", name: "Builder" }, { slug: "checker", name: "Checker" }], missing: [], blockers: [], canSwitchOn: true, ...over,
});

test("models: the section is a component", () => {
  assert.equal(typeof Section, "function");
});

test("models: the C9 sentences are used as written", () => {
  assert.equal(WORDS.intro, "Your agents can run on models from Omega Plus instead of your Claude and Codex plans. Omega Plus is a paid service with its own key.");
  assert.equal(WORDS.warning, "When this is on, everything an agent reads and writes in a task is sent to Omega Plus, and Omega Plus decides which model answers under each name.");
  assert.equal(WORDS.switchLabel, "Use Omega Plus for the agents");
  assert.equal(WORDS.restart, "This section appears after the home screen is restarted: engine stop, then engine start.");
  for (const w of ["Provider key", "Save key", "Test", "Remove key", "Read the list", "Show technical details"]) assert.ok(SRC.includes(w), w);
  for (const c of ["Agent", "Works on", "Model", "Used"]) assert.ok(SRC.includes(`label: "${c}"`), c);
});

test("models: the restart line drawn on screen says the C9 sentence", () => {
  const m = /function RestartLine\(\) \{\s*return html`([\s\S]*?)`;/.exec(SRC);
  assert.ok(m);
  assert.equal(m[1].replace(/<[^>]+>/g, ""), WORDS.restart);
});

test("models: one sentence per key state (no key, saved, works, refused, limit, not answering)", () => {
  assert.equal(keyStatus({ saved: false, state: "none" }).sentence, "No key yet. Paste the one from your Omega Plus account.");
  assert.match(keyStatus({ saved: true, savedAt: AT, state: "unknown" }).sentence, /^A key is saved \(12 Nov 2026, \d\d:\d\d\)\./);
  assert.match(keyStatus({ saved: true, savedAt: AT, state: "ok" }).sentence, /It works\.$/);
  assert.equal(keyStatus({ saved: true, state: "refused" }).sentence, "Omega Plus refused this key. Check it and paste it again.");
  assert.equal(keyStatus({ saved: true, state: "limited" }).sentence, "Omega Plus says your limit is reached. Agents cannot work until it resets.");
  assert.equal(keyStatus({ saved: true, state: "unreachable" }).sentence, "Omega Plus is not answering. Nothing was changed.");
  assert.equal(keyStatus({ saved: true, state: "refused" }).tone, "bad");
  assert.equal(keyStatus(null).tone, "off");
});

test("models: on and off, and switching", () => {
  assert.equal(modeLine("provider"), "On. Your agents use Omega Plus.");
  assert.equal(modeLine("plans"), "Off. Your agents use your Claude and Codex plans.");
  assert.equal(WORDS.switching, "Switching…");
  assert.equal(WORDS.afterSwitch, "Nothing else to do. Each agent's next run uses this. Run the proof on Health to check the fence.");
});

test("models: blockers become the reasons the switch is off", () => {
  assert.deepEqual(blockerLines(view({ blockers: ["no_key"] })), ["No key yet. Paste the one from your Omega Plus account."]);
  assert.deepEqual(blockerLines(view({ blockers: ["key_refused"] })), ["Omega Plus refused this key. Check it and paste it again."]);
  assert.deepEqual(blockerLines(view({ blockers: ["relay_off"] })), ["The model relay is off. Run: engine start"]);
  assert.deepEqual(blockerLines(view({ blockers: ["no_catalogue"] })), ["The list of models has not been read yet."]);
  assert.deepEqual(blockerLines(view({ blockers: ["pick_missing"], missing: ["checker"] })), ["No model is available for Checker. Choose one from the list."]);
  // Before the list is read every agent lacks a model: one line says so, not ten.
  assert.deepEqual(blockerLines(view({ blockers: ["no_key", "no_catalogue", "pick_missing"], missing: ["builder", "checker"] })),
    ["No key yet. Paste the one from your Omega Plus account.", "The list of models has not been read yet."]);
  assert.deepEqual(blockerLines(null), []);
  assert.equal(missingLine("Sales"), "No model is available for Sales. Choose one from the list.");
});

test("models: a list shows the ranked models first and marks the rest", () => {
  const opts = orderOptions([
    { id: "claude-kimi-k3", name: "Kimi K3", ranked: false },
    { id: "claude-fable-5-1", name: "Fable 5.1", ranked: true },
    { id: "claude-omega-plus", name: "Omega Plus", ranked: false },
    { id: "claude-opus-5-5", name: "Opus 5.5", ranked: true },
    null,
  ]);
  assert.deepEqual(opts.map((o) => o.value), ["claude-fable-5-1", "claude-opus-5-5", "claude-kimi-k3", "claude-omega-plus"]);
  assert.deepEqual(opts.map((o) => o.label), ["Fable 5.1", "Opus 5.5", "Kimi K3 (not ranked)", "Omega Plus (not ranked)"]);
  assert.deepEqual(orderOptions(undefined), []);
});

test("models: test results in words", () => {
  assert.equal(testLine({ model: "claude-fable-5-1", name: "Fable 5.1", answered: true }), "Fable 5.1 answered.");
  assert.equal(testLine({ name: "GPT-6.1 Sol", answered: false, reason: "limited" }), "GPT-6.1 Sol did not answer: your limit is reached.");
  assert.equal(testLine({ name: "Opus 5.5", answered: false, reason: "relay_off" }), "Opus 5.5 did not answer: the model relay is off.");
  assert.equal(testLine({ name: "X", answered: false, reason: "something new" }), "X did not answer: no answer came back.");
});

test("models: the kinds of work, what was used, and files that could not be read", () => {
  assert.deepEqual(NEEDS, { reasoning: "Thinking and planning", making: "Making things", writing: "Writing", checking: "Checking" });
  assert.equal(usageLine({ requests: 0, inputTokens: 0, outputTokens: 0 }), "No calls yet");
  assert.equal(usageLine({ requests: 4, inputTokens: 1200, outputTokens: 15 }), "4 calls, 1,215 tokens");
  for (const p of ["state_unreadable", "company_unreadable", "ranking_unreadable"]) assert.equal(problemLine(p), PROBLEMS[p]);
  assert.equal(problemLine(null), "");
  assert.ok(problemLine("new_problem").length > 0);
});

test("models: loading, ready, an error, and the routes not there yet", () => {
  assert.equal(sectionState({ loading: true }), "loading");
  assert.equal(sectionState({ data: {} }), "ready");
  assert.equal(sectionState({ error: { status: 404 } }), "restart");
  assert.equal(sectionState({ error: { status: 0 } }), "error");
});

test("models: the key goes nowhere but the one POST", () => {
  const code = stripJsComments(SRC);
  for (const bad of [/localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /\bhistory\./, /location\./, /\bconsole\./, /caches\./]) {
    assert.doesNotMatch(code, bad, `settings-models.js does not use ${bad}`);
  }
  assert.match(code, /type="password"/);
  assert.match(code, /autocomplete="off"/);
  // The field is only ever filled by the owner's typing, and emptied after Save.
  assert.match(code, /value=\$\{typed\}/);
  assert.match(code, /if \(ok\) setTyped\(""\)/);
  assert.doesNotMatch(code, /setTyped\((?!""|e\.currentTarget\.value)/);
  const page = stripJsComments(readFileSync(join(PUBLIC, "pages", "settings.js"), "utf8"));
  for (const bad of [/localStorage/, /sessionStorage/, /\bconsole\./]) assert.doesNotMatch(page, bad);
});

test("models: imports stay inside public, use the kit through kit/index.js, and name no host", () => {
  for (const spec of importsOf(SRC)) {
    assert.ok(spec.startsWith("../"), spec);
    assert.ok(!spec.includes("/kit/") || spec === "../kit/index.js", spec);
  }
  assert.deepEqual(hostsIn(stripJsComments(SRC)), []);
});
