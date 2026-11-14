// PLAN-V5 K9, T20: the card of versions to pick from (kit/pick.js). Its pure helpers (the axis words, the brand
// line, the bar rule from `meets`, the order, the act body), and the card mounted in a very small DOM: three
// versions with one "Pick this one" each, an agent's words only ever as text, a picture only from the server's
// address, the pick sent with its version and variant, "changed since you looked", and the fallback to the
// ordinary card for an item without versions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(PUBLIC, "kit");
const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);
const pick = await import(pathToFileURL(join(KIT, "pick.js")).href);
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

// ---- The item as the home server sends it (inbox/goals.mjs asPick). ----
const review = (scores, meets, reason) => ({ scores, total: Object.values(scores).reduce((a, b) => a + b, 0), of: 70, meets, reason });
const A = { brand: 8, hierarchy: 7, composition: 8, finish: 7, idea: 7, voice: 8, kind: 7 };
const B = { brand: 5, hierarchy: 6, composition: 7, finish: 7, idea: 8, voice: 7, kind: 6 };
const img = (t) => ({ type: "image", token: t, url: `/api/view/${t}` });
const ITEM = {
  id: "goal:g1", kind: "pick", title: "Pick one: Launch carousel", raisedBy: "Chief of staff", when: "2026-11-12T09:00:00.000Z",
  version: "v1", summary: "Three versions are ready. Pick one, ask for another round, or send all back with a note.", severity: "normal",
  details: [{ label: "Versions", value: "3 to choose from" }],
  actions: [
    { id: "pick", label: "Pick this one", style: "primary", needsNote: false, takes: "variant" },
    { id: "another", label: "Another round", style: "plain", needsNote: false },
    { id: "reopen", label: "Send all back", style: "plain", needsNote: true },
  ],
  pieceKind: "carousel", round: 1, missing: [],
  variants: [
    { id: "c", direction: { id: "diagram-led", title: "Diagram led" }, preview: [{ type: "text", text: "<img src=x onerror=alert(1)>Plain words" }], brand: { result: "unknown", lines: ["The brand check is still running. Look again in a minute."] }, review: null },
    { id: "a", direction: { id: "type-led", title: "<b>Type led</b>" }, preview: [img("c2xpZGVz"), { type: "image", url: "/files/x.png" }], brand: { result: "pass", lines: [] }, review: review(A, true, "calm and exact, the type carries it") },
    { id: "b", direction: { id: "picture-led", title: "Picture led" }, preview: [img("YmJi")], brand: { result: "fail", lines: ["Colour #00a0a0 is not in your kit.", "The logo is missing."] }, review: review(B, false, "the strongest idea, but the teal is not ours") },
  ],
};

// ---- Pure helpers ----

test("axisWords: six fixed axes and the kind's own seventh, in words", () => {
  assert.deepEqual(pick.axisWords("carousel").map((a) => a.label), ["Brand", "Hierarchy", "Composition", "Finish", "Idea", "Voice", "Sequence"]);
  assert.equal(pick.axisWords("post").at(-1).label, "Flow");
  assert.equal(pick.axisWords("film").at(-1).label, "Motion");
  assert.equal(pick.axisWords("page").at(-1).label, "Screens");
  assert.equal(pick.axisWords(undefined).at(-1).label, "Its kind");
  assert.equal(pick.axisWords("constructor").at(-1).label, "Its kind");
});

test("scoreRows: a row per axis, the total out of 70, the bar from `meets`, the reason capped; null without a review", () => {
  const s = pick.scoreRows(review(B, false, "x".repeat(400)), "carousel");
  assert.deepEqual(s.rows.map((r) => r.value), [5, 6, 7, 7, 8, 7, 6]);
  assert.equal(s.total, 46);
  assert.equal(s.of, 70);
  assert.equal(s.below, true);
  assert.ok(s.reason.length <= 200);
  assert.equal(pick.scoreRows(null, "carousel"), null);
  // A number out of range is shown as none, never as 11.
  assert.equal(pick.scoreRows({ scores: { brand: 11, idea: -1 }, meets: true }, "post").rows[0].value, null);
  // The bar is the server's word from the numbers: true meets, false is below, anything else is not called below.
  assert.equal(pick.belowBar({ meets: false }), true);
  assert.equal(pick.belowBar({ meets: true }), false);
  assert.equal(pick.belowBar({}), false);
  assert.equal(pick.belowBar(null), false);
});

