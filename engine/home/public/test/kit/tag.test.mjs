// The kit's tags and chips (CONTRACTS-V2 13.1, V3 27): the chip's dot, and the stylesheet's rules. Split out of
// kit-a (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, elements, textOf, showTree } from "./_dom.mjs";
import { css, primitiveSheetTests } from "./_rules.mjs";

const kit = { tag: await import(pathToFileURL(join(KIT, "tag.js")).href) };

test("Chip: dot takes a department, a state tone or true; anything else draws no dot; the words stay", async () => {
  installDom();
  const dotOf = (root) => elements(root).find((e) => (e.getAttribute("class") || "").split(" ").includes("k-chip__dot"));
  let root = await showTree(kit.tag.Chip, { dot: "sales", children: "List building" });
  let dot = dotOf(root);
  assert.equal(dot.getAttribute("data-dept"), "sales");
  assert.equal(dot.getAttribute("aria-hidden"), "true");
  assert.match(textOf(root), /List building/);
  root = await showTree(kit.tag.Chip, { dot: "warn", children: "Waiting for you" });
  assert.match(dotOf(root).getAttribute("class"), /k-chip__dot--warn/);
  root = await showTree(kit.tag.Chip, { dot: true, children: "Here" });
  dot = dotOf(root);
  assert.ok(dot, "a plain dot");
  assert.equal(dot.getAttribute("data-dept"), null, "its colour comes from the nearest data-dept");
  for (const bad of [undefined, false, "purple", '"><script>', 7]) {
    root = await showTree(kit.tag.Chip, { dot: bad, children: "x" });
    assert.equal(dotOf(root), undefined, `no dot for ${String(bad)}`);
  }
  root = await showTree(kit.tag.Chip, { dot: "books", icon: "clock", children: "Monthly" });
  const kinds = elements(root.firstChild).map((e) => e.localName);
  assert.ok(kinds.indexOf("span") < kinds.indexOf("svg"), "the dot comes before the icon");
});

test("Chip with onClick is a toggle: a button with aria-pressed, lifted when on; without, a plain label", async () => {
  installDom();
  let clicked = 0;
  let root = await showTree(kit.tag.Chip, { on: true, onClick: () => { clicked++; }, children: "Approved" });
  const b = root.firstChild;
  assert.equal(b.localName, "button");
  assert.equal(b.getAttribute("type"), "button");
  assert.equal(b.getAttribute("aria-pressed"), "true");
  assert.match(b.getAttribute("class"), /k-chip k-chip--toggle k-chip--on/);
  root = await showTree(kit.tag.Chip, { onClick: () => {}, children: "Waiting" });
  assert.equal(root.firstChild.getAttribute("aria-pressed"), "false");
  root = await showTree(kit.tag.Chip, { on: true, children: "Label" });
  assert.equal(root.firstChild.localName, "span", "no handler, no button");
  assert.equal(root.firstChild.getAttribute("aria-pressed"), null);
  assert.equal(clicked, 0);
});

test("tags and chips: 12 px on a 5 px corner, grey by default, a tone on its tint; a selected chip is lifted", () => {
  const s = css("kit/tag.css");
  const base = /\.k-tag,\s*\.k-chip\s*\{([^}]*)\}/.exec(s)[1];
  assert.match(base, /border-radius: 5px;/);
  assert.match(base, /background: var\(--ctl\);/);
  assert.match(base, /color: var\(--ink-2\);/);
  assert.match(base, /font-size: var\(--fs-label\);/);
  assert.match(base, /font-weight: var\(--fw-medium\);/);
  for (const [t, ink, bg] of [["ok", "good", "good-bg"], ["warn", "warn", "warn-bg"], ["bad", "bad", "bad-bg"]]) {
    const r = new RegExp(`\\.k-tag--${t}\\s*\\{([^}]*)\\}`).exec(s)[1];
    assert.match(r, new RegExp(`color: var\\(--${ink}\\);`));
    assert.match(r, new RegExp(`background: var\\(--${bg}\\);`));
  }
  const on = /\.k-chip--on,[^{]*\{([^}]*)\}/.exec(s)[1];
  assert.match(on, /background: var\(--raise\);/);
  assert.match(on, /border-color: var\(--accent\);/);
  assert.doesNotMatch(s, /r-pill/);
});

primitiveSheetTests("tag");
