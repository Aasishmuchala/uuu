// The kit's overlays (CONTRACTS-V2 13.1, V3 27.3): an opaque panel with the float shadow, and the stylesheet's rules.
// Split out of kit-a (T01 of PLAN-COOK). The drawers' M55 test is the shell's (shell-m55.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STYLES } from "./_dom.mjs";
import { stripComments, primitiveSheetTests, narrowControlsTest } from "./_rules.mjs";

// From "the primitives' stylesheets follow the rules of V3 27.3" (kit-a).
test("overlays: an overlay is an opaque panel and blurs nothing behind it", () => {
  const overlays = stripComments(readFileSync(join(STYLES, "overlays.css"), "utf8"));
  assert.match(overlays, /\.k-menu__list \{[^}]*background: var\(--panel\)/, "the menu is an opaque panel");
  assert.match(overlays, /\.k-drawer__panel \{[^}]*background: var\(--panel\)/, "the dialog and the drawer are opaque panels");
  assert.doesNotMatch(overlays, /backdrop-filter/, "an overlay blurs nothing behind it");
});

test("overlays: overlays carry the float shadow", () => {
  const overlays = stripComments(readFileSync(join(STYLES, "overlays.css"), "utf8"));
  assert.match(overlays, /var\(--float\)/, "overlays carry the float shadow");
});

primitiveSheetTests("overlays");
narrowControlsTest("overlays");
