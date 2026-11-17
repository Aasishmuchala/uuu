// Opening and shutting a door from the Map (PLAN-3D T9, D12, 2.3; revision R1). For each of the three doors, in the
// test DOM with a fake fetch that records method, address, headers and the body string, and a fake clock:
// (1) shut is one click and one request; (2) nothing on the way to the confirm sends a switch request (the row, Enter,
// Space, a double click, the door in the picture's Doors marker, "Open this door"), the confirm's text takes focus, the yes is
// inert for 600 ms, Esc and a click outside cancel; (3) the confirm's sentences are each one whole text node, strictly
// equal to the Settings module's export and the view's field, and the sheet never cuts them; (4) hostile sentences
// stay text; (5) the request is the one Settings sends, byte for byte; (6) refusals in Settings' own words with the
// link to Settings; (7) after a success /api/world is read again and Settings' word for the new state is said.
// "Zero requests" counts switch requests (every POST): the confirm reads its view with one GET as 2.3 asks.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FakeElement, html, render, installDom, elements, classesOf, textOf, walkDom } from "../kit/_dom.mjs";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (f) => import(pathToFileURL(join(PUBLIC, f)).href);
const Page = (await load("pages/map.js")).default;
const { AppContext } = await load("lib/context.js");
const F = await load("world/fixtures.js");
const { doorSettingsHref, WORDS: W } = await load("world/words.js");
const WEB = await load("pages/settings-web.js");
const GEN = await load("pages/settings-generation.js");
const { ARM_MS } = await load("map/door-panel.js");

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
function press(el, key, extra = {}) {
  const ev = { key, target: el, defaultPrevented: false, stopped: false, ...extra };
  for (let n = el; n && !ev.stopped; n = n.parentNode) {
    const k = n.listeners && Object.keys(n.listeners).find((x) => x.toLowerCase() === "keydown");
    if (k) for (const f of n.listeners[k]) f.call(n, { ...ev, type: k, currentTarget: n, get defaultPrevented() { return ev.defaultPrevented; }, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() { ev.stopped = true; } });
  }
  return ev;
}
const byWords = (root, words) => elements(root).filter((e) => (e.localName === "button" || e.localName === "a") && textOf(e).trim() === words);
const doorRow = (root, id) => elements(root).find((e) => e.localName === "button" && e.getAttribute("data-door") === id);
const confirmOf = (root) => elements(root).find((e) => e.getAttribute("role") === "alertdialog") || null;
const yesOf = (root) => byWords(root, W.yesOpenDoor)[0] || null;
const textNodes = (root) => [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);

// ---- the fake home ----

const ROOM_MAP = (world) => ({
  company: world.company, boardOff: null, counts: { running: 1, needsYou: 1 }, brain: { files: 12, basics: { filled: 4, total: 9 }, asking: null },
  departments: world.rooms.map((r) => ({ id: r.id, title: r.title, line: r.line, counts: r.counts, agents: r.agents.map((a) => ({ slug: a.slug, name: a.name })), clusters: [] })),
});
const HOME = { needsYou: { total: 0, items: [] }, running: [] };
const DOOR_TITLES = { web: "Web door", generation: "Generation door", higgsfield: "Higgsfield door" };
// The seed's world with one door on or off.
function worldWith(id, on) {
  return { ...F.seed.world, doors: F.seed.world.doors.map((d) => (d.id === id ? { ...d, on, sentence: on ? d.sentence : `The ${DOOR_TITLES[id].toLowerCase()} is shut.` } : d)) };
}
// The views Settings reads, with the door's switch off.
const VIEWS = {
  web: { ...F.webView.plain, on: false },
  generation: { ...F.generationView.plain, on: false },
  higgsfield: { ...F.generationView.plain, higgsfield: { ...F.generationView.plain.higgsfield, on: false } },
};
const PATHS = { web: "/api/web/switch", generation: "/api/generation/switch", higgsfield: "/api/generation/higgsfield/switch" };
const VIEW_PATH = { web: "/api/web", generation: "/api/generation", higgsfield: "/api/generation" };

function stubFetch(answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    calls.push({ path, method: opts.method, headers: { ...(opts.headers || {}) }, body: opts.body === undefined ? undefined : String(opts.body) });
    const a = answer(path, opts.method, opts.body) || { status: 404, body: { error: { message: "Not here.", next: "" } } };
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return { calls, posts: () => calls.filter((c) => c.method !== "GET"), restore: () => { globalThis.fetch = real; } };
}

