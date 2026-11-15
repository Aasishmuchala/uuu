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
  assert.deepEqual(sl.boardRows(v), [{ shot: "s01", url: "/api/view/x", crop: null }]);
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
  assert.ok(elements(root).some((e) => /\bk-sl__lock\b/.test(e.getAttribute("class") || "")), "the approval is locked: one quiet line with a lock");
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
    // Fix round A2 (T101): the server's approved sentence is shown as it sent it, a text node.
    const said = elements(root).find((e) => hasClass(e, "k-sl__done-message"));
    assert.equal(textOf(said), "Approved. whatever the server says");
    assert.ok(said.childNodes.every((n) => n.nodeType === 3), "as text");
    assert.equal(got.message, "Approved. whatever the server says");
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
  // Fix round A3 (T113): never an underlined link; a ghost of the primary's height under it.
  assert.ok(raise && hasClass(raise, "k-btn--ghost"), "raising the limit is a ghost button when a treatment fits");
  assert.ok(!hasClass(raise, "k-btn--link") && !hasClass(raise, "k-btn--lg") && !hasClass(primaries(root)[0], "k-btn--lg"), "one height for both");
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
  // Fix round A3 (T113): no bordered card and no pill: one quiet line with a lock, a group named by the action.
  const locked = within(within(root, "k-rail__foot"), "k-sl__lock");
  assert.ok(locked, "the lock line is drawn");
  assert.equal(locked.getAttribute("role"), "group");
  assert.equal(locked.getAttribute("aria-label"), "Approve A and its cost");
  const why = elements(locked).find((e) => hasClass(e, "k-sl__lock-why"));
  assert.equal(locked.getAttribute("aria-describedby"), why.getAttribute("id"), "a reader hears why");
  assert.equal(textOf(why), OVER, "the reason is the server's sentence, as sent");
  assert.ok(why.childNodes.every((n) => n.nodeType === 3), "as text");
  assert.ok(!elements(root).some((e) => hasClass(e, "k-locked") || hasClass(e, "k-locked__tag")), "no locked card, no Locked pill");
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

test("T96: the boards fill the stage's height as a size container; the locked decision is tightened; the dead board handlers are gone", () => {
  const sheet = readFileSync(join(PUBLIC, "styles", "kit", "shotlist.css"), "utf8");
  assert.match(sheet, /\.k-work__stage \.k-sl__boards \{[^}]*flex: 1 1 0;[^}]*container: k-sl-boards \/ size;/);
  // Fix round A3 (T117): at the board's own shape, 16 to 9 or its picture box's.
  assert.match(sheet, /width: min\(calc\(100cqw - var\(--k-sl-side\)\), calc\(\(100cqh - var\(--k-sl-cap\)\) \* var\(--k-sl-ar\)\)\);/, "as large as width and height allow together");
  assert.match(sheet, /@container k-sl-boards \(max-aspect-ratio: 3 \/ 2\)/, "a tall place runs the reel under the board");
  assert.doesNotMatch(sheet, /176px/);
  // Fix round A3 (T113): the lock line is 13 px in the second ink, no border of its own.
  const lock = /\.k-sl__lock \{([^}]*)\}/.exec(sheet)[1];
  assert.match(lock, /color: var\(--ink-2\);/);
  assert.doesNotMatch(lock, /border/);
  assert.match(/\.k-sl__lock-why \{([^}]*)\}/.exec(sheet)[1], /font-size: var\(--fs-note\);/);
  const src = readFileSync(join(KIT, "shotlist.js"), "utf8");
  assert.doesNotMatch(src, /onBoard/, "the option cards' board buttons are gone, and so are their handlers");
});

