// The kit tests' shared helpers: a very small DOM, enough for Preact to render into and for us to walk, and the
// ways the tests show a part in it. Moved here word for word from kit-a, kit-b, kit-c, kit-m55, kit-u1, kit-f1b,
// kit-v60a and pages-u2 (T01 of PLAN-COOK). Nothing here touches document or window at load.
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TREE = PUBLIC;
export const KIT = join(PUBLIC, "kit");
export const STYLES = join(PUBLIC, "styles", "kit");
export const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);

// ---- A very small DOM, enough for Preact to render into and for us to walk. ----
export class FakeNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get nextSibling() {
    const p = this.parentNode;
    return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null;
  }
  appendChild(c) {
    return this.insertBefore(c, null);
  }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
}
export class FakeText extends FakeNode {
  constructor(d) {
    super();
    this.nodeType = 3;
    this.data = String(d);
  }
}
export class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.localName = tag;
    this.attrs = {};
    this.style = { cssText: "", setProperty(k, v) { this[k] = v; } };
    this.listeners = {};
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  addEventListener(t, f) {
    (this.listeners[t] ||= []).push(f);
  }
  removeEventListener(t, f) {
    this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f);
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}
export function installDom() {
  const doc = {
    title: "",
    activeElement: null,
    createElement: (t) => new FakeElement(t),
    createElementNS: (_ns, t) => new FakeElement(t),
    createTextNode: (d) => new FakeText(d),
    addEventListener() {},
    removeEventListener() {},
  };
  doc.body = new FakeElement("body");
  globalThis.document = doc;
}
export function* walkDom(node) {
  yield node;
  for (const c of node.childNodes) yield* walkDom(c);
}
export const elements = (root) => [...walkDom(root)].filter((n) => n.nodeType === 1);
export const textOf = (root) => [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");
export const classOf = (el) => String(el.getAttribute("class") ?? el.className ?? "");
export const withClass = (root, c) => elements(root).filter((e) => classOf(e).split(/\s+/).includes(c));
export const hasClass = (root, c) => elements(root).some((e) => classOf(e).split(/\s+/).includes(c));
export const classesOf = (el) => (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
export const byClass = (root, c) => elements(root).filter((e) => classesOf(e).includes(c));
export const tags = (root) => elements(root).map((e) => e.localName);
export const isVNode = (v) => v !== null && typeof v === "object" && "type" in v && "props" in v;

// Preact runs effects after a 100 ms timer when there is no requestAnimationFrame.
// Effects run about 100 ms after a render in this stand-in DOM. On a busy machine 110 ms was not always enough
// (a mounted test then read the page before its effects ran and failed by chance), so the wait is 300 ms.
export const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// kit-a: renders `Component` with `props`, also capturing what the component itself returned.
export async function probe(Component, props) {
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  let returned;
  function Probe() {
    returned = Component(props);
    return returned;
  }
  render(html`<${Probe} />`, root);
  await settle();
  render(null, root);
  root.remove();
  return { returned };
}
// kit-a, kit-f1b, kit-v60a: renders into a root that is not in the body, after the effects ran.
export async function showTree(Component, props) {
  const root = new FakeElement("div");
  render(html`<${Component} ...${props} />`, root);
  await settle();
  return root;
}
// kit-u1, pages-u2: a fresh document each time, then as showTree.
export async function show(Component, props) {
  installDom();
  const root = new FakeElement("div");
  render(html`<${Component} ...${props} />`, root);
  await settle();
  return root;
}
// kit-m55: at once, with no wait for effects, into a bare document.
export function showNow(Component, props) {
  globalThis.document = { createElement: (t) => new FakeElement(t), createElementNS: (_n, t) => new FakeElement(t), createTextNode: (x) => new FakeText(x), addEventListener() {}, removeEventListener() {} };
  const root = new FakeElement("div");
  render(html`<${Component} ...${props} />`, root);
  return root;
}
// kit-c: mounted in the body, and taken away again.
export async function mount(Component, props) {
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${Component} ...${props} />`, root);
  await settle();
  return root;
}
export function unmount(root) {
  render(null, root);
  root.remove();
}

export function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName} listens for ${type}`);
  const ev = { type: key, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra };
  for (const f of el.listeners[key]) f.call(el, ev);
}
export const buttonNamed = (root, words) => elements(root).find((e) => e.localName === "button" && textOf(e).trim() === words);

// kit-a, kit-f1b, kit-v60a: the answer is chosen by path, method and the call's number.
export function stubFetch(answers) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    const a = answers(path, opts.method, calls.length);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
// kit-c: the answer is chosen by path and the call's number; the headers are kept.
export function stubFetchByCount(answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, method: opts.method, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
    const a = answer(path, calls.length);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

// kit-b: walks a Preact vnode tree: calls function components that use no hooks, collects classes and text.
export function walkVNode(node, out = { classes: [], text: [], props: [] }) {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (Array.isArray(node)) { node.forEach((n) => walkVNode(n, out)); return out; }
  if (typeof node === "string" || typeof node === "number") { out.text.push(String(node)); return out; }
  if (typeof node.type === "function") {
    // Primitives that keep state (Avatar, Menu) need a mounted tree; they are V7's and are tested there.
    let inner;
    try { inner = node.type(node.props || {}); } catch { out.skipped = (out.skipped || 0) + 1; return out; }
    return walkVNode(inner, out);
  }
  const p = node.props || {};
  out.props.push(p);
  if (p.class) out.classes.push(...String(p.class).split(/\s+/));
  walkVNode(p.children, out);
  return out;
}
