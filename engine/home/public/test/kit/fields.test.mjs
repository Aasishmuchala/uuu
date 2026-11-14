// The kit's fields (CONTRACTS-V2 13.1): the money input, the controls' look, and the stylesheet's rules. Split out of
// kit-a (T01 of PLAN-COOK); the money input and the look added by T31.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, elements, mount, unmount, fire } from "./_dom.mjs";
import { css, primitiveSheetTests, narrowControlsTest } from "./_rules.mjs";

const kit = { fields: await import(pathToFileURL(join(KIT, "fields.js")).href) };

test("MoneyInput: the sign, then the number as typed; it takes a string and gives the string, never rounded", async () => {
  installDom();
  const got = [];
  const root = await mount(kit.fields.MoneyInput, { value: 3, label: "Today's limit", onInput: (v) => got.push(v) });
  const box = root.firstChild;
  assert.match(box.getAttribute("class"), /^k-money-input$/);
  const sign = elements(root).find((e) => e.getAttribute("class") === "k-money-input__sign");
  assert.equal(sign.firstChild.data, "$");
  assert.equal(sign.getAttribute("aria-hidden"), "true");
  const input = elements(root).find((e) => e.localName === "input");
  assert.equal(input.getAttribute("inputmode"), "decimal");
  assert.equal(input.getAttribute("aria-label"), "Today's limit");
  assert.equal(String(input.value ?? input.getAttribute("value")), "3");
  input.value = "3.005";
  fire(input, "input");
  assert.deepEqual(got, ["3.005"], "the string typed, not a rounded number");
  unmount(root);
  const euro = await mount(kit.fields.MoneyInput, { currency: "€", disabled: true });
  assert.match(euro.firstChild.getAttribute("class"), /k-money-input--disabled/);
  assert.equal(elements(euro).find((e) => e.getAttribute("class") === "k-money-input__sign").firstChild.data, "€");
  unmount(euro);
});

test("inputs, text areas, selects and the money input: 36 px, the control corner, a firm edge, the third ink for placeholders", () => {
  const s = css("kit/fields.css");
  const shared = /\.k-input,\s*\.k-textarea,\s*\.k-select__control,\s*\.k-money-input\s*\{([^}]*)\}/.exec(s);
  assert.ok(shared, "one look for all four");
  assert.match(shared[1], /min-height: var\(--h-md\);/);
  assert.match(shared[1], /border-radius: var\(--r-2\);/);
  assert.match(shared[1], /border: 1px solid var\(--line-2\);/);
  assert.match(shared[1], /font-size: var\(--fs-ui\);/);
  assert.match(s, /::placeholder\s*\{\s*color: var\(--ink-3\);/);
  assert.match(/\}\s*\.k-money-input\s*\{([^}]*)\}/.exec(s)[1], /width: 116px;/);
  assert.match(/\.k-money-input__control\s*\{([^}]*)\}/.exec(s)[1], /text-align: right;[\s\S]*font-variant-numeric: tabular-nums;/);
  assert.doesNotMatch(s, /outline: none;/, "focus is never taken away: the ring stays drawn");
  assert.doesNotMatch(s, /r-pill/);
});

test("Switch: 38 x 22, the raised track off, the accent fill on, and role switch", async () => {
  const s = css("kit/fields.css");
  const track = /\.k-switch__track\s*\{([^}]*)\}/.exec(s)[1];
  assert.match(track, /width: 38px;\s*height: 22px;/);
  assert.match(track, /background: var\(--raise-2\);/);
  assert.match(/\.k-switch--on \.k-switch__track\s*\{([^}]*)\}/.exec(s)[1], /background: var\(--accent-fill\);/);
  installDom();
  const root = await mount(kit.fields.Switch, { on: true, label: "Let the Artist use Runway" });
  const b = elements(root).find((e) => e.localName === "button");
  assert.equal(b.getAttribute("role"), "switch");
  assert.equal(b.getAttribute("aria-checked"), "true");
  unmount(root);
});