test("brandLine: passed, a warning with why, failed with why, no kit, still checking, could not be checked", () => {
  assert.deepEqual(pick.brandLine({ result: "pass", lines: [] }), { tone: "ok", text: "Fits your brand kit", lines: [], kit: false, running: false });
  const warn = pick.brandLine({ result: "warn", lines: ["“Elevate your” sounds like filler."] });
  assert.equal(warn.tone, "warn");
  assert.equal(warn.text, "Brand check: 1 thing to look at");
  assert.deepEqual(warn.lines, ["“Elevate your” sounds like filler."]);
  const fail = pick.brandLine({ result: "fail", lines: ["Colour #00a0a0 is not in your kit.", "The logo is missing."] });
  assert.equal(fail.text, "Brand check: 2 things to fix");
  assert.equal(fail.tone, "bad");
  const noKit = pick.brandLine({ result: "warn", lines: ["There is no brand kit yet, so colours, the logo and type were not checked."] });
  assert.equal(noKit.text, "No brand kit yet, so colours and type were not checked");
  assert.equal(noKit.kit, true);
  assert.deepEqual(noKit.lines, []);
  const running = pick.brandLine({ result: "unknown", lines: ["The brand check is still running. Look again in a minute."] });
  assert.equal(running.text, "Still checking against your brand kit");
  assert.equal(running.running, true);
  assert.equal(pick.brandLine({ result: "unknown", lines: ["The brand check could not be run, so this version is not marked as checked."] }).text, "Could not be checked");
  assert.equal(pick.brandLine(null).text, "Could not be checked");
  assert.equal(pick.brandLine({ result: "pass", lines: "nope" }).lines.length, 0);
});

test("versionsOf: a to c whatever the scores, missing ones listed and not pickable, junk left out", () => {
  const a = ITEM.variants.find((x) => x.id === "a");
  const v = pick.versionsOf({ ...ITEM, missing: ["c", "z", "a"], variants: [{ id: "d" }, null, a, a] });
  assert.deepEqual(v.map((x) => [x.id, x.missing]), [["a", false], ["c", true]]);
  const all = pick.versionsOf(ITEM);
  assert.deepEqual(all.map((x) => x.id), ["a", "b", "c"], "the highest total is not moved first");
  assert.deepEqual(all.map((x) => x.letter), ["A", "B", "C"]);
  assert.equal(all[1].title, "Picture led");
  assert.equal(pick.versionsOf({ variants: [{ id: "piece", direction: null }] })[0].title, "Your piece");
  assert.equal(pick.versionsOf({ variants: [{ id: "b", direction: null }] })[0].title, "Version B");
});

test("previewParts and safeViewUrl: pictures only from the server's viewer, text as it is", () => {
  const p = pick.previewParts(ITEM.variants[1].preview);
  assert.deepEqual(p.images, ["/api/view/c2xpZGVz"]);
  assert.equal(pick.safeViewUrl("javascript:alert(1)"), null);
  assert.equal(pick.safeViewUrl("/api/view/../files"), null);
  assert.equal(pick.safeViewUrl("//elsewhere.example/api/view/x"), null);
  assert.equal(pick.safeViewUrl("/api/view/abc_-9"), "/api/view/abc_-9");
  assert.equal(pick.previewParts(ITEM.variants[0].preview).text, "<img src=x onerror=alert(1)>Plain words");
  assert.equal(pick.foldsText("short"), false);
  assert.equal(pick.foldsText("x".repeat(500)), true);
  assert.equal(pick.foldsText(Array.from({ length: 12 }, () => "a").join("\n")), true);
});

