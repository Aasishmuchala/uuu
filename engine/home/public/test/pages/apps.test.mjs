// App Studio's list (PLAN-V5 K17, K22, K23, T80): K23's words as written, the pure helpers (the frame's address, the
// state the owner sees, the spending words, the sheet's amounts), and the list mounted in a very small DOM in each
// state: empty, one app off, on, starting, failed, not ready, damaged, App Studio off, the switch's two POSTs and a
// refusal, and a 404 that says to restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Page, {
  AMOUNTS, APP_PORTS, FIRST_AMOUNT, STATE_WORDS, WORDS, allowLabel, amountChoices, appAddress, appHref, appsOf, dollarWord, firstAmount,
  iconHref, plain, sheetTitle, shownState, spendingLine, spends, stateSentence, stateTone, stateWord, thinksLabel,
} from "../../pages/apps.js";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(PUBLIC, "pages", "apps.js"), "utf8");
// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const SHAPE = JSON.parse(readFileSync(join(SHAPES, "apps.json"), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
// Addresses are built from parts, so this file names no host (test/static.test.mjs).
const HTTP = "http:" + "//";
const LOOP = ["127", "0", "0", "1"].join(".");
const NOSPEND = { open: false, budget: 0, spent: 0, left: 0, expiresAt: null, words: "This app cannot spend anything right now.", limitLeft: 2880, limitWords: "What is left of today's limit: $28.80." };
const app = (over = {}) => ({ ...clone(SHAPE.apps[0]), ...over });
const view = (apps, over = {}) => ({ ...clone(SHAPE), apps, ...over });

test("apps: K23's words are used as written", () => {
  assert.equal(WORDS.title, "App Studio");
  assert.equal(WORDS.intro, "Apps that run on this Mac. They reach Runway and Higgsfield only through the engine, inside the limits in Settings.");
  assert.deepEqual(STATE_WORDS, {
    off: "Off", starting: "Starting…", on: "On", failed: "Stopped. It could not start.", not_installed: "Not ready yet.", damaged: "This app's description is damaged.",
  });
  assert.equal(WORDS.open, "Open");
  assert.equal(WORDS.turnOn, "Turn on");
  assert.equal(WORDS.turnOff, "Turn off");
  assert.equal(WORDS.ownWindow, "Open in its own window");
  assert.equal(WORDS.noSpending, "This app cannot spend anything right now.");
  assert.equal(WORDS.allow, "Allow spending");
  assert.equal(WORDS.stop, "Stop spending");
  assert.equal(WORDS.sheetBody, "Each picture or clip shows its price before you make it. This ends at midnight.");
  assert.equal(WORDS.team, "Made by the team");
  assert.equal(WORDS.teamEmpty, "Sites the Builder makes appear here after you accept them.");
  assert.equal(WORDS.restart, "This page appears after the home screen is restarted: engine stop, then engine start.");
  assert.equal(sheetTitle("Render to Film"), "Let Render to Film spend today");
  assert.equal(allowLabel(500), "Allow $5 today");
  assert.deepEqual(AMOUNTS.map(dollarWord), ["$2", "$5", "$10", "$20"]);
  assert.equal(FIRST_AMOUNT, 500, "$5 is the first suggestion (the owner's answer to S5)");
  assert.equal(thinksLabel({ model: "claude-opus-5-5", name: "Claude Opus 5.5" }), "Thinks with Claude Opus 5.5.");
});

test("apps: the frame's address is the home's own hostname and the app's own port, 3171 to 3189, nothing else", () => {
  assert.deepEqual(APP_PORTS, { first: 3171, last: 3189 });
  assert.equal(appAddress(LOOP, 3171), `${HTTP}${LOOP}:3171/`);
  assert.equal(appAddress("localhost", 3189), `${HTTP}localhost:3189/`);
  for (const port of [3170, 3190, 3100, 80, 0, -1, 3171.5, "3171", null, undefined, NaN]) assert.equal(appAddress(LOOP, port), null, String(port));
  for (const host of ["", "evil.test", "127.0.0.2", "[::1]", "LOCALHOST", `${LOOP}.evil.test`, null]) assert.equal(appAddress(host, 3171), null, String(host));
  assert.equal(appHref("render-to-film"), "#/apps/render-to-film");
  assert.equal(appHref("../x"), null);
  assert.equal(appHref("Render"), null);
  assert.equal(iconHref("render-to-film"), "/api/apps/render-to-film/icon");
  assert.equal(iconHref("a/b"), null);
});