test("T101: after approval the stage holds the sheet of boards; the rail is the approved state with one primary", async () => {
  const v = { ...LAKE.variants[0], letter: "A", title: "Slow approach" };
  const at = new Date().toISOString();
  const said = "Approved. The Artist will make the clips; up to $3.70 may be spent. You can follow it in Studio.";
  const root = await showTree(sl.ShotlistDone, { done: { action: "approve", version: v, title: "Approve a shotlist", studio: "#/dashboards/studio?film=g1", message: said, at } });
  const stage = elements(root).find((e) => hasClass(e, "k-work__stage"));
  assert.match(textOf(stage), /You approved A: Slow approach/);
  // Fix round A3 (T117): the only things on the stage to press are the sheet's boards, each opening it larger.
  const pressable = elements(stage).filter((e) => e.localName === "button" || e.localName === "a");
  assert.ok(pressable.length > 0 && pressable.every((e) => hasClass(e, "k-sl__tile-pic")), "only the boards, to open larger");
  // "Open Studio" once, and it is the primary.
  const studio = elements(root).filter((e) => e.localName === "a" && e.getAttribute("href") === "#/dashboards/studio?film=g1");
  assert.equal(studio.length, 1, "one way to Studio");
  assert.ok(hasClass(studio[0], "k-btn--primary"), "and it is the primary");
  assert.equal(textOf(studio[0]).trim(), "Open Studio");
  assert.equal(elements(root).filter((e) => textOf(e).trim() === "Open Studio" && (e.localName === "a" || e.localName === "button")).length, 1, "the words once");
  // Fix round A3 (T113): it follows what was approved in the rail's body, with a ghost back to Needs you beside it; no foot.
  const go = elements(root).find((e) => hasClass(e, "k-sl__done-go"));
  assert.ok(go && elements(go).includes(studio[0]));
  const back = elements(go).find((e) => e.localName === "a" && e.getAttribute("href") === "#/needs-you");
  assert.ok(back && hasClass(back, "k-btn--ghost") && textOf(back).trim() === "Back to Needs you");
  assert.ok(!elements(root).some((e) => hasClass(e, "k-rail__foot")));
  // The stage starts with its bar, as in the other states.
  assert.ok(elements(stage).some((e) => hasClass(e, "k-stagebar")));
  const order = elements(stage).filter((e) => hasClass(e, "k-stagebar") || hasClass(e, "k-sl__sheet"));
  assert.deepEqual(order.map((e) => hasClass(e, "k-stagebar")), [true, false], "the bar, then the sheet");
  // "Approved" is the kit's good chip.
  assert.ok(elements(root).some((e) => hasClass(e, "k-tag--good") && textOf(e) === "Approved"));
  const rail = elements(root).find((e) => hasClass(e, "k-rail"));
  const all = textOf(rail);
  // The mark with its time, the server's sentence as sent, what was approved from the item's own numbers.
  assert.ok(elements(rail).some((e) => hasClass(e, "k-sl__approved") && textOf(e) === "Approved"));
  assert.match(all, /Approvedtoday \d\d:\d\d/);
  assert.equal(textOf(elements(rail).find((e) => hasClass(e, "k-sl__done-message"))), said);
  assert.match(all, /TreatmentA · Slow approach/);
  assert.match(all, /Cost(about \$\d+\.\d\d)/);
  // What happens next is the server's time sentence, as sent.
  if (v.cost && v.cost.time) assert.ok(all.includes(v.cost.time));
  // Fix round A3 (T117): the shots are on the sheet, one board each with its seconds and cost; the rail does not list
  // them again; and no state the item does not carry.
  const tiles = elements(stage).filter((e) => hasClass(e, "k-sl__tile"));
  assert.equal(tiles.length, sl.shotRows(v).length);
  assert.ok(!elements(rail).some((e) => hasClass(e, "k-sl__done-shot") || hasClass(e, "k-sl__tile")), "no per-shot rows in the rail");
  assert.doesNotMatch(all, /The shots approved/);
  assert.doesNotMatch(textOf(root), /Waiting to start|Rendering|Done|In progress/, "nothing invented about a clip's state");
});

test("T101: wholeCut leaves the room under the last whole part, and nothing when all of it fits", () => {
  assert.equal(sl.wholeCut(300, [100, 200, 290]), 0, "it fits");
  assert.equal(sl.wholeCut(300, [262, 306, 350]), 38, "the row that would be cut is left out of view");
  assert.equal(sl.wholeCut(300, [262, 300.4, 350]), 0, "a part that ends at the edge is whole");
  assert.equal(sl.wholeCut(300, [400]), 0, "nothing whole inside: nothing is hidden");
  assert.equal(sl.wholeCut(0, [10]), 0);
  assert.equal(sl.wholeCut(300, []), 0);
});