test("safeViewUrl: a page's kept picture exactly (C21), and nothing like it", () => {
  const key = "0123456789abcdef".repeat(4);
  const good = `/api/sites/shot/${key}/shot-index-1280-light.png`;
  assert.equal(pick.safeViewUrl(good), good);
  assert.equal(pick.safeViewUrl(`/api/sites/shot/${key}/shot-about.us-390-dark.png`), `/api/sites/shot/${key}/shot-about.us-390-dark.png`);
  for (const bad of [`${good}?x=1`, `${good}#top`, `/api/sites/shot/${key.toUpperCase()}/shot-index-1280-light.png`, good.replace("shot-index", "SHOT-index"),
    `/api/sites/shot/${key}/shot-index-1024-light.png`, `/api/sites/shot/${key}/shot-index-1280-dim.png`, `/api/sites/shot/${key}/shot-index-1280-light.jpg`,
    `/api/sites/shot/${key.slice(2)}/shot-index-1280-light.png`, `/api/sites/shots/${key}/shot-index-1280-light.png`, `/api/sites/shot/${key}/x/shot-index-1280-light.png`,
    `/api/sites/shot/${key}/shot-%2e%2e-1280-light.png`, `/files/api/sites/shot/${key}/shot-index-1280-light.png`, `//elsewhere${good}`, `${good}\n`]) {
    assert.equal(pick.safeViewUrl(bad), null, bad);
  }
});

test("the card: three page versions show their kept pictures, desktop first, and nothing else", async () => {
  const key = (c) => c.repeat(64);
  const page = (id, title, c) => ({ id, direction: { id: title.toLowerCase(), title }, brand: { result: "pass", lines: [] }, review: review(A, true, "the grid holds"),
    preview: [{ type: "image", url: `/api/sites/shot/${key(c)}/shot-index-1280-light.png`, file: "shot-index-1280-light.png" },
      { type: "image", url: `/api/sites/shot/${key(c)}/shot-index-390-light.png`, file: "shot-index-390-light.png" },
      { type: "image", url: `/api/sites/shot/${key(c)}/shot-index-390-light.png?x`, file: "x" }] });
  const item = { ...ITEM, pieceKind: "page", variants: [page("a", "Editorial", "a"), page("b", "Gallery", "b"), page("c", "Spec sheet", "c")] };
  const root = await showTree(pick.PickCard, { item });
  const srcs = elements(root).filter((e) => e.localName === "img").map((e) => e.src ?? e.getAttribute("src"));
  // The stage: version A as its desktop and its phone picture, desktop first, at one scale in frames.
  const framed = elements(root).filter((e) => /\bk-frame__img\b/.test(e.getAttribute("class") || "")).map((e) => e.src ?? e.getAttribute("src"));
  assert.deepEqual(framed, [`/api/sites/shot/${key("a")}/shot-index-1280-light.png`, `/api/sites/shot/${key("a")}/shot-index-390-light.png`]);
  // The strip: each version's desktop picture, a to c; the address with a query is never drawn.
  assert.deepEqual([...new Set(srcs)].sort(), [...framed, ...["b", "c"].map((c) => `/api/sites/shot/${key(c)}/shot-index-1280-light.png`)].sort());
  assert.ok(srcs.every((u) => pick.safeViewUrl(u) === u && !u.includes("?")));
  assert.match(textOf(root), /Desktop/);
  assert.match(textOf(root), /Screens/, "the seventh axis of a page");
  assert.equal(elements(root).filter((e) => e.getAttribute("role") === "radio").length, 3);
  assert.equal(buttons(root, "Pick A, Editorial").length, 1, "one primary, for the version on the stage");
});