test("T100: a text field's focus is a 1 px accent edge with a 3 px ring of the accent at 25 percent; the switch keeps the 2 px accent ring", () => {
  const s = css("kit/fields.css");
  const ring = /\{\s*outline: 2px solid var\(--focus\);\s*outline-offset: 2px;/;
  const fields = /\.k-input:focus-visible,\s*\.k-textarea:focus-visible,\s*\.k-select__control:focus-visible,\s*\.k-money-input:focus-within\s*(\{[^}]*\})/.exec(s);
  assert.ok(fields, "inputs, text areas, selects and the money input's box draw the ring on focus");
  assert.match(fields[1], /box-shadow: 0 0 0 3px color-mix\(in srgb, var\(--focus\) 25%, transparent\);/, "a 3 px ring of the accent at 25 percent");
  assert.match(fields[1], /outline: 2px solid transparent;/, "the outline stays, transparent, for forced colours");
  assert.match(/\.k-input:focus,\s*\.k-textarea:focus,\s*\.k-select__control:focus,\s*\.k-money-input:focus-within\s*\{([^}]*)\}/.exec(s)[1], /border-color: var\(--accent\);/, "the 1 px edge turns to the accent");
  assert.match(s, new RegExp(String.raw`\.k-switch__control:focus-visible\s*` + ring.source), "the switch's ring is the accent, 2 px");
  assert.doesNotMatch(s, /outline: 3px|outline: [^;]*var\(--ink\)/, "no ring in the ink colour");
});

test("T97: a disabled field is the inert fill with a solid hairline and the third ink; a disabled switch is plainly inert", () => {
  const s = css("kit/fields.css");
  const off = /\.k-input:disabled,\s*\.k-textarea:disabled,\s*\.k-select__control:disabled,\s*\.k-money-input--disabled\s*\{([^}]*)\}/.exec(s);
  assert.ok(off);
  assert.match(off[1], /border-style: solid;/);
  assert.match(off[1], /border-color: var\(--line\);/);
  assert.match(off[1], /background: color-mix\(in srgb, var\(--ink\) 5%, var\(--raise\)\);/, "the disabled button's inert fill");
  assert.match(off[1], /color: var\(--ink-3\);/);
  assert.match(off[1], /cursor: not-allowed;/);
  assert.doesNotMatch(s, /dashed/, "no dashed edge");
  assert.doesNotMatch(css("kit/job.css"), /\.k-input:disabled[^{]*\{[^}]*dashed/, "nor in a job's switched-off questions");
  // The switch: the track at low contrast on the inert fill, the thumb flat, the pointer says no.
  assert.match(/\.k-switch--disabled \.k-switch__control\s*\{([^}]*)\}/.exec(s)[1], /cursor: not-allowed;/);
  assert.match(/\.k-switch--disabled \.k-switch__track,[^{]*\{([^}]*)\}/.exec(s)[1], /background: color-mix\(in srgb, var\(--ink\) 5%, var\(--raise\)\);/);
  const thumb = /\.k-switch--disabled \.k-switch__thumb,[^{]*\{([^}]*)\}/.exec(s)[1];
  assert.match(thumb, /background: var\(--line-2\);/);
  assert.match(thumb, /box-shadow: none;/);
  assert.match(/\.k-switch--disabled \.k-switch__state\s*\{([^}]*)\}/.exec(s)[1], /color: var\(--ink-3\);/);
});

test("T97: a disabled Switch stays reachable, says it is disabled, and does not change", async () => {
  installDom();
  let changed = 0;
  const root = await mount(kit.fields.Switch, { on: false, disabled: true, label: "Make videos", explain: "Add a key first.", onChange: () => { changed++; } });
  assert.match(root.firstChild.getAttribute("class"), /k-switch--disabled/);
  const b = elements(root).find((e) => e.localName === "button");
  assert.equal(b.getAttribute("aria-disabled"), "true");
  assert.equal(b.getAttribute("disabled"), null, "still a Tab stop, so its explanation can be read");
  fire(b, "click");
  assert.equal(changed, 0);
  unmount(root);
});

primitiveSheetTests("fields");
narrowControlsTest("fields");
