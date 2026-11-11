import { test } from "node:test";
import assert from "node:assert/strict";
import Page, { THEMES } from "../../pages/settings.js";

test("settings: the page is a component", () => {
  assert.equal(typeof Page, "function");
});

test("settings: three themes in order", () => {
  assert.deepEqual(THEMES.map((t) => t.id), ["auto", "light", "dark"]);
  assert.deepEqual(THEMES.map((t) => t.label), ["Auto", "Light", "Dark"]);
});

test("settings: the page names nothing it should not and holds no address", () => {
  const src = readFileSync(new URL("../../pages/settings.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /https?:\/\//);
});
import { readFileSync } from "node:fs";
