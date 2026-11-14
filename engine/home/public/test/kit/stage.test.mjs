// The kit's stage part (T12 of PLAN-COOK): registered, its builder fills it in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT } from "./_dom.mjs";
import { ROOTS, newSheetTest } from "./_rules.mjs";

const mod = await import(pathToFileURL(join(KIT, "stage.js")).href);

test("stage.js loads in Node and exports its parts as functions", () => {
  for (const name of ["Shot", "Frames", "Frame", "StageBar", "Pin", "Finds", "PicTag", "Pair", "Verdict"]) assert.equal(typeof mod[name], "function", `${name} is a function`);
});

ROOTS.stage = "k-stage";
newSheetTest("stage");
