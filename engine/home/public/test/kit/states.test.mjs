// The kit's states (CONTRACTS-V2 13.1): the error notice's one word, and the stylesheet's rules. Split out of
// kit-a and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, textOf, showNow as show } from "./_dom.mjs";
import { primitiveSheetTests } from "./_rules.mjs";

const states = await import(pathToFileURL(join(KIT, "states.js")).href);

test("one name for one button: the error notice says Try again (M51 F18, C3 25)", () => {
  const root = show(states.ErrorNotice, { error: new Error("The board did not answer."), onRetry() {} });
  assert.match(textOf(root), /Try again/);
  assert.doesNotMatch(textOf(root), /Retry/);
});

primitiveSheetTests("states");