test("T101: the rail's secondary lines are 44 px rows that open in place; the time sentence is behind one, as sent", async () => {
  const root = await showTree(sl.ShotlistCard, { item: LAKE });
  const heads = elements(root).filter((e) => hasClass(e, "k-sl__fold-head"));
  const names = heads.map((h) => textOf(elements(h).find((e) => hasClass(e, "k-sl__fold-name")) || h));
  assert.deepEqual(names.slice(0, 2), ["How long it takes", "Brand check"]);
  assert.ok(names.includes("The Art director's scores") && names.includes("Shots"));
  const v = LAKE.variants[0];
  if (v.cost && v.cost.time) {
    const time = elements(root).find((e) => e.localName === "details" && textOf(e).startsWith("How long it takes"));
    assert.ok(time, "the time sentence sits behind a row");
    assert.ok(textOf(time).includes(v.cost.time), "as sent");
  }
  const sheet = readFileSync(join(PUBLIC, "styles", "kit", "shotlist.css"), "utf8");
  assert.match(/\.k-sl__fold-head \{([^}]*)\}/.exec(sheet)[1], /min-height: 44px;/);
  assert.match(sheet, /clip-path: inset\(0 0 var\(--k-sl-cut, 0px\) 0\);/, "the body never shows a cut line");
});

// ---- Fix round A3 (T113) ----

test("T113: keepShort joins a word of one letter to the next, so no headline line ends on one; every word stays", () => {
  assert.equal(sl.keepShort("Approve a shotlist: A film of the lake house"), "Approve a\u00a0shotlist: A\u00a0film of the lake house");
  assert.equal(sl.keepShort("A film"), "A\u00a0film");
  assert.equal(sl.keepShort("Nothing short here"), "Nothing short here");
  assert.equal(sl.keepShort("ends in a"), "ends in a");
  assert.equal(sl.keepShort(null), "");
  assert.equal(sl.keepShort("Approve a shotlist: A film").replace(/\u00a0/g, " "), "Approve a shotlist: A film");
});

test("T113: the cards' chips show only when the treatments differ in them", async () => {
  const lake = sl.stripChips(LAKE, LAKE.variants);
  assert.deepEqual(lake.map((c) => c && c.text), ["Over today's limit", "Over today's limit", "Fits today"]);
  const fits = { ...LAKE, generation: { ...GEN, dayLeft: 900 }, variants: LAKE.variants.map((v) => ({ ...v, approvable: true, blocked: null })) };
  assert.deepEqual(sl.stripChips(fits, fits.variants), [null, null, null], "three Fits today say nothing");
  const root = await showTree(sl.ShotlistCard, { item: fits });
  assert.equal(elements(root).filter((e) => hasClass(e, "k-strip__chip")).length, 0);
  const over = await showTree(sl.ShotlistCard, { item: LAKE });
  assert.equal(elements(over).filter((e) => hasClass(e, "k-strip__chip")).length, 3);
});

test("T113: the headline is the item's title with its one-letter words held to the next", async () => {
  const root = await showTree(sl.ShotlistCard, { item: { ...LAKE, title: "Approve a shotlist: A film of the lake house" } });
  const h = elements(root).find((e) => e.getAttribute("id") === "page-title");
  assert.equal(textOf(h), "Approve a\u00a0shotlist: A\u00a0film of the lake house");
  const sheet = readFileSync(join(PUBLIC, "styles", "kit", "shotlist.css"), "utf8");
  const t = /\.k-sl \.k-rail__title \{([^}]*)\}/.exec(sheet)[1];
  assert.match(t, /font-size: 24px;/);
  assert.match(t, /font-weight: var\(--fw-bold\);/);
  assert.match(t, /text-wrap: balance;/);
});

test("T113: every fold row keeps one 20 px chevron column, empty on a row that does not open", async () => {
  const root = await showTree(sl.ShotlistCard, { item: LAKE });
  const heads = elements(root).filter((e) => hasClass(e, "k-sl__fold-head"));
  assert.ok(heads.length >= 3);
  for (const h of heads) assert.equal(elements(h).filter((e) => hasClass(e, "k-sl__fold-mark")).length, 1, textOf(h));
  const still = elements(root).find((e) => hasClass(e, "k-sl__fold--still"));
  if (still) assert.equal(textOf(elements(still).find((e) => hasClass(e, "k-sl__fold-mark"))), "");
  const sheet = readFileSync(join(PUBLIC, "styles", "kit", "shotlist.css"), "utf8");
  const mark = /\.k-sl__fold-mark \{([^}]*)\}/.exec(sheet)[1];
  assert.match(mark, /width: 20px;/);
  assert.doesNotMatch(sheet, /\.k-sl__fold--still \.k-sl__fold-aside \{/, "no per-row margin: one column for all");
});

