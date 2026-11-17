// Needs you on the desk (PLAN-3D T10), mounted in the test DOM with a fake fetch and the drawn picture (no WebGL2
// here, so the stage stays on its fallback): every action goes over the wire exactly as today's card sends it; the
// keys move focus and never act; a shotlist's approval waits for the confirm, whose yes is inert for 600 ms; the
// money sentences stay whole text nodes; J and K follow the pager; the stack holds twelve and says the rest; hostile
// text stays text; nothing waiting says today's words.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FakeElement, html, render, installDom, elements, classesOf, fire, textOf, walkDom, settle } from "../kit/_dom.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..");
const imp = (f) => import(pathToFileURL(join(PUBLIC, f)).href);
const page = await imp("pages/needs-you.js");
const { AppContext } = await imp("lib/context.js");
const { actBody } = await imp("kit/decision.js");
const { WORDS } = await imp("world/words.js");
const F = await imp("world/fixtures.js");
const SHAPES = (() => { let d = HERE; for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();

const MONEY_LINE = "$3.40 of $10.00 spent today.";
const approval = (id, extra = {}) => ({
  id, kind: "approval", source: "board", severity: "normal", when: "2026-11-11T09:00:00.000Z", version: `v-${id}`,
  title: `Approve the quotation ${id}`, summary: "The Bookkeeper made a quotation for a villa.",
  agent: { slug: "bookkeeper", name: "Bookkeeper" }, department: "books", link: { page: "tasks", id: `t-${id}` },
  actions: [
    { id: "approve", label: "Approve", style: "primary", needsNote: false },
    { id: "send_back", label: "Send back", style: "plain", needsNote: true },
    { id: "dismiss", label: "Hide", style: "plain", needsNote: false },
  ],
  ...extra,
});

// A film's shotlist as the home server sends it (shapes/shotlist-item.json), its money as sent.
const SHAPE = JSON.parse(readFileSync(join(SHAPES, "shotlist-item.json"), "utf8"));
const shot = (n) => ({ id: `s0${n}`, render: "tower.png", seconds: 5, move: "A slow push.", prompt: "The camera moves.", kind: "image_to_video", best: false, model: "gen4_turbo", credits: 25 });
const COST_WORDS = "2 clips, 10 seconds: about $0.50, up to $1.00 with one retake each.";
const COST_TIME = "Runway takes a few minutes a clip.";
const variant = (id, title) => ({
  id, direction: { id: `d-${id}`, title }, preview: [], brand: { result: "pass", lines: [] },
  review: { scores: { brand: 8 }, total: 52, of: 70, meets: true, reason: "calm" },
  shotlist: { title: `Film ${id}`, seconds: 10, ratio: "1280:720", shots: [shot(1), shot(2)], cards: null },
  boards: [{ shot: "s01", url: `/api/view/b${id}1` }],
  cost: { base: 50, most: 100, words: COST_WORDS, time: COST_TIME },
  approvable: true, blocked: null,
});
const SHOTLIST = {
  ...SHAPE, id: "staged:shotlist:g1", version: "v1", round: 1, missing: [], department: "studio",
  actions: [{ id: "approve", label: "Approve this one and its cost" }, { id: "another", label: "Another round" }, { id: "send_back", label: "Send all back" }],
  variants: [variant("a", "Slow approach"), variant("b", "Details first")],
};

const inboxOf = (items) => ({ items, counts: { total: items.length }, notConnected: [], generatedAt: "2026-11-16T19:42:00.000Z" });
const departments = [{ id: "books", title: "Books", agents: [{ slug: "bookkeeper" }] }, { id: "studio", title: "Studio", agents: [{ slug: "artist" }] }];

// ---- the page, mounted: a document whose key listeners can be fired, a wide window (or a phone), a fake fetch.
function mountDom({ wide = true, phone = false, hash = "#/needs-you" } = {}) {
  installDom();
  const doc = globalThis.document;
  const keyListeners = [];
  doc.addEventListener = (t, f) => { if (t === "keydown") keyListeners.push(f); };
  doc.removeEventListener = (t, f) => { const i = keyListeners.indexOf(f); if (i >= 0) keyListeners.splice(i, 1); };
  doc.getElementById = () => null;
  doc.querySelector = () => null;
  globalThis.location = { hash, search: "" };
  globalThis.matchMedia = (q) => ({ matches: q.includes("min-width: 1280px") ? wide : q.includes("max-width: 859px") ? phone : false, addEventListener() {}, removeEventListener() {} });
  return {
    key(k) {
      const ev = { key: k, target: doc.activeElement || doc.body, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const f of [...keyListeners]) f(ev);
      return ev;
    },
  };
}
const mounted = [];
afterEach(() => {
  // Unmounted, so the page's 10 s polls stop and the run ends.
  while (mounted.length) render(null, mounted.pop());
  delete globalThis.location;
  delete globalThis.matchMedia;
  if (globalThis.__realFetch) { globalThis.fetch = globalThis.__realFetch; delete globalThis.__realFetch; }
});

function fakeFetch({ inbox, world = F.seed.world, story = null }) {
  const calls = [];
  globalThis.__realFetch = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    calls.push({ path, method: opts.method, headers: opts.headers, body: opts.body === undefined ? undefined : JSON.parse(opts.body) });
    let body = { ok: true };
    if (path === "/api/inbox") body = inbox;
    else if (path === "/api/map") body = { departments };
    else if (path === "/api/world") body = world;
    else if (path.startsWith("/api/tasks/")) body = story || { conversation: [] };
    else if (path === "/api/inbox/act") body = { ok: true, message: "Approved." };
    return { ok: true, status: 200, json: async () => body };
  };
  return calls;
}

async function mount({ query = "", top = [], ...rest } = {}) {
  const root = new FakeElement("div");
  const app = { setTop: (t) => top.push(t), refreshShell() {}, announce() {}, settings: { theme: "dark", motion: "off" } };
  render(html`<${AppContext.Provider} value=${app}><${page.default} route=${{ query: new URLSearchParams(query) }} /><//>`, root);
  mounted.push(root);
  for (let i = 0; i < 4; i++) await settle(120);
  return root;
}
const posts = (calls) => calls.filter((c) => c.method === "POST");
const button = (root, words) => elements(root).find((e) => e.localName === "button" && textOf(e).trim() === words);
const buttonStarting = (root, words) => elements(root).find((e) => e.localName === "button" && textOf(e).trim().startsWith(words));
const textNodes = (root) => [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);

test("an approval's primary posts to /api/inbox/act exactly { id, action, version }, as today's card does", async () => {
  mountDom();
  const calls = fakeFetch({ inbox: inboxOf([approval("a1"), approval("a2")]) });
  const root = await mount();
  assert.ok(elements(root).some((e) => classesOf(e).includes("p-needs-you__sheet")), "the item opened is on the paper sheet");
  fire(button(root, "Approve"), "click");
  await settle();
  const sent = posts(calls);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, "/api/inbox/act");
  assert.deepEqual(sent[0].body, actBody("a1", "approve", undefined, "v-a1"));
  assert.deepEqual(Object.keys(sent[0].body).sort(), ["action", "id", "version"]);
  assert.equal(sent[0].headers["X-Engine"], "1");
});

