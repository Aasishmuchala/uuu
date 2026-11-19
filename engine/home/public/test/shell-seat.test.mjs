// The second PC's line (PLAN-DESKTOP T7): on a seat's port the shell says `seat`, and the top bar shows one fixed
// line; on the Mac's own port (`seat: null`) the bar is as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PUBLIC, installDom, show, textOf, withClass } from "./kit/_dom.mjs";

installDom();
const topbar = await import(pathToFileURL(join(PUBLIC, "shell/topbar.js")).href);
const LINE = "You are on a second PC. Keys, switches and money stay on the Mac.";
const mac = { counts: { needsYou: 2 }, engine: { board: "on" }, seat: null };
const seat = { ...mac, seat: { n: 1, role: "desk" } };
const bar = (shell, extra = {}) =>
  show(topbar.Topbar, { routeId: "map", parts: ["map"], shell, top: null, narrow: false, side: "open", onSide() {}, onQueue() {}, onCommand() {}, ...extra });

test("seatLine: the fixed line on a seat, null on the Mac or with no shell", () => {
  assert.equal(topbar.SEAT_LINE, LINE);
  assert.equal(topbar.seatLine(seat), LINE);
  assert.equal(topbar.seatLine({ seat: { n: 3, role: "view" } }), LINE);
  assert.equal(topbar.seatLine(mac), null);
  assert.equal(topbar.seatLine({}), null);
  assert.equal(topbar.seatLine(null), null);
  assert.equal(topbar.seatLine({ seat: "1" }), null);
  assert.equal(topbar.seatLine({ seat: { n: "1" } }), null);
});

test("the wide bar shows the line once on a seat, and not on the Mac", async () => {
  const on = withClass(await bar(seat), "s-top-seat");
  assert.equal(on.length, 1);
  assert.equal(textOf(on[0]), LINE);
  assert.equal(withClass(await bar(mac), "s-top-seat").length, 0);
  assert.equal(withClass(await bar(undefined), "s-top-seat").length, 0);
});

test("narrow: the line is in the More sheet, not the bar", async () => {
  assert.equal(withClass(await bar(seat, { narrow: true }), "s-top-seat").length, 0);
  const sheet = await show(topbar.MenuSheet, { open: true, onClose() {}, shell: seat, dock: [], onCompose() {}, onCommand() {} });
  const lines = withClass(sheet, "s-sheet-seat");
  assert.equal(lines.length, 1);
  assert.equal(textOf(lines[0]), LINE);
  const macSheet = await show(topbar.MenuSheet, { open: true, onClose() {}, shell: mac, dock: [], onCompose() {}, onCommand() {} });
  assert.equal(withClass(macSheet, "s-sheet-seat").length, 0);
});
