// The kit's table and figures (CONTRACTS-V2 13.2, M51). Split out of kit-b and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, showTree, elements, textOf } from "./_dom.mjs";
import { css, compositeSheetTests } from "./_rules.mjs";

const table = await import(pathToFileURL(join(KIT, "table.js")).href);

test("a figure never breaks over two lines; a long one is drawn smaller (M51 F13)", () => {
  assert.equal(table.figureClass("12"), "k-figures__value");
  assert.equal(table.figureClass("₹ 1,18,000.00"), "k-figures__value k-figures__value--long");
  assert.equal(table.figureClass("₹ 1,18,00,000.00 due"), "k-figures__value k-figures__value--longer");
  const t = css("kit/table.css");
  assert.match(t, /\.k-figures__value\s*\{[^}]*white-space: nowrap;/);
  assert.doesNotMatch(t, /overflow-wrap: break-word/);
  assert.match(t, /\.k-table__table td > \*\s*\{\s*justify-self: start;/, "a chip in a stacked cell keeps its width (M51 F21)");
});

test("amounts and dates sit at the right in tabular figures, the unit small and grey; 12 px headings over 48 px rows of 14 px values (corrections after round 3, 4)", async () => {
  const { isFigure, numericColumn, splitUnit, DataTable } = table;
  for (const v of ["12", "$1.10", "₹ 1,18,000.00", "40%", "5 s", "120 credits", "-3", "2026-11-14", "14 Nov", "14 Nov 2026", "05:28", 7]) assert.ok(isFigure(v), `${v} is a figure`);
  for (const v of ["STH-25", "Shot 1", "", null, "about $1", "Today", "1 of 3 made"]) assert.ok(!isFigure(v), `${v} is not a figure`);
  const rows = [{ name: "Today", spent: "$2.00", ref: "STH-25" }, { name: "This month", spent: "$3.70", ref: "" }];
  assert.equal(numericColumn({ key: "spent" }, rows), true);
  assert.equal(numericColumn({ key: "name" }, rows), false);
  assert.equal(numericColumn({ key: "name", align: "end" }, rows), true);
  assert.equal(numericColumn({ key: "spent", align: "start" }, rows), false);
  assert.equal(numericColumn({ key: "ref" }, rows), false);
  assert.deepEqual(splitUnit("120 credits"), ["120", "credits"]);
  assert.deepEqual(splitUnit("$1.10"), ["$1.10", ""]);
  assert.deepEqual(splitUnit("14 Nov"), ["14 Nov", ""]);
  installDom();
  const root = await showTree(DataTable, { columns: [{ key: "name", label: "Limit" }, { key: "spent", label: "Spent" }, { key: "used", label: "Used" }], rows: [{ id: "a", name: "Today", spent: "$2.00", used: "200 credits" }] });
  const cells = elements(root).filter((e) => e.localName === "td" || e.localName === "th");
  assert.deepEqual(cells.map((e) => e.getAttribute("class") || ""), ["", "k-table__num", "k-table__num", "", "k-table__num", "k-table__num"]);
  const unit = elements(root).find((e) => (e.getAttribute("class") || "") === "k-table__unit");
  assert.equal(textOf(unit), "credits");
  const t = css("kit/table.css");
  assert.match(t, /\.k-table__table th \{[^}]*font-size: var\(--fs-label\);[^}]*color: var\(--ink-3\);/);
  assert.match(t, /\.k-table__table td \{[^}]*height: var\(--s-12\);[^}]*border-top: 1px solid var\(--line\);/);
  assert.match(t, /\.k-table__table \{[^}]*font-size: var\(--fs-ui\);/);
  assert.match(t, /\.k-table__table \.k-table__num \{\s*text-align: right;\s*font-variant-numeric: tabular-nums;/);
  assert.match(t, /\.k-table__unit \{[^}]*color: var\(--ink-3\);/);
  assert.match(t, /tr:has\(a\[href\]\):hover \{\s*background-color: var\(--ctl\);/, "a row that opens something answers the pointer");
  assert.doesNotMatch(t, /\.k-table \{[^}]*(border|background)/, "the table has no frame of its own");
});

compositeSheetTests("table");
