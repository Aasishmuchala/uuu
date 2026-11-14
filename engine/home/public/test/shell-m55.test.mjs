// M55, builder A: the fixes from the browser checks (M18, M50, M51, M52) that lie in the shell and the shared
// styles, each held by a test so it does not come back. Split out of kit-m55 (T01 of PLAN-COOK); the kit's own
// M55 tests are in test/kit/<part>.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TREE, withClass, showNow as show } from "./kit/_dom.mjs";
import { css, src } from "./kit/_rules.mjs";

const load = (p) => import(pathToFileURL(join(TREE, p)).href);
const topbar = await load("shell/topbar.js");
const menu = await load("shell/command-menu.js");
const dock = await load("shell/dock.js");

test("the Health dot is never 'everything is on' while the gate is off (M52 F4)", () => {
  assert.deepEqual(topbar.engineDot({ board: "on", books: "on", gate: "off" }), { tone: "bad", words: "the gate is off" });
  assert.equal(topbar.engineDot({ board: "on", books: "on", gate: "on" }).tone, "ok");
  assert.equal(topbar.engineDot({ board: "on", books: "on" }).tone, "ok", "a shell without the key reads as before");
  assert.equal(topbar.engineDot({ board: "off", gate: "off" }).words, "the engine is off");
});

test("the command menu leads with Start and the departments, pages last, and does not say Search twice (M18-14)", () => {
  const empty = menu.localItems("", []);
  assert.deepEqual([...new Set(empty.map((i) => i.group))], ["Start", "Departments", "Pages"]);
  assert.doesNotMatch(menu.PLACEHOLDER, /^Search/);
  assert.ok(menu.PLACEHOLDER_SHORT.length <= 34, "the phone's placeholder fits 390 px");
  assert.match(css("shell.css"), /\.s-cmd-list\.has-more\s*\{[^}]*mask-image/);
});

test("the dock: the briefcase at its foot, each item's words on hover, labels give way on a short window (M18-23, M18-33, C1)", () => {
  const root = show(dock.Dock, { dock: [{ id: "sales", title: "Sales", creature: "sales", working: 1, needsYou: 2 }], current: null, onCompose() {} });
  const item = withClass(root, "s-dock-item")[0];
  assert.equal(item.getAttribute("title"), "Sales, 1 working, 2 need you");
  assert.match(src("shell/dock.js"), /<\$\{Icon\} name="jobs" \/>\s*<\/a>/);
  assert.match(css("shell.css"), /@media \(max-height: 699px\)\s*\{\s*\.s-dock-label\s*\{\s*display: none;/);
});

test("the top bar: the right group never slides under the capsule, and a band fades in once scrolled (M18-01, M50 F12)", () => {
  const s = css("shell.css");
  // Up to 1399 px since the capsule holds a fifth section, App Studio (PLAN-V5 T80); 1259 px let it overlap at 1280.
  assert.match(s, /@media \(min-width: 860px\) and \(max-width: 1399px\)\s*\{\s*\.s-topbar\s*\{\s*grid-template-columns: auto minmax\(0, 1fr\) auto;/);
  assert.match(s, /@media \(min-width: 860px\) and \(max-width: 1099px\)\s*\{\s*\.s-topbar \.s-capsule-item \.k-icon\s*\{\s*display: none;/, "the five sections' words alone up to 1099 px");
  assert.match(s, /\.s-needs\s*\{\s*flex: none;/);
  assert.match(s, /\.s-topbar\.is-scrolled::before\s*\{\s*opacity: 1;/);
  assert.match(s, /@media \(min-width: 860px\) and \(max-width: 979px\)\s*\{\s*\.s-topbar \.s-brand-name\s*\{\s*display: none;/);
});

test("the tab bar lives in the pages' layer, so a page's dialog lies over it (M52 F2)", () => {
  const shell = src("shell/app-shell.js");
  const open = shell.indexOf("<div class=${cls}>");
  const bar = shell.indexOf("<${TabBar}");
  const drawer = shell.indexOf("<${NeedsDrawer}");
  const close = shell.lastIndexOf("</div>", drawer);
  assert.ok(open > 0 && bar > open && bar < close, "the TabBar is inside .s-app");
});

test("drawers: full width below 860 px, focus on Close first, no paused opening animation with motion off (M18-13, M50 F13, M52 K1)", () => {
  const o = css("kit/overlays.css");
  assert.match(o, /@media \(max-width: 859px\)[\s\S]*\.k-drawer__panel\s*\{\s*width: 100%;/);
  assert.match(o, /\[data-motion="off"\] \.k-drawer__panel\s*\{\s*animation: none;/);
  const js = src("kit/overlays.js");
  assert.match(js, /useFocusTrap\(ref, onClose, true\)/);
  assert.match(js, /data-overlay-close/);
  assert.doesNotMatch(css("base.css"), /animation-play-state: paused/);
});

test("the light theme's strong glass and the working colour for words (M18-30, M50 F10)", () => {
  // PLAN-COOK T10: the strong glass is the opaque panel (white in light), so nothing behind a menu or dialog
  // shows through at all; the working colour for words is the one green, dark enough to read in light.
  const t = css("tokens.css");
  assert.match(t, /:root\[data-theme="light"\]\s*\{[^}]*--panel: #ffffff;/);
  assert.match(t, /--glass-strong: var\(--panel\);/);
  assert.match(t, /:root\[data-theme="light"\]\s*\{[^}]*--good: #17703f;/);
  assert.match(t, /--live-text: var\(--good\);/);
});
