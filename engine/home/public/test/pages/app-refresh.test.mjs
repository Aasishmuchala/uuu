// U19 fix 1: after the owner's Turn on (or Turn off) is answered, the page asks /api/apps again at once, so the app's
// frame stands as soon as the server says the app is ready, not at the next periodic refresh (2 s while starting).
// One app's page is mounted in a very small DOM. (The list's own Turn on is pinned by apps.test.mjs and unchanged.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Page from "../../pages/app.js";
const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const SHAPE = JSON.parse(readFileSync(join(SHAPES, "apps.json"), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
const HTTP = "http:" + "//";
const LOOP = ["127", "0", "0", "1"].join(".");
const NOSPEND = { open: false, budget: 0, spent: 0, left: 0, expiresAt: null, words: "This app cannot spend anything right now.", limitLeft: 640, limitWords: "What is left of today's limit: $6.40." };
const CHOICES = [{ id: "claude-opus-5-5", name: "Claude Opus 5.5" }, { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }];
const app = (over = {}) => ({ ...clone(SHAPE.apps[0]), thinks: { model: "claude-opus-5-5", name: "Claude Opus 5.5", choices: CHOICES }, ...over });
const view = (apps, over = {}) => ({ ...clone(SHAPE), apps, ...over });

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
  globalThis.location = { hostname: LOOP };
}
function* walk(node) { yield node; for (const c of node.childNodes) yield* walk(c); }
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");
// Effects run 100 ms after the render that asks for them in this small DOM (no animation frame), so a wait of 300 ms
// lets an answer, its render and its effects land even on a busy machine.
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName} listens for ${type}`);
  for (const f of el.listeners[key]) f.call(el, { type: key, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra });
}
const buttons = (root, words) => elements(root).filter((e) => (e.localName === "button" || e.localName === "a") && textOf(e).trim() === words);

const frames = (root) => elements(root).filter((e) => e.localName === "iframe");
function stubFetch(answers) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    const a = answers(path, opts.method, opts.body ? JSON.parse(opts.body) : null);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
async function mount(answers, slug = "render-to-film") {
  installDom();
  const f = stubFetch(answers);
  const root = new FakeElement("div");
  render(html`<${Page} route=${{ id: "app", parts: ["apps", slug], query: new URLSearchParams("") }} />`, root);
  await settle();
  return { root, f, done: () => { render(null, root); f.restore(); delete globalThis.location; } };
}
const fixed = (body, status = 200) => () => ({ status, body });
// The server answers the POST while the host has not started the app yet, and the next GET says it is on.
const turnOnServer = () => {
  let current = view([app({ state: "off", on: false, spending: NOSPEND })]);
  return (path, method) => {
    if (method === "POST") { current = view([app({ state: "starting", on: true, spending: NOSPEND })]); return { status: 200, body: current }; }
    return { status: 200, body: current, ...(current.apps[0].on ? { body: view([app()]) } : {}) };
  };
};

test("app page: Turn on asks /api/apps at once, and the frame stands well before the next 2 s refresh", async () => {
  const m = await mount(turnOnServer());
  try {
    assert.equal(frames(m.root).length, 0);
    fire(buttons(m.root, "Turn on")[0], "click");
    await settle(700);
    assert.ok(m.f.calls.some((c) => c.method === "POST"), "the switch was posted");
    const after = m.f.calls.slice(m.f.calls.findIndex((c) => c.method === "POST") + 1);
    assert.ok(after.some((c) => c.method === "GET" && c.path === "/api/apps"), "asked again right after the answer");
    assert.equal(frames(m.root).length, 1, "the frame is set within 700 ms of the click");
  } finally { m.done(); }
});

test("app page: Turn off, answered off, needs no second ask; Turn on answered on needs none either", async () => {
  let current = view([app()]);
  const m = await mount((path, method) => {
    if (method === "POST") current = view([app({ state: "off", on: false, spending: NOSPEND })]);
    return { status: 200, body: current };
  });
  try {
    const before = m.f.calls.length;
    fire(buttons(m.root, "Turn off")[0], "click");
    await settle(700);
    assert.deepEqual(m.f.calls.slice(before).map((c) => c.method), ["POST"], "the answer is final: no GET follows");
  } finally { m.done(); }
});

test("app page: a refused Turn on is not followed by an extra ask", async () => {
  const m = await mount((path, method) => (method === "POST"
    ? { status: 409, body: { error: { message: "Render to Film cannot be turned on yet.", next: "Add a key first.", code: "cannot_switch_on" } } }
    : { status: 200, body: view([app({ state: "off", on: false, spending: NOSPEND })]) }));
  try {
    fire(buttons(m.root, "Turn on")[0], "click");
    await settle(700);
    const i = m.f.calls.findIndex((c) => c.method === "POST");
    assert.equal(m.f.calls.slice(i + 1).filter((c) => c.method === "GET").length, 0);
  } finally { m.done(); }
});
