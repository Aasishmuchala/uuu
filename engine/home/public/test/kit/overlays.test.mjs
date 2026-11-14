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

test("overlays: a dialog has the 12 px corner, a 15 px title and its primary last; a drawer's title is 16 px; a menu has the 8 px corner and 32 px rows; the drawer is a 380 px sheet", () => {
  const o = css("kit/overlays.css");
  assert.match(o, /\.k-dialog__panel \{[^}]*border-radius: var\(--r-3\);/);
  assert.match(o, /\.k-dialog__title \{[^}]*font-size: var\(--fs-fact\);[^}]*font-weight: var\(--fw-bold\);/, "the dialog's title line is 15 px, 600");
  assert.match(o, /\.k-drawer__title \{[^}]*font-size: var\(--fs-section\);[^}]*font-weight: var\(--fw-bold\);/);
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

// PLAN-COOK T102: the kit's Dialog for every caller.
test("T102: a dialog is centred with 48 px of scrim on every side, a 1 px border, the float shadow, a muted second line, a 32 px close and a body that scrolls inside it", () => {
  const o = css("kit/overlays.css");
  assert.match(o, /\.k-dialog \{\s*align-items: center;\s*justify-content: center;\s*padding: var\(--s-12\);/, "centred, 48 px all round");
  assert.match(o, /\.k-dialog__backdrop,\s*\.k-drawer__backdrop \{[^}]*background: var\(--scrim\);/, "the scrim token");
  assert.match(o, /\.k-dialog__panel \{[^}]*max-height: 100%;[^}]*border: 1px solid var\(--line-2\);[^}]*border-radius: var\(--r-3\);/);
  assert.match(o, /\.k-dialog__panel,\s*\.k-drawer__panel \{[^}]*box-shadow: var\(--float\);/);
  assert.match(o, /\.k-dialog__sub \{[^}]*color: var\(--ink-2\);/, "the second line is muted");
  assert.match(o, /\.k-dialog__close\.k-btn \{[^}]*width: var\(--s-8\);[^}]*height: var\(--s-8\);/, "a 32 px target");
  assert.match(o, /\.k-dialog__body,\s*\.k-drawer__body \{[^}]*min-height: 0;[^}]*overflow-y: auto;/, "the body scrolls inside");
  assert.match(o, /\.k-dialog--full \.k-dialog__backdrop \{\s*background: var\(--bg\);/, "a viewer hides the page under the scrim");
  assert.match(o, /\.k-dialog--full \.k-dialog__backdrop::after \{[^}]*background: var\(--scrim\);/);
});

test("T102: Dialog draws its title, the muted line and the head's controls before Close; the foot and the body as before; an unknown size is md", async () => {
  const { Dialog } = await import(pathToFileURL(join(KIT, "overlays.js")).href);
  installDom();
  const root = new FakeElement("div");
  document.body.appendChild(root);
  render(html`<${Dialog} open=${true} title="Opened larger" sub="55 of 70" size="full" onClose=${() => {}}
    tools=${html`<button type="button" class="t-switch">Phone</button>`} footer=${html`<button type="button">Keep</button>`}>
    <p>Body</p>
  <//>`, root);
  await settle();
  const head = elements(root).find((e) => e.getAttribute("class") === "k-dialog__head");
  assert.deepEqual(elements(head).filter((e) => e.localName === "h2" || e.localName === "p" || e.localName === "button").map((e) => textOf(e) || e.getAttribute("aria-label")),
    ["Opened larger", "55 of 70", "Phone", "Close"], "title, muted line, the switch, then Close");
  assert.ok(elements(root).some((e) => e.getAttribute("class") === "k-dialog k-dialog--full"));
  assert.ok(elements(root).some((e) => e.getAttribute("class") === "k-dialog__panel k-dialog__panel--full"));
  assert.equal(textOf(elements(root).find((e) => e.getAttribute("class") === "k-dialog__foot")), "Keep");
  const panel = elements(root).find((e) => e.getAttribute("role") === "dialog");
  assert.equal(panel.getAttribute("aria-labelledby"), elements(head).find((e) => e.localName === "h2").getAttribute("id"));
  render(null, root);
  const odd = new FakeElement("div");
  render(html`<${Dialog} open=${true} title="Plain" size="huge" onClose=${() => {}}>x<//>`, odd);
  await settle();
  assert.ok(elements(odd).some((e) => e.getAttribute("class") === "k-dialog__panel k-dialog__panel--md"));
  assert.ok(!elements(odd).some((e) => e.getAttribute("class") === "k-dialog__sub"), "no sub, no line");
  render(null, odd);
});
