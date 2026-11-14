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
  assert.deepEqual(sl.blockedOf(ITEM.variants[2]), { text: ITEM.variants[2].blocked, link: { href: "#/settings?s=generation", label: "Open Settings" } });
  assert.equal(sl.blockedOf({ blocked: "Generation is off or has no key yet. Open Settings." }).link.href, "#/settings?s=generation");
  assert.equal(sl.blockedOf({ blocked: "The spending ledger cannot be read, so nothing will be made. Health shows what to do." }).link.href, "#/health");
  assert.equal(sl.blockedOf({ blocked: "A render is missing: dock.png." }).link, null);
  assert.equal(sl.blockedOf({ blocked: null }), null);
  assert.equal(sl.refusalLink({ code: "over_limit" }).href, "#/settings?s=generation");
  assert.equal(sl.refusalLink({ code: "job_not_ready" }).href, "#/settings?s=generation");
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

test("the card: three treatments in a to c order on one strip; one on the stage; one approve; the blocked one says why", async () => {
  const root = await showTree(sl.ShotlistCard, { item: ITEM });
  const all = textOf(root);
  const radios = elements(root).filter((e) => e.getAttribute("role") === "radio");
  assert.equal(radios.length, 3, "one card a treatment");
  assert.deepEqual(radios.map((r) => r.getAttribute("aria-checked")), ["true", "false", "false"], "the first is on the stage");
  assert.ok(all.indexOf("Slow approach") < all.indexOf("Details first") && all.indexOf("Details first") < all.indexOf("Day of light"));
  assert.equal(buttons(root, "Approve A and its cost").length, 1, "one approve, for the treatment on the stage");
  assert.equal(buttons(root, "Approve this one and its cost").length, 0);
  // O9: with the server's numbers the money block is drawn and its cost sentence waits for the confirm.
  assert.match(all, /Treatment A costs/);
  assert.doesNotMatch(all, /2 clips, 10 seconds: about \$0.50/);
  assert.match(all, /Runway takes a few minutes a clip\./);
  assert.match(all, /Made from words alone/);
  assert.match(all, /Best model/);
  assert.match(all, /s01 · A slow push\./);
  assert.match(all, /52 of 70, meets the bar: calm/);
  assert.equal(buttons(root, "Another round").length, 1);
  assert.equal(buttons(root, "Send all back").length, 1);
  // B cannot be approved: choosing it puts it on the stage and locks the approval with the server's sentence.
  fire(radios[1], "click");
  await settle();
  const now = textOf(root);
  assert.equal(buttons(root, "Approve B and its cost").length, 0);
  assert.ok(elements(root).some((e) => /\bk-locked\b/.test(e.getAttribute("class") || "")), "the approval is locked");
  assert.match(now, /This costs more than is left of today's limit \(\$0\.40\)/);
  assert.equal(buttons(root, "Pick A instead, it fits today").length, 1, "the way out that works");
  assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/settings?s=generation" && textOf(e).trim() === "Raise today's limit"), "a link to raise the limit");
});

test("the card: an agent's words are text, never markup; a board only from the server's address", async () => {
  const bad = { ...ITEM, variants: [variant("a", "<b>Slow</b>", { shotlist: { title: "<i>t</i>", shots: [shotOf(1, { prompt: "<img src=x onerror=alert(1)>", move: "<u>m</u>" })] }, boards: [{ shot: "s01", url: "/api/view/ok" }, { shot: "s01", url: "/files/a.png" }] })] };
  const root = await showTree(sl.ShotlistCard, { item: bad });
  assert.match(textOf(root), /<b>Slow<\/b>/);
  assert.match(textOf(root), /<img src=x onerror=alert\(1\)>/);
  // The only b, i or u elements are the kit's own empty marks (the meter's parts and its tick), never an agent's.
  const marks = elements(root).filter((e) => ["b", "i", "u"].includes(e.localName));
  assert.ok(marks.every((e) => textOf(e) === "" && /^k-/.test(e.getAttribute("class") || "")), JSON.stringify(marks.map((e) => e.localName)));
  const srcs = elements(root).filter((e) => e.localName === "img").map((e) => e.src ?? e.getAttribute("src"));
  assert.ok(srcs.length > 0 && srcs.every((s) => s === "/api/view/ok"), JSON.stringify(srcs));
  assert.doesNotMatch(readFileSync(join(KIT, "shotlist.js"), "utf8"), /dangerouslySetInnerHTML|innerHTML/);
});

test("the card: Approve opens the confirm; nothing is sent until its button; then the approval goes with its version and variant", async () => {
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Approved. whatever the server says" } }));
  try {
    let got = null;
    const root = await showTree(sl.ShotlistCard, { item: ITEM, onDone: (r) => { got = r; } });
    fire(buttons(root, "Approve A and its cost")[0], "click");
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
    fire(buttons(root, "Approve A and its cost")[0], "click");
    await settle();
    fire(elements(root).find((e) => e.localName === "button" && /^Approve and spend/.test(textOf(e).trim())), "click");
    await settle();
    assert.equal(f.calls.length, 1);
    assert.match(textOf(root), /This costs more than is left of today's limit \(\$0\.10\)/);
    assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/settings?s=generation"));
    assert.equal(buttons(root, "Approve A and its cost").length, 1, "the card is still there to act on");
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
  assert.equal(elements(root).filter((e) => e.localName === "button" && /^Approve/.test(textOf(e).trim())).length, 0);
  assert.equal(buttons(root, "Another round").length, 0);
  assert.equal(buttons(root, "Send all back").length, 1);
});

// ---- PLAN-COOK T40: the stage, the strip and the one decision ----

const GEN = { on: true, key: true, daily: 300, monthly: 1000, dayLeft: 100, monthLeft: 630 };
const OVER = "This costs more than is left of today's limit ($1.00). Raise it in Settings, or approve it tomorrow.";
// A over today's limit, B over too, C fits: the numbers of section 4's first vector.
const LAKE = {
  ...ITEM, generation: GEN,
  variants: [
    variant("a", "Slow approach", { cost: { base: 185, most: 370, words: "6 clips, 30 seconds: about $1.85, up to $3.70 with one retake each.", time: "Runway takes a few minutes a clip." }, approvable: false, blocked: OVER }),
    variant("b", "Detail to whole", { cost: { base: 240, most: 480, words: "3 clips: about $2.40.", time: "" }, approvable: false, blocked: OVER }),
    variant("c", "Day of light", { cost: { base: 100, most: 200, words: "4 clips: about $1.00.", time: "" } }),
  ],
};
const ALL_OVER = { ...LAKE, variants: LAKE.variants.map((v) => (v.id === "c" ? { ...v, cost: { ...v.cost, base: 120 }, approvable: false, blocked: OVER } : v)) };
const hasClass = (e, c) => (e.getAttribute("class") || "").split(/\s+/).includes(c);
const within = (root, c) => elements(root).find((e) => hasClass(e, c));
const primaries = (root) => elements(within(root, "k-rail__foot")).filter((e) => hasClass(e, "k-btn--primary"));

test("T40 words: the new labels are pinned and built from the letter", () => {
  const W = sl.SHOTLIST_WORDS;
  assert.equal(sl.withLetter("pickInstead", "C"), "Pick C instead, it fits today");
  assert.equal(sl.withLetter("approveOne", "A"), "Approve A and its cost");
  assert.equal(sl.withLetter("costs", "A"), "Treatment A costs");
  assert.equal(sl.withLetter("overBy", "A"), "Treatment A goes over that by");
  assert.equal(W.raise, "Raise today's limit");
  assert.equal(W.overLimit, "Over today's limit");
  assert.equal(W.fitsToday, "Fits today");
  assert.equal(W.meets, "meets the bar");
  assert.equal(W.below, "below the bar");
  assert.equal(W.scores, "The Art director's scores");
  assert.equal(W.notePlaceholder, "Say why, in a few words (optional)");
  assert.equal(W.approve, "Approve this one and its cost", "the older words stay");
});

test("T40 helpers: the chip, the treatment instead, the way out, the money from the server's numbers", () => {
  const [a, b, c] = sl.SHOTLIST_WORDS && LAKE.variants.map((v) => ({ ...v, letter: v.id.toUpperCase(), title: v.direction.title }));
  assert.deepEqual(sl.treatmentChip(LAKE, a), { tone: "bad", icon: "lock", text: "Over today's limit" });
  assert.deepEqual(sl.treatmentChip(LAKE, c), { tone: "good", icon: "check", text: "Fits today" });
  assert.equal(sl.treatmentChip({}, b).text, "Locked", "no numbers: the server's blocked locks it");
  assert.equal(sl.insteadOf(LAKE, a).id, "c");
  assert.equal(sl.insteadOf(LAKE, c), null);
  assert.equal(sl.insteadOf(ALL_OVER, a), null);
  assert.deepEqual(sl.wayOut(OVER), { href: "#/settings?s=generation", label: "Raise today's limit" });
  assert.deepEqual(sl.wayOut("Generation is off or has no key yet. Open Settings."), { href: "#/settings?s=generation", label: "Open Settings" });
  assert.equal(sl.wayOut("A render is missing: dock.png."), null);
  const m = sl.treatmentMoney(LAKE, a);
  assert.equal(m.figure, "$1.85");
  assert.equal(m.overBy, "$0.85");
  assert.equal(m.tick, 77.9);
  assert.equal(sl.treatmentMoney({}, a), null);
  assert.equal(sl.verdictWords({ total: 41, of: 70, meets: false, reason: "short" }), "41 of 70, below the bar: short");
  assert.equal(sl.ratioWords("1280:720"), "1280 × 720");
  assert.equal(sl.lengthWords(variant("a", "A")), "10 s · 2 clips");
});

test("T40: the foot has one primary action at most, whatever is on the stage", async () => {
  const root = await showTree(sl.ShotlistCard, { item: LAKE });
  assert.equal(primaries(root).length, 1);
  assert.equal(textOf(primaries(root)[0]).trim(), "Pick C instead, it fits today", "A is over: the way out is the primary");
  const raise = elements(root).find((e) => e.localName === "a" && textOf(e).trim() === "Raise today's limit");
  assert.ok(raise && hasClass(raise, "k-btn--link"), "raising the limit is a text link when a treatment fits");
  fire(primaries(root)[0], "click");
  await settle();
  const radios = elements(root).filter((e) => e.getAttribute("role") === "radio");
  assert.deepEqual(radios.map((r) => r.getAttribute("aria-checked")), ["false", "false", "true"], "choosing it puts C on the stage");
  assert.equal(primaries(root).length, 1);
  assert.equal(textOf(primaries(root)[0]).trim(), "Approve C and its cost");
  const over = await showTree(sl.ShotlistCard, { item: ALL_OVER });
  assert.equal(primaries(over).length, 1);
  const p = primaries(over)[0];
  assert.equal(p.localName, "a");
  assert.equal(p.getAttribute("href"), "#/settings?s=generation");
  assert.equal(textOf(p).trim(), "Raise today's limit", "nothing fits: raising the limit is the primary");
});

test("T40: a blocked treatment is locked with the server's sentence as text, and no approve button is enabled", async () => {
  const root = await showTree(sl.ShotlistCard, { item: LAKE });
  const locked = within(root, "k-locked");
  assert.ok(locked, "k-locked is drawn");
  const why = elements(locked).find((e) => hasClass(e, "k-locked__why"));
  assert.equal(textOf(why), OVER, "the reason is the server's sentence, as sent");
  assert.ok(why.childNodes.every((n) => n.nodeType === 3), "as text");
  assert.equal(elements(root).filter((e) => e.localName === "button" && /^Approve/.test(textOf(e).trim()) && e.getAttribute("disabled") === null).length, 0);
  // The money block from the server's numbers: the figure, the one alert line, the limit.
  const all = textOf(root);
  assert.match(all, /about\$1\.85/);
  assert.match(all, /Treatment A goes over that by\$0\.85/);
  assert.doesNotMatch(all, /6 clips, 30 seconds: about \$1\.85/, "the sentence is not on the card twice (O9)");
});

test("T40: with no numbers from the server the card shows its cost sentence verbatim, and the limit lines", async () => {
  const words = "6 clips, 30 seconds: about $1.85, up to $3.70 with one retake each. Today's limit: $3.00.";
  const { generation, ...rest } = LAKE;
  const item = { ...rest, details: [{ label: "Today's limit", value: "$3.00; $2.00 spent" }], variants: [variant("a", "Slow approach", { cost: { base: 185, most: 370, words } })] };
  const root = await showTree(sl.ShotlistCard, { item });
  const say = elements(root).filter((e) => hasClass(e, "k-money__say"));
  assert.equal(say.length, 1);
  assert.equal(textOf(say[0]), words);
  assert.match(textOf(root), /Today's limit\$3\.00; \$2\.00 spent/);
  assert.ok(!elements(root).some((e) => hasClass(e, "k-meter")), "no meter without numbers");
});

test("T40: the prompt of a shot is a text node, on the stage and in the shots table", async () => {
  const prompt = "<script>alert(1)</script> The camera rises & turns.";
  const item = { ...ITEM, variants: [variant("a", "A", { shotlist: { seconds: 5, ratio: "1280:720", shots: [shotOf(1, { prompt })] }, boards: [{ shot: "s01", url: img("x") }] })] };
  const root = await showTree(sl.ShotlistCard, { item });
  const holders = elements(root).filter((e) => e.childNodes.some((n) => n.nodeType === 3 && n.data === prompt));
  assert.ok(holders.length >= 2, "the prompt is under the board and in the table");
  assert.ok(!elements(root).some((e) => e.localName === "script"));
});

test("T40: the compact use draws the head, the money and one Open link to the item's own page", async () => {
  const root = await showTree(sl.ShotlistCard, { item: LAKE, compact: true });
  assert.ok(!elements(root).some((e) => e.getAttribute("role") === "radiogroup"), "no strip");
  const open = elements(root).filter((e) => e.localName === "a" && textOf(e).trim() === "Open");
  assert.equal(open.length, 1);
  assert.equal(open[0].getAttribute("href"), "#/needs-you?item=staged%3Ashotlist%3Ag1");
  assert.match(textOf(root), /Treatment C costsabout\$1\.00/, "the treatment that can be approved");
});

test("T40: after approval the stage keeps the approved treatment and the rail links to Studio", async () => {
  const v = { ...LAKE.variants[2], letter: "C", title: "Day of light" };
  const root = await showTree(sl.ShotlistDone, { done: { action: "approve", version: v, title: "Approve a shotlist: A film of the lake house", studio: "#/dashboards/studio?film=g1" } });
  assert.match(textOf(root), /You approved C: Day of light/);
  assert.match(textOf(root), /Approved\. The Artist will make the clips\. You can follow them in Studio\./);
  assert.ok(elements(root).some((e) => e.localName === "img" && e.getAttribute("src") === "/api/view/bc1"));
  assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/dashboards/studio?film=g1"));
});