test("A moves focus to the primary and posts nothing; A and then Enter on it posts once; D goes to Send back", async () => {
  const dom = mountDom();
  const calls = fakeFetch({ inbox: inboxOf([approval("a1"), approval("a2")]) });
  const root = await mount();
  const ev = dom.key("a");
  assert.equal(ev.defaultPrevented, true);
  const primary = globalThis.document.activeElement;
  assert.equal(primary, button(root, "Approve"), "focus is on the card's primary");
  await settle();
  assert.equal(posts(calls).length, 0, "A acts on nothing");
  dom.key("d");
  assert.equal(globalThis.document.activeElement, button(root, "Send back"), "D: the send-back control");
  await settle();
  assert.equal(posts(calls).length, 0, "D acts on nothing");
  dom.key("a");
  // Enter on a focused button is the browser's click on it.
  fire(globalThis.document.activeElement, "click");
  await settle();
  assert.equal(posts(calls).length, 1, "Enter on the primary sends once");
  assert.deepEqual(posts(calls)[0].body, { id: "a1", action: "approve", version: "v-a1" });
});

test("J and K (and Down and Up) change the address to the pager's next and previous", async () => {
  const dom = mountDom({ hash: "#/needs-you?item=a2" });
  const items = [approval("a1", { when: "2026-11-11T09:00:00.000Z" }), approval("a2", { when: "2026-11-11T08:00:00.000Z" }), approval("a3", { when: "2026-11-11T07:00:00.000Z" })];
  fakeFetch({ inbox: inboxOf(items) });
  await mount({ query: "item=a2" });
  dom.key("j");
  assert.equal(globalThis.location.hash, "#/needs-you?item=a3");
  dom.key("k");
  assert.equal(globalThis.location.hash, "#/needs-you?item=a1");
  globalThis.location.hash = "x";
  dom.key("ArrowDown");
  assert.equal(globalThis.location.hash, "#/needs-you?item=a3");
  dom.key("ArrowUp");
  assert.equal(globalThis.location.hash, "#/needs-you?item=a1");
  assert.deepEqual(page.keyIntent("x", { pager: { next: "#n" }, opened: true }), null);
});

