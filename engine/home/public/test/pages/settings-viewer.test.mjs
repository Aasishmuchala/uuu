// The Page viewer section of Settings (PLAN-V5 K15, T54): K15's words as written, the pure helpers, a case per
// state (off, on, the viewer off, no Chrome, after Test), why the switch cannot be turned on, and the section mounted
// in a very small DOM: the switch sends on and off, Test shows its sentence and its two pictures small, and a 404
// shows the restart sentence. The server's own sentences (T52, T52b) are read from its modules, so the two cannot
// drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Section, {
  DOOR, PROBLEMS, WORDS, blockerLines, chromeOf, doorState, doorWord, heroMark, isOpen, plain, problemLine, sectionState, switchLine,
  testMark, testResult, todayFigures,
} from "../../pages/settings-viewer.js";
import { BLOCKER_SENTENCES, DOOR_SENTENCES, PROBLEM_SENTENCES } from "../../../server/routes/viewer.mjs";
import { VIEWER_SAY } from "../../../server/routes/sites.mjs";
import { SAY } from "../../../server/lib/siteshots.mjs";

// The same checks as pages.test.mjs, kept here so that file's tests do not run twice.
const stripJsComments = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
const importsOf = (src) => [...stripJsComments(src).matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
const hostsIn = (t) => [...String(t).matchAll(/\b(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\d+\.\d+\.\d+\.\d+)(?::\d+)?/gi)].map((m) => m[0]);

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(PUBLIC, "pages", "settings-viewer.js"), "utf8");
// The shape file sits beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const VIEW = JSON.parse(readFileSync(join(SHAPES, "viewer.json"), "utf8"));
const view = (over = {}) => ({ ...structuredClone(VIEW), ...over });
const ready = (over = {}) => view({ canSwitchOn: true, blockers: [], whyNot: null, ...over });
const KEY = "0123456789abcdef".repeat(4);
const TEST_OK = {
  ok: true, seconds: 4, pictures: 2, sentence: "Chrome opened a test page and took 2 pictures in 4 seconds.",
  images: [
    { url: `/api/sites/shot/${KEY}/shot-index-1280-light.png`, page: "index.html", width: 1280, scheme: "light" },
    { url: `/api/sites/shot/${KEY}/shot-index-390-light.png`, page: "index.html", width: 390, scheme: "light" },
  ],
};

test("viewer: the section is a component", () => {
  assert.equal(typeof Section, "function");
});

test("viewer: K15's and T54's Settings words are used as written", () => {
  assert.equal(WORDS.title, "Page viewer");
  assert.equal(WORDS.intro, "When this is on, pages the Builder makes are opened in a hidden Chrome on this Mac to take pictures of them at desktop and phone width. Nothing is sent anywhere, and the pages can reach nothing but themselves.");
  assert.equal(WORDS.switchLabel, "Let pages be opened to take pictures");
  assert.equal(WORDS.off, "Off. No page is opened.");
  assert.equal(WORDS.on, "On. Only the Builder and the Art director can ask.");
  assert.equal(WORDS.doorOff, "The page viewer is off. Run: engine start");
  assert.equal(WORDS.noChrome, "No Chrome was found on this Mac.");
  assert.equal(WORDS.test, "Test");
  assert.equal(WORDS.testWhat, "Opens a page built into the engine, nothing an agent made.");
  assert.equal(WORDS.restart, "This section appears after the home screen is restarted: engine stop, then engine start.");
  assert.equal(switchLine(false), WORDS.off);
  assert.equal(switchLine(true), WORDS.on);
});

test("viewer: the sentences are the server's own (T52b's door and blockers, T52's Test)", () => {
  for (const [state, sentence] of Object.entries(DOOR_SENTENCES)) assert.equal(DOOR[state].sentence, sentence, state);
  assert.equal(BLOCKER_SENTENCES.door_off, WORDS.doorOff);
  assert.equal(BLOCKER_SENTENCES.no_chrome, WORDS.noChrome);
  assert.equal(BLOCKER_SENTENCES.no_agents, WORDS.noAgents);
  assert.equal(PROBLEM_SENTENCES.state_unreadable, PROBLEMS.state_unreadable);
  assert.equal(VIEWER_SAY.testOff, WORDS.doorOff);
  assert.equal(SAY.noChrome, WORDS.noChrome);
});