async function mountMap({ id, on = false, view, post, viewStatus = 200, route = ["map"] } = {}) {
  installDom();
  globalThis.document.visibilityState = "visible";
  globalThis.location = { hash: "#/map", search: "", replace(h) { this.hash = h; } };
  let world = worldWith(id, on);
  const said = [];
  const f = stubFetch((path, method) => {
    if (method === "POST") {
      const a = post ? post(path) : { status: 200, body: { ok: true } };
      if (a.status < 400 && path === PATHS[id]) world = worldWith(id, !on);
      return a;
    }
    if (path === "/api/world") return { status: 200, body: world };
    if (path === "/api/map") return { status: 200, body: ROOM_MAP(world) };
    if (path === "/api/home") return { status: 200, body: HOME };
    if (path === VIEW_PATH[id]) return viewStatus === 200 ? { status: 200, body: view || VIEWS[id] } : { status: viewStatus, body: { error: { message: "The door's settings could not be read.", next: "Try again in a minute." } } };
    return { status: 200, body: {} };
  });
  const ctx = { shell: null, announce: (s) => said.push(s), setTop: () => {}, openNeeds: () => {}, openComposer: () => {}, refreshShell: () => {}, settings: { motion: "off", theme: "dark" } };
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${Page} route=${{ id: "map", parts: route, query: new URLSearchParams("") }} /><//>`, root);
  await settle();
  return { root, f, said, done: () => { render(null, root); root.remove(); f.restore(); } };
}

// The door's panel, opened from its row; the Settings module loaded.
async function openPanel(m, id) {
  fire(doorRow(m.root, id), "click");
  await settle();
  assert.ok(elements(m.root).some((e) => e.getAttribute("data-panel-door") === id), "the door's panel is open");
}
async function openConfirm(m) {
  fire(byWords(m.root, W.openDoor)[0], "click");
  await settle();
  const c = confirmOf(m.root);
  assert.ok(c, "the confirm is open");
  return c;
}

const IDS = ["web", "generation", "higgsfield"];