test("apps: the state the owner sees, read with the switch and App Studio's own state", () => {
  const on = { state: "on", sentence: "App Studio is on." };
  const off = { state: "off", sentence: "App Studio is off. Run: engine start" };
  assert.equal(shownState(app({ state: "on", on: true }), on), "on");
  assert.equal(shownState(app({ state: "off", on: false }), on), "off");
  assert.equal(shownState(app({ state: "on", on: false }), on), "off", "switched off: off, though the host is still stopping it");
  assert.equal(shownState(app({ state: "off", on: true }), on), "starting", "switched on, not started yet");
  assert.equal(shownState(app({ state: "starting", on: true }), on), "starting");
  assert.equal(shownState(app({ state: "failed", on: true }), on), "failed");
  assert.equal(shownState(app({ state: "not_installed", on: false }), on), "not_installed");
  assert.equal(shownState(app({ state: "damaged", on: true }), on), "damaged");
  assert.equal(shownState(app({ state: "off", on: true }), off), "host_off");
  assert.equal(shownState(app({ state: "made up", on: false }), on), "off");
  assert.equal(shownState(null, null), "off");
  assert.equal(stateSentence("host_off", off), "App Studio is off. Run: engine start");
  assert.equal(stateWord("host_off"), "Waits for App Studio.");
  assert.equal(stateWord("failed"), "Stopped. It could not start.");
  for (const s of Object.keys(STATE_WORDS)) assert.equal(stateSentence(s, on), STATE_WORDS[s]);
  assert.equal(stateTone("on"), "ok");
  assert.equal(stateTone("failed"), "bad");
  assert.notEqual(stateTone("starting"), stateTone("on"), "starting does not look like on");
});

test("apps: the spending words, and which apps can spend", () => {
  assert.equal(spendingLine(app()), "Allowed today: $5.00. Spent: $1.20.");
  assert.equal(spendingLine(app({ spending: NOSPEND })), "This app cannot spend anything right now.");
  assert.equal(spendingLine(app({ spending: null })), "This app cannot spend anything right now.");
  assert.equal(spends(app()), true);
  assert.equal(spends(app({ spending: { ...NOSPEND, limitWords: null } })), false, "an app that makes nothing has no allowance");
  assert.equal(plain("a‮b\u0000c", 10), "abc");
});

test("apps: the sheet's amounts: over what is left of today's limit is disabled; $5 first when it fits", () => {
  assert.deepEqual(amountChoices(2880).map((c) => [c.label, c.disabled]), [["$2", false], ["$5", false], ["$10", false], ["$20", false]]);
  assert.deepEqual(amountChoices(640).map((c) => [c.label, c.disabled]), [["$2", false], ["$5", false], ["$10", true], ["$20", true]]);
  assert.deepEqual(amountChoices(1000).map((c) => c.disabled), [false, false, false, true]);
  assert.equal(firstAmount(2880), 500);
  assert.equal(firstAmount(640), 500);
  assert.equal(firstAmount(300), 200);
  assert.equal(firstAmount(150), null);
  assert.equal(firstAmount(undefined), null);
});

