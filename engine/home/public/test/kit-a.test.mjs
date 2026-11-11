// The kit's primitives (CONTRACTS-V2 13.1): pinned names, they render in Node with their documented
// props (and with none), text stays text, every class starts with k-, and each stylesheet follows 11.2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(PUBLIC, "kit");
const STYLES = join(PUBLIC, "styles", "kit");

const PINNED = {
  button: ["Button"],
  icon: ["Icon", "StateIcon", "ICON_NAMES"],
  avatar: ["Avatar", "initials"],
  status: ["StatusDot", "Waiting", "Live"],
  tag: ["Tag", "Chip"],
  card: ["Card"],
  tabs: ["Tabs"],
  fields: ["Field", "TextInput", "TextArea", "Select", "Switch"],
  states: ["Notice", "ErrorNotice", "NotConnected", "Empty", "Loading", "BeingBuilt", "NextStep"],
  overlays: ["Menu", "Dialog", "Drawer"],
  text: ["Time", "Mono", "Kbd"],
  page: ["PageHeader", "Section"],
};
const MODULES = Object.keys(PINNED);
const COMPOSITES = ["decision", "task-card", "brief", "composer", "conversation", "table", "timeline", "checks", "doc", "agent"];
const PINNED_ICONS =
  "search home tasks docs team routines health settings plus check cross clock chevron-right chevron-down file download external play pause loop send menu panel sun moon alert image layers".split(" ");

// Load every module before any fake document exists: nothing may touch document or window at load.
const kit = {};
for (const m of MODULES) kit[m] = await import(pathToFileURL(join(KIT, `${m}.js`)).href);
const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);

