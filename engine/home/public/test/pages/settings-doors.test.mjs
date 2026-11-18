// Opening a door from Settings (a door opens only through a confirm, 18 Nov 2026). The web switch, Runway's and
// Higgsfield's switch on as the Map's door does: the press opens the Map's own confirm (map/door-panel.js) and nothing
// more; its yes is inert for 600 ms and never focused first; it sends the request Settings sent before, byte for byte.
// Switching off stays one press, one request. In the test DOM with a fake fetch that records method, address, headers
// and the body string, and a fake clock. "Nothing sent" counts switch requests (every POST): the confirm reads its
// view with one GET.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FakeElement, html, render, installDom, elements, classesOf, textOf, walkDom } from "../kit/_dom.mjs";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (f) => import(pathToFileURL(join(PUBLIC, f)).href);
const { AppContext } = await load("lib/context.js");
const { api } = await load("lib/api.js");
const F = await load("world/fixtures.js");
const { WORDS: W } = await load("world/words.js");
const { ARM_MS } = await load("map/door-panel.js");
const WEB = await load("pages/settings-web.js");
const GEN = await load("pages/settings-generation.js");

// Setting innerHTML anywhere is a failure.
Object.defineProperty(FakeElement.prototype, "innerHTML", { set(v) { throw new Error(`innerHTML was set: ${v}`); }, configurable: true });

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const realNow = Date.now;
let clock = null;
afterEach(() => { Date.now = realNow; clock = null; });
function fakeClock(at = 1_000_000) { clock = at; Date.now = () => clock; }

function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName}.${classesOf(el).join(".")} listens for ${type}`);
  const ev = { type: key, target: el, currentTarget: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
  for (const f of el.listeners[key]) f.call(el, ev);
  return ev;
}
// A key pressed on an element, bubbling up through its ancestors as the browser does, until something stops it.
function press(el, key) {
  const ev = { key, target: el, defaultPrevented: false, stopped: false };
  for (let n = el; n && !ev.stopped; n = n.parentNode) {
    const k = n.listeners && Object.keys(n.listeners).find((x) => x.toLowerCase() === "keydown");
    if (k) for (const f of n.listeners[k]) f.call(n, { ...ev, type: k, currentTarget: n, get defaultPrevented() { return ev.defaultPrevented; }, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() { ev.stopped = true; } });
  }
  return ev;
}
const byWords = (root, words) => elements(root).filter((e) => e.localName === "button" && textOf(e).trim() === words);
const confirmOf = (root) => elements(root).find((e) => e.getAttribute("role") === "alertdialog") || null;
const yesOf = (root) => byWords(root, W.yesOpenDoor)[0] || null;
const textNodes = (root) => [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);

const IDS = ["web", "generation", "higgsfield"];
const PATHS = { web: "/api/web/switch", generation: "/api/generation/switch", higgsfield: "/api/generation/higgsfield/switch" };
const VIEW_PATH = { web: "/api/web", generation: "/api/generation", higgsfield: "/api/generation" };
const LABEL = { web: WEB.WORDS.switchLabel, generation: GEN.WORDS.switchLabel, higgsfield: GEN.HF_WORDS.switchLabel };
const TITLE = { web: "Open the Web door?", generation: "Open the Generation door?", higgsfield: "Open the Higgsfield door?" };
const SAID_ON = { web: WEB.switchLine(true), generation: GEN.switchLine(true), higgsfield: GEN.HF_WORDS.on };
const SAID_OFF = { web: WEB.switchLine(false), generation: GEN.switchLine(false), higgsfield: GEN.HF_WORDS.off };
// The views Settings reads, with the door's switch off (or on).
const viewOf = (id, on) => (id === "web" ? { ...F.webView.plain, on }
  : id === "generation" ? { ...F.generationView.plain, on }
    : { ...F.generationView.plain, higgsfield: { ...F.generationView.plain.higgsfield, on } });

function stubFetch(answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    calls.push({ path, method: opts.method, headers: { ...(opts.headers || {}) }, body: opts.body === undefined ? undefined : String(opts.body) });
    const a = answer(path, opts.method, opts.body) || { status: 200, body: { days: [], hasMore: false } };
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return { calls, posts: () => calls.filter((c) => c.method !== "GET"), restore: () => { globalThis.fetch = real; } };
}

// The section of Settings that holds this door's switch. served.view is what GET of its view answers; post(path)
// what a POST answers (by default the view with the door switched the other way).
async function mountSection(id, { on = false, post } = {}) {
  installDom();
  globalThis.window = globalThis;
  globalThis.location = { hash: `#/settings?s=${id === "web" ? "web" : "generation"}`, pathname: "/", search: "", replace() {}, assign() {} };
  globalThis.history = { state: null, replaceState() {} };
  const served = { view: viewOf(id, on) };
  const said = [];
  const f = stubFetch((path, method) => {
    if (method === "POST") return post ? post(path) : { status: 200, body: viewOf(id, !on) };
    if (path === VIEW_PATH[id]) return { status: 200, body: served.view };
    return null;
  });
  const Section = id === "web" ? WEB.default : GEN.default;
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${{ announce: (s) => said.push(s), setTop() {} }}><${Section} /><//>`, root);
  await settle();
  const sw = () => elements(root).find((e) => e.getAttribute("role") === "switch" && textOf(e).includes(LABEL[id]));
  assert.ok(sw(), `Settings draws the switch "${LABEL[id]}"`);
  return {
    root, f, said, served, sw,
    done: () => { render(null, root); root.remove(); f.restore(); delete globalThis.window; delete globalThis.history; },
  };
}