test("viewer: Chrome as found: its version, K15's sentence, or nothing while the viewer does not answer", () => {
  assert.deepEqual(chromeOf(view()), { found: true, version: "142.0.7444.60", line: "Chrome 142.0.7444.60 is used." });
  assert.deepEqual(chromeOf(view({ chrome: { found: false, version: null } })), { found: false, version: "", line: "No Chrome was found on this Mac." });
  assert.deepEqual(chromeOf(view({ chrome: { found: null, version: null } })), { found: null, version: "", line: "" });
  assert.equal(chromeOf(view({ chrome: { found: true, version: "<b>142</b>\u0000" } })).line, "Chrome b142/b is used.", "markup comes out plain");
  assert.equal(chromeOf(view({ chrome: { found: true, version: "" } })).line, "Chrome is used.");
  assert.equal(chromeOf(view({ chrome: { found: true, version: "9".repeat(200) } })).version.length, 60);
});

test("viewer: a case per state: off, on, the viewer off, no Chrome", () => {
  // Off, everything ready: the switch can be turned on.
  const off = ready();
  assert.deepEqual(heroMark(off), { tone: "off", word: "Off" });
  assert.equal(doorWord(off), "Closed");
  assert.equal(isOpen(off), false);
  assert.deepEqual(blockerLines(off), []);
  // On: open.
  const on = ready({ on: true, today: { renders: 3, refused: 1 } });
  assert.deepEqual(heroMark(on), { tone: "ok", word: "On" });
  assert.equal(doorWord(on), "Open");
  assert.equal(isOpen(on), true);
  assert.deepEqual(todayFigures(on).tiles, [["Opened today", 3], ["Refused today", 1]]);
  // The viewer off: K15's sentence with its command; on but not running warns.
  const down = view({ door: { state: "off", sentence: DOOR_SENTENCES.off }, chrome: { found: null, version: null }, blockers: ["door_off", "no_agents"] });
  assert.deepEqual(blockerLines(down), ["The page viewer is off. Run: engine start", "Run engine setup first, then try again."]);
  assert.equal(doorWord(down), "Off");
  assert.deepEqual(heroMark({ ...down, on: true }), { tone: "warn", word: "On" });
  assert.equal(doorState({ state: "not_installed" }).sentence, "The page viewer is not installed yet.");
  assert.equal(doorState({ state: "<x>" }).state, "off");
  // No Chrome.
  const none = view({ chrome: { found: false, version: null }, blockers: ["no_chrome"] });
  assert.deepEqual(blockerLines(none), ["No Chrome was found on this Mac."]);
  assert.equal(doorWord(none), "No Chrome");
  assert.equal(isOpen({ ...none, on: true }), false);
  // Refused for another reason the server words itself.
  assert.deepEqual(blockerLines(view({ blockers: [], canSwitchOn: false, whyNot: "Not yet." })), ["Not yet."]);
  assert.deepEqual(todayFigures(view({ today: { renders: -1, refused: "9" } })).tiles, [["Opened today", 0], ["Refused today", 0]]);
});

test("viewer: Test's answer: its sentence, its two light pictures, and its mark", () => {
  const r = testResult(TEST_OK);
  assert.deepEqual([r.tone, r.word, r.sentence], ["ok", "Works", "Chrome opened a test page and took 2 pictures in 4 seconds."]);
  assert.equal(r.desktop, TEST_OK.images[0].url);
  assert.equal(r.phone, TEST_OK.images[1].url);
  assert.deepEqual(testMark(null), { tone: "off", word: "Not tested yet" });
  assert.deepEqual(testMark(TEST_OK), { tone: "ok", word: "Works" });
  const noChrome = testResult({ ok: false, seconds: 1, pictures: 0, images: [], sentence: "No Chrome was found on this Mac." });
  assert.deepEqual([noChrome.tone, noChrome.word, noChrome.desktop], ["bad", "No Chrome", null]);
  assert.deepEqual(testResult({ ok: false, sentence: "The page viewer is off. Run: engine start" }).word, "Not running");
  assert.equal(testResult({ ok: false, sentence: "" }).sentence, "The test did not work.");
});

test("viewer: what the section draws, and a file that could not be read", () => {
  assert.equal(sectionState({ data: VIEW }), "ready");
  assert.equal(sectionState({ error: { status: 404 } }), "restart");
  assert.equal(sectionState({ error: { status: 500 } }), "error");
  assert.equal(sectionState({ loading: true }), "loading");
  assert.equal(problemLine(view({ problem: "state_unreadable", problemSentence: null })), PROBLEMS.state_unreadable);
  assert.equal(problemLine(view()), "");
  assert.equal(plain("a‮b", 10), "ab");
});

