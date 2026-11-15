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
  const { Button, LockedAction } = kit.button;
  const { Icon, StateIcon } = kit.icon;
  const { Avatar } = kit.avatar;
  const { StatusDot, Waiting, Live, St } = kit.status;
  const { Tag, Chip } = kit.tag;
  const { Card } = kit.card;
  const { Tabs } = kit.tabs;
  const { Field, TextInput, TextArea, Select, Switch, MoneyInput } = kit.fields;
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
    ["Button", Button, { variant: "ghost", children: h }],
    ["Button", Button, { variant: "link", href: "#/settings", children: h }],
    ["Button", Button, { variant: "primary", disabled: true, children: h }],
    ["LockedAction", LockedAction, {}],
    ["LockedAction", LockedAction, { label: h, why: h, tag: h, children: html`<${Button} variant="primary">${h}<//>` }],
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
    ["St", St, {}],
    ...["neutral", "good", "warn", "bad", "info"].map((tone) => ["St", St, { tone, children: h }]),
    ["St", St, { tone: "good", icon: "lock", children: h }],
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
    ["Chip", Chip, { on: true, onClick: noop, children: h }],
    ["Chip", Chip, { onClick: noop, icon: "filter", children: h }],
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
    ["MoneyInput", MoneyInput, {}],
    ["MoneyInput", MoneyInput, { value: "3.00", label: h, onInput: noop }],
    ["MoneyInput", MoneyInput, { value: h, currency: "€", disabled: true }],
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
    ["PageHeader", PageHeader, { title: h, over: "Sales · Outreach", creature: h, chip: { label: h, href: "javascript:alert(1)" } }],
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
  for (const root of ["k-btn", "k-btn--primary", "k-btn--md", "k-icon", "k-avatar", "k-avatar--24", "k-dot", "k-dot--live", "k-tag", "k-chip", "k-card", "k-card--plain", "k-tabs", "k-field", "k-input", "k-textarea", "k-select", "k-switch", "k-locked", "k-money-input", "k-st", "k-notice", "k-empty", "k-loading", "k-menu", "k-dialog", "k-drawer", "k-time", "k-mono", "k-kbd", "k-page-header", "k-section"]) {
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
  assert.equal(elements(root).some((e) => e.localName === "img"), false, "an agent is a flat disc: no picture is asked for (TB4)");
  assert.match(textOf(root), /^B/);
  root = await showTree(kit.avatar.Avatar, { slug: "you", name: "You" });
  assert.equal(elements(root).some((e) => e.localName === "img"), false);
  assert.match(textOf(root), /^Y/);
  root = await showTree(kit.icon.Icon, { name: "check" });
  assert.equal(root.firstChild.getAttribute("aria-hidden"), "true");
  root = await showTree(kit.icon.Icon, { name: "check", label: "Passed" });
  assert.equal(root.firstChild.getAttribute("aria-label"), "Passed");
});

