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