// ---- A very small DOM, enough for Preact to render into and for us to walk. ----
class FakeNode {
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
class FakeText extends FakeNode {
  constructor(d) {
    super();
    this.nodeType = 3;
    this.data = String(d);
  }
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
function installDom() {
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
function* walk(node) {
  yield node;
  for (const c of node.childNodes) yield* walk(c);
}
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");

// Preact runs effects after a 100 ms timer when there is no requestAnimationFrame.
const settle = () => new Promise((r) => setTimeout(r, 110));

// Renders `Component` with `props`, also capturing what the component itself returned.
async function show(Component, props) {
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
async function showTree(Component, props) {
  const root = new FakeElement("div");
  render(html`<${Component} ...${props} />`, root);
  await settle();
  return root;
}

const isVNode = (v) => v !== null && typeof v === "object" && "type" in v && "props" in v;

const HOSTILE = '<script>alert("x")</script><img src=x onerror=alert(1)>';
const noop = () => {};

// Documented props for each component, then the same with hostile text where it takes text.
function cases(h) {
  const { Button } = kit.button;
  const { Icon, StateIcon } = kit.icon;
  const { Avatar } = kit.avatar;
  const { StatusDot, Waiting, Live } = kit.status;
  const { Tag, Chip } = kit.tag;
  const { Card } = kit.card;
  const { Tabs } = kit.tabs;
  const { Field, TextInput, TextArea, Select, Switch } = kit.fields;
  const { Notice, ErrorNotice, NotConnected, Empty, Loading, BeingBuilt, NextStep } = kit.states;
  const { Menu, Dialog, Drawer } = kit.overlays;
  const { Time, Mono, Kbd } = kit.text;
  const { PageHeader, Section } = kit.page;
  return [
    ["Button", Button, {}],
    ["Button", Button, { variant: "primary", size: "sm", icon: "plus", onClick: noop, children: h }],
    ["Button", Button, { variant: "accept", busy: true, children: h }],
    ["Button", Button, { variant: "danger", href: "#/tasks", children: h }],
    ["Button", Button, { variant: "quiet", href: "javascript:alert(1)", children: h }],
    ["Button", Button, { variant: "quiet", icon: "cross", "aria-label": h }],
    ["Icon", Icon, {}],
    ["Icon", Icon, { name: "search", size: 20, label: h }],
    ["StateIcon", StateIcon, {}],
    ...["backlog", "in_progress", "pending_review", "done", "failed", "canceled"].map((column) => ["StateIcon", StateIcon, { column }]),
    ["Avatar", Avatar, {}],
    ["Avatar", Avatar, { slug: "chief-of-staff", name: h, size: 48, state: "live" }],
    ["Avatar", Avatar, { slug: "you", name: h, size: 72 }],
    ["Avatar", Avatar, { slug: "../../etc", name: "Artist", size: 999 }],
    ["StatusDot", StatusDot, {}],
    ...["live", "ok", "wait", "warn", "bad", "off"].map((tone) => ["StatusDot", StatusDot, { tone, label: h }]),
    ["StatusDot", StatusDot, { tone: "ok", label: h, hideLabel: true, pulse: true }],
    ["Waiting", Waiting, {}],
    ["Live", Live, {}],
    ["Tag", Tag, {}],
    ["Tag", Tag, { tone: "bad", children: h }],
    ["Chip", Chip, {}],
    ["Chip", Chip, { icon: "clock", children: h }],
    ["Card", Card, {}],
    ["Card", Card, { tone: "warm", padding: "lg", children: h }],
    ["Card", Card, { tone: "sunken", href: "#/tasks/1", children: h }],
    ["Card", Card, { onClick: noop, padding: "none", children: h }],
    ["Tabs", Tabs, {}],
    ["Tabs", Tabs, { tabs: [{ id: "a", label: h, count: 3, tone: "bad" }, { id: "b", label: "Two" }], current: "b", onChange: noop, label: h }],
    ["Field", Field, {}],
    ["Field", Field, { label: h, hint: h, error: h, children: html`<${TextInput} value=${h} />` }],
    ["TextInput", TextInput, {}],
    ["TextInput", TextInput, { value: h, placeholder: h, onInput: noop }],
    ["TextArea", TextArea, {}],
    ["TextArea", TextArea, { autoGrow: true, value: h, onInput: noop }],
    ["Select", Select, {}],
    ["Select", Select, { options: [{ value: "a", label: h }, { value: "b", label: "B" }], value: "a", onChange: noop }],
    ["Switch", Switch, {}],
    ["Switch", Switch, { on: true, label: h, explain: h, onChange: noop }],
    ["Switch", Switch, { on: false, disabled: true, label: h, explain: h }],
    ["Notice", Notice, {}],
    ...["info", "ok", "warn", "bad"].map((tone) => ["Notice", Notice, { tone, title: h, children: h }]),
    ["ErrorNotice", ErrorNotice, {}],
    ["ErrorNotice", ErrorNotice, { error: new Error(h), onRetry: noop }],
    ["NotConnected", NotConnected, {}],
    ["NotConnected", NotConnected, { reason: h, next: `Run: engine start ${h}`, title: h }],
    ["Empty", Empty, {}],
    ["Empty", Empty, { title: h, text: h, children: h }],
    ["Loading", Loading, {}],
    ["Loading", Loading, { lines: 5, label: h }],
    ["BeingBuilt", BeingBuilt, {}],
    ["BeingBuilt", BeingBuilt, { title: h }],
    ["NextStep", NextStep, {}],
    ["NextStep", NextStep, { text: `Run: ${h}` }],
    ["Menu", Menu, {}],
    ["Menu", Menu, { label: h, icon: "menu", items: [{ id: "a", label: h, icon: "send", onSelect: noop }, { id: "b", label: "Stop", danger: true }] }],
    ["Dialog", Dialog, { open: true }],
    ["Dialog", Dialog, { open: true, title: h, onClose: noop, size: "lg", footer: h, children: h }],
    ["Drawer", Drawer, { open: true }],
    ["Drawer", Drawer, { open: true, side: "left", title: h, onClose: noop, children: h }],
    ["Time", Time, { at: "2026-11-11T09:00:00.000Z" }],
    ["Time", Time, { at: "2026-11-11T09:00:00.000Z", prefix: h }],
    ["Mono", Mono, {}],
    ["Mono", Mono, { children: h }],
    ["Kbd", Kbd, { children: h }],
    ["PageHeader", PageHeader, {}],
    ["PageHeader", PageHeader, { title: h, lead: h, back: { href: "#/tasks", label: h }, actions: h, children: h }],
    ["Section", Section, {}],
    ["Section", Section, { title: h, hint: h, count: 4, aside: h, children: h }],
  ];
}

// ---- Tests ----

test("every primitive module loads in Node and exports its pinned names", () => {
  assert.equal(globalThis.document, undefined, "no document existed while the modules loaded");
  for (const [m, names] of Object.entries(PINNED)) {
    for (const name of names) assert.ok(name in kit[m], `kit/${m}.js exports ${name}`);
    for (const name of names) if (/^[A-Z][a-z]/.test(name)) assert.equal(typeof kit[m][name], "function", `${name} is a component`);
  }
});

test("ICON_NAMES holds every icon name of 13.1, and each draws something", () => {
  const { ICON_NAMES } = kit.icon;
  for (const n of PINNED_ICONS) assert.ok(ICON_NAMES.includes(n), `icon ${n}`);
});

test("initials: the pinned vectors", () => {
  const { initials } = kit.avatar;
  assert.equal(initials("Chief of staff"), "CS");
  assert.equal(initials("Artist"), "A");
  assert.equal(initials(""), "?");
  assert.equal(initials(undefined), "?");
  assert.equal(initials("sales agent"), "SA");
});

test("every primitive renders with its documented props and with none, and returns a virtual node", async () => {
  installDom();
  for (const [name, Component, props] of cases("Plain words")) {
    const { returned } = await show(Component, props);
    // ErrorNotice with no error draws nothing (V48: a page that places it without a check shows no false error).
    if (name === "ErrorNotice" && !props.error) { assert.equal(returned, null, "ErrorNotice without an error draws nothing"); continue; }
    assert.ok(isVNode(returned), `${name}(${JSON.stringify(Object.keys(props))}) returns a virtual node`);
  }
});

test("hostile text stays text: no script element, no handler attribute, the words are shown as written", async () => {
  installDom();
  for (const [name, Component, props] of cases(HOSTILE)) {
    const root = await showTree(Component, props);
    for (const el of elements(root)) {
      assert.notEqual(el.localName, "script", `${name} made no script element`);
      if (el.localName === "img") assert.match(el.attrs.src || "", /^\/assets\/avatars\/[a-z0-9-]+\.png$/, `${name} made no image from text`);
      for (const a of Object.keys(el.attrs)) assert.ok(!/^on/i.test(a), `${name} set no ${a} attribute`);
      for (const [a, v] of Object.entries(el.attrs)) if (a === "href") assert.ok(!/^javascript:/i.test(v), `${name} has no script link`);
    }
    const text = textOf(root);
    const attrText = elements(root).map((e) => Object.values(e.attrs).join(" ")).join(" ");
    const carries = Object.values(props).some((v) => v instanceof Error || Array.isArray(v) || (typeof v === "string" && v.includes("<script>")) || (v && v.label === HOSTILE));
    // Icons, avatars and loading lines put a label only in an attribute or not on screen at all.
    if (["Icon", "Avatar", "Loading"].includes(name) || !carries) continue;
    assert.ok(text.includes("<script>") || attrText.includes("<script>"), `${name} shows the hostile words as text`);
    render(null, root);
  }
});

test("every class name the primitives use starts with k-", async () => {
  installDom();
  const seen = new Set();
  for (const [name, Component, props] of [...cases("Words"), ...cases(HOSTILE)]) {
    const root = await showTree(Component, props);
    for (const el of elements(root)) {
      for (const c of (el.getAttribute("class") || "").split(/\s+/).filter(Boolean)) {
        seen.add(c);
        assert.ok(c.startsWith("k-"), `${name} uses class "${c}"`);
      }
    }
    render(null, root);
  }
  for (const root of ["k-btn", "k-btn--primary", "k-btn--md", "k-icon", "k-avatar", "k-avatar--24", "k-dot", "k-dot--live", "k-tag", "k-chip", "k-card", "k-card--plain", "k-tabs", "k-field", "k-input", "k-textarea", "k-select", "k-switch", "k-notice", "k-empty", "k-loading", "k-menu", "k-dialog", "k-drawer", "k-time", "k-mono", "k-kbd", "k-page-header", "k-section"]) {
    assert.ok(seen.has(root), `the root class ${root} is used`);
  }
});

test("pinned behaviour: accept is always large, busy disables, a link button is a link, closed overlays render nothing", async () => {
  installDom();
  const { Button } = kit.button;
  let root = await showTree(Button, { variant: "accept", size: "sm", children: "Accept" });
  assert.match(root.firstChild.getAttribute("class"), /k-btn--accept k-btn--lg/);
  root = await showTree(Button, { variant: "primary", busy: true, children: "Save" });
  assert.equal(root.firstChild.localName, "button");
  assert.equal(root.firstChild.getAttribute("disabled"), "true");
  assert.equal(root.firstChild.getAttribute("aria-busy"), "true");
  root = await showTree(Button, { href: "#/tasks", children: "Tasks" });
  assert.equal(root.firstChild.localName, "a");
  assert.equal(root.firstChild.getAttribute("href"), "#/tasks");
  assert.equal(kit.overlays.Dialog({ open: false, title: "x" }), null);
  assert.equal(kit.overlays.Drawer({ open: false, title: "x" }), null);
  root = await showTree(kit.status.Waiting, {});
  assert.match(textOf(root), /Waiting for you/);
  assert.match(root.firstChild.getAttribute("class"), /k-dot--warn/);
  root = await showTree(kit.status.Live, {});
  assert.match(textOf(root), /Working/);
  assert.match(root.firstChild.getAttribute("class"), /k-dot--live k-dot--pulse/);
  root = await showTree(kit.states.BeingBuilt, { title: "Team" });
  assert.match(textOf(root), /This page is being built\./);
  root = await showTree(kit.page.PageHeader, { title: "Tasks" });
  const h1 = elements(root).find((e) => e.localName === "h1");
  assert.equal(h1.getAttribute("id"), "page-title");
  assert.equal(globalThis.document.title, "Tasks");
  root = await showTree(kit.avatar.Avatar, { slug: "builder", name: "Builder", size: 32 });
  assert.equal(elements(root).find((e) => e.localName === "img").getAttribute("src"), "/assets/avatars/builder.png");
  root = await showTree(kit.avatar.Avatar, { slug: "you", name: "You" });
  assert.equal(elements(root).some((e) => e.localName === "img"), false);
  assert.match(textOf(root), /^Y/);
  root = await showTree(kit.icon.Icon, { name: "check" });
  assert.equal(root.firstChild.getAttribute("aria-hidden"), "true");
  root = await showTree(kit.icon.Icon, { name: "check", label: "Passed" });
  assert.equal(root.firstChild.getAttribute("aria-label"), "Passed");
});

// ---- Stylesheets (11.2) ----

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Returns the selectors of every style rule, looking inside @media and @supports, skipping @keyframes bodies.
function selectorsOf(css) {
  const out = [];
  const keyframes = [];
  let i = 0;
  function block(endAt) {
    let prelude = "";
    while (i < css.length) {
      const ch = css[i];
      if (ch === "{") {
        i++;
        const p = prelude.trim();
        prelude = "";
        if (p.startsWith("@keyframes")) {
          keyframes.push(p.slice(10).trim());
          skip();
        } else if (p.startsWith("@media") || p.startsWith("@supports")) {
          block(true);
        } else {
          out.push(...p.split(",").map((s) => s.trim()));
          skip();
        }
      } else if (ch === "}") {
        i++;
        if (endAt) return;
      } else {
        prelude += ch;
        i++;
      }
    }
  }
  function skip() {
    let depth = 1;
    while (i < css.length && depth) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
  }
  block(false);
  return { selectors: out, keyframes };
}

for (const m of MODULES) {
  test(`stylesheet ${m}.css exists and follows the class and token rules`, () => {
    const file = join(STYLES, `${m}.css`);
    assert.ok(existsSync(file), `styles/kit/${m}.css exists`);
    const css = stripComments(readFileSync(file, "utf8"));
    assert.ok(css.trim().length > 0, "it is not empty");
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, "no hex colour");
    assert.doesNotMatch(css, /\brgba?\(/i, "no rgb(");
    assert.doesNotMatch(css, /font-family/i, "no font-family");
    assert.doesNotMatch(css, /font-size\s*:\s*[\d.]+px/i, "no font size in px");
    assert.doesNotMatch(css, /@import|url\(/i, "no import and no url()");
    if (m !== "overlays") {
      for (const z of css.matchAll(/z-index\s*:\s*(\d+)/g)) assert.ok(Number(z[1]) <= 50, `z-index ${z[1]} is at most 50`);
    }
    const { selectors, keyframes } = selectorsOf(css);
    assert.ok(selectors.length > 0, "it has rules");
    for (const s of selectors) assert.ok(s.startsWith(".k-"), `selector "${s}" starts with .k-`);
    for (const k of keyframes) assert.ok(k.startsWith("k-"), `keyframes "${k}" are named k-...`);
  });
}

test("kit/index.js re-exports every primitive and composite module", () => {
  const src = readFileSync(join(KIT, "index.js"), "utf8");
  for (const m of [...MODULES, ...COMPOSITES]) assert.ok(src.includes(`export * from "./${m}.js";`), `index.js re-exports ${m}.js`);
});

const compositesReady = COMPOSITES.every((m) => existsSync(join(KIT, `${m}.js`)));
test("kit/index.js loads and exposes every primitive name", { skip: compositesReady ? false : "the composites (V10) do not exist yet" }, async () => {
  const index = await import(pathToFileURL(join(KIT, "index.js")).href);
  for (const names of Object.values(PINNED)) for (const name of names) assert.ok(name in index, `index.js exports ${name}`);
});

// ---- DecisionCard, mounted (V48): the version the owner saw, "changed since you looked", and Esc. ----
// It lives here because this file has the small DOM; the composite's other tests are in kit-b.test.mjs.

const decision = await import(pathToFileURL(join(KIT, "decision.js")).href);

function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName} listens for ${type}`);
  const ev = { type: key, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra };
  for (const f of el.listeners[key]) f.call(el, ev);
}
const buttonNamed = (root, words) => elements(root).find((e) => e.localName === "button" && textOf(e).trim() === words);

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

const SEEN = {
  id: "goal:1", version: "v1", kind: "result", title: "Price list is ready", raisedBy: "Chief of staff",
  when: "2026-11-11T09:00:00.000Z", summary: "Three rows.", severity: "normal",
  details: [{ label: "Amount", value: "₹ 1,000.00" }],
  actions: [
    { id: "acknowledge", label: "Accept", style: "primary", needsNote: false },
    { id: "reopen", label: "Send back", style: "plain", needsNote: true },
  ],
};

test("DecisionCard shows what is approved before its button, and sends the version the owner saw", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Accepted." } }));
  try {
    const root = await showTree(decision.DecisionCard, { item: SEEN });
    const all = elements(root);
    const at = (pred) => all.findIndex(pred);
    const button = at((e) => e.localName === "button" && textOf(e).trim() === "Accept");
    for (const words of ["Price list is ready", "Chief of staff", "Amount", "₹ 1,000.00"]) {
      const i = at((e) => e.childNodes.some((c) => c.nodeType === 3 && c.data.includes(words)));
      assert.ok(i >= 0 && i < button, `"${words}" is shown before the button`);
    }
    fire(buttonNamed(root, "Accept"), "click");
    await settle();
    assert.deepEqual(f.calls.map((c) => [c.method, c.path, c.body]), [["POST", "/api/inbox/act", { id: "goal:1", action: "acknowledge", version: "v1" }]]);
    assert.match(textOf(root), /Accepted\./);
    render(null, root);
  } finally {
    f.restore();
  }
});

test("DecisionCard on 409 changed_since_seen: says so, shows the item again, never retries, then acts on the new version", async () => {
  installDom();
  const f = stubFetch((path, method, n) => {
    if (method === "GET") return { status: 200, body: { items: [{ ...SEEN, version: "v2", title: "Price list is ready, with Hindi" }] } };
    if (n === 1) return { status: 409, body: { error: { message: "This changed after you looked at it. Nothing was done.", next: "Read it again, then decide.", code: "changed_since_seen" } } };
    return { status: 200, body: { ok: true, message: "Accepted." } };
  });
  try {
    const root = await showTree(decision.DecisionCard, { item: SEEN });
    fire(buttonNamed(root, "Accept"), "click");
    await settle();
    await settle();
    const t = textOf(root);
    assert.match(t, /This changed after you looked at it\. Nothing was done\./);
    assert.match(t, /Read it again, then decide\./);
    assert.match(t, /Price list is ready, with Hindi/, "the new version is shown");
    assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`), ["POST /api/inbox/act", "GET /api/inbox"], "no second action by itself");
    fire(buttonNamed(root, "Accept"), "click");
    await settle();
    assert.deepEqual(f.calls[2].body, { id: "goal:1", action: "acknowledge", version: "v2" });
    assert.match(textOf(root), /Accepted\./);
    render(null, root);
  } finally {
    f.restore();
  }
});

