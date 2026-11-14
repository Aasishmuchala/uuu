// The kit's table and figures (CONTRACTS-V2 13.2, M51). Split out of kit-b and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT } from "./_dom.mjs";
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

compositeSheetTests("table");
