// The kit's status dots (CONTRACTS-V2 13.1): motion off stops the live dot (and the loading lines, read from
// states.css), and the stylesheet's rules. Split out of kit-a and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { css, primitiveSheetTests } from "./_rules.mjs";

test("motion off stops the live dot and the loading lines too", () => {
  assert.match(css("kit/status.css"), /\[data-motion="off"\] \.k-dot--pulse \.k-dot__mark::after\s*\{\s*animation: none;/);
  assert.match(css("kit/states.css"), /\[data-motion="off"\] \.k-loading__line\s*\{\s*animation: none;/);
});

primitiveSheetTests("status");