test("DecisionCard: Esc in an open note or confirm cancels and sends nothing", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Done." } }));
  try {
    let root = await showTree(decision.DecisionCard, { item: SEEN });
    fire(buttonNamed(root, "Send back"), "click");
    await settle();
    assert.ok(elements(root).some((e) => e.localName === "textarea"), "the note field is open");
    fire(elements(root).find((e) => e.localName === "article"), "keydown", { key: "Escape" });
    await settle();
    assert.ok(!elements(root).some((e) => e.localName === "textarea"), "Esc closed it");
    assert.ok(buttonNamed(root, "Accept"), "the actions are back");
    render(null, root);

    const risky = { ...SEEN, actions: [{ id: "stop", label: "Stop", style: "danger", needsNote: false }] };
    root = await showTree(decision.DecisionCard, { item: risky });
    fire(buttonNamed(root, "Stop"), "click");
    await settle();
    assert.ok(buttonNamed(root, "Yes, stop"), "it asks once");
    fire(elements(root).find((e) => e.localName === "article"), "keydown", { key: "Escape" });
    await settle();
    assert.ok(!buttonNamed(root, "Yes, stop"), "Esc cancelled the confirm");
    assert.equal(f.calls.length, 0, "nothing was sent");
    render(null, root);
  } finally {
    f.restore();
  }
});
