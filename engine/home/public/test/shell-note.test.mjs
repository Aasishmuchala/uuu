// The top bar's note (the money line, PLAN-3D T8) and the icons-only sidebar on the Map and Needs you.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PUBLIC, elements, installDom, show, textOf, withClass } from "./kit/_dom.mjs";

installDom();
const load = (p) => import(pathToFileURL(join(PUBLIC, p)).href);
const topbar = await load("shell/topbar.js");
const shellMod = await load("shell/app-shell.js");
const { sideMode } = await load("shell/sidenav.js");
const shell = { counts: { needsYou: 2 }, engine: { board: "on" } };
const bar = (top, extra = {}) =>
  show(topbar.Topbar, { routeId: "map", parts: ["map"], shell, top, narrow: false, side: "icons", onSide() {}, onQueue() {}, onCommand() {}, ...extra });

test("cleanTop keeps a note of at most 120 characters, whitespace collapsed, else null", () => {
  assert.equal(topbar.cleanTop({ note: "$3.40 of $10.00 spent today." }).note, "$3.40 of $10.00 spent today.");
  assert.equal(topbar.cleanTop({ note: "  a \n  b  " }).note, "a b");
  assert.equal(topbar.cleanTop({ note: "x".repeat(300) }).note, null);
  assert.equal(topbar.cleanTop({ note: "x".repeat(120) }).note, "x".repeat(120));
  assert.equal(topbar.cleanTop({ note: 5 }).note, null);
  assert.equal(topbar.cleanTop({}).note, null);
});

test("the note is one span of text between the links and the Queue button; none without a note", async () => {
  const root = await bar(topbar.cleanTop({ note: "$3.40 of $10.00 spent today.", links: [{ label: "L", href: "#/map" }] }));
  const spans = withClass(root, "s-top-note");
  assert.equal(spans.length, 1);
  assert.equal(spans[0].localName, "span");
  assert.equal(textOf(spans[0]), "$3.40 of $10.00 spent today.");
  const all = elements(root);
  assert.ok(all.indexOf(withClass(root, "s-top-link")[0]) < all.indexOf(spans[0]));
  assert.ok(all.indexOf(spans[0]) < all.indexOf(withClass(root, "s-queue-btn")[0]));
  assert.equal(withClass(await bar(topbar.cleanTop({})), "s-top-note").length, 0);
  assert.equal(withClass(await bar(null), "s-top-note").length, 0);
});

test("a hostile note is text and creates no element; no button speaks of spending", async () => {
  const root = await bar(topbar.cleanTop({ note: "<img src=x onerror=alert(1)>" }));
  assert.equal(textOf(withClass(root, "s-top-note")[0]), "<img src=x onerror=alert(1)>");
  assert.equal(elements(root).filter((e) => e.localName === "img").length, 0);
  assert.ok(!elements(root).some((e) => [...(e.attributes || [])].some((a) => /^on/i.test(a.name))));
  const buttons = elements(root).filter((e) => e.localName === "button");
  assert.ok(buttons.length > 0);
  assert.ok(!buttons.some((b) => /spending/i.test(textOf(b) + (b.getAttribute("aria-label") || ""))));
});

test("narrow: the note is not in the bar; it is the first line of the More sheet", async () => {
  const bare = await bar(topbar.cleanTop({ note: "A note." }), { narrow: true });
  assert.equal(withClass(bare, "s-top-note").length, 0);
  const sheet = await show(topbar.MenuSheet, { open: true, onClose() {}, shell, dock: [], note: "A note.", onCompose() {}, onCommand() {} });
  const first = withClass(sheet, "s-sheet")[0].childNodes.find((n) => n.nodeType === 1);
  assert.equal(textOf(first), "A note.");
  assert.equal(withClass(await show(topbar.MenuSheet, { open: true, onClose() {}, shell, dock: [] }), "s-sheet-note").length, 0);
});

test("the sidebar shows icons on map and needs-you with no choice; the owner's choice wins", () => {
  const side = (routeId, stored) => sideMode({ stored, stage: shellMod.iconsRoute(routeId), width: 1600 });
  assert.equal(side("map", null), "icons");
  assert.equal(side("needs-you", null), "icons");
  assert.equal(side("map", "open"), "open");
  assert.equal(side("needs-you", "open"), "open");
  assert.equal(side("tasks", null), "open", "every other route is as before");
});