test("apps: an app's text is plain text; nothing is set as HTML; the frame's address never comes from the view's text", () => {
  assert.doesNotMatch(SRC, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(SRC, /api\.post\(`\/api\/apps\/\$\{slug\}\/\$\{what\}`/);
  assert.deepEqual(appsOf({ apps: [{ slug: "../x" }, { slug: "ok-app" }, null, { slug: 3 }] }).map((a) => a.slug), ["ok-app"]);
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
const cls = (e) => e.getAttribute("class") || e.className || "";
const settle = () => new Promise((r) => setTimeout(r, 120));
function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName} listens for ${type}`);
  for (const f of el.listeners[key]) f.call(el, { type: key, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra });
}
const buttons = (root, words) => elements(root).filter((e) => (e.localName === "button" || e.localName === "a") && textOf(e).trim() === words);
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
  render(html`<${Page} route=${{ id: "apps", parts: ["apps"], query: new URLSearchParams("") }} />`, root);
  await settle();
  return { root, f, done: () => { render(null, root); f.restore(); } };
}
const fixed = (body, status = 200) => () => ({ status, body });

test("apps mounted: the intro, the tiles' root class, and the team's group with its empty sentence", async () => {
  const m = await mount(fixed(view([])));
  try {
    const all = textOf(m.root);
    assert.match(all, /App Studio/);
    assert.ok(all.includes(WORDS.intro));
    assert.ok(all.includes(WORDS.noApps), "no app: says so");
    assert.ok(all.includes("Made by the team"));
    assert.ok(all.includes("Sites the Builder makes appear here after you accept them."));
    assert.ok(elements(m.root).some((e) => cls(e).split(/\s+/).includes("p-apps")));
  } finally { m.done(); }
});

test("apps mounted: an app that is on has its picture at 56 px, its line, its state, Open to its page and Turn off", async () => {
  const m = await mount(fixed(view([app()])));
  try {
    const all = textOf(m.root);
    assert.ok(all.includes("Render to Film"));
    assert.ok(all.includes("Turn a render into cinematic stills, clips and a finished film."));
    assert.ok(all.includes("On"));
    assert.ok(all.includes("Allowed today: $5.00. Spent: $1.20."));
    const img = elements(m.root).find((e) => e.localName === "img");
    assert.equal(img.getAttribute("src"), "/api/apps/render-to-film/icon");
    assert.equal(img.getAttribute("width"), "56");
    assert.equal(img.getAttribute("alt"), "");
    assert.equal(buttons(m.root, "Open")[0].getAttribute("href"), "#/apps/render-to-film");
    assert.equal(buttons(m.root, "Turn off").length, 1);
    assert.equal(buttons(m.root, "Turn on").length, 0);
  } finally { m.done(); }
});

test("apps mounted: off shows Turn on, which posts { on: true } and shows the answer; a refusal shows its sentence", async () => {
  let current = view([app({ state: "off", on: false, sentence: "Off", spending: NOSPEND })]);
  let refuse = false;
  const m = await mount((path, method) => {
    if (method === "POST" && path === "/api/apps/render-to-film/switch") {
      if (refuse) return { status: 409, body: { error: { message: "Render to Film cannot be turned on yet.", next: "Not ready yet.", code: "cannot_switch_on" } } };
      current = view([app({ state: "starting", on: true, sentence: "Starting…", spending: NOSPEND })]);
      return { status: 200, body: current };
    }
    return { status: 200, body: current };
  });
  try {
    assert.ok(textOf(m.root).includes("Off"));
    assert.equal(buttons(m.root, "Open").length, 0, "no Open while off");
    fire(buttons(m.root, "Turn on")[0], "click");
    await settle();
    assert.deepEqual(m.f.calls.find((c) => c.method === "POST").body, { on: true });
    assert.ok(textOf(m.root).includes("Starting…"));
    assert.equal(buttons(m.root, "Open").length, 1, "starting: Open goes to its page, which waits for it");
    fire(buttons(m.root, "Turn off")[0], "click");
    await settle();
    assert.deepEqual(m.f.calls.filter((c) => c.method === "POST").at(-1).body, { on: false });
  } finally { m.done(); }
  refuse = true;
  current = view([app({ state: "off", on: false, sentence: "Off", spending: NOSPEND })]);
  const n = await mount((path, method) => (method === "POST" ? { status: 409, body: { error: { message: "Render to Film cannot be turned on yet.", next: "Not ready yet.", code: "cannot_switch_on" } } } : { status: 200, body: current }));
  try {
    fire(buttons(n.root, "Turn on")[0], "click");
    await settle();
    assert.match(textOf(n.root), /Render to Film cannot be turned on yet\.Not ready yet\./);
    assert.ok(elements(n.root).some((e) => e.getAttribute("role") === "alert"));
  } finally { n.done(); }
});

test("apps mounted: every state has its words; App Studio off says so with its command; the switches' problem is shown", async () => {
  const apps = [
    app({ slug: "a-failed", state: "failed", on: true }),
    app({ slug: "b-new", state: "not_installed", on: false }),
    app({ slug: "c-bad", state: "damaged", on: false, name: "c-bad", about: "" }),
  ];
  const m = await mount(fixed(view(apps, { problem: "apps_state_unreadable", problemSentence: "Your app switches could not be read, so every app is off. Turning an app on or off writes them again." })));
  try {
    const all = textOf(m.root);
    assert.ok(all.includes("Stopped. It could not start."));
    assert.ok(all.includes("Turn it off, then on, to try again."));
    assert.ok(elements(m.root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/health"), "a stopped app links to Health");
    assert.ok(all.includes("Not ready yet."));
    assert.ok(all.includes("This app's description is damaged."));
    assert.ok(all.includes("Your app switches could not be read"));
    assert.equal(buttons(m.root, "Turn on").length, 0, "not ready and damaged cannot be turned on");
    assert.equal(buttons(m.root, "Turn off").length, 1, "the stopped one can be turned off");
  } finally { m.done(); }
  const n = await mount(fixed(view([app({ state: "off", on: true })], { host: { state: "off", sentence: "App Studio is off. Run: engine start" } })));
  try {
    assert.match(textOf(n.root), /App Studio is off\. Run: engine start/);
    assert.ok(elements(n.root).some((e) => e.localName === "code" && textOf(e) === "engine start"));
    assert.equal(textOf(n.root).split("Run:").length, 2, "the command is said once, above the apps");
    assert.ok(textOf(n.root).includes("Waits for App Studio."), "the tile says it waits for App Studio");
  } finally { n.done(); }
});

test("apps mounted: a 404 says to restart the home screen; another failure offers Try again", async () => {
  const m = await mount(fixed({ error: { message: "Not found." } }, 404));
  try {
    assert.equal(textOf(m.root).replace(/\s+/g, " ").trim().endsWith(WORDS.restart), true);
  } finally { m.done(); }
  const n = await mount(fixed({ error: { message: "Something broke.", next: "" } }, 500));
  try {
    assert.match(textOf(n.root), /This could not be loaded\./);
    assert.equal(buttons(n.root, "Try again").length, 1);
  } finally { n.done(); }
});