test("pickBody: the version seen goes with every action, the variant only with a pick", () => {
  assert.deepEqual(pick.pickBody(ITEM, "pick", "Warmer.", "b"), { id: "goal:g1", action: "pick", note: "Warmer.", version: "v1", variant: "b" });
  assert.deepEqual(pick.pickBody(ITEM, "pick", "", "a"), { id: "goal:g1", action: "pick", version: "v1", variant: "a" });
  assert.deepEqual(pick.pickBody(ITEM, "another", "Darker.", "a"), { id: "goal:g1", action: "another", note: "Darker.", version: "v1" });
  assert.deepEqual(pick.pickBody(ITEM, "pick", "", "d"), { id: "goal:g1", action: "pick", version: "v1" });
});

test("isPickItem and stepAt", () => {
  assert.equal(pick.isPickItem(ITEM), true);
  assert.equal(pick.isPickItem({ ...ITEM, variants: undefined }), false);
  assert.equal(pick.isPickItem({ ...ITEM, kind: "result" }), false);
  assert.equal(pick.isPickItem(null), false);
  assert.equal(pick.stepAt(0, 300, 3), 0);
  assert.equal(pick.stepAt(310, 300, 3), 1);
  assert.equal(pick.stepAt(9000, 300, 3), 2);
  assert.equal(pick.stepAt(10, 0, 3), 0);
});

// ---- Mounted ----

const radios = (root) => elements(root).filter((e) => e.getAttribute("role") === "radio");
const choose = async (root, letter) => {
  const card = radios(root).find((e) => textOf(e).startsWith(`${letter} · `));
  assert.ok(card, `a card for version ${letter}`);
  fire(card, "click");
  await settle();
};
const PICK_A = "Pick A, <b>Type led</b>";

test("the card: three versions in a to c order, one primary for the one on the stage, the note and the quieter actions", async () => {
  const root = await showTree(pick.PickCard, { item: ITEM });
  const all = textOf(root);
  const cards = radios(root);
  assert.equal(cards.length, 3, "one card a version, in a radio group");
  assert.deepEqual(cards.map((c) => c.getAttribute("aria-checked")), ["true", "false", "false"], "the first is only the one shown first");
  assert.ok(all.indexOf("Type led") < all.indexOf("Picture led") && all.indexOf("Picture led") < all.indexOf("Diagram led"));
  assert.equal(elements(root).filter((e) => /\bk-btn--primary\b/.test(e.getAttribute("class") || "")).length, 1, "one filled primary");
  assert.equal(buttons(root, PICK_A).length, 1);
  assert.match(all, /52 of 70/);
  assert.match(all, /Meets the bar/);
  assert.match(all, /Below the bar/);
  assert.match(all, /Not scored yet/);
  assert.match(all, /Fits your brand kit/);
  assert.match(all, /Sequence/);
  assert.match(all, /Say why, in a few words: your agents read this next time\./);
  assert.equal(buttons(root, "Another round").length, 1);
  assert.equal(buttons(root, "Send all back").length, 1);
  const h1 = elements(root).find((e) => e.localName === "h1");
  assert.equal(h1.getAttribute("id"), "page-title");
  assert.equal(textOf(h1), "Pick one: Launch carousel");
  // Choosing another card puts it on the stage, and the primary follows it.
  await choose(root, "B");
  assert.deepEqual(radios(root).map((c) => c.getAttribute("aria-checked")), ["false", "true", "false"]);
  assert.match(textOf(root), /Brand check: 2 things to fix/);
  assert.equal(buttons(root, "Pick B, Picture led").length, 1);
  assert.equal(buttons(root, PICK_A).length, 0);
  await choose(root, "C");
  assert.match(textOf(root), /Still checking against your brand kit/);
});

test("the card: an agent's words are text, never markup; a picture only from the server's address", async () => {
  const root = await showTree(pick.PickCard, { item: ITEM });
  assert.match(textOf(root), /<b>Type led<\/b>/, "the title is shown as the characters it is");
  await choose(root, "C");
  assert.match(textOf(root), /<img src=x onerror=alert\(1\)>Plain words/, "a draft is on the stage as text");
  assert.ok(!elements(root).some((e) => (e.localName === "b" && textOf(e) === "Type led") || e.getAttribute("onerror") !== null), "no element was made from an agent's words");
  const srcs = elements(root).filter((e) => e.localName === "img").map((e) => e.src ?? e.getAttribute("src"));
  assert.deepEqual([...new Set(srcs)].sort(), ["/api/view/YmJi", "/api/view/c2xpZGVz"]);
  const src = readFileSync(join(KIT, "pick.js"), "utf8");
  assert.doesNotMatch(src, /dangerouslySetInnerHTML|innerHTML/);
});

