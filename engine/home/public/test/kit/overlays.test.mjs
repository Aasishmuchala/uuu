// The kit's overlays (CONTRACTS-V2 13.1, V3 27.3): an opaque panel with the float shadow, and the stylesheet's rules.
// Split out of kit-a (T01 of PLAN-COOK). The drawers' M55 test is the shell's (shell-m55.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STYLES } from "./_dom.mjs";
import { css, stripComments, primitiveSheetTests, narrowControlsTest } from "./_rules.mjs";

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

test("overlays: a dialog has the 12 px corner, a 16 px title and its primary last; a menu has the 8 px corner and 32 px rows; the drawer is a 380 px sheet", () => {
  const o = css("kit/overlays.css");
  assert.match(o, /\.k-dialog__panel \{[^}]*border-radius: var\(--r-3\);/);
  assert.match(o, /\.k-dialog__title,\s*\.k-drawer__title \{[^}]*font-size: var\(--fs-section\);[^}]*font-weight: var\(--fw-bold\);/);
  assert.match(o, /\.k-dialog__foot \{[^}]*justify-content: flex-end;/, "the actions at the right of the foot");
  assert.match(o, /\.k-dialog__foot \.k-btn--primary,\s*\.k-dialog__foot \.k-btn--accept \{\s*order: 1;/, "the primary goes last");
  assert.match(o, /\.k-menu__list \{[^}]*border-radius: var\(--r-2\);[^}]*box-shadow: var\(--float\);/);
  assert.match(o, /\.k-menu__item \{[^}]*min-height: var\(--s-8\);/, "32 px rows");
  assert.match(o, /\.k-drawer__panel \{\s*width: min\(88vw, var\(--panel-w\)\);/);
});

primitiveSheetTests("overlays");
narrowControlsTest("overlays");
