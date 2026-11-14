// PLAN-V5 K14, T45: the shotlist card (kit/shotlist.js). Its pure helpers (the confirm words from a cost, the approve
// label, why a treatment is blocked and the link for it, the shots as rows, the act body, where Studio is) and the card
// mounted in a very small DOM: three treatments with one "Approve this one and its cost" each, an agent's words only as
// text, a board only from the server's address, the confirm that says the most Runway may charge, the approval sent with
// its version and variant, the refusals in the server's words, and the item shape the home server sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(PUBLIC, "kit");
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);
const sl = await import(pathToFileURL(join(KIT, "shotlist.js")).href);
const index = await import(pathToFileURL(join(KIT, "index.js")).href);

// ---- A very small DOM, enough for Preact to render into and for us to walk. ----
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
class FakeText extends FakeNode {
  constructor(d) { super(); this.nodeType = 3; this.data = String(d); }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.localName = tag;
    this.attrs = {};
    this.style = { cssText: "", setProperty(k, v) { this[k] = v; } };
    this.listeners = {};
  }
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
function installDom() {
  const doc = {
    title: "", activeElement: null,
    createElement: (t) => new FakeElement(t),
    createElementNS: (_ns, t) => new FakeElement(t),
    createTextNode: (d) => new FakeText(d),
    addEventListener() {}, removeEventListener() {},
  };
  doc.body = new FakeElement("body");
  globalThis.document = doc;
}
function* walk(node) { yield node; for (const c of node.childNodes) yield* walk(c); }
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");
const settle = () => new Promise((r) => setTimeout(r, 110));
async function showTree(Component, props) {
  installDom();
  const root = new FakeElement("div");
  render(html`<${Component} ...${props} />`, root);
  await settle();
  return root;
}
function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName} listens for ${type}`);
  const ev = { type: key, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra };
  for (const f of el.listeners[key]) f.call(el, ev);
}
const buttons = (root, words) => elements(root).filter((e) => e.localName === "button" && textOf(e).trim() === words);
function stubFetch(answers) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    const a = answers(path, opts.method, calls.length);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}


// ---- The item as the home server sends it (shapes/shotlist-item.json), made a little richer. ----
const SHAPE = JSON.parse(readFileSync(join(SHAPES, "shotlist-item.json"), "utf8"));
const img = (t) => `/api/view/${t}`;
const shotOf = (n, extra = {}) => ({ id: `s0${n}`, render: "tower.png", seconds: 5, move: "A slow push.", prompt: "The camera moves slowly.", kind: "image_to_video", best: false, model: "gen4_turbo", credits: 25, ...extra });
const variant = (id, title, extra = {}) => ({
  id, direction: { id: `d-${id}`, title }, preview: [], brand: { result: "pass", lines: [] },
  review: { scores: { brand: 8, hierarchy: 7, composition: 8, finish: 7, idea: 7, voice: 8, kind: 7 }, total: 52, of: 70, meets: true, reason: "calm" },
  shotlist: { title: `Film ${id}`, seconds: 10, ratio: "1280:720", shots: [shotOf(1), shotOf(2, { kind: "text_to_video", best: true, render: undefined })], cards: null },
  boards: [{ shot: "s01", url: img(`b${id}1`) }, { shot: "s02", url: img(`b${id}2`) }],
  cost: { base: 50, most: 100, words: "2 clips, 10 seconds: about $0.50, up to $1.00 with one retake each.", time: "Runway takes a few minutes a clip." },
  approvable: true, blocked: null, ...extra,
});
const ITEM = {
  ...SHAPE, id: "staged:shotlist:g1", version: "v1", round: 1, missing: [],
  actions: [{ id: "approve", label: "Approve this one and its cost" }, { id: "another", label: "Another round" }, { id: "send_back", label: "Send all back" }],
  variants: [variant("c", "<b>Day of light</b>"), variant("a", "Slow approach"), variant("b", "Details first", { approvable: false, blocked: "This costs more than is left of today's limit ($0.40). Raise it in Settings, or approve it tomorrow." })],
};

// ---- Pure helpers ----

test("confirmWords: the most Runway may charge, from the server's own numbers", () => {
  const w = sl.confirmWords(variant("a", "Slow approach"));
  assert.equal(w.title, "Approve Slow approach?");
  assert.equal(w.body, "Runway may charge up to $1.00 for its 2 clips and one retake each. Nothing else is spent without you.");
  assert.equal(w.button, "Approve and spend up to $1.00");
  const one = sl.confirmWords(variant("a", "One", { shotlist: { shots: [shotOf(1)] }, cost: { most: 20 } }));
  assert.match(one.body, /for its 1 clip and/);
  assert.equal(sl.confirmWords(variant("a", "x", { cost: null })), null);
  assert.equal(sl.confirmWords(variant("a", "x", { shotlist: null })), null);
  assert.equal(sl.confirmWords(variant("a", "x", { cost: { most: "300" } })), null);
  assert.equal(sl.creditsDollars(370), "$3.70");
  assert.equal(sl.creditsDollars(null), "");
});

test("approveLabel names the treatment for a screen reader", () => {
  assert.equal(sl.approveLabel({ letter: "B", title: "Details first" }), "Approve this one and its cost: version B, Details first");
});

test("blockedOf: the server's sentence, and a link only when it is about Settings or Health", () => {
  assert.deepEqual(sl.blockedOf(ITEM.variants[2]), { text: ITEM.variants[2].blocked, link: { href: "#/settings", label: "Open Settings" } });
  assert.equal(sl.blockedOf({ blocked: "Generation is off or has no key yet. Open Settings." }).link.href, "#/settings");
  assert.equal(sl.blockedOf({ blocked: "The spending ledger cannot be read, so nothing will be made. Health shows what to do." }).link.href, "#/health");
  assert.equal(sl.blockedOf({ blocked: "A render is missing: dock.png." }).link, null);
  assert.equal(sl.blockedOf({ blocked: null }), null);
  assert.equal(sl.refusalLink({ code: "over_limit" }).href, "#/settings");
  assert.equal(sl.refusalLink({ code: "job_not_ready" }).href, "#/settings");
  assert.equal(sl.refusalLink({ code: "shotlist_problem" }), null);
});

test("sharedBlock: one reason for every treatment is said once; different reasons are not shared", () => {
  const off = "Generation is off or has no key yet. Open Settings.";
  assert.equal(sl.sharedBlock({ variants: [variant("a", "A", { blocked: off }), variant("b", "B", { blocked: off })] }).text, off);
  assert.equal(sl.sharedBlock(ITEM), null);
  assert.equal(sl.sharedBlock({ variants: [variant("a", "A", { blocked: off })] }), null);
});

test("shotRows: each shot with its board, words alone and best marked; only the server's addresses", () => {
  const v = variant("a", "A", { boards: [{ shot: "s01", url: img("x") }, { shot: "s02", url: "/files/x.png" }] });
  const rows = sl.shotRows(v);
  assert.deepEqual(rows.map((r) => [r.label, r.credits, r.wordsAlone, r.best, r.board]), [["s01 · 5 s", 25, false, false, "/api/view/x"], ["s02 · 5 s", 25, true, true, ""]]);
  assert.deepEqual(sl.boardRows(v), [{ shot: "s01", url: "/api/view/x" }]);
  assert.equal(sl.foldsPrompt("x".repeat(200)), true);
  assert.equal(sl.foldsPrompt("short"), false);
  assert.equal(sl.factsOf(variant("a", "A")), "10 s · 2 clips · 1280:720");
});

test("shotlistBody, offers, goalIdOf and studioHref", () => {
  assert.deepEqual(sl.shotlistBody(ITEM, "approve", "Go.", "a"), { id: "staged:shotlist:g1", action: "approve", note: "Go.", version: "v1", variant: "a" });
  assert.deepEqual(sl.shotlistBody(ITEM, "another", "", "a"), { id: "staged:shotlist:g1", action: "another", version: "v1" });
  assert.deepEqual(sl.shotlistBody(ITEM, "approve", "", "z"), { id: "staged:shotlist:g1", action: "approve", version: "v1" });
  assert.equal(sl.cardOffers({ actions: [{ id: "send_back" }] }, "another"), false);
  assert.equal(sl.cardOffers({}, "another"), true);
  assert.equal(sl.goalIdOf(ITEM), "g1");
  assert.equal(sl.studioHref(ITEM), "#/dashboards/studio?film=g1");
  assert.equal(sl.studioHref({ id: "x", link: { id: "../y" } }), "#/dashboards/studio");
  assert.equal(sl.isShotlistItem(ITEM), true);
  assert.equal(sl.isShotlistItem({ ...ITEM, kind: "pick" }), false);
  assert.equal(sl.isShotlistItem({ id: "q", kind: "shotlist", variants: [] }), true);
  assert.equal(sl.limitLines({ details: [{ label: "Today's limit", value: "300" }, { label: "Treatments", value: "x" }] }).length, 1);
});

test("the shape file's item is a shotlist item and DecisionCard is the one card for it", () => {
  assert.equal(sl.isShotlistItem(SHAPE), true);
  assert.equal(index.DecisionCard, sl.DecisionOrShotlist);
  assert.equal(typeof index.ShotlistCard, "function");
});

// ---- Mounted ----

test("the card: three treatments in a to c order, one approve button each but the blocked one, which says why", async () => {
  const root = await showTree(sl.ShotlistCard, { item: ITEM });
  const all = textOf(root);
  assert.equal(buttons(root, "Approve this one and its cost").length, 2);
  assert.ok(all.indexOf("Slow approach") < all.indexOf("Details first") && all.indexOf("Details first") < all.indexOf("Day of light"));
  assert.match(all, /This costs more than is left of today's limit \(\$0\.40\)/);
  assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/settings"), "a link to Settings");
  assert.match(all, /2 clips, 10 seconds: about \$0.50/);
  assert.match(all, /Runway takes a few minutes a clip\./);
  assert.match(all, /Made from words alone/);
  assert.match(all, /Best model/);
  assert.match(all, /s01 · 5 s/);
  assert.equal(buttons(root, "Another round").length, 1);
  assert.equal(buttons(root, "Send all back").length, 1);
});

test("the card: an agent's words are text, never markup; a board only from the server's address", async () => {
  const bad = { ...ITEM, variants: [variant("a", "<b>Slow</b>", { shotlist: { title: "<i>t</i>", shots: [shotOf(1, { prompt: "<img src=x onerror=alert(1)>", move: "<u>m</u>" })] }, boards: [{ shot: "s01", url: "/api/view/ok" }, { shot: "s01", url: "/files/a.png" }] })] };
  const root = await showTree(sl.ShotlistCard, { item: bad });
  assert.match(textOf(root), /<b>Slow<\/b>/);
  assert.match(textOf(root), /<img src=x onerror=alert\(1\)>/);
  assert.ok(!elements(root).some((e) => ["b", "i", "u"].includes(e.localName)));
  const srcs = elements(root).filter((e) => e.localName === "img").map((e) => e.src ?? e.getAttribute("src"));
  assert.ok(srcs.length > 0 && srcs.every((s) => s === "/api/view/ok"), JSON.stringify(srcs));
  assert.doesNotMatch(readFileSync(join(KIT, "shotlist.js"), "utf8"), /dangerouslySetInnerHTML|innerHTML/);
});

test("the card: Approve opens the confirm; nothing is sent until its button; then the approval goes with its version and variant", async () => {
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Approved. whatever the server says" } }));
  try {
    let got = null;
    const root = await showTree(sl.ShotlistCard, { item: ITEM, onDone: (r) => { got = r; } });
    fire(buttons(root, "Approve this one and its cost")[0], "click");
    await settle();
    assert.equal(f.calls.length, 0, "opening the confirm sends nothing");
    const page = textOf(root);
    assert.match(page, /Approve Slow approach\?/);
    assert.match(page, /Runway may charge up to \$1\.00 for its 2 clips and one retake each\. Nothing else is spent without you\./);
    const yes = elements(root).find((e) => e.localName === "button" && textOf(e).trim() === "Approve and spend up to $1.00");
    assert.ok(yes, "the confirm button");
    assert.ok(elements(root).some((e) => e.localName === "button" && textOf(e).trim() === "Not yet"));
    fire(yes, "click");
    await settle();
    assert.deepEqual(f.calls.at(-1).body, { id: "staged:shotlist:g1", action: "approve", version: "v1", variant: "a" });
    assert.match(textOf(root), /Approved\. The Artist will make the clips\. You can follow them in Studio\./);
    assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/dashboards/studio?film=g1"));
    assert.equal(got.variant, "a");
    assert.equal(got.done.kind, "shotlist");
  } finally {
    f.restore();
  }
});

test("the card: a refused approval shows the server's sentence with a link to Settings, and sends nothing again", async () => {
  const f = stubFetch(() => ({ status: 409, body: { error: { message: "This costs more than is left of today's limit ($0.10). Raise it in Settings, or approve it tomorrow.", next: "Open Settings, then look at the card again.", code: "over_limit" } } }));
  try {
    const root = await showTree(sl.ShotlistCard, { item: ITEM });
    fire(buttons(root, "Approve this one and its cost")[0], "click");
    await settle();
    fire(elements(root).find((e) => e.localName === "button" && /^Approve and spend/.test(textOf(e).trim())), "click");
    await settle();
    assert.equal(f.calls.length, 1);
    assert.match(textOf(root), /This costs more than is left of today's limit \(\$0\.10\)/);
    assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/settings"));
    assert.equal(buttons(root, "Approve this one and its cost").length, 2, "the card is still there to act on");
  } finally {
    f.restore();
  }
});

test("the card: Send all back needs a note, and sends it with send_back", async () => {
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Sent back with your note. The Chief of staff will pick it up." } }));
  try {
    const root = await showTree(sl.ShotlistCard, { item: ITEM });
    fire(buttons(root, "Send all back")[0], "click");
    await settle();
    assert.equal(f.calls.length, 0);
    assert.match(textOf(root), /Send all back needs a note/);
    fire(elements(root).find((e) => e.localName === "textarea"), "input", { currentTarget: { value: "Warmer." } });
    await settle();
    fire(buttons(root, "Send all back")[0], "click");
    await settle();
    assert.deepEqual(f.calls.at(-1).body, { id: "staged:shotlist:g1", action: "send_back", note: "Warmer.", version: "v1" });
    assert.match(textOf(root), /Sent back with your note/);
  } finally {
    f.restore();
  }
});

test("the card: a problem card with no treatments says what is wrong and still offers its actions", async () => {
  const root = await showTree(sl.ShotlistCard, { item: { ...ITEM, variants: [], problem: "The treatments' files are missing, so there is nothing to approve.", actions: [{ id: "send_back", label: "Send all back" }] } });
  assert.match(textOf(root), /files are missing/);
  assert.equal(buttons(root, "Approve this one and its cost").length, 0);
  assert.equal(buttons(root, "Another round").length, 0);
  assert.equal(buttons(root, "Send all back").length, 1);
});