test("viewer: imports stay inside public through kit/index.js, name no host, set nothing as HTML", () => {
  for (const spec of importsOf(SRC)) {
    assert.ok(spec.startsWith("../"), spec);
    assert.ok(!spec.includes("/kit/") || spec === "../kit/index.js", spec);
  }
  assert.deepEqual(hostsIn(stripJsComments(SRC)), []);
  assert.doesNotMatch(SRC, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(SRC, /api\.post\("\/api\/viewer\/test", \{\}\)/);
});

// ---- Mounted ----

class FakeNode {
  constructor() { this.childNodes = []; this.parentNode = null; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
}
class FakeText extends FakeNode { constructor(d) { super(); this.nodeType = 3; this.data = String(d); } }
class FakeElement extends FakeNode {
  constructor(tag) { super(); this.nodeType = 1; this.localName = tag; this.attrs = {}; this.style = { cssText: "", setProperty(k, v) { this[k] = v; } }; this.listeners = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  focus() { globalThis.document.activeElement = this; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  set innerHTML(v) { throw new Error(`innerHTML was set: ${v}`); }
}
const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);
function installDom() {
  const doc = { title: "", activeElement: null, visibilityState: "visible", createElement: (t) => new FakeElement(t), createElementNS: (_n, t) => new FakeElement(t), createTextNode: (d) => new FakeText(d), addEventListener() {}, removeEventListener() {} };
  doc.body = new FakeElement("body");
  globalThis.document = doc;
}
function* walk(node) { yield node; for (const c of node.childNodes) yield* walk(c); }
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");
const settle = () => new Promise((r) => setTimeout(r, 120));
function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName} listens for ${type}`);
  for (const f of el.listeners[key]) f.call(el, { type: key, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra });
}
function stubFetch(answers) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    const a = answers(path, opts.method);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
async function mount(answers) {
  installDom();
  const f = stubFetch(answers);
  const root = new FakeElement("div");
  render(html`<${Section} />`, root);
  await settle();
  return { root, f, done: () => { render(null, root); f.restore(); } };
}

test("viewer mounted: the switch sends on; Test shows its sentence and its two pictures small", async () => {
  let current = ready();
  const m = await mount((path, method) => {
    if (path === "/api/viewer/switch") { current = { ...current, on: true }; return { status: 200, body: current }; }
    if (path === "/api/viewer/test") return { status: 200, body: TEST_OK };
    return { status: 200, body: current };
  });
  try {
    const all = textOf(m.root);
    assert.match(all, /Page viewer/);
    assert.match(all, /Off\. No page is opened\./);
    assert.match(all, /Chrome 142\.0\.7444\.60 is used\./);
    assert.match(all, /Opens a page built into the engine, nothing an agent made\./);
    const sw = elements(m.root).find((e) => e.getAttribute("role") === "switch" || (e.localName === "input" && e.type === "checkbox") || e.getAttribute("aria-checked") !== null);
    assert.ok(sw, "the switch is there");
    fire(sw, sw.listeners.change ? "change" : "click", { currentTarget: { checked: true }, target: { checked: true } });
    await settle();
    assert.deepEqual(m.f.calls.find((c) => c.path === "/api/viewer/switch").body, { on: true });
    assert.match(textOf(m.root), /On\. Only the Builder and the Art director can ask\./);
    const test = elements(m.root).find((e) => e.localName === "button" && textOf(e).trim() === "Test");
    fire(test, "click");
    await settle();
    assert.match(textOf(m.root), /Chrome opened a test page and took 2 pictures in 4 seconds\./);
    const srcs = elements(m.root).filter((e) => e.localName === "img" && /^\/api\/sites\/shot\//.test(e.src ?? e.getAttribute("src"))).map((e) => e.src ?? e.getAttribute("src"));
    assert.deepEqual(srcs, [TEST_OK.images[0].url, TEST_OK.images[1].url]);
  } finally {
    m.done();
  }
});

test("viewer mounted: the viewer off says so with its command; no Chrome says so; a 404 says to restart", async () => {
  let m = await mount(() => ({ status: 200, body: view({ door: { state: "off", sentence: DOOR_SENTENCES.off }, chrome: { found: null, version: null }, blockers: ["door_off"] }) }));
  try {
    assert.match(textOf(m.root), /It can be switched on when these are done:/);
    assert.match(textOf(m.root), /The page viewer is off\. Run:/);
    assert.ok(elements(m.root).some((e) => e.localName === "code" && textOf(e) === "engine start"));
    assert.match(textOf(m.root), /It can be tested once the page viewer is running\./);
  } finally {
    m.done();
  }
  m = await mount(() => ({ status: 200, body: view({ chrome: { found: false, version: null }, blockers: ["no_chrome"] }) }));
  try {
    assert.match(textOf(m.root), /No Chrome was found on this Mac\./);
  } finally {
    m.done();
  }
  m = await mount(() => ({ status: 404, body: { error: { message: "Not found." } } }));
  try {
    assert.match(textOf(m.root), /This section appears after the home screen is restarted: engine stop, then engine start\./);
  } finally {
    m.done();
  }
});
