// The kit's overlays (CONTRACTS-V2 13.1, V3 27.3): chrome glass with the pop shadow, and the stylesheet's rules.
// Split out of kit-a (T01 of PLAN-COOK). The drawers' M55 test is the shell's (shell-m55.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STYLES } from "./_dom.mjs";
import { stripComments, primitiveSheetTests, narrowControlsTest } from "./_rules.mjs";

// From "the primitives' stylesheets follow the rules of V3 27.3" (kit-a).
test("overlays: overlays are chrome glass", () => {
  const overlays = stripComments(readFileSync(join(STYLES, "overlays.css"), "utf8"));
  assert.match(overlays, /backdrop-filter: blur\(var\(--blur-chrome\)\)/, "overlays are chrome glass");
});

test("overlays: overlays carry the pop shadow", () => {
  const overlays = stripComments(readFileSync(join(STYLES, "overlays.css"), "utf8"));
  assert.match(overlays, /var\(--shadow-pop\)/, "overlays carry the pop shadow");
});

primitiveSheetTests("overlays");
narrowControlsTest("overlays");
