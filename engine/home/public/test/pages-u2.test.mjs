// U2: the composer's hint is short on a phone. (The Docs page and its Markdown test went with M13: the Files page replaces it.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);
const composer = await import(pathToFileURL(join(PUBLIC, "kit", "composer.js")).href);

// ---- A very small DOM, enough for Preact to render into and for us to walk (as in kit-v60a). ----
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
}
function installDom() {
  const d = {
    title: "", activeElement: null,
    createElement: (t) => new FakeElement(t), createElementNS: (_ns, t) => new FakeElement(t), createTextNode: (x) => new FakeText(x),
    addEventListener() {}, removeEventListener() {},
  };
  d.body = new FakeElement("body");
  globalThis.document = d;
}
function* walk(node) { yield node; for (const c of node.childNodes) yield* walk(c); }
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");
const classOf = (el) => String(el.getAttribute("class") ?? el.className ?? "");
const hasClass = (root, c) => elements(root).some((e) => classOf(e).split(/\s+/).includes(c));
const settle = () => new Promise((r) => setTimeout(r, 110));
async function show(Component, props) {
  installDom();
  const root = new FakeElement("div");
  render(html`<${Component} ...${props} />`, root);
  await settle();
  return root;
}

test("composer: the full hint at wide sizes, the short one below 480 px, and never both", async () => {
  const find = (root) => elements(root).find((e) => e.localName === "textarea");
  const prev = globalThis.matchMedia;
  try {
    for (const [matches, want] of [[false, composer.DEFAULT_PLACEHOLDER], [true, composer.SHORT_PLACEHOLDER]]) {
      globalThis.matchMedia = () => ({ matches, addEventListener() {}, removeEventListener() {} });
      const root = await show(composer.Composer, {});
      assert.equal(find(root).getAttribute("placeholder"), want);
    }
    assert.equal(composer.SHORT_PLACEHOLDER, "Say what you want done.");
    // A placeholder the page chose itself is never swapped.
    const root = await show(composer.Composer, { placeholder: "Write to Sam." });
    assert.equal(find(root).getAttribute("placeholder"), "Write to Sam.");
  } finally {
    if (prev === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = prev;
  }
});
