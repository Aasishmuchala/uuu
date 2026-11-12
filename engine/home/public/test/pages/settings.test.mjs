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

import { BACKDROPS } from "../../pages/settings.js";

test("settings: three backdrops, and the page saves Background and Moving background", () => {
  assert.deepEqual(BACKDROPS.map((b) => b.id), ["aurora", "stars", "plain"]);
  assert.deepEqual(BACKDROPS.map((b) => b.label), ["Aurora", "Stars", "Plain"]);
  const src = readFileSync(new URL("../../pages/settings.js", import.meta.url), "utf8");
  assert.match(src, /Background/);
  assert.match(src, /Moving background/);
  assert.match(src, /change\(\{ backdrop:/);
  assert.match(src, /change\(\{ motion:/);
});

test("settings: the Models section sits between Appearance and Later", () => {
  const src = readFileSync(new URL("../../pages/settings.js", import.meta.url), "utf8");
  const a = src.indexOf('title="Appearance"');
  const m = src.indexOf("<${ModelsSection} />");
  const l = src.indexOf('title="Later, when you want it"');
  assert.ok(a > 0 && m > a && l > m);
  assert.match(src, /import ModelsSection from "\.\/settings-models\.js";/);
});