test("the card: a pick sends the version seen and the variant, then says what happened", async () => {
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Picked. Your choice and note are kept for next time." } }));
  try {
    let got = null;
    const root = await showTree(pick.PickCard, { item: ITEM, onDone: (r) => { got = r; } });
    const note = elements(root).find((e) => e.localName === "textarea");
    fire(note, "input", { currentTarget: { value: "Warmer." } });
    await settle();
    fire(buttons(root, PICK_A)[0], "click");
    await settle();
    assert.deepEqual(f.calls.at(-1).body, { id: "goal:g1", action: "pick", note: "Warmer.", version: "v1", variant: "a" });
    assert.match(textOf(root), /Picked\. Your choice and note are kept for next time\./);
    assert.match(textOf(root), /You picked A: <b>Type led<\/b>/);
    assert.equal(got.variant, "a");
  } finally {
    f.restore();
  }
});

test("the card: a version below the bar asks once before it is picked", async () => {
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Picked." } }));
  try {
    const root = await showTree(pick.PickCard, { item: ITEM });
    await choose(root, "B");
    fire(buttons(root, "Pick B, Picture led")[0], "click");
    await settle();
    assert.equal(f.calls.length, 0, "nothing is sent yet");
    assert.match(textOf(root), /This version is below the bar the Art director holds\. Pick it anyway\?/);
    fire(buttons(root, "Yes, pick it")[0], "click");
    await settle();
    assert.equal(f.calls.at(-1).body.variant, "b");
  } finally {
    f.restore();
  }
});

test("the card: Send all back needs a note and sends nothing without one", async () => {
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Sent back with your note." } }));
  try {
    const root = await showTree(pick.PickCard, { item: ITEM });
    fire(buttons(root, "Send all back")[0], "click");
    await settle();
    assert.equal(f.calls.length, 0);
    assert.match(textOf(root), /Send all back needs a note\./);
    fire(elements(root).find((e) => e.localName === "textarea"), "input", { currentTarget: { value: "None feel like us." } });
    await settle();
    fire(buttons(root, "Send all back")[0], "click");
    await settle();
    assert.deepEqual(f.calls.at(-1).body, { id: "goal:g1", action: "reopen", note: "None feel like us.", version: "v1" });
  } finally {
    f.restore();
  }
});

test("the card: changed since you looked says so, reads the item again and shows it; nothing is sent again", async () => {
  const newer = { ...ITEM, version: "v2", variants: ITEM.variants.map((v) => (v.id === "c" ? { ...v, brand: { result: "pass", lines: [] } } : v)) };
  const f = stubFetch((path, method) => (method === "POST"
    ? { status: 409, body: { error: { code: "changed_since_seen", message: "These versions changed since you looked. Read them again.", next: "Look at the versions again, then decide." } } }
    : { status: 200, body: { items: [newer] } }));
  try {
    const root = await showTree(pick.PickCard, { item: ITEM });
    fire(buttons(root, PICK_A)[0], "click");
    await settle();
    await settle();
    assert.match(textOf(root), /These versions changed since you looked\. Read them again\./);
    assert.equal(f.calls.filter((c) => c.method === "POST").length, 1);
    assert.equal(f.calls.filter((c) => c.method === "GET").length, 1, "the item was read again");
    await choose(root, "C");
    assert.doesNotMatch(textOf(root), /Still checking/, "the newer versions are shown");
    assert.match(textOf(root), /Fits your brand kit/);
    fire(buttons(root, "Pick C, Diagram led")[0], "click");
    await settle();
    assert.equal(f.calls.filter((c) => c.method === "POST").at(-1).body.version, "v2", "the next pick sends the version now shown");
  } finally {
    f.restore();
  }
});