// The request Settings sent for this switch before 18 Nov 2026: api.post(path, { on: true }), through the same fetch.
async function todaysRequest(id) {
  const f = stubFetch(() => ({ status: 200, body: {} }));
  try {
    await api.post(PATHS[id], { on: true });
    return f.posts()[0];
  } finally { f.restore(); }
}

for (const id of IDS) {
  test(`${id} (Settings): a press on the switch alone sends nothing; the confirm opens, paper, focus on its words, Cancel then an inert yes`, async () => {
    fakeClock();
    const m = await mountSection(id);
    try {
      const gets = m.f.calls.length;
      fire(m.sw(), "click");
      await settle();
      assert.equal(m.f.posts().length, 0, "the press sends nothing");
      const c = confirmOf(m.root);
      assert.ok(c, "the confirm is open");
      assert.equal(c.getAttribute("data-surface"), "paper");
      assert.equal(c.getAttribute("aria-modal"), "true");
      assert.ok(c.getAttribute("aria-labelledby") && c.getAttribute("aria-describedby"));
      assert.ok(m.f.calls.slice(gets).some((x) => x.method === "GET" && x.path === VIEW_PATH[id]), "the view read fresh");
      const active = globalThis.document.activeElement;
      assert.ok(active && classesOf(active).includes("p-settings-door__confirm-text"), "focus is on the confirm's words");
      const buttons = elements(c).filter((e) => e.localName === "button").map((e) => textOf(e).trim());
      assert.deepEqual(buttons, [W.cancel, W.yesOpenDoor], "Cancel first, then the yes");
      assert.notEqual(active, yesOf(m.root));
      assert.equal(yesOf(m.root).getAttribute("aria-disabled"), "true", "inert at first");
      // A second press on the switch while it is open asks nothing more.
      fire(m.sw(), "click");
      await settle(50);
      assert.equal(elements(m.root).filter((e) => e.getAttribute("role") === "alertdialog").length, 1);
      assert.equal(m.f.posts().length, 0);
    } finally { m.done(); }
  });

  test(`${id} (Settings): Enter or Space on the switch sends nothing; Enter and Space on the yes are swallowed while it is inert`, async () => {
    fakeClock();
    const m = await mountSection(id);
    try {
      const sw = m.sw();
      sw.focus();
      // The browser presses a focused button on Enter and on Space: the press opens the confirm, nothing more.
      press(sw, "Enter");
      fire(sw, "click");
      await settle();
      press(sw, " ");
      fire(sw, "click");
      await settle();
      assert.equal(m.f.posts().length, 0, "Enter and Space on the switch");
      // Enter and Space where focus now is (the confirm's words) press nothing.
      press(globalThis.document.activeElement, "Enter");
      press(globalThis.document.activeElement, " ");
      const yes = yesOf(m.root);
      assert.equal(press(yes, "Enter").defaultPrevented, true, "Enter on the yes is swallowed while it is inert");
      assert.equal(press(yes, " ").defaultPrevented, true, "Space on the yes is swallowed while it is inert");
      await settle(50);
      assert.equal(m.f.posts().length, 0);
    } finally { m.done(); }
  });

  test(`${id} (Settings): the yes at 300 ms sends nothing; at 700 ms exactly one request, byte for byte the one Settings sent before`, async () => {
    const before = await todaysRequest(id);
    assert.equal(before.body, '{"on":true}');
    fakeClock();
    const m = await mountSection(id);
    try {
      fire(m.sw(), "click");
      await settle();
      fire(yesOf(m.root), "click");
      clock += 300;
      fire(yesOf(m.root), "click");
      await settle(50);
      assert.equal(m.f.posts().length, 0, "nothing before 600 ms");
      clock += 400;
      fire(yesOf(m.root), "click");
      fire(yesOf(m.root), "click");
      await settle();
      const posts = m.f.posts();
      assert.equal(posts.length, 1, "exactly one at 700 ms");
      assert.deepEqual(posts[0], before, "method, address, every header and the body's bytes");
      assert.equal(confirmOf(m.root), null, "the confirm closes");
      assert.ok(m.said.includes(SAID_ON[id]), `said "${SAID_ON[id]}"`);
      assert.equal(m.sw().getAttribute("aria-checked"), "true", "the switch shows the server's answer");
    } finally { m.done(); }
  });

  test(`${id} (Settings): Esc and a click outside cancel; nothing is sent`, async () => {
    fakeClock();
    const m = await mountSection(id);
    try {
      fire(m.sw(), "click");
      await settle();
      const ev = press(globalThis.document.activeElement, "Escape");
      assert.equal(ev.stopped, true);
      await settle();
      assert.equal(confirmOf(m.root), null);
      fire(m.sw(), "click");
      await settle();
      fire(elements(m.root).find((e) => classesOf(e).includes("p-settings-door__confirm-back")), "click");
      await settle();
      assert.equal(confirmOf(m.root), null);
      fire(m.sw(), "click");
      await settle();
      fire(byWords(m.root, W.cancel)[0], "click");
      await settle();
      assert.equal(confirmOf(m.root), null);
      clock += 5000;
      assert.equal(m.f.posts().length, 0);
      assert.equal(m.sw().getAttribute("aria-checked"), "false");
    } finally { m.done(); }
  });

  test(`${id} (Settings): shutting is one press, one request, no confirm`, async () => {
    const m = await mountSection(id, { on: true });
    try {
      assert.equal(m.sw().getAttribute("aria-checked"), "true");
      fire(m.sw(), "click");
      await settle();
      assert.equal(confirmOf(m.root), null, "no confirm");
      const posts = m.f.posts();
      assert.equal(posts.length, 1);
      assert.equal(posts[0].path, PATHS[id]);
      assert.equal(posts[0].body, '{"on":false}');
      assert.ok(m.said.includes(SAID_OFF[id]));
    } finally { m.done(); }
  });
}

