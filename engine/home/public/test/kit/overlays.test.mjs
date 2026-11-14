// The kit's overlays (CONTRACTS-V2 13.1, V3 27.3): an opaque panel with the float shadow, and the stylesheet's rules.
// Split out of kit-a (T01 of PLAN-COOK). The drawers' M55 test is the shell's (shell-m55.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STYLES, KIT, html, render, FakeElement, elements, installDom, settle, fire, textOf } from "./_dom.mjs";
import { pathToFileURL } from "node:url";
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

// PLAN-COOK T94: a menu says which item is current and starts there.
test("Menu: a current item is a menuitemradio, checked; focus starts on it, else on the first; no current item changes nothing", async () => {
  const { Menu } = await import(pathToFileURL(join(KIT, "overlays.js")).href);
  installDom();
  const was = FakeElement.prototype.querySelectorAll;
  FakeElement.prototype.querySelectorAll = function () {
    return elements(this).filter((e) => /^menuitem/.test(e.getAttribute("role") || ""));
  };
  const open = async (items) => {
    const root = new FakeElement("div");
    document.body.appendChild(root);
    render(html`<${Menu} label="Agent" items=${items} />`, root);
    await settle();
    fire(elements(root).find((e) => e.localName === "button" && e.getAttribute("aria-haspopup") === "menu"), "click");
    await settle();
    return root;
  };
  try {
    const plain = await open([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
    const items = elements(plain).filter((e) => /^menuitem/.test(e.getAttribute("role") || ""));
    assert.deepEqual(items.map((e) => e.getAttribute("role")), ["menuitem", "menuitem"]);
    assert.ok(items.every((e) => e.getAttribute("aria-checked") === null));
    assert.equal(document.activeElement, items[0], "no current item: focus starts on the first");
    const chosen = await open([{ id: "a", label: "A" }, { id: "b", label: "B", current: true }, { id: "c", label: "C" }]);
    const radios = elements(chosen).filter((e) => /^menuitem/.test(e.getAttribute("role") || ""));
    assert.deepEqual(radios.map((e) => e.getAttribute("role")), ["menuitemradio", "menuitemradio", "menuitemradio"]);
    assert.deepEqual(radios.map((e) => e.getAttribute("aria-checked")), ["false", "true", "false"]);
    assert.equal(document.activeElement, radios[1], "focus starts on the current item");
    assert.equal(textOf(radios[1]).trim(), "B");
  } finally {
    FakeElement.prototype.querySelectorAll = was;
  }
});
