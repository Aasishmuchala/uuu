// The kit's tabs (CONTRACTS-V2 13.1): they wrap instead of hiding, and the stylesheet's rules. Split out of
// kit-a and kit-u1 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC } from "./_dom.mjs";
import { primitiveSheetTests, narrowControlsTest } from "./_rules.mjs";

test("Tabs wrap onto a second line instead of hiding tabs off the edge", () => {
  const css = readFileSync(join(PUBLIC, "styles", "kit", "tabs.css"), "utf8");
  const row = /\.k-tabs\s*\{([^}]*)\}/.exec(css)[1];
  assert.match(row, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(row, /overflow-x:\s*auto/);
});

primitiveSheetTests("tabs");
narrowControlsTest("tabs");