// ---- whole sentences, and hostile ones ----

// Every sentence the Map's confirm shows for a door, by its source: Settings' own export and the view's fields.
function sentencesFor(id, view) {
  if (id === "web") return [WEB.WORDS.leaves, view.door.sentence];
  const limits = [
    GEN.spentLine(view.spent.day, view.caps.daily), GEN.spentLine(view.spent.month, view.caps.monthly),
    GEN.leftLine(view.spent.dayLeft), GEN.leftLine(view.spent.monthLeft), GEN.WORDS.money,
  ];
  if (id === "generation") return [GEN.WORDS.sent, view.door.sentence, view.example, ...limits];
  return [GEN.HF_WORDS.sent, view.higgsfield.sentence, GEN.hfSwitchLine(view), ...limits];
}

for (const id of IDS) {
  test(`${id} (Settings): every sentence of the confirm is one whole text node, strictly the source's; the Map's title`, async () => {
    const m = await mountSection(id);
    try {
      fire(m.sw(), "click");
      await settle();
      const c = confirmOf(m.root);
      const nodes = textNodes(c);
      for (const s of sentencesFor(id, viewOf(id, false))) assert.ok(typeof s === "string" && s.length > 0 && nodes.includes(s), `"${s}" is one text node`);
      assert.equal(textOf(elements(c).find((e) => classesOf(e).includes("p-settings-door__confirm-title"))), TITLE[id]);
      assert.ok(!elements(c).some((e) => e.localName === "a"), "no link to Settings inside Settings");
    } finally { m.done(); }
  });

  test(`${id} (Settings): hostile sentences from the server stay text in the confirm`, async () => {
    const m = await mountSection(id);
    try {
      // The section drew a switch that can be pressed; the view the confirm reads fresh carries hostile text.
      const H = id === "web" ? F.webView.hostile : F.generationView.hostile;
      m.served.view = { ...H, canSwitchOn: true, blockers: [], whyNot: null };
      fire(m.sw(), "click");
      await settle();
      const c = confirmOf(m.root);
      const els = elements(c);
      for (const t of ["script", "img", "iframe", "a", "object", "b"]) assert.equal(els.filter((e) => e.localName === t).length, 0, t);
      for (const e of els) {
        for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k} attribute`);
        for (const h of F.HOSTILE) assert.ok(!String(e.getAttribute("style") || "").includes(h), "no style holds the view's text");
      }
      const nodes = textNodes(c);
      const shown = id === "web" ? [F.HOSTILE[0]] : id === "generation" ? [F.HOSTILE[0], F.HOSTILE[4]] : [F.HOSTILE[2]];
      for (const h of shown) assert.ok(nodes.includes(h), `the hostile sentence is a text node: ${h.slice(0, 30)}`);
      assert.equal(m.f.posts().length, 0);
    } finally { m.done(); }
  });
}

test("higgsfield (Settings): the server refuses the yes: its message and next as sent, inside the confirm; the switch stays off", async () => {
  fakeClock();
  const refusal = { message: "Higgsfield is not signed in.", next: "Sign in under Settings, Generation, then try again." };
  const m = await mountSection("higgsfield", { post: () => ({ status: 409, body: { error: { ...refusal, code: "not_signed_in" } } }) });
  try {
    fire(m.sw(), "click");
    await settle();
    clock += ARM_MS + 50;
    fire(yesOf(m.root), "click");
    await settle();
    assert.equal(m.f.posts().length, 1);
    const nodes = textNodes(confirmOf(m.root));
    assert.ok(nodes.includes(refusal.message) && nodes.includes(refusal.next));
    assert.equal(yesOf(m.root).getAttribute("aria-disabled"), "true", "a failure arms the yes again");
    assert.equal(m.sw().getAttribute("aria-checked"), "false");
  } finally { m.done(); }
});

test("Settings opens a door only through the Map's confirm: one shared component, no { on: true } of its own; its sheet never cuts a sentence", () => {
  const panel = readFileSync(join(PUBLIC, "map/door-panel.js"), "utf8");
  assert.match(panel, /export function DoorConfirm\(/);
  for (const f of ["settings-web.js", "settings-generation.js"]) {
    const src = readFileSync(join(PUBLIC, "pages", f), "utf8");
    // Not at load: the confirm is read with a dynamic import on the first press (M2), so Settings' first view asks for nothing more.
    assert.doesNotMatch(src, /^import[^\n]*map\/door-panel\.js/m, `${f} does not import the confirm at load`);
    assert.match(src, /import\("\.\.\/map\/door-panel\.js"\)/, `${f} reads the confirm on the first press`);
    assert.doesNotMatch(src, /on: true|on: next/, `${f} sends no { on: true } itself`);
    assert.doesNotMatch(src, /yesOpenDoor|ARM_MS|alertdialog/, `${f} draws no confirm of its own`);
  }
  const css = readFileSync(join(PUBLIC, "styles/pages/settings.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((x) => ({ sel: x[1].trim(), body: x[2] }));
  const mine = rules.filter((r) => /p-settings-door__confirm(?!-back|-foot)/.test(r.sel));
  assert.ok(mine.length >= 8, "the confirm's rules are found");
  for (const r of mine) assert.doesNotMatch(r.body, /text-overflow|line-clamp|(^|[^-])height\s*:|overflow\s*:\s*hidden|white-space\s*:\s*nowrap/, r.sel);
});
