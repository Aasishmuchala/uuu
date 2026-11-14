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
  assert.doesNotMatch(s, /outline: none;/, "focus keeps the 2 px ring");
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

primitiveSheetTests("fields");
narrowControlsTest("fields");
