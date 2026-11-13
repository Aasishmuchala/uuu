// The Needs you page's pure helpers: the department of an item (CONTRACTS-V3 26.4), the order, the filter chips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const mod = await import("../../pages/needs-you.js");

const departments = [
  { id: "sales", title: "Sales", agents: [{ slug: "sales" }] },
  { id: "studio", title: "Studio", agents: [{ slug: "artist" }] },
  { id: "operations", title: "Operations", agents: [{ slug: "chief-of-staff" }, { slug: "checker" }] },
];
const item = (id, extra = {}) => ({ id, source: "goal", severity: "normal", when: "2026-11-11T09:00:00.000Z", ...extra });

test("needs-you: the page is a component", () => {
  assert.equal(typeof mod.default, "function");
});

test("needs-you: an item belongs to the department of its agent, else of its source, else to none", () => {
  assert.equal(mod.departmentOf(item("a", { agent: { slug: "artist" } }), departments), "studio");
  assert.equal(mod.departmentOf(item("b", { agent: { slug: "checker" } }), departments), "operations");
  assert.equal(mod.departmentOf(item("c", { source: "books" }), departments), "books");
  assert.equal(mod.departmentOf(item("d", { source: "customers" }), departments), "sales");
  assert.equal(mod.departmentOf(item("e", { source: "support" }), departments), "support");
  assert.equal(mod.departmentOf(item("f", { source: "board" }), departments), "");
  // The agent wins over the source; an unknown agent falls back to the source; no map falls back too.
  assert.equal(mod.departmentOf(item("g", { source: "marketing", agent: { slug: "artist" } }), departments), "studio");
  assert.equal(mod.departmentOf(item("h", { source: "books", agent: { slug: "nobody" } }), departments), "books");
  assert.equal(mod.departmentOf(item("i", { agent: { slug: "artist" } }), null), "");
  assert.equal(mod.departmentOf(null, departments), "");
  assert.equal(mod.departmentOf(item("j", { source: "constructor" }), departments), "");
});

test("needs-you: the home server's department wins (M50 F1): a task's result raised by the Chief of staff is filtered under its task's department", () => {
  assert.equal(mod.departmentOf(item("a", { agent: { slug: "chief-of-staff" }, department: "studio" }), departments), "studio");
  assert.equal(mod.departmentOf(item("b", { source: "books", department: null }), departments), "", "placed nowhere stays nowhere");
  assert.equal(mod.departmentOf(item("c", { department: "nonsense" }), departments), "");
  assert.equal(mod.departmentOf(item("d", { department: "books" }), null), "books", "no map needed");
});

test("needs-you: with the home server's departments, the chips add up to All for the seed of 20", () => {
  const where = ["operations", "operations", "operations", "marketing", "marketing", "books", "books", "books", "books", "people",
    "support", "operations", "studio", "operations", "operations", "studio", "marketing", "operations", "operations", "operations"];
  const items = where.map((d, i) => item(`i${i}`, { agent: { slug: "chief-of-staff" }, department: d }));
  const chips = mod.chipsFor(items, departments, "");
  assert.equal(chips[0].count, 20);
  assert.equal(chips.slice(1).reduce((n, c) => n + c.count, 0), 20, "every item is under one chip");
  for (const c of chips.slice(1)) assert.equal(mod.itemsFor(items, departments, c.id).length, c.count, c.id);
});

test("needs-you: urgent first, then newest; bad entries are dropped", () => {
  const out = mod.sortItems([
    item("old", { when: "2026-11-01T00:00:00Z" }),
    item("new", { when: "2026-11-10T00:00:00Z" }),
    item("hot", { severity: "high", when: "2026-10-01T00:00:00Z" }),
    null,
    { title: "no id" },
  ]);
  assert.deepEqual(out.map((i) => i.id), ["hot", "new", "old"]);
  assert.deepEqual(mod.sortItems(undefined), []);
});

