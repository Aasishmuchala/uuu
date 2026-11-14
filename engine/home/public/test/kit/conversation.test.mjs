// The kit's conversation and file card (CONTRACTS-V2 13.2, M63, M50): markers, bubbles, the fold, a file's own
// name. Split out of kit-b and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, PUBLIC, elements, textOf, withClass, showNow as show, walkVNode as walk } from "./_dom.mjs";
import { UNTRUSTED, shape } from "./_fixtures.mjs";
import { src, compositeSheetTests } from "./_rules.mjs";

const load = (name) => import(join(KIT, `${name}.js`));
const conversation = await import(pathToFileURL(join(KIT, "conversation.js")).href);

test("Conversation: the owner's bubble has an initials badge; an agent's head; a marker is a centred quiet line", async () => {
  const { Conversation, markerOf } = await load("conversation");
  assert.deepEqual(markerOf({ marker: { label: "Brief  written", tone: "ok" } }), { label: "Brief written", tone: "ok" });
  assert.deepEqual(markerOf({ marker: { label: "Round 1 · Repairing", tone: "pink" } }), { label: "Round 1 · Repairing", tone: "neutral" });
  assert.equal(markerOf({ marker: { label: "  " } }), null);
  assert.equal(markerOf({ marker: "Brief written" }), null);
  assert.equal(markerOf({}), null);
  assert.equal(markerOf({ marker: { label: "x".repeat(500) } }).label.length, 120);
  const msgs = [
    { marker: { label: "Brief written", tone: "neutral" } },
    { who: { slug: "you", name: "Asha Rao" }, kind: "note", text: "Make it four frames.", at: "2026-11-11T08:00:00.000Z" },
    { who: shape("who"), kind: "comment", text: "On it.", at: "2026-11-11T08:01:00.000Z", marker: { label: "Round 1 · Repairing", tone: "warn" } },
  ];
  const out = walk(Conversation({ messages: msgs }));
  assert.equal(out.classes.filter((c) => c === "k-convo__marker").length, 2);
  assert.ok(out.classes.includes("k-convo__marker--warn"));
  assert.ok(out.text.includes("Brief written") && out.text.includes("Round 1 · Repairing"));
  assert.equal(out.classes.filter((c) => c === "k-convo__msg").length, 2, "a marker alone is only its line");
  assert.ok(out.classes.includes("k-convo__badge") && out.classes.includes("k-convo__mine"));
  assert.ok(out.classes.includes("k-convo__head"));
  assert.ok(out.text.includes("On it."));
  // A marker's words are an agent's words too: text only.
  const bad = walk(Conversation({ messages: [{ marker: { label: UNTRUSTED } }] }));
  assert.ok(bad.text.includes(UNTRUSTED));
  assert.ok(!bad.props.some((p) => "dangerouslySetInnerHTML" in p));
});

test("Conversation and FileCard: the owner's bubble, Open or Download", async () => {
  const { Conversation, FileCard } = await load("conversation");
  const file = shape("file-entry");
  const msgs = [
    { who: { slug: "you", name: "You" }, kind: "note", text: "Make it four frames.", at: "2026-11-11T08:00:00.000Z" },
    { who: shape("who"), kind: "result", text: "Done.", at: "2026-11-11T08:10:00.000Z", files: [file] },
  ];
  const out = walk(Conversation({ messages: msgs }));
  assert.ok(out.classes.includes("k-convo"));
  assert.ok(out.classes.includes("k-convo__bubble"));
  assert.ok(out.classes.includes("k-file"));
  assert.ok(out.text.includes("Open"));
  const dl = walk(FileCard({ file: { ...file, viewUrl: null } }));
  assert.ok(dl.text.includes("Download"));
  assert.ok(!dl.text.includes("Open"));
});

