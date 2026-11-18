// U19 fix 2: the approved shotlist's "Cost" fact is the server's words (cost.about), shown as sent; the page composes
// "about $X, up to $Y" from the numbers only when an older server sends none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(PUBLIC, "kit");
const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);
const sl = await import(pathToFileURL(join(KIT, "shotlist.js")).href);

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

const done = (cost) => ({
  action: "approve", title: "Approve a shotlist", studio: "#/dashboards/studio?film=g1", message: "Approved.", at: new Date().toISOString(),
  version: { id: "a", letter: "A", title: "Slow approach", direction: { id: "d-a", title: "Slow approach" }, preview: [], boards: [], cost,
    shotlist: { title: "Film a", seconds: 10, ratio: "1280:720", shots: [], cards: null }, approvable: true, blocked: null },
});
const costFact = async (cost) => {
  const root = await showTree(sl.ShotlistDone, { done: done(cost) });
  const rail = elements(root).find((e) => (e.getAttribute("class") || "").split(/\s+/).includes("k-rail"));
  return /Cost(.*?)(?:What happens next|$)/s.exec(textOf(rail));
};

test("the Cost fact is the server's words as sent, never composed from the numbers", async () => {
  const m = await costFact({ base: 150, most: 300, about: "about $1.50 at Higgsfield, up to $3.00 with a retake", words: "x", time: "" });
  assert.ok(m, "the fact is shown");
  assert.ok(m[0].includes("about $1.50 at Higgsfield, up to $3.00 with a retake"), m[0]);
  assert.ok(!/about \$1\.50, up to/.test(m[0]), "not the page's own composition");
});

test("an older server that sends no about: the fact falls back to the numbers", async () => {
  const m = await costFact({ base: 150, most: 300, words: "x", time: "" });
  assert.ok(m && m[0].includes("about $1.50, up to $3.00"), m && m[0]);
});
