// The kit's button (CONTRACTS-V2 13.1, V3 27.3), and the tests that run over every primitive at once (they read
// button.js first): every module loads in Node, renders with its documented props and with none, keeps hostile text
// as text, uses only k- classes, and the pinned behaviour. Split out of kit-a and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, STYLES, html, render, installDom, elements, textOf, isVNode, showTree, probe as show } from "./_dom.mjs";
import { PRIMITIVES, HOSTILE } from "./_fixtures.mjs";
import { css, stripComments, primitiveSheetTests, narrowControlsTest } from "./_rules.mjs";

const PINNED = PRIMITIVES;
const MODULES = Object.keys(PINNED);

// Load every module before any fake document exists: nothing may touch document or window at load.
const kit = {};
for (const m of MODULES) kit[m] = await import(pathToFileURL(join(KIT, `${m}.js`)).href);

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
    ["Chip", Chip, { dot: "sales", children: h }],
    ["Chip", Chip, { dot: "warn", icon: "clock", children: h }],
    ["Chip", Chip, { dot: true, children: h }],
    ["Chip", Chip, { dot: h, children: h }],
    ["Card", Card, {}],
    ["Card", Card, { tone: "warm", padding: "lg", children: h }],
    ["Card", Card, { tone: "sunken", href: "#/tasks/1", children: h }],
    ["Card", Card, { onClick: noop, padding: "none", children: h }],
    ["Card", Card, { tone: "ghost", children: h }],
    ["Card", Card, { tone: "ghost", href: "#/files", padding: "sm", children: h }],
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
    ["PageHeader", PageHeader, { title: h, over: h, creature: "sales", chip: { label: ["Marketing", h], href: "#/jobs" } }],
    ["PageHeader", PageHeader, { title: "Plain", over: "Sales · Outreach", creature: h, chip: { label: h, href: "javascript:alert(1)" } }],
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

test("a switched-off primary is a solid fill, not half the white pill (M18-27)", () => {
  const b = css("kit/button.css");
  assert.match(b, /\.k-btn--primary:disabled:not\(\.k-btn--busy\)[^{]*\{\s*opacity: 1;\s*background: color-mix/);
});

// From "the primitives' stylesheets follow the rules of V3 27.3" (kit-a).
test("button: every button is a pill", () => {
  const button = stripComments(readFileSync(join(STYLES, "button.css"), "utf8"));
  assert.match(button, /\.k-btn \{[^}]*border-radius: var\(--r-pill\)/, "every button is a pill");
});

primitiveSheetTests("button");
narrowControlsTest("button");
