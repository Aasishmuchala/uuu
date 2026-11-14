// The kit's icons (CONTRACTS-V2 13.1, V3 28): every pinned name, each drawn on the 24 unit grid; and the
// stylesheet's rules. Split out of kit-a (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, render, installDom, elements, showTree } from "./_dom.mjs";
import { PINNED_ICONS, V3_ICONS } from "./_fixtures.mjs";
import { primitiveSheetTests } from "./_rules.mjs";

// The home screen redesign (T30 of PLAN-COOK): the names added, redrawn from the mockup's symbols.
const COOK_ICONS =
  "inbox sidebar more chevron-left globe film camera key power door eye chip sliders volume fullscreen retake trend horn buoy bulb info people brush arrow-up-right".split(" ");

const kit = { icon: await import(pathToFileURL(join(KIT, "icon.js")).href) };

test("ICON_NAMES holds every icon name of 13.1, and each draws something", () => {
  const { ICON_NAMES } = kit.icon;
  for (const n of PINNED_ICONS) assert.ok(ICON_NAMES.includes(n), `icon ${n}`);
});

test("ICON_NAMES holds every icon name of V3 28, and every icon draws at least one stroke", async () => {
  const { ICON_NAMES } = kit.icon;
  for (const n of V3_ICONS) assert.ok(ICON_NAMES.includes(n), `icon ${n}`);
  for (const n of COOK_ICONS) assert.ok(ICON_NAMES.includes(n), `icon ${n}`);
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length, "no name twice");
  installDom();
  for (const n of ICON_NAMES) {
    const root = await showTree(kit.icon.Icon, { name: n, size: 24 });
    const paths = elements(root).filter((e) => e.localName === "path");
    assert.ok(paths.length > 0, `${n} draws something`);
    for (const p of paths) assert.match(p.getAttribute("d") || "", /^M[-\d.]/, `${n}: a path starts with a move`);
    assert.equal(root.firstChild.getAttribute("viewBox"), "0 0 24 24", `${n} is on the 24 unit grid`);
    render(null, root);
  }
});

test("the full icon name list is pinned: every older name is kept and the cook names are added, nothing else", () => {
  const { ICON_NAMES } = kit.icon;
  const want = [...PINNED_ICONS, ...V3_ICONS, "apps", ...COOK_ICONS].sort();
  assert.deepEqual([...ICON_NAMES].sort(), want);
});

test("a state icon takes its colour from the good, warn, bad and ink-2 tokens", async () => {
  const css = (await import("node:fs")).readFileSync(join(KIT, "..", "styles", "kit", "icon.css"), "utf8");
  for (const t of ["--good", "--warn", "--bad", "--ink-2"]) assert.ok(css.includes(`var(${t})`), t);
  assert.doesNotMatch(css, /text-transform|letter-spacing|gradient|box-shadow/);
});

primitiveSheetTests("icon");