test("a switched-off primary is a solid fill, not a faded accent (M18-27): the inert raised step with the third ink", () => {
  const b = css("kit/button.css");
  assert.match(b, /\.k-btn--primary:disabled:not\(\.k-btn--busy\)[^{]*\{\s*opacity: 1;\s*background: color-mix\(in srgb, var\(--ink\) 5%, var\(--raise\)\);\s*border-color: var\(--line\);\s*color: var\(--ink-3\);/);
  const any = /\.k-btn:disabled:not\(\.k-btn--busy\),\s*\.k-btn--off:not\(\.k-btn--busy\)\s*\{([^}]*)\}/.exec(b);
  assert.ok(any, "one disabled look for every variant");
  assert.match(any[1], /background: color-mix\(in srgb, var\(--ink\) 5%, var\(--raise\)\);/);
  assert.match(any[1], /color: var\(--ink-3\);/);
  assert.match(any[1], /cursor: not-allowed;/);
  assert.doesNotMatch(any[1], /opacity/, "nothing is shown disabled by fading it");
});

// From "the primitives' stylesheets follow the rules of V3 27.3" (kit-a).
test("button: a button has the control corner", () => {
  const button = stripComments(readFileSync(join(STYLES, "button.css"), "utf8"));
  assert.match(button, /\.k-btn \{[^}]*border-radius: var\(--r-2\)/, "a button has the control corner");
});

test("button: one system of variants (fix round A3): outlined plain at 36 px, the one accent fill with its highlight, a ghost with an edge, quiet words, a text link, a soft danger, 32 px small, nothing taller than 36 px", () => {
  const b = css("kit/button.css");
  // The body of the rule whose selector list starts with `sel` exactly.
  const rule = (sel) => { const at = b.search(new RegExp("(^\\s*|\\}\\s*)" + sel.split("").map((c) => (/[.()\\-]/.test(c) ? "\\" + c : c)).join(""))); assert.ok(at >= 0, `${sel} is drawn`); const open = b.indexOf("{", at); return b.slice(open + 1, b.indexOf("}", open)); };
  const base = rule(".k-btn {");
  assert.match(base, /min-height: var\(--h-md\);/);
  assert.match(base, /border: 1px solid var\(--line-2\);/);
  assert.match(base, /background: var\(--field\);/);
  assert.match(base, /font-size: var\(--fs-ui\);/);
  assert.match(base, /font-weight: var\(--fw-medium\);/);
  assert.doesNotMatch(base, /transform/, "a press changes colour, nothing moves");
  const fill = rule(".k-btn--primary,\n.k-btn--accept {");
  assert.match(fill, /background: var\(--accent-fill\);/);
  assert.match(fill, /color: var\(--accent-ink\);/);
  assert.match(fill, /font-weight: var\(--fw-medium\);/);
  assert.match(fill, /box-shadow: var\(--shadow-btn\);/, "an inner top highlight and a small drop");
  assert.match(rule(".k-btn--accept {"), /min-height: var\(--h-md\);/);
  assert.match(rule(".k-btn--lg {"), /min-height: var\(--h-md\);/);
  assert.match(rule(".k-btn--quiet {"), /color: var\(--ink-2\);/);
  const ghost = rule(".k-btn--ghost {");
  assert.match(ghost, /border-color: var\(--line-2\);/, "a ghost has a visible edge");
  assert.match(ghost, /background: transparent;/);
  // Outside the narrow block, no button rule is taller than 36 px and none fills its row by default.
  const wide = b.slice(0, b.indexOf("@media (max-width: 859px)"));
  assert.doesNotMatch(wide, /min-height: var\(--h-lg\)/, "nothing 40 px tall");
  assert.doesNotMatch(wide.slice(0, wide.indexOf(".k-locked")), /width: 100%/, "full width is the caller's choice");
  assert.doesNotMatch(/\.k-locked__out\s*\{([^}]*)\}/.exec(b)[1] + (/\.k-locked__out > \.k-btn\s*\{([^}]*)\}/.exec(b)?.[1] ?? ""), /width: 100%/);
  const link = rule(".k-btn--link {");
  assert.match(link, /color: var\(--accent\);/);
  assert.match(link, /text-decoration: underline;/);
  const danger = rule(".k-btn--danger {");
  assert.match(danger, /color: var\(--bad\);/);
  assert.match(danger, /background: var\(--bad-bg\);/, "a soft danger: its tint");
  assert.match(b, /\.k-btn--danger:hover:not\(:disabled\):not\(\.k-btn--off\) \{[^}]*background: var\(--bad-fill\);[^}]*color: var\(--accent-ink\);/, "solid under the pointer");
  const sm = rule(".k-btn--sm {");
  assert.match(sm, /min-height: var\(--s-8\);/);
  assert.match(sm, /font-size: var\(--fs-note\);/);
  for (const v of ["plain", "primary", "quiet", "ghost", "link", "danger"]) {
    assert.match(b, new RegExp(`\\.k-btn--${v}:hover:not\\(:disabled\\)`), `${v} answers the pointer`);
    assert.match(b, new RegExp(`\\.k-btn--${v}:active:not\\(:disabled\\)`), `${v} answers a press`);
  }
});