test("needs-you: the address filters by department, and only by a known one", () => {
  assert.equal(mod.filterOf(new URLSearchParams("d=sales")), "sales");
  assert.equal(mod.filterOf(new URLSearchParams("d=nonsense")), "");
  assert.equal(mod.filterOf(new URLSearchParams("")), "");
  assert.equal(mod.address("studio"), "#/needs-you?d=studio");
  assert.equal(mod.address(""), "#/needs-you");
  assert.equal(mod.address("../x"), "#/needs-you");
  const items = [item("a", { agent: { slug: "artist" } }), item("b", { source: "books" }), item("c", { agent: { slug: "artist" }, when: "2026-11-12T00:00:00Z" })];
  assert.deepEqual(mod.itemsFor(items, departments, "studio").map((i) => i.id), ["c", "a"]);
  assert.deepEqual(mod.itemsFor(items, departments, "").length, 3);
  assert.deepEqual(mod.itemsFor(items, departments, "sales"), []);
});

test("needs-you: the chips are All, then each department that has an item, with counts", () => {
  const items = [item("a", { agent: { slug: "artist" } }), item("b", { source: "books" }), item("c", { agent: { slug: "artist" } })];
  const chips = mod.chipsFor(items, departments, "");
  assert.deepEqual(chips.map((c) => [c.id, c.count]), [["", 3], ["studio", 2], ["books", 1]]);
  assert.equal(chips[1].href, "#/needs-you?d=studio");
  // A department asked for by the address stays a chip even when it has nothing.
  assert.deepEqual(mod.chipsFor(items, departments, "people").map((c) => c.id), ["", "studio", "people", "books"]);
});

test("needs-you: the not-connected lines are plain words, capped", () => {
  const lines = mod.quietLines(Array.from({ length: 14 }, (_, i) => ({ source: i ? "books" : "mystery", reason: "x".repeat(300) })));
  assert.equal(lines.length, 10);
  assert.equal(lines[0].source, "A part");
  assert.equal(lines[1].source, "The books");
  assert.ok(lines[0].reason.length <= 200);
  assert.deepEqual(mod.quietLines(null), []);
});

test("needs-you: the page uses the approval card and refreshes every 10 seconds", () => {
  const src = readFileSync(resolve(HERE, "../../pages/needs-you.js"), "utf8");
  assert.match(src, /DecisionCard/);
  assert.match(src, /every: 10000/);
  assert.match(src, /refreshShell/);
  assert.match(src, /Nothing needs you\./);
});

// PLAN-V5 K9, T20: a finished task with versions is a card of versions; after a pick its outcome stays in view.
test("needs-you: a card of versions is shown with the kit's PickCard; any other item keeps the approval card", () => {
  const src = readFileSync(resolve(HERE, "../../pages/needs-you.js"), "utf8");
  assert.match(src, /isPickItem\(item\)\s*\n?\s*\? html`<\$\{PickCard\}/);
  assert.match(src, /: html`<\$\{DecisionCard\} key=\$\{item\.id\} item=\$\{item\} onDone=\$\{done\} \/>`/);
});

test("needs-you: the outcome of a pick stays once its item has left the list, newest first, at most three", () => {
  const settled = [{ id: "goal:3" }, { id: "goal:2" }, { id: "goal:1" }, { id: "goal:0" }, null, { title: "no id" }];
  assert.deepEqual(mod.settledShown(settled, [item("goal:2")]).map((s) => s.id), ["goal:3", "goal:1", "goal:0"]);
  assert.deepEqual(mod.settledShown(settled, []).map((s) => s.id), ["goal:3", "goal:2", "goal:1"]);
  assert.deepEqual(mod.settledShown(null, null), []);
});

// PLAN-V5 K14, T45: a film's shotlist is a card of its own, and its outcome stays like a pick's.
test("needs-you: an item of kind shotlist is shown with ShotlistCard, before PickCard and DecisionCard", () => {
  const src = readFileSync(resolve(HERE, "..", "..", "pages", "needs-you.js"), "utf8");
  assert.match(src, /isShotlistItem\(item\)\s*\n?\s*\? html`<\$\{ShotlistCard\} key=\$\{item\.id\} item=\$\{item\} onDone=\$\{done\} \/>`/);
  assert.match(src, /s\.kind === "shotlist"\s*\n?\s*\? html`<\$\{ShotlistDone\}/);
  assert.doesNotMatch(src, /innerHTML/);
});

test("needs-you: a shotlist's settled outcome stays at the top once its item has left the list", () => {
  const settled = [{ id: "staged:shotlist:g1", kind: "shotlist", action: "approve" }];
  assert.equal(mod.settledShown(settled, []).length, 1);
  assert.equal(mod.settledShown(settled, [{ id: "staged:shotlist:g1" }]).length, 0);
});
