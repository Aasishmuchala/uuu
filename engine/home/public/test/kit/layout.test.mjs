// The kit's layout part (T12 of PLAN-COOK): registered, its builder fills it in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT } from "./_dom.mjs";
import { ROOTS, newSheetTest } from "./_rules.mjs";

const mod = await import(pathToFileURL(join(KIT, "layout.js")).href);

test("layout.js loads in Node and exports its parts as functions", () => {
  for (const name of ["StageLayout", "DocLayout", "Group", "Rows", "Row", "Blk"]) assert.equal(typeof mod[name], "function", `${name} is a function`);
});

ROOTS.layout = "k-layout";
newSheetTest("layout");