test("Button: a quiet danger (fix round R5) is the problem ink with no fill, the ghost's edge under the pointer, bare when off", async () => {
  installDom();
  const root = await showTree(kit.button.Button, { variant: "danger-quiet", icon: "cross", children: "Stop this task" });
  assert.match(root.firstChild.getAttribute("class"), /k-btn--danger-quiet k-btn--md/);
  const b = css("kit/button.css");
  const rest = /\.k-btn--danger-quiet \{([^}]*)\}/.exec(b)[1];
  assert.match(rest, /border-color: transparent;/);
  assert.match(rest, /background: transparent;/);
  assert.match(rest, /color: var\(--bad\);/);
  assert.match(/\.k-btn--danger-quiet:hover:not\(:disabled\):not\(\.k-btn--off\) \{([^}]*)\}/.exec(b)[1], /border-color: var\(--line-2\);/, "the ghost's edge under the pointer");
  assert.match(b, /\.k-btn--danger-quiet:active:not\(:disabled\)/);
  assert.match(b, /\.k-btn--danger-quiet\.k-btn--off:not\(\.k-btn--busy\) \{[^}]*background: transparent;/, "off, it stays bare");
});

test("Button: ghost and link are variants of their own; an unknown one is plain", async () => {
  installDom();
  const { Button } = kit.button;
  for (const v of ["ghost", "link"]) {
    const root = await showTree(Button, { variant: v, children: "Raise today's limit" });
    assert.match(root.firstChild.getAttribute("class"), new RegExp(`k-btn--${v} k-btn--md`));
  }
  const root = await showTree(Button, { variant: "loud", children: "x" });
  assert.match(root.firstChild.getAttribute("class"), /k-btn--plain/);
});

test("LockedAction: a group named by its action, its reason read with it, the way out under it, no disabled button", async () => {
  installDom();
  const { Button, LockedAction } = kit.button;
  const root = await showTree(LockedAction, {
    label: "Approve A and its cost", why: "Goes over today's limit by $0.85.",
    children: html`<${Button} variant="primary">Pick C instead, it fits today<//>`,
  });
  const group = root.firstChild;
  assert.equal(group.localName, "div");
  assert.equal(group.getAttribute("role"), "group");
  assert.equal(group.getAttribute("aria-label"), "Approve A and its cost");
  const why = elements(root).find((e) => (e.getAttribute("class") || "") === "k-locked__why");
  assert.equal(why.localName, "p");
  assert.equal(group.getAttribute("aria-describedby"), why.getAttribute("id"));
  assert.match(textOf(why), /^Goes over today's limit by \$0\.85\.$/, "the reason is shown as sent");
  assert.ok(elements(root).some((e) => e.localName === "svg"), "a lock");
  assert.match(textOf(root), /Locked/, "the tag says Locked by default");
  const buttons = elements(root).filter((e) => e.localName === "button");
  assert.equal(buttons.length, 1, "the only button is the way out");
  assert.equal(buttons[0].getAttribute("disabled"), null);
  assert.match(textOf(buttons[0]), /Pick C instead/);
  const bare = await showTree(LockedAction, { label: "Approve", tag: "" });
  assert.doesNotMatch(textOf(bare), /Locked/, "an empty tag draws none");
  assert.equal(bare.firstChild.getAttribute("aria-describedby"), null, "no reason, nothing described");
  const b = css("kit/button.css");
  // Fix round A2 (T101): one warning colour. A solid 1 px line box, the action and its reason in neutral inks, only
  // the tag in the problem colour; no dashed edge, no amber, nothing cut.
  const block = /\.k-locked__block\s*\{([^}]*)\}/.exec(b)[1];
  assert.match(block, /border: 1px solid var\(--line-2\);/);
  assert.doesNotMatch(b.slice(b.indexOf(".k-locked {")), /dashed|--warn/, "no dashed edge and no warning colour in the locked action");
  assert.match(/\.k-locked__action\s*\{([^}]*)\}/.exec(b)[1], /color: var\(--ink\);/, "the action's words in the default ink");
  assert.doesNotMatch(/\.k-locked__label\s*\{([^}]*)\}/.exec(b)[1], /ellipsis|nowrap/, "the label is never cut");
  const reason = /\.k-locked__why\s*\{([^}]*)\}/.exec(b)[1];
  assert.match(reason, /color: var\(--ink-2\);/, "its reason in the second ink");
  assert.match(reason, /font-size: var\(--fs-(note|ui)\);/, "at 13 or 14 px");
  const tag = /\.k-locked__tag\s*\{([^}]*)\}/.exec(b)[1];
  assert.match(tag, /background: var\(--bad-bg\);/);
  assert.match(tag, /color: var\(--bad\);/, "only the tag in the problem colour");
});

primitiveSheetTests("button");
narrowControlsTest("button");