test("T113: on a wide window the money holds still and the rows under it scroll, cut only between whole parts", () => {
  const sheet = readFileSync(join(PUBLIC, "styles", "kit", "shotlist.css"), "utf8");
  const folds = /\.k-sl:not\(\.k-sl--done\) \.k-sl__rail > \.k-sl__folds \{([^}]*)\}/.exec(sheet)[1];
  assert.match(folds, /overflow-y: auto;/);
  assert.match(folds, /clip-path: inset\(0 0 var\(--k-sl-fcut, 0px\) 0\);/);
  assert.match(sheet, /\.k-sl:not\(\.k-sl--done\) \.k-sl__rail > \* \{\s*flex: none;/, "the money never shrinks");
});

// ---- Fix round A3 (T117): a board is shown without its band; the approved sheet ----

// The tool's boards: 1280 by 720, the render in [0, 0, 1280, 619] above a band of 101 px.
const BOX = { box: [0, 0, 1280, 619], size: [1280, 720] };
const boxed = (id) => [{ shot: "s01", url: img(`b${id}1`), ...BOX }, { shot: "s02", url: img(`b${id}2`), box: null, size: null }];
const styleOf = (e) => `${e.getAttribute("style") || ""} ${(e.style && e.style.cssText) || ""}`;

test("T117: a board's picture box becomes a crop: the box's shape, the board laid so only the box shows; anything else is the whole board", () => {
  const v = variant("a", "A", { boards: boxed("a") });
  const [one, two] = sl.boardRows(v);
  assert.deepEqual(one.crop, { ratio: 2.0679, w: 100, h: 116.3166, x: 0, y: 0 });
  assert.equal(two.crop, null, "no box: the whole board");
  assert.deepEqual(sl.shotRows(v).map((r) => [r.board, r.crop && r.crop.ratio]), [["/api/view/ba1", 2.0679], ["/api/view/ba2", null]]);
  // Checked again on the page: numbers only, inside the board, at least half of it.
  for (const bad of [{ box: [0, 0, 1281, 619], size: [1280, 720] }, { box: [-1, 0, 1280, 619], size: [1280, 720] }, { box: ["0", 0, 1280, 619], size: [1280, 720] },
    { box: "../x.png", size: [1280, 720] }, { box: [0, 0, 1280, 300], size: [1280, 720] }, { box: [0, 0, 1280, 619] }, { box: [0, 0, 1280, 619], size: ["1280", 720] }, {}]) {
    assert.equal(sl.boardRows(variant("a", "A", { boards: [{ shot: "s01", url: img("x"), ...bad }] }))[0].crop, null, JSON.stringify(bad));
  }
  const inner = sl.boardRows(variant("a", "A", { boards: [{ shot: "s01", url: img("x"), box: [100, 50, 1180, 670], size: [1280, 720] }] }))[0].crop;
  assert.deepEqual([inner.x, inner.y], [-9.2593, -8.0645], "laid up and left by the box's corner");
});

test("T117: the stage, the reel, the option card and the table each draw a boxed board cropped, and an unboxed one whole", async () => {
  const item = { ...ITEM, variants: [variant("a", "Slow approach", { boards: boxed("a") }), variant("b", "B", { boards: boxed("b") })] };
  const root = await showTree(sl.ShotlistCard, { item });
  const fit = within(root, "k-sl__fit");
  assert.ok(hasClass(fit, "k-sl__fit--crop"), "the stage's board is cropped");
  assert.match(styleOf(fit), /--k-sl-ar: 2\.0679;/);
  assert.match(styleOf(fit), /--k-crop-h: 116\.3166%;/);
  // The reel and the table: the boxed board in a crop, the other whole.
  const pics = elements(root).filter((e) => hasClass(e, "k-sl__pic"));
  assert.ok(pics.some((e) => hasClass(e, "k-sl__pic--crop") && elements(e).some((x) => hasClass(x, "k-sl__crop"))));
  assert.ok(pics.some((e) => !hasClass(e, "k-sl__pic--crop") && e.childNodes.some((x) => x.localName === "img")));
  // The option cards' small pictures: the chosen board (the first) cropped.
  const thumbs = elements(root).filter((e) => hasClass(e, "k-opt__thumb"));
  assert.equal(thumbs.length, 2);
  for (const t of thumbs) {
    assert.ok(hasClass(t, "k-strip__thumb--crop"));
    assert.match(styleOf(t), /--k-crop-r: 2\.0679;/);
  }
  // Moving to the unboxed board draws it whole.
  fire(buttons(root, "").find((b) => b.getAttribute("aria-label") === "The next board"), "click");
  await settle();
  assert.ok(!hasClass(within(root, "k-sl__fit"), "k-sl__fit--crop"));
  const sheet = readFileSync(join(PUBLIC, "styles", "kit", "shotlist.css"), "utf8");
  assert.match(/\.k-sl__fit--crop > \.k-shot \.k-shot__frame \{([^}]*)\}/.exec(sheet)[1], /aspect-ratio: var\(--k-sl-ar\);/);
  const crop = /\.k-sl__crop > img \{([^}]*)\}/.exec(sheet)[1];
  for (const k of ["left: var(--k-crop-x)", "top: var(--k-crop-y)", "width: var(--k-crop-w)", "height: var(--k-crop-h)"]) assert.ok(crop.includes(k), k);
});

