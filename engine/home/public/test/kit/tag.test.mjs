// The kit's tags and chips (CONTRACTS-V2 13.1, V3 27): the chip's dot, and the stylesheet's rules. Split out of
// kit-a (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, elements, textOf, showTree } from "./_dom.mjs";
import { primitiveSheetTests } from "./_rules.mjs";

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

primitiveSheetTests("tag");
