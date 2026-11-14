// One app opened inside App Studio (PLAN-V5 K17, K22, K23, T80): mounted in a very small DOM in each state. On: the
// home screen's own bar above an iframe at the app's own port with exactly T80's sandbox; off: a card with Turn on;
// starting: no frame yet, /api/apps asked again; stopped: its sentence and Health; App Studio off; an unknown app; a
// 404 that says to restart. The allowance sheet: four amounts, those over what is left disabled, "Allow $5 today"
// posts and the bar shows the new words; Stop spending; the model's menu; a refusal shown in the bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Page, { ALLOW, POLL_ON_MS, POLL_STARTING_MS, SANDBOX, STARTING_FOR_MS, frameAddress } from "../../pages/app.js";
import { WORDS } from "../../pages/apps.js";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(PUBLIC, "pages", "app.js"), "utf8");
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const SHAPE = JSON.parse(readFileSync(join(SHAPES, "apps.json"), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
const HTTP = "http:" + "//";
const LOOP = ["127", "0", "0", "1"].join(".");
const NOSPEND = { open: false, budget: 0, spent: 0, left: 0, expiresAt: null, words: "This app cannot spend anything right now.", limitLeft: 640, limitWords: "What is left of today's limit: $6.40." };
const CHOICES = [{ id: "claude-opus-5-5", name: "Claude Opus 5.5" }, { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }];
const TRUST = "This app's own program runs inside the fence: it cannot reach the internet or your files. Its page runs in your browser, and a page in your browser can still reach the internet, as any web page can. Turn on only an app whose code you trust.";
const TRUST_SHORT = "This app's page runs in your browser and can reach the internet. Its program cannot.";
const app = (over = {}) => ({ ...clone(SHAPE.apps[0]), thinks: { model: "claude-opus-5-5", name: "Claude Opus 5.5", choices: CHOICES }, ...over });
const view = (apps, over = {}) => ({ ...clone(SHAPE), apps, ...over });

test("app: the sandbox and permissions are exactly T86's: no popups, never the top window", () => {
  assert.equal(SANDBOX, "allow-scripts allow-same-origin allow-forms allow-downloads");
  assert.doesNotMatch(SANDBOX, /allow-top-navigation|allow-popups/);
  assert.equal(ALLOW, "fullscreen; clipboard-write");
  assert.equal(POLL_STARTING_MS, 2000);
  assert.equal(STARTING_FOR_MS, 60000);
  assert.doesNotMatch(SRC, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(SRC, /window\.open\(address, "_blank", "noopener,noreferrer"\)/, "its own window has no way back");
  assert.match(SRC, /referrerpolicy="no-referrer"/);
});

test("app: the frame's address follows this page's hostname and only the app's port", () => {
  globalThis.location = { hostname: LOOP };
  assert.equal(frameAddress({ port: 3171 }), `${HTTP}${LOOP}:3171/`);
  globalThis.location = { hostname: "localhost" };
  assert.equal(frameAddress({ port: 3171 }), `${HTTP}localhost:3171/`);
  assert.equal(frameAddress({ port: 3200 }), null);
  globalThis.location = { hostname: "evil.test" };
  assert.equal(frameAddress({ port: 3171 }), null);
  delete globalThis.location;
  assert.equal(frameAddress({ port: 3171 }), null);
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
  globalThis.location = { hostname: LOOP };
}
function* walk(node) { yield node; for (const c of node.childNodes) yield* walk(c); }
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
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

test("app mounted, on: the bar (back, name, state, spending, the model, its own window, Turn off) above an iframe at its own port", async () => {
  const m = await mount(fixed(view([app()])));
  try {
    const all = textOf(m.root);
    const bar = elements(m.root).find((e) => e.localName === "header");
    assert.ok(bar, "the home screen's own bar");
    const barText = textOf(bar);
    for (const w of ["Render to Film", "On", "Allowed today: $5.00. Spent: $1.20.", "Stop spending", "Thinks with Claude Opus 5.5.", "Open in its own window", "Turn off"]) {
      assert.ok(barText.includes(w), w);
    }
    assert.ok(elements(bar).some((e) => e.localName === "a" && e.getAttribute("href") === "#/apps"), "back to App Studio");
    assert.ok(elements(bar).some((e) => e.localName === "h1" && e.getAttribute("id") === "page-title"), "the heading the shell focuses");
    const f = frames(m.root);
    assert.equal(f.length, 1);
    assert.equal(f[0].getAttribute("src"), `${HTTP}${LOOP}:3171/`);
    assert.equal(f[0].getAttribute("sandbox"), SANDBOX);
    assert.equal(f[0].getAttribute("referrerpolicy"), "no-referrer");
    assert.equal(f[0].getAttribute("allow"), "fullscreen; clipboard-write");
    assert.equal(f[0].getAttribute("title"), "Render to Film");
    assert.ok(!bar.contains(f[0]), "the frame is not inside the bar");
    assert.ok(!all.includes("is off."));
  } finally { m.done(); }
});

test("app mounted, on: its own window opens the same address with noopener and noreferrer", async () => {
  const opened = [];
  globalThis.window = { open: (...a) => { opened.push(a); return null; } };
  const m = await mount(fixed(view([app()])));
  try {
    fire(buttons(m.root, "Open in its own window")[0], "click");
    assert.deepEqual(opened, [[`${HTTP}${LOOP}:3171/`, "_blank", "noopener,noreferrer"]]);
  } finally { m.done(); delete globalThis.window; }
});

test("app mounted, off: no frame, a card '<name> is off.' with Turn on, which posts { on: true }", async () => {
  let current = view([app({ state: "off", on: false, spending: NOSPEND })]);
  const m = await mount((path, method) => {
    if (method === "POST") { current = view([app({ state: "starting", on: true, spending: NOSPEND })]); return { status: 200, body: current }; }
    return { status: 200, body: current };
  });
  try {
    assert.equal(frames(m.root).length, 0);
    assert.ok(textOf(m.root).includes("Render to Film is off."));
    assert.equal(buttons(m.root, "Open in its own window").length, 0);
    fire(buttons(m.root, "Turn on")[0], "click");
    await settle();
    assert.deepEqual(m.f.calls.find((c) => c.method === "POST"), { path: "/api/apps/render-to-film/switch", method: "POST", body: { on: true } });
    assert.ok(textOf(m.root).includes("Starting Render to Film…"));
    assert.equal(frames(m.root).length, 0, "no frame until the host says on");
  } finally { m.done(); }
});

test("app mounted, starting: asks /api/apps again every 2 seconds and sets the frame only once the app is on", async () => {
  let asks = 0;
  const m = await mount((path, method) => {
    if (method === "GET") asks += 1;
    return { status: 200, body: view([app(asks >= 2 ? {} : { state: "starting", on: true })]) };
  });
  try {
    assert.ok(textOf(m.root).includes("Starting Render to Film…"));
    assert.equal(frames(m.root).length, 0);
    await settle(POLL_STARTING_MS + 300);
    assert.ok(asks >= 2, "asked again");
    assert.equal(frames(m.root).length, 1, "on: the frame is set");
    assert.equal(frames(m.root)[0].getAttribute("src"), `${HTTP}${LOOP}:3171/`);
  } finally { m.done(); }
});

test("app mounted, failed: the sentence, what to do and a link to Health; no frame", async () => {
  const m = await mount(fixed(view([app({ state: "failed", on: true })])));
  try {
    const all = textOf(m.root);
    assert.ok(all.includes("Stopped. It could not start."));
    assert.ok(all.includes("Turn it off, then on, to try again."));
    assert.ok(buttons(m.root, "Open Health").some((a) => a.getAttribute("href") === "#/health"));
    assert.equal(frames(m.root).length, 0);
    assert.equal(buttons(m.root, "Turn off").length, 1);
  } finally { m.done(); }
});

test("app mounted: App Studio off, not ready, damaged and an unknown app each say so; a 404 says to restart", async () => {
  let m = await mount(fixed(view([app({ state: "off", on: true })], { host: { state: "off", sentence: "App Studio is off. Run: engine start" } })));
  try {
    assert.match(textOf(m.root), /Render to Film cannot run right now\.App Studio is off\. Run: engine start/);
    assert.equal(frames(m.root).length, 0);
  } finally { m.done(); }
  m = await mount(fixed(view([app({ state: "not_installed", on: false })])));
  try { assert.ok(textOf(m.root).includes("Not ready yet.")); assert.equal(frames(m.root).length, 0); } finally { m.done(); }
  m = await mount(fixed(view([app({ state: "damaged", on: false })])));
  try { assert.ok(textOf(m.root).includes("This app's description is damaged.")); } finally { m.done(); }
  m = await mount(fixed(view([app()])), "no-such-app");
  try {
    assert.ok(textOf(m.root).includes("App Studio has no app by that name."));
    assert.equal(buttons(m.root, "App Studio")[0].getAttribute("href"), "#/apps");
    assert.equal(frames(m.root).length, 0);
  } finally { m.done(); }
  m = await mount(fixed({ error: { message: "Not found." } }, 404));
  try { assert.equal(textOf(m.root).trim(), WORDS.restart); } finally { m.done(); }
});

test("app mounted: the allowance sheet: K23's words, four amounts with those over what is left disabled, Allow $5 today posts", async () => {
  let current = view([app({ spending: NOSPEND })]);
  const m = await mount((path, method, body) => {
    if (method === "POST" && path === "/api/apps/render-to-film/allowance") {
      current = view([app({ spending: { ...NOSPEND, open: true, budget: body.cents, words: "Allowed today: $5.00. Spent: $0.00." } })]);
      return { status: 200, body: current };
    }
    return { status: 200, body: current };
  });
  try {
    assert.ok(textOf(m.root).includes("This app cannot spend anything right now."));
    fire(buttons(m.root, "Allow spending")[0], "click");
    await settle();
    const dialog = elements(m.root).find((e) => e.getAttribute("role") === "dialog");
    assert.ok(dialog, "the sheet is the kit's dialog");
    const d = textOf(dialog);
    assert.ok(d.includes("Let Render to Film spend today"));
    assert.ok(d.includes("Each picture or clip shows its price before you make it. This ends at midnight."));
    assert.ok(d.includes("What is left of today's limit: $6.40."));
    const amounts = ["$2", "$5", "$10", "$20"].map((w) => buttons(dialog, w)[0]);
    assert.deepEqual(amounts.map((b) => b.disabled === true || b.getAttribute("disabled") !== null && b.getAttribute("disabled") !== "false"), [false, false, true, true]);
    assert.equal(amounts[1].getAttribute("aria-pressed"), "true", "$5 is picked first");
    fire(buttons(dialog, "Allow $5 today")[0], "click");
    await settle();
    assert.deepEqual(m.f.calls.find((c) => c.method === "POST").body, { cents: 500 });
    assert.equal(elements(m.root).filter((e) => e.getAttribute("role") === "dialog").length, 0, "the sheet closes");
    assert.ok(textOf(m.root).includes("Allowed today: $5.00. Spent: $0.00."), "the bar shows the new words");
    assert.equal(buttons(m.root, "Stop spending").length, 1);
  } finally { m.done(); }
});

test("app mounted: a refused allowance stays in the sheet; Esc and Cancel close it; Stop spending posts", async () => {
  let current = view([app({ spending: NOSPEND })]);
  const m = await mount((path, method) => {
    if (method === "POST" && path.endsWith("/allowance")) return { status: 409, body: { error: { message: "Nothing can be made yet.", next: "Add a Runway key or sign in to Higgsfield in Settings first.", code: "no_provider" } } };
    if (method === "POST" && path.endsWith("/allowance/stop")) { current = view([app({ spending: NOSPEND })]); return { status: 200, body: current }; }
    return { status: 200, body: current };
  });
  try {
    fire(buttons(m.root, "Allow spending")[0], "click");
    await settle();
    let dialog = elements(m.root).find((e) => e.getAttribute("role") === "dialog");
    fire(buttons(dialog, "Allow $5 today")[0], "click");
    await settle();
    dialog = elements(m.root).find((e) => e.getAttribute("role") === "dialog");
    assert.ok(dialog, "still open");
    assert.match(textOf(dialog), /Nothing can be made yet\.Add a Runway key or sign in to Higgsfield in Settings first\./);
    fire(dialog, "keydown", { key: "Escape" });
    await settle();
    assert.equal(elements(m.root).filter((e) => e.getAttribute("role") === "dialog").length, 0, "Esc closes the sheet");
    fire(buttons(m.root, "Allow spending")[0], "click");
    await settle();
    dialog = elements(m.root).find((e) => e.getAttribute("role") === "dialog");
    fire(buttons(dialog, "Cancel")[0], "click");
    await settle();
    assert.equal(elements(m.root).filter((e) => e.getAttribute("role") === "dialog").length, 0, "Cancel closes the sheet");
  } finally { m.done(); }
  current = view([app()]);
  const n = await mount((path, method) => {
    if (method === "POST") { current = view([app({ spending: NOSPEND })]); return { status: 200, body: current }; }
    return { status: 200, body: current };
  });
  try {
    fire(buttons(n.root, "Stop spending")[0], "click");
    await settle();
    assert.equal(n.f.calls.find((c) => c.method === "POST").path, "/api/apps/render-to-film/allowance/stop");
    assert.ok(textOf(n.root).includes("This app cannot spend anything right now."));
    assert.equal(buttons(n.root, "Allow spending").length, 1);
  } finally { n.done(); }
});

test("app mounted: the model's menu posts the choice; a refusal in the bar is shown as an alert", async () => {
  let current = view([app()]);
  let refuse = false;
  const m = await mount((path, method, body) => {
    if (method === "POST" && path.endsWith("/thinks")) {
      if (refuse) return { status: 400, body: { error: { message: "That model is not in the list.", next: "Choose a model from the list.", code: "bad_model" } } };
      current = view([app({ thinks: { model: body.model, name: "Claude Sonnet 5.5", choices: CHOICES } })]);
      return { status: 200, body: current };
    }
    return { status: 200, body: current };
  });
  try {
    const trigger = buttons(m.root, "Thinks with Claude Opus 5.5.")[0];
    fire(trigger, "click");
    await settle();
    const item = elements(m.root).find((e) => e.getAttribute("role") === "menuitem" && textOf(e).trim() === "Claude Sonnet 5.5");
    fire(item, "click");
    await settle();
    assert.deepEqual(m.f.calls.find((c) => c.method === "POST").body, { model: "claude-sonnet-5-5" });
    assert.equal(buttons(m.root, "Thinks with Claude Sonnet 5.5.").length, 1);
    refuse = true;
    fire(buttons(m.root, "Thinks with Claude Sonnet 5.5.")[0], "click");
    await settle();
    fire(elements(m.root).find((e) => e.getAttribute("role") === "menuitem" && textOf(e).trim() === "Claude Opus 5.5"), "click");
    await settle();
    assert.ok(elements(m.root).some((e) => e.getAttribute("role") === "alert" && /That model is not in the list\./.test(textOf(e))));
  } finally { m.done(); }
});

test("app: the words of what the fence does not cover, and of checking, are as written", () => {
  assert.equal(WORDS.trust, TRUST);
  assert.equal(WORDS.trustShort, TRUST_SHORT);
  assert.equal(WORDS.checking, "Checking the app…");
  assert.doesNotMatch(TRUST + TRUST_SHORT, /\u2014/, "no em dash");
});

test("app mounted, off: the long sentence stands beside Turn on; no short one, no frame", async () => {
  const m = await mount(fixed(view([app({ state: "off", on: false, spending: NOSPEND })])));
  try {
    const card = elements(m.root).find((e) => e.getAttribute("class") === "p-app__card");
    assert.ok(card, "the off card");
    assert.ok(buttons(card, "Turn on").length === 1);
    const long = elements(card).find((e) => e.getAttribute("class") === "p-app__trust-long");
    assert.ok(long, "the long sentence is in the card with Turn on");
    assert.equal(textOf(long), TRUST);
    assert.ok(!textOf(m.root).includes(TRUST_SHORT));
  } finally { m.done(); }
});

test("app mounted, on: the short sentence stays under the bar, beside the frame; not inside the bar, and not loud", async () => {
  const m = await mount(fixed(view([app()])));
  try {
    const short = elements(m.root).find((e) => e.getAttribute("class") === "p-app__trust");
    assert.ok(short, "the short sentence");
    assert.equal(textOf(short), TRUST_SHORT);
    const bar = elements(m.root).find((e) => e.localName === "header");
    assert.ok(!bar.contains(short));
    assert.ok(!textOf(m.root).includes(TRUST), "the long one is not shown while the app is open");
    assert.ok(!textOf(m.root).includes(WORDS.checking));
    const css = readFileSync(join(PUBLIC, "styles", "pages", "app.css"), "utf8");
    assert.match(css, /\.p-app \.p-app__notes \{[^}]*color: var\(--text-2\);[^}]*font-size: var\(--fs-caption\);/, "caption size, second colour");
    assert.match(css, /\.p-app \.p-app__trust-long \{[^}]*color: var\(--text-2\);[^}]*font-size: var\(--fs-caption\);/);
  } finally { m.done(); }
});

test("app mounted: one answer that says off keeps the frame and says 'Checking the app…'; the second takes it away", async () => {
  const answers = [view([app()]), view([app({ state: "off" })], { host: { state: "off", sentence: "App Studio is off. Run: engine start" } }), view([app({ state: "off" })])];
  let n = 0;
  const m = await mount((path, method) => ({ status: 200, body: answers[Math.min(n++, answers.length - 1)] }));
  try {
    assert.equal(frames(m.root).length, 1);
    const frame = frames(m.root)[0];
    // The page asks again; this answer says App Studio is off.
    await settle(POLL_ON_MS + 300);
    assert.equal(frames(m.root).length, 1, "the frame is kept through one bad answer");
    assert.equal(frames(m.root)[0], frame, "the same frame, never taken down and put back");
    const checking = elements(m.root).find((e) => e.getAttribute("class") === "p-app__checking");
    assert.ok(checking, "the quiet line");
    assert.equal(textOf(checking), "Checking the app…");
    assert.equal(checking.getAttribute("role"), "status");
    // While checking it asks again sooner; the second answer that says off is believed.
    await settle(POLL_STARTING_MS + 300);
    assert.equal(frames(m.root).length, 0, "two answers in a row say off");
    assert.ok(!textOf(m.root).includes("Checking the app…"));
  } finally { m.done(); }
});

test("app mounted: the owner's Turn off takes the frame away at once, with no checking", async () => {
  let current = view([app()]);
  const m = await mount((path, method) => {
    if (method === "POST") { current = view([app({ state: "on", on: false, spending: NOSPEND })]); return { status: 200, body: current }; }
    return { status: 200, body: current };
  });
  try {
    assert.equal(frames(m.root).length, 1);
    fire(buttons(m.root, "Turn off")[0], "click");
    await settle();
    assert.equal(frames(m.root).length, 0);
    assert.ok(textOf(m.root).includes("Render to Film is off."));
    assert.ok(!textOf(m.root).includes("Checking the app…"));
  } finally { m.done(); }
});