for (const id of IDS) {
  test(`${id} door (1): shut is one click, one request: POST ${PATHS[id]} {"on":false}`, async () => {
    const m = await mountMap({ id, on: true });
    try {
      await openPanel(m, id);
      assert.equal(m.f.posts().length, 0);
      fire(byWords(m.root, W.shutDoor)[0], "click");
      await settle();
      const posts = m.f.posts();
      assert.equal(posts.length, 1);
      assert.equal(posts[0].method, "POST");
      assert.equal(posts[0].path, PATHS[id]);
      assert.equal(posts[0].body, '{"on":false}');
    } finally { m.done(); }
  });

  test(`${id} door (2): nothing on the way to the confirm opens the door; the yes is inert for 600 ms`, async () => {
    fakeClock();
    const m = await mountMap({ id });
    try {
      const row = doorRow(m.root, id);
      row.focus();
      // Enter on the row: the browser presses the button, which opens the panel and nothing more.
      press(row, "Enter");
      fire(row, "click");
      await settle();
      assert.ok(elements(m.root).some((e) => e.getAttribute("data-panel-door") === id));
      assert.equal(m.f.posts().length, 0, "Enter on the row");
      // Enter on the panel's first stop (Close) closes it; Space on the row and a double click open it again.
      const first = elements(m.root).find((e) => classesOf(e).includes("p-map__close"));
      press(first, "Enter");
      fire(first, "click");
      await settle();
      press(doorRow(m.root, id), " ");
      fire(doorRow(m.root, id), "click");
      fire(doorRow(m.root, id), "click");
      fire(doorRow(m.root, id), "click");
      await settle();
      // The door in the picture: the owner chose photographs over 3D on 18 Nov 2026, so the drawn studio's door (an
      // SVG g) is now the loft's one Doors marker, whose short list names each door; choosing one opens its panel.
      const marker = elements(m.root).find((e) => e.localName === "button" && classesOf(e).includes("o-mark--doors"));
      assert.ok(marker, "the picture has the Doors marker");
      press(marker, "Enter");
      fire(marker, "click");
      await settle();
      const drawn = elements(m.root).find((e) => e.localName === "button" && e.getAttribute("data-door-pick") === id);
      assert.ok(drawn, "the Doors marker lists the door");
      press(drawn, "Enter");
      fire(drawn, "click");
      await settle();
      assert.ok(elements(m.root).some((e) => e.getAttribute("data-panel-door") === id), "the door's panel, and nothing more");
      assert.equal(m.f.posts().length, 0, "row, Enter, Space, double click, the door in the picture");
      // "Open this door": the confirm, and no switch request; focus on its text, not on yes.
      const gets = m.f.calls.length;
      const c = await openConfirm(m);
      assert.equal(m.f.posts().length, 0, "Open this door");
      assert.ok(m.f.calls.slice(gets).some((x) => x.method === "GET" && x.path === VIEW_PATH[id]), "the view Settings reads, read fresh");
      const active = globalThis.document.activeElement;
      assert.ok(active && classesOf(active).includes("p-map__confirm-text"), "focus is on the confirm's text");
      const yes = yesOf(m.root);
      assert.ok(yes, "the confirm has its yes");
      assert.notEqual(active, yes);
      assert.equal(yes.getAttribute("aria-disabled"), "true", "inert at first");
      assert.equal(c.getAttribute("aria-labelledby") !== null && c.getAttribute("aria-describedby") !== null, true);
      // A second press on the row or on "Open this door" while it is open does nothing.
      fire(doorRow(m.root, id), "click");
      fire(byWords(m.root, W.openDoor)[0], "click");
      await settle(50);
      // Enter at once, a click at 300 ms: nothing.
      const enter = press(yes, "Enter");
      assert.equal(enter.defaultPrevented, true, "Enter on the yes is swallowed while it is inert");
      fire(yes, "click");
      clock += 300;
      fire(yes, "click");
      press(yes, " ");
      await settle(50);
      assert.equal(m.f.posts().length, 0, "nothing before 600 ms");
      clock += 400;
      fire(yesOf(m.root), "click");
      await settle();
      const posts = m.f.posts();
      assert.equal(posts.length, 1, "exactly one at 700 ms");
      assert.equal(posts[0].path, PATHS[id]);
      assert.equal(posts[0].body, '{"on":true}');
    } finally { m.done(); }
  });

  test(`${id} door (2): Esc and a click outside cancel; focus goes back to "Open this door"; nothing is sent`, async () => {
    fakeClock();
    const m = await mountMap({ id });
    try {
      await openPanel(m, id);
      let c = await openConfirm(m);
      const ev = press(elements(c).find((e) => classesOf(e).includes("p-map__confirm-text")), "Escape");
      assert.equal(ev.stopped, true, "Esc stops at the confirm: the panel stays open");
      await settle();
      assert.equal(confirmOf(m.root), null);
      assert.ok(elements(m.root).some((e) => e.getAttribute("data-panel-door") === id), "the panel is still open");
      assert.equal(textOf(globalThis.document.activeElement).trim(), W.openDoor);
      c = await openConfirm(m);
      fire(elements(m.root).find((e) => classesOf(e).includes("p-map__confirm-back")), "click");
      await settle();
      assert.equal(confirmOf(m.root), null);
      assert.equal(textOf(globalThis.document.activeElement).trim(), W.openDoor);
      clock += 5000;
      assert.equal(m.f.posts().length, 0);
    } finally { m.done(); }
  });
}

// ---- (3) whole sentences ----

// Every sentence 2.3 names for a door, from the fixture's view and the Settings module, by its source.
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
  test(`${id} door (3): every sentence of the confirm is one whole text node, strictly the source's`, async () => {
    const m = await mountMap({ id });
    try {
      await openPanel(m, id);
      const c = await openConfirm(m);
      const nodes = textNodes(c.parentNode);
      const want = sentencesFor(id, VIEWS[id]);
      for (const s of want) assert.ok(typeof s === "string" && s.length > 0 && nodes.some((t) => t === s), `"${s}" is one text node`);
      // The warning is the module's own export, the same string, not a copy.
      const warning = id === "web" ? WEB.WORDS.leaves : id === "generation" ? GEN.WORDS.sent : GEN.HF_WORDS.sent;
      assert.ok(nodes.includes(warning));
      assert.equal(textOf(elements(c).find((e) => classesOf(e).includes("p-map__confirm-title"))), `Open the ${DOOR_TITLES[id]}?`);
    } finally { m.done(); }
  });
}

