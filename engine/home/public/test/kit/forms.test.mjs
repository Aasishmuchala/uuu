// The kit's forms (CONTRACTS-V3 28, M18, M52): checkForm, FormFields mounted, the rows form. Split out of kit-c
// and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, elements, textOf, mount, unmount, fire } from "./_dom.mjs";
import { BRAND, SERVICES } from "./_fixtures.mjs";
import { css, newSheetTest } from "./_rules.mjs";

const kit = { forms: await import(pathToFileURL(join(KIT, "forms.js")).href) };

// ---- checkForm ----

const good = { tone: ["warm", "plain", "exact"], colours: ["#2f6f5e"], fonts: "Didot", signoff: "With thanks", story: "We fit kitchens." };

test("checkForm: good values pass", () => {
  assert.deepEqual(kit.forms.checkForm(BRAND, good), { ok: true, errors: {} });
  assert.deepEqual(kit.forms.checkForm(SERVICES, { items: [{ name: "Survey", price: "2500" }] }), { ok: true, errors: {} });
});

test("checkForm: line and text", () => {
  const f = kit.forms.checkForm;
  assert.match(f(BRAND, { ...good, story: "  " }).errors.story, /Fill this in/);
  assert.match(f(BRAND, { ...good, story: "x".repeat(4001) }).errors.story, /4000/);
  assert.equal(f(BRAND, { ...good, story: "x".repeat(4000) }).ok, true);
  assert.equal(f(BRAND, { ...good, signoff: "" }).ok, true, "an empty optional line is fine");
  assert.match(f(BRAND, { ...good, signoff: "x".repeat(201) }).errors.signoff, /200/);
  assert.match(f(BRAND, { ...good, signoff: "one\ntwo" }).errors.signoff, /one line/);
});

test("checkForm: list", () => {
  const f = kit.forms.checkForm;
  assert.match(f(BRAND, { ...good, tone: [] }).errors.tone, /Fill this in/);
  assert.match(f(BRAND, { ...good, tone: ["", "  "] }).errors.tone, /Fill this in/, "blank lines do not count");
  assert.match(f(BRAND, { ...good, tone: ["a", "b", "c", "d", "e", "f"] }).errors.tone, /at most 5/);
  assert.equal(f(BRAND, { ...good, tone: ["a", "", "b"] }).ok, true);
  assert.match(f(BRAND, { ...good, tone: ["x".repeat(201)] }).errors.tone, /200/);
  assert.match(f(BRAND, { ...good, tone: "warm" }).errors.tone, /Fill this in/, "a list that is not a list is empty");
});

test("checkForm: rows", () => {
  const f = kit.forms.checkForm;
  assert.match(f(SERVICES, { items: [] }).errors.items, /at least one row/);
  assert.match(f(SERVICES, { items: [{ name: " ", price: "" }] }).errors.items, /at least one row/);
  assert.match(f(SERVICES, { items: Array.from({ length: 61 }, (_, i) => ({ name: `n${i}` })) }).errors.items, /60 rows/);
  assert.match(f(SERVICES, { items: [{ name: "x".repeat(201) }] }).errors.items, /200/);
});

test("checkForm: colour", () => {
  const f = kit.forms.checkForm;
  assert.match(f(BRAND, { ...good, colours: [] }).errors.colours, /at least one colour/);
  assert.match(f(BRAND, { ...good, colours: ["teal"] }).errors.colours, /six letters or numbers/);
  assert.match(f(BRAND, { ...good, colours: ["#fff"] }).errors.colours, /six letters or numbers/);
  assert.match(f(BRAND, { ...good, colours: ["#000000", "#111111", "#222222", "#333333", "#444444", "#555555"] }).errors.colours, /at most 5/);
  assert.equal(f(BRAND, { ...good, colours: ["#ABCDEF", ""] }).ok, true);
});

test("checkForm: choice, and nothing given at all", () => {
  const f = kit.forms.checkForm;
  assert.match(f(BRAND, { ...good, fonts: "Comic" }).errors.fonts, /Pick one of the choices/);
  assert.equal(f(BRAND, { ...good, fonts: "" }).ok, true, "an optional choice may be left");
  const req = { ...BRAND, fields: [{ ...BRAND.fields[2], required: true }] };
  assert.match(f(req, {}).errors.fonts, /Pick one/);
  const none = f(BRAND, null);
  assert.equal(none.ok, false);
  assert.deepEqual(Object.keys(none.errors).sort(), ["colours", "story", "tone"]);
  assert.deepEqual(f(null, {}), { ok: true, errors: {} });
});

// ---- FormFields, mounted ----

test("FormFields: each kind draws its control and an edit hands back the whole set of values", async () => {
  installDom();
  const changes = [];
  const form = { ...BRAND, fields: [...BRAND.fields, ...SERVICES.fields] };
  const root = await mount(kit.forms.FormFields, { form, values: { tone: ["warm"], colours: ["#2f6f5e"], fonts: "Didot" }, errors: { tone: "Fill this in." }, onChange: (v) => changes.push(v) });
  const els = elements(root);
  assert.ok(els.some((e) => e.localName === "textarea"), "list and text are text areas");
  assert.ok(els.some((e) => e.localName === "input" && e.getAttribute("type") === "color"), "a colour picker");
  assert.ok(els.some((e) => e.localName === "select"), "a choice");
  assert.ok(els.some((e) => e.localName === "fieldset"), "rows and colours are fieldsets");
  assert.match(textOf(root), /Fill this in\./);
  assert.match(textOf(root), /\(optional\)/);
  const line = els.find((e) => e.localName === "input" && e.getAttribute("type") === "text" && e.getAttribute("maxlength") === "200" && !e.getAttribute("aria-label"));
  fire(line, "input", { target: { value: "With thanks" } });
  assert.deepEqual(changes.at(-1), { tone: ["warm"], colours: ["#2f6f5e"], fonts: "Didot", signoff: "With thanks" });
  const list = els.find((e) => e.localName === "textarea");
  fire(list, "input", { target: { value: "warm\nplain" } });
  assert.deepEqual(changes.at(-1).tone, ["warm", "plain"]);
  unmount(root);
});

test("the rows form stays inside its box and stacks when its columns do not fit (M18-21, M52 F3)", () => {
  const f = css("kit/forms.css");
  assert.match(f, /\.k-form__rows\s*\{\s*position: relative;/);
  assert.match(f, /\.k-form__rows-box\s*\{\s*container-type: inline-size;/);
  for (const n of [2, 3, 4, 5, 6]) assert.match(f, new RegExp(`@container \\(max-width: \\d+px\\)\\s*\\{\\s*\\.k-form__rows--c${n}`));
});

newSheetTest("forms");
