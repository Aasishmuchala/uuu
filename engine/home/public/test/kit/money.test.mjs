// The kit's money part (T12 of PLAN-COOK): registered, its builder fills it in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT } from "./_dom.mjs";
import { ROOTS, newSheetTest } from "./_rules.mjs";

const mod = await import(pathToFileURL(join(KIT, "money.js")).href);

test("money.js loads in Node and exports its parts as functions", () => {
  for (const name of ["moneyParts", "MoneyBlock", "Meter", "Sum"]) assert.equal(typeof mod[name], "function", `${name} is a function`);
});

ROOTS.money = "k-money";
newSheetTest("money");