test("the card: a refusal is said in place with the server's words", async () => {
  const f = stubFetch(() => ({ status: 400, body: { error: { code: "note_too_long", message: "The note is too long.", next: "Keep it under 4000 characters." } } }));
  try {
    const root = await showTree(pick.PickCard, { item: ITEM });
    fire(buttons(root, "Another round")[0], "click");
    await settle();
    assert.match(textOf(root), /The note is too long\. Keep it under 4000 characters\./);
    assert.equal(radios(root).length, 3, "the versions are still there");
    assert.equal(buttons(root, PICK_A).length, 1);
  } finally {
    f.restore();
  }
});

test("the card: a version with missing files is listed and cannot be picked", async () => {
  const root = await showTree(pick.PickCard, { item: { ...ITEM, variants: ITEM.variants.filter((v) => v.id !== "c"), missing: ["c"] } });
  assert.equal(radios(root).length, 3);
  assert.match(textOf(root), /Files missing/);
  await choose(root, "C");
  assert.match(textOf(root), /This version's files are missing\./);
  assert.ok(elements(root).some((e) => /\bk-locked\b/.test(e.getAttribute("class") || "")), "the pick is a locked action with its reason");
  assert.equal(elements(root).filter((e) => e.localName === "button" && /^Pick /.test(textOf(e).trim()) && e.getAttribute("disabled") === null).length, 0);
});

test("the card read-only: no buttons, the owner's pick marked", async () => {
  const root = await showTree(pick.PickCard, { pieces: { kind: "carousel", round: 1, variants: ITEM.variants, single: false, missing: [], problem: null }, readOnly: true, picked: "b" });
  assert.equal(elements(root).filter((e) => e.localName === "button" && /^Pick /.test(textOf(e).trim())).length, 0);
  assert.equal(buttons(root, "Another round").length, 0);
  assert.match(textOf(root), /You picked this one/);
  const on = radios(root).filter((e) => e.getAttribute("aria-checked") === "true");
  assert.equal(on.length, 1);
  assert.match(textOf(on[0]), /^B · Picture led/, "the picked one is on the stage");
});

test("the fallback: an item without versions is the ordinary card, as today, through the kit's DecisionCard", async () => {
  const plain = { ...ITEM, kind: "result", title: "Finished: Launch carousel", variants: undefined, actions: [
    { id: "acknowledge", label: "Accept", style: "primary", needsNote: false },
    { id: "reopen", label: "Send back", style: "plain", needsNote: true },
  ] };
  const root = await showTree(index.DecisionCard, { item: plain });
  assert.equal(buttons(root, "Accept").length, 1);
  assert.equal(buttons(root, PICK_A).length, 0);
  const asPick = await showTree(index.DecisionCard, { item: ITEM });
  assert.equal(buttons(asPick, PICK_A).length, 1, "a card of versions through the same name");
  assert.equal(radios(asPick).length, 3);
});

test("Versions on a task's page: nothing for a task without versions; a problem as one sentence", async () => {
  assert.equal(pick.Versions({ pieces: null }), null);
  assert.equal(pick.Versions({ pieces: { kind: null, round: null, variants: [], single: true, missing: [], problem: null } }), null);
  const root = await showTree(pick.Versions, { pieces: { kind: "carousel", variants: [], single: false, missing: [], problem: "variants.json names a direction that is not in the list." } });
  assert.match(textOf(root), /variants\.json names a direction that is not in the list\./);
});

test("pick.css is tokens only, its selectors the kit's, and it is linked", () => {
  const css = readFileSync(join(PUBLIC, "styles", "kit", "pick.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(|hsla?\(/i);
  assert.doesNotMatch(css, /font-family|font-size\s*:\s*[\d.]+px|url\(/i);
  const blocks = css.replace(/@(?:media|supports|container)[^{]+\{/g, "");
  for (const m of blocks.matchAll(/([^{}@;]+)\{/g)) {
    for (const sel of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      assert.match(sel, /^(\[data-motion="off"\] )?\.k-/, `selector "${sel}" is the kit's`);
    }
  }
  assert.match(readFileSync(join(PUBLIC, "index.html"), "utf8"), /href="\.\/styles\/kit\/pick\.css"/);
});

// ---- PLAN-COOK T42: the pick on a stage ----

test("pickLabel, scoreFact, stageOf, pageFrames and openHref", () => {
  const [a, b, c] = pick.versionsOf(ITEM);
  assert.equal(pick.pickLabel(a), "Pick A, <b>Type led</b>");
  assert.equal(pick.pickLabel(b), "Pick B, Picture led");
  assert.equal(pick.pickLabel(pick.versionsOf({ variants: [{ id: "piece" }] })[0]), "Pick this one");
  assert.equal(pick.pickLabel(null), "Pick this one");
  assert.deepEqual(pick.scoreFact(a.review), { fact: "52 of 70", tone: "good", bar: "Meets the bar", reason: "calm and exact, the type carries it" });
  assert.equal(pick.scoreFact(b.review).bar, "Below the bar");
  assert.equal(pick.scoreFact({ scores: {}, total: 40 }).bar, "", "no bar words when the server did not say");
  assert.equal(pick.scoreFact(null), null);
  assert.equal(pick.stageOf(a).type, "pictures");
  assert.deepEqual(pick.stageOf(a).images, ["/api/view/c2xpZGVz"]);
  assert.equal(pick.stageOf(c).type, "draft");
  assert.equal(pick.stageOf({ id: "c", missing: true }).type, "missing");
  assert.equal(pick.stageOf({ id: "a", preview: [{ type: "image", url: "//elsewhere.example/x.png" }] }).type, "none");
  const key = "ab".repeat(32);
  const shot = (p, w, s) => `/api/sites/shot/${key}/shot-${p}-${w}-${s}.png`;
  assert.deepEqual(pick.pageFrames([shot("about-us", 390, "dark"), shot("index", 1280, "light"), shot("about-us", 1280, "dark")]),
    [{ width: 1280, src: shot("about-us", 1280, "dark") }, { width: 390, src: shot("about-us", 390, "dark") }]);
  assert.equal(pick.pageFrames([shot("index", 1280, "light"), "/api/view/abc"]), null, "a page and a picture are not frames");
  assert.equal(pick.pageFrames([]), null);
  assert.equal(pick.openHref(ITEM), "#/needs-you?item=goal%3Ag1");
  assert.equal(pick.openHref({ ...ITEM, link: { page: "tasks", id: "t 1" } }), "#/tasks/t%201");
  assert.equal(pick.openHref({ ...ITEM, link: { page: "elsewhere", id: "x" } }), "#/needs-you?item=goal%3Ag1");
  assert.equal(pick.PICK_WORDS.meets, "Meets the bar");
  assert.equal(pick.PICK_WORDS.strip, "The versions");
});

test("Scores: the total first, then the seven axes, as figures; compact draws the row alone", async () => {
  const full = await showTree(pick.Scores, { review: review(A, true, "calm and exact"), kind: "page" });
  const cells = elements(full).filter((e) => /\bk-pick-scores__cell\b/.test(e.getAttribute("class") || ""));
  assert.equal(cells.length, 8);
  assert.match(textOf(cells[0]), /^Of 7052 of 70Meets the bar$/);
  assert.deepEqual(cells.slice(1).map((c) => textOf(c.childNodes[0])), ["Brand", "Hierarchy", "Composition", "Finish", "Idea", "Voice", "Screens"]);
  assert.match(textOf(full), /calm and exact/);
  const compact = await showTree(pick.Scores, { review: review(B, false, "the teal is not ours"), kind: "film", compact: true });
  assert.equal(elements(compact).filter((e) => /\bk-pick-scores__cell\b/.test(e.getAttribute("class") || "")).length, 8);
  assert.match(elements(compact)[1].getAttribute("class"), /k-pick-scores--compact/);
  assert.doesNotMatch(textOf(compact), /the teal is not ours/, "the compact row has no reason");
  assert.match(textOf(compact), /Below the bar/);
  assert.match(textOf(compact), /Motion/);
  assert.match(textOf(await showTree(pick.Scores, { review: null })), /Not scored yet/);
});

test("PickFoot: the foot alone acts for the version the page shows; nothing for an item that is not a pick", async () => {
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Picked." } }));
  try {
    let got = null;
    const root = await showTree(pick.PickFoot, { item: ITEM, chosen: "c", onDone: (r) => { got = r; } });
    assert.equal(elements(root).filter((e) => /\bk-btn--primary\b/.test(e.getAttribute("class") || "")).length, 1);
    assert.equal(buttons(root, "Pick C, Diagram led").length, 1);
    assert.equal(buttons(root, "Another round").length, 1);
    assert.equal(buttons(root, "Send all back").length, 1);
    assert.equal(elements(root).find((e) => /\bk-pick-foot__more\b/.test(e.getAttribute("class") || "")).getAttribute("aria-haspopup"), "dialog");
    assert.equal(radios(root).length, 0, "no strip and no stage: the page draws those");
    fire(buttons(root, "Pick C, Diagram led")[0], "click");
    await settle();
    assert.deepEqual(f.calls.at(-1).body, { id: "goal:g1", action: "pick", version: "v1", variant: "c" });
    assert.equal(got.variant, "c");
    assert.match(textOf(root), /You picked C: Diagram led/);
    const none = await showTree(pick.PickFoot, { item: { ...ITEM, kind: "result" }, chosen: "a" });
    assert.equal(none.childNodes.length, 0);
  } finally {
    f.restore();
  }
});

test("the card in a list (compact): the head, the versions as small pictures, and Open; nothing to decide in place", async () => {
  const root = await showTree(pick.PickCard, { item: ITEM, compact: true });
  assert.match(textOf(root), /3 versions to choose from · round 1/);
  assert.match(textOf(root), /Pick one: Launch carousel/);
  const names = elements(root).filter((e) => /\bk-pick__mini-name\b/.test(e.getAttribute("class") || "")).map(textOf);
  assert.deepEqual(names, ["A · <b>Type led</b>", "B · Picture led", "C · Diagram led"], "a to c");
  const pics = elements(root).filter((e) => e.localName === "img").map((e) => e.src ?? e.getAttribute("src"));
  assert.deepEqual(pics, ["/api/view/c2xpZGVz", "/api/view/YmJi"], "a draft has its letter, not a picture");
  const open = elements(root).find((e) => e.localName === "a" && textOf(e).trim() === "Open");
  assert.equal(open.getAttribute("href"), "#/needs-you?item=goal%3Ag1");
  assert.equal(elements(root).filter((e) => e.localName === "textarea" || e.getAttribute("role") === "radio").length, 0);
  const given = await showTree(pick.PickCard, { item: ITEM, compact: true, href: "#/tasks/STH-25" });
  assert.equal(elements(given).find((e) => e.localName === "a" && textOf(e).trim() === "Open").getAttribute("href"), "#/tasks/STH-25");
});


test("Versions on a task's page: the pick drawn in the page's column, without a title of its own; one primary", async () => {
  const root = await showTree(pick.Versions, { id: "p-task-versions", item: ITEM });
  assert.equal(elements(root).filter((e) => e.localName === "h1").length, 0, "the page has the title");
  assert.ok(!elements(root).some((e) => e.getAttribute("id") === "page-title"));
  assert.equal(elements(root).filter((e) => /\bk-btn--primary\b/.test(e.getAttribute("class") || "")).length, 1);
  assert.equal(radios(root).length, 3);
  assert.match(textOf(root), /Pick one to accept this task\./);
});
