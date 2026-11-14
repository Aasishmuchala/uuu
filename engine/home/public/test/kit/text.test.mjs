// The kit's text parts (CONTRACTS-V2 13.1): the stylesheet's rules. Split out of kit-a (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { css, primitiveSheetTests } from "./_rules.mjs";

test("Kbd: 12 px words of weight 500 in a 1 px box with a 5 px corner, no thick bottom edge", () => {
  const k = /\.k-kbd\s*\{([^}]*)\}/.exec(css("kit/text.css"))[1];
  assert.match(k, /border: 1px solid var\(--line-2\);/);
  assert.match(k, /border-radius: 5px;/);
  assert.match(k, /font-size: var\(--fs-label\);/);
  assert.match(k, /font-weight: var\(--fw-medium\);/);
  assert.doesNotMatch(k, /border-bottom-width/);
});

primitiveSheetTests("text");