test("T117: approved, the stage is a sheet of every board cropped: its number on the picture, its words and 5 s · $0.25 under it", async () => {
  const v = { ...variant("a", "Slow approach", { boards: boxed("a") }), letter: "A", title: "Slow approach" };
  const root = await showTree(sl.ShotlistDone, { done: { action: "approve", version: v, title: "Approve a shotlist", studio: "#/dashboards/studio?film=g1" } });
  const tiles = elements(root).filter((e) => hasClass(e, "k-sl__tile"));
  assert.equal(tiles.length, 2);
  const [t1] = tiles;
  assert.equal(textOf(elements(t1).find((e) => hasClass(e, "k-pictag"))), "s01", "the shot's number on the picture");
  assert.equal(textOf(elements(t1).find((e) => hasClass(e, "k-sl__tile-words"))), "A slow push.");
  assert.equal(textOf(elements(t1).find((e) => hasClass(e, "k-sl__tile-facts"))), "5 s · $0.25");
  assert.ok(elements(t1).some((e) => hasClass(e, "k-sl__pic--crop")), "cropped to its picture");
  const open = elements(t1).find((e) => e.localName === "button");
  assert.equal(open.getAttribute("aria-label"), "Treatment A, board s01, open it larger");
  const sheet = readFileSync(join(PUBLIC, "styles", "kit", "shotlist.css"), "utf8");
  assert.match(/\.k-sl__sheet \{([^}]*)\}/.exec(sheet)[1], /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, "three across");
  assert.match(sheet, /\.k-sl \.k-work__stage > \.k-sl__sheet \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, "two on a phone");
  assert.match(/\.k-sl__tile-facts \{([^}]*)\}/.exec(sheet)[1], /font-variant-numeric: tabular-nums;/);
  assert.equal(sl.SHOTLIST_WORDS.openLarger, "open it larger");
  assert.equal(sl.SHOTLIST_WORDS.shotsApproved, "The shots approved", "the word stays: it names the sheet");
});

test("T117: a board of the sheet opens larger in the kit's full-size viewer, with its line and the board before and the next", async () => {
  const v = { ...variant("a", "Slow approach", { boards: boxed("a") }), letter: "A", title: "Slow approach" };
  const root = await showTree(sl.ShotlistDone, { done: { action: "approve", version: v, title: "Approve a shotlist", studio: "#/dashboards/studio?film=g1" } });
  assert.ok(!within(root, "k-dialog"));
  fire(elements(root).find((e) => e.getAttribute("aria-label") === "Treatment A, board s01, open it larger"), "click");
  await settle();
  const dialog = within(root, "k-dialog");
  assert.ok(dialog && hasClass(dialog, "k-dialog--full"), "the full-size Dialog");
  assert.match(textOf(dialog), /Treatment A, board s01/);
  assert.match(textOf(dialog), /A slow push\.5 s · \$0\.25/, "the same line under it");
  assert.match(textOf(dialog), /1 of 2/);
  const view = within(dialog, "k-sl__view");
  assert.match(styleOf(view), /--k-sl-vr: 2\.0679;/, "at its picture box's shape");
  const before = elements(dialog).find((e) => e.getAttribute("aria-label") === "The board before");
  assert.ok(before.getAttribute("disabled") !== null);
  fire(elements(dialog).find((e) => e.getAttribute("aria-label") === "The next board"), "click");
  await settle();
  assert.match(textOf(within(root, "k-dialog")), /Treatment A, board s02/);
  assert.match(textOf(within(root, "k-dialog")), /2 of 2/);
  assert.equal(styleOf(within(root, "k-sl__view")).trim(), "", "a board with no box: the whole board at 16 to 9");
  fire(elements(root).find((e) => e.getAttribute("aria-label") === "Close"), "click");
  await settle();
  assert.ok(!within(root, "k-dialog"));
});
