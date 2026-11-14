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
const side = await load("shell/sidenav.js");

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
  // PLAN-COOK T21: the menu's sheet is shell-overlays.css; with gradients banned, more below is a rule at the
  // foot's rule firming instead of a fade.
  assert.match(css("shell-overlays.css"), /\.s-cmd-list\.has-more \+ \.s-cmd-help\s*\{[^}]*border-top-color: var\(--line-2\);/);
  assert.doesNotMatch(css("shell-overlays.css"), /gradient\(/);
});

// The dock's words on hover (M18-23, C1) carried over: in the icons-only sidebar each row says its name in a
// tooltip, on hover and on keyboard focus; a short window scrolls the sidebar instead of hiding its foot.
test("the sidebar: each row's words in a tooltip when it shows icons only, and it scrolls on a short window (M18-23, C1)", () => {
  const root = show(side.Sidenav, { mode: "icons", routeId: "map", shell: null, dock: [{ id: "sales", title: "Sales", working: 1, needsYou: 2 }], settings: {} });
  const sales = withClass(root, "s-go").find((e) => e.getAttribute("href") === "#/departments/sales");
  assert.equal(sales.getAttribute("data-tip"), "Sales, 1 working, 2 need you");
  assert.equal(sales.getAttribute("aria-label"), sales.getAttribute("data-tip"), "the tooltip's words are the row's name");
  const s = css("shell.css");
  assert.match(s, /\.s-side--icons \.s-go:hover::after,\s*\.s-side--icons \.s-go:focus-visible::after[^{]*\{[^}]*content: attr\(data-tip\);/);
  assert.match(s, /\.s-side \{[^}]*position: sticky;[^}]*height: 100vh;[^}]*overflow-y: auto;/);
});

// The capsule's overlap (M18-01) and the scrolled band (M50 F12) are gone with the capsule: the top bar has the
// page's own ground and a hairline, so nothing that scrolls under it reads as part of it, and the crumbs give
// way before the buttons at its right.
test("the top bar: opaque on the page's ground with a hairline, and its right group never gives up its width (M18-01, M50 F12)", () => {
  const s = css("shell.css");
  assert.match(s, /\.s-top \{[^}]*position: sticky;[^}]*border-bottom: 1px solid var\(--line\);[^}]*background: var\(--bg\);/);
  assert.match(s, /\.s-queue-btn,\s*\.s-find \{[^}]*flex: none;/);
  assert.match(s, /\.s-crumbs \{[^}]*min-width: 0;/);
  assert.match(s, /\.s-crumbs-here \{[^}]*text-overflow: ellipsis;/);
  assert.doesNotMatch(s, /\.s-top[^{]*::before/, "no band behind the bar");
});

test("the tab bar lives in the pages' layer, so a page's dialog lies over it (M52 F2)", () => {
  const shell = src("shell/app-shell.js");
  const open = shell.indexOf("<div class=${cls}>");
  const bar = shell.indexOf("<${TabBar}");
  const drawer = shell.indexOf("<${QueuePanel}");
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