test("the confirm's sentences are never cut: no text-overflow, line-clamp, fixed height or overflow: hidden", () => {
  const css = readFileSync(join(PUBLIC, "styles/pages/map.css"), "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const mine = rules.filter((r) => /p-map__confirm(?!-back|-foot)|p-map__door-sentence|p-map__door-line|p-map__money/.test(r.sel));
  assert.ok(mine.length >= 6, "the confirm's rules are found");
  for (const r of mine) {
    assert.doesNotMatch(r.body, /text-overflow|line-clamp|(^|[^-])height\s*:|overflow\s*:\s*hidden|white-space\s*:\s*nowrap/, r.sel);
  }
});

// ---- (4) hostile ----

const HOSTILE = { web: F.webView.hostile, generation: F.generationView.hostile, higgsfield: F.generationView.hostile };
const REFUSED = { web: F.webView.refused, generation: F.generationView.refused, higgsfield: F.generationView.refused };
const shown = (id) => (id === "web" ? [F.HOSTILE[0]] : id === "generation" ? [F.HOSTILE[0], F.HOSTILE[4]] : [F.HOSTILE[2]]);

for (const id of IDS) {
  test(`${id} door (4): a hostile view stays text in the confirm`, async () => {
    const count = (root) => {
      const c = confirmOf(root);
      const els = elements(c.parentNode);
      return { els, tags: ["script", "img", "iframe", "a", "object"].map((t) => els.filter((e) => e.localName === t).length) };
    };
    const plain = await mountMap({ id, view: REFUSED[id] });
    let base;
    try { await openPanel(plain, id); await openConfirm(plain); base = count(plain.root).tags; } finally { plain.done(); }
    const m = await mountMap({ id, view: HOSTILE[id] });
    try {
      await openPanel(m, id);
      await openConfirm(m);
      const { els, tags } = count(m.root);
      assert.deepEqual(tags, base, "no script, img, iframe, a or object beyond the plain view's");
      for (const e of els) {
        for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k} attribute`);
        for (const h of F.HOSTILE) {
          assert.ok(!String(e.getAttribute("href") || "").includes(h), "no href holds the view's text");
          assert.ok(!String(e.getAttribute("style") || "").includes(h), "no style holds the view's text");
        }
      }
      const nodes = textNodes(confirmOf(m.root));
      for (const h of shown(id)) assert.ok(nodes.includes(h), `the hostile sentence is a text node: ${h.slice(0, 30)}`);
    } finally { m.done(); }
  });
}

// ---- (5) the same request as Settings ----

// Settings' own section, driven through the same fake fetch: its switch for this door flipped on.
async function settingsRequest(id) {
  installDom();
  globalThis.window = globalThis;
  globalThis.location = { hash: "#/settings?s=generation", pathname: "/", search: "", replace() {}, assign() {} };
  globalThis.history = { state: null, replaceState() {} };
  const f = stubFetch((path, method) => {
    if (method === "POST") return { status: 200, body: VIEWS[id] };
    if (path === VIEW_PATH[id]) return { status: 200, body: VIEWS[id] };
    return { status: 200, body: { days: [], hasMore: false } };
  });
  const Section = id === "web" ? WEB.default : GEN.default;
  const label = id === "web" ? WEB.WORDS.switchLabel : id === "generation" ? GEN.WORDS.switchLabel : GEN.HF_WORDS.switchLabel;
  const root = new FakeElement("div");
  render(html`<${AppContext.Provider} value=${{ announce() {}, setTop() {} }}><${Section} /><//>`, root);
  await settle();
  try {
    const sw = elements(root).find((e) => e.getAttribute("role") === "switch" && textOf(e).includes(label));
    assert.ok(sw, `Settings draws the switch "${label}"`);
    fire(sw, "click");
    await settle();
    const posts = f.posts();
    assert.equal(posts.length, 1);
    return posts[0];
  } finally { render(null, root); f.restore(); delete globalThis.window; delete globalThis.history; }
}

for (const id of IDS) {
  test(`${id} door (5): the Map's request equals the one Settings sends: method, address, every header, the body's bytes`, async () => {
    const fromSettings = await settingsRequest(id);
    fakeClock();
    const m = await mountMap({ id });
    try {
      await openPanel(m, id);
      await openConfirm(m);
      clock += ARM_MS + 100;
      fire(yesOf(m.root), "click");
      await settle();
      const posts = m.f.posts();
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0], fromSettings);
      assert.equal(posts[0].body, '{"on":true}');
    } finally { m.done(); }
  });
}

// ---- (6) refusals ----

for (const id of ["web", "generation"]) {
  test(`${id} door (6): Settings locks its switch: no yes, that module's blocker lines whole, the link to its section`, async () => {
    const view = REFUSED[id];
    const mod = id === "web" ? WEB : GEN;
    const m = await mountMap({ id, view });
    try {
      await openPanel(m, id);
      const c = await openConfirm(m);
      assert.equal(yesOf(m.root), null, "no yes");
      const lines = mod.blockerLines(view);
      assert.ok(lines.length > 0);
      const nodes = textNodes(c);
      for (const l of lines) assert.ok(nodes.includes(l), `"${l}" whole`);
      const link = elements(c).find((e) => e.localName === "a" && e.getAttribute("href") === doorSettingsHref(id));
      assert.ok(link, "the link to that Settings section");
      assert.equal(m.f.posts().length, 0);
    } finally { m.done(); }
  });
}

test("higgsfield door (6): the server refuses with 409: its message and next as sent, the link, the door still shut", async () => {
  fakeClock();
  const refusal = { message: "Higgsfield is not signed in.", next: "Sign in under Settings, Generation, then try again." };
  const m = await mountMap({ id: "higgsfield", post: () => ({ status: 409, body: { error: { ...refusal, code: "not_signed_in" } } }) });
  try {
    await openPanel(m, "higgsfield");
    await openConfirm(m);
    clock += ARM_MS + 50;
    fire(yesOf(m.root), "click");
    await settle();
    assert.equal(m.f.posts().length, 1);
    const c = confirmOf(m.root);
    const nodes = textNodes(c);
    assert.ok(nodes.includes(refusal.message), "message as sent");
    assert.ok(nodes.includes(refusal.next), "next as sent");
    assert.ok(elements(c).some((e) => e.localName === "a" && e.getAttribute("href") === doorSettingsHref("higgsfield")));
    const row = doorRow(m.root, "higgsfield");
    assert.match(textOf(row), /Shut/, "the door is still shut");
    // A failure changes the confirm's words, so the yes is inert again.
    assert.equal(yesOf(m.root).getAttribute("aria-disabled"), "true");
  } finally { m.done(); }
});

for (const id of IDS) {
  test(`${id} door (6): a view that cannot be read: the error's words and no yes`, async () => {
    const m = await mountMap({ id, viewStatus: 500 });
    try {
      await openPanel(m, id);
      const c = await openConfirm(m);
      const nodes = textNodes(c);
      assert.ok(nodes.includes("The door's settings could not be read."));
      assert.ok(nodes.includes("Try again in a minute."));
      assert.equal(yesOf(m.root), null);
    } finally { m.done(); }
  });
}

// ---- (7) after a success ----

for (const id of IDS) {
  test(`${id} door (7): after a success /api/world is read again and Settings' word for the new state is said`, async () => {
    fakeClock();
    const m = await mountMap({ id });
    try {
      await openPanel(m, id);
      await openConfirm(m);
      const before = m.f.calls.filter((c) => c.path === "/api/world").length;
      clock += ARM_MS + 50;
      fire(yesOf(m.root), "click");
      await settle();
      assert.ok(m.f.calls.filter((c) => c.path === "/api/world").length > before, "/api/world read again");
      const word = id === "web" ? WEB.switchLine(true) : id === "generation" ? GEN.switchLine(true) : GEN.HF_WORDS.on;
      assert.ok(m.said.includes(word), `said "${word}"`);
      assert.equal(confirmOf(m.root), null, "the confirm closes");
      assert.ok(byWords(m.root, W.shutDoor).length === 1, "the panel now offers Shut this door");
    } finally { m.done(); }
  });
}

test("the Settings modules are loaded only by import(), when a door's panel opens; the page never sends { on: true } itself", () => {
  const panel = readFileSync(join(PUBLIC, "map/door-panel.js"), "utf8");
  const page = readFileSync(join(PUBLIC, "pages/map.js"), "utf8");
  assert.doesNotMatch(page, /settings-(web|generation)/, "the page does not name the Settings modules");
  assert.doesNotMatch(panel, /from\s+["']\.\.\/pages\/settings/, "no static import of a Settings module");
  assert.match(panel, /import\("\.\.\/pages\/settings-web\.js"\)/);
  assert.match(panel, /import\("\.\.\/pages\/settings-generation\.js"\)/);
  assert.equal([...panel.matchAll(/on: true/g)].length, 1, "one place sends { on: true }: the confirm's yes");
  assert.match(page, /^(?![\s\S]*on: true)/, "the page sends no { on: true }");
});