// M63 item 28: an agent's long comment folds behind a real "Show all" button; the first lines show.
test("Conversation: a long agent message marked fold shows its first lines and a Show all button; others stay open", async () => {
  const { Conversation, foldText, FOLD_LINES, FOLD_CHARS } = await load("conversation");
  const long = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of what the agent said.`).join("\n");
  const f = foldText(long);
  assert.equal(f.long, true);
  assert.ok(f.head.startsWith("Line 1 of"));
  assert.ok(f.head.endsWith("agent said."), "a line that ends a sentence gets no extra mark");
  assert.ok(foldText("word ".repeat(400)).head.endsWith("…"));
  assert.ok(f.head.split("\n").length <= 6);
  assert.equal(foldText("short").long, false);
  assert.equal(foldText("a\n".repeat(FOLD_LINES - 1)).long, false);
  assert.equal(foldText("a\n".repeat(FOLD_LINES)).long, true);
  assert.equal(foldText("x".repeat(FOLD_CHARS)).long, false);
  const wide = foldText("word ".repeat(400));
  assert.equal(wide.long, true);
  assert.ok(wide.head.length <= 482);
  // Linear on a hostile text.
  const t0 = performance.now();
  foldText("\n".repeat(2_000_000));
  assert.ok(performance.now() - t0 < 500);

  // In the page: the folded one renders through its own component (with state), the check and the result as text.
  const msgs = [
    { who: { slug: "builder", name: "Builder" }, kind: "comment", text: long, at: null, fold: true },
    { who: { slug: "checker", name: "Checker" }, kind: "verdict", text: long, at: null },
    { who: { slug: "chief-of-staff", name: "Chief of staff" }, kind: "result", text: long, at: null },
  ];
  const tree = Conversation({ messages: msgs });
  const src = JSON.stringify(tree, (k, v) => (typeof v === "function" ? `fn:${v.name}` : k === "__" || k === "__o" ? undefined : v));
  assert.equal((src.match(/fn:FoldedText/g) || []).length, 1, "only the agent's comment folds");
  assert.equal((src.match(/Line 30 of what/g) || []).length, 3, "the check and the result keep every line; the fold holds the full text to open");
});

// A very small DOM, enough for Preact to render into, for the fold's state (as in kit-f1b).
class MiniNode {
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
}
class MiniText extends MiniNode { constructor(d) { super(); this.nodeType = 3; this.data = String(d); } }
class MiniElement extends MiniNode {
  constructor(tag) { super(); this.nodeType = 1; this.localName = tag; this.attrs = {}; this.listeners = {}; this.style = { cssText: "", setProperty() {} }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  dispatch(type) {
    const key = Object.keys(this.listeners).find((k) => k.toLowerCase() === type);
    for (const f of this.listeners[key] || []) f.call(this, { type: key, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} });
  }
}
function fakeDocument() {
  const doc = {
    createElement: (t) => new MiniElement(t), createElementNS: (_n, t) => new MiniElement(t), createTextNode: (d) => new MiniText(d),
    addEventListener() {}, removeEventListener() {}, activeElement: null,
  };
  doc.body = new MiniElement("body");
  globalThis.document = doc;
  return doc;
}
function* miniWalk(n) { yield n; for (const c of n.childNodes) yield* miniWalk(c); }
const find = (root, ok) => [...miniWalk(root)].find((n) => n.nodeType === 1 && ok(n)) || null;
const textIn = (root) => [...miniWalk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join(" ");

// The fold's button in a mounted tree: a real button, closed with the first lines, opened by a click.
test("Conversation fold: Show all opens the rest, Show less closes it, and aria-expanded follows", async () => {
  const { Conversation } = await load("conversation");
  const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);
  const long = Array.from({ length: 20 }, (_, i) => `Row ${i + 1}`).join("\n");
  const doc = fakeDocument();
  const root = doc.createElement("div");
  render(html`<${Conversation} messages=${[{ who: { slug: "builder", name: "Builder" }, kind: "comment", text: long, fold: true }]} />`, root);
  const btn = find(root, (n) => n.localName === "button" && /k-convo__fold/.test(n.getAttribute?.("class") || ""));
  assert.ok(btn, "a button");
  assert.equal(btn.getAttribute("type"), "button");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.match(textIn(root), /Show all/);
  assert.doesNotMatch(textIn(root), /Row 20/);
  assert.match(textIn(root), /Row 1\b/);
  const box = btn.getAttribute("aria-controls");
  assert.ok(find(root, (n) => n.getAttribute?.("id") === box), "it controls the text it opens");
  btn.dispatch("click");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.match(textIn(root), /Row 20/);
  assert.match(textIn(root), /Show less/);
});

test("file cards and evidence show a file's own name, never its folder; each Open says which file (M50 F17, M52 K9, K10)", () => {
  const root = show(conversation.FileCard, { file: { name: "art/walker/walker-sheet.png", kind: "image", viewUrl: "/api/x", size: 1200 } });
  assert.doesNotMatch(textOf(root), /art\/walker/);
  assert.equal(withClass(root, "k-file__folder").length, 0);
  assert.ok(elements(root).some((e) => e.getAttribute("aria-label") === "Open walker-sheet.png"));
  const checks = src("kit/checks.js");
  assert.doesNotMatch(checks, /alt=\$\{`Evidence: \$\{name\}`\}/);
  assert.match(checks, /split\("\/"\)\.pop\(\)/);
});

compositeSheetTests("conversation");