test("a shotlist's approve posts nothing until the confirm's yes: nothing at once or at 300 ms, once at 700 ms, with its variant", async () => {
  mountDom({ hash: "#/needs-you?item=staged%3Ashotlist%3Ag1" });
  const calls = fakeFetch({ inbox: inboxOf([SHOTLIST, approval("a1")]) });
  const root = await mount({ query: "item=staged%3Ashotlist%3Ag1" });
  assert.ok(elements(root).some((e) => classesOf(e).includes("p-needs-you__sheet--wide")), "a whole stage is a wide sheet over the desk");
  fire(buttonStarting(root, "Approve A and its cost"), "click");
  const opened = Date.now();
  await settle(60);
  assert.equal(posts(calls).length, 0, "opening the confirm sends nothing");
  const yes = buttonStarting(root, "Approve and spend up to $1.00");
  assert.ok(yes, "the confirm's yes");
  fire(yes, "click");
  await new Promise((r) => setTimeout(r, Math.max(0, 300 - (Date.now() - opened))));
  fire(yes, "click");
  await settle(60);
  assert.equal(posts(calls).length, 0, "nothing at once or at 300 ms");
  // The money sentences, as sent, are each one whole text node while the confirm is open.
  const nodes = textNodes(root);
  assert.ok(nodes.includes(COST_WORDS), "the cost's words whole");
  await new Promise((r) => setTimeout(r, Math.max(0, 700 - (Date.now() - opened))));
  fire(yes, "click");
  await settle();
  const sent = posts(calls);
  assert.equal(sent.length, 1, "exactly once at 700 ms");
  assert.deepEqual(sent[0].body, { id: "staged:shotlist:g1", action: "approve", version: "v1", variant: "a" });
});

test("the money line: the server's sentence to the top bar, and on a phone one whole line on the page", async () => {
  mountDom();
  fakeFetch({ inbox: inboxOf([approval("a1")]) });
  const top = [];
  await mount({ top });
  assert.equal(top.at(-1).note, MONEY_LINE, "setTop({ note }) with the server's line");
  mountDom({ wide: false, phone: true });
  fakeFetch({ inbox: inboxOf([approval("a1")]) });
  const root = await mount();
  const line = elements(root).find((e) => classesOf(e).includes("p-needs-you__money"));
  assert.ok(line, "the line stands on the page");
  assert.deepEqual(line.childNodes.map((n) => [n.nodeType, n.data]), [[3, MONEY_LINE]], "one whole text node, as sent");
  assert.ok(elements(root).some((e) => classesOf(e).includes("p-needs-you__strip")), "the desk strip over the list");
});

test("with 40 waiting the stack holds 12 sheets and says 28 more", async () => {
  mountDom();
  const items = Array.from({ length: 40 }, (_, i) => approval(`x${i}`));
  fakeFetch({ inbox: inboxOf(items) });
  const root = await mount();
  const stack = elements(root).find((e) => e.getAttribute("data-part") === "stack");
  assert.ok(stack, "the drawn desk's stack");
  assert.equal(stack.getAttribute("data-sheets"), "12");
  assert.ok(textNodes(root).includes(page.moreWords(28)), "\"28 more\" is said");
  assert.equal(page.moreWords(28), "28 more");
  const stage = elements(root).find((e) => classesOf(e).includes("w-stage"));
  assert.equal(stage.getAttribute("data-world"), "fallback");
  assert.equal(stage.getAttribute("aria-hidden"), "true");
});

test("the keys line is inside the sheet, after the card, in the words of world/words.js", async () => {
  mountDom();
  fakeFetch({ inbox: inboxOf([approval("a1")]) });
  const root = await mount();
  const sheet = elements(root).find((e) => classesOf(e).includes("p-needs-you__sheet"));
  const keys = elements(sheet).find((e) => classesOf(e).includes("p-needs-you__keys"));
  assert.ok(keys, "inside the sheet");
  assert.equal(sheet.getAttribute("data-surface"), "paper", "the sheet is the kit's paper scope");
  assert.equal(textOf(keys), WORDS.keys);
  assert.equal(sheet.childNodes.filter((n) => n.nodeType === 1).at(-1), keys, "at the sheet's foot");
});

test("after an action the desk's top sheet goes into its room or to the tray; no Undo anywhere", () => {
  assert.deepEqual(page.deskEvent({ action: "approve", item: approval("a1") }, departments), { type: "approve", room: "books", animate: true });
  assert.deepEqual(page.deskEvent({ action: "accept", item: { id: "x", source: "board" } }, departments), { type: "approve", room: null, animate: true });
  for (const a of ["pick", "answer"]) assert.equal(page.deskEvent({ action: a, item: approval("a1") }, departments).type, "approve");
  for (const a of ["send_back", "reject", "dismiss", "another", ""]) assert.deepEqual(page.deskEvent({ action: a }, departments), { type: "aside", animate: true });
  assert.deepEqual(page.keyTargets(approval("a1")), { primary: "Approve", decline: "Send back" });
  assert.deepEqual(page.keyTargets({ actions: [{ id: "accept", label: "Accept", style: "primary" }, { id: "reject", label: "Decline" }] }), { primary: "Accept", decline: "Decline" });
  const src = readFileSync(join(PUBLIC, "pages", "needs-you.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /\bUndo\b|\bundo\b/);
  assert.doesNotMatch(src, /Stop spending|api\/spending/);
});

// ---- hostile text (section 3): titles, summaries, an agent's name and the story's entries
const BAD_TAGS = ["script", "img", "iframe", "object"];
function census(root) {
  const count = {};
  for (const e of elements(root)) if (BAD_TAGS.includes(e.localName)) count[e.localName] = (count[e.localName] || 0) + 1;
  return count;
}
function storyOf(words) {
  return { conversation: words.map((w, i) => ({ who: { slug: "bookkeeper", name: w }, kind: "comment", text: w, at: `2026-11-1${i % 9}T00:00:00.000Z` })) };
}
test("hostile titles, summaries, names and story entries stay text: no new element, no on* attribute, no href, src or style with them", async () => {
  const H = F.HOSTILE;
  const itemsOf = (words) => words.map((w, i) => approval(`h${i}`, { title: w, summary: w, agent: { slug: "bookkeeper", name: w }, raisedBy: w, identifier: w, link: { page: "tasks", id: "t1" } }));
  mountDom();
  fakeFetch({ inbox: inboxOf(itemsOf(H.map((_, i) => `Plain ${i}`))), story: storyOf(H.map((_, i) => `Plain ${i}`)) });
  const plain = await mount();
  const before = census(plain);
  mountDom();
  fakeFetch({ inbox: inboxOf(itemsOf(H)), story: storyOf(H), world: F.hostile.world });
  const root = await mount();
  assert.deepEqual(census(root), before, "no script, img, iframe or object the plain page did not have");
  const all = textNodes(root).join("\n");
  for (const h of H.slice(0, 5)) assert.ok(all.includes(h), `${h} is shown as text`);
  for (const e of elements(root)) {
    for (const [k, v] of Object.entries(e.attrs)) {
      assert.ok(!/^on/i.test(k), `no ${k} attribute`);
      if (k === "href" || k === "src" || k === "style") for (const h of H) assert.ok(!v.includes(h.slice(0, 40)), `${k} holds no fixture text`);
    }
  }
});

test("nothing waiting: today's words and Open Tasks on a small sheet over the desk", async () => {
  mountDom();
  fakeFetch({ inbox: inboxOf([]), world: F.allOff.world });
  const root = await mount();
  assert.ok(textNodes(root).includes(page.PAGE_WORDS.empty));
  assert.ok(textNodes(root).includes(page.PAGE_WORDS.emptyLine));
  assert.ok(elements(root).some((e) => classesOf(e).includes("p-needs-you__sheet--small")));
  assert.ok(elements(root).some((e) => classesOf(e).includes("w-stage")), "the desk behind it");
});
