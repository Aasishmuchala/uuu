// The kit's status dots (CONTRACTS-V2 13.1): motion off stops the live dot (and the loading lines, read from
// states.css), and the stylesheet's rules. Split out of kit-a and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, elements, textOf, showTree } from "./_dom.mjs";
import { css, primitiveSheetTests } from "./_rules.mjs";

const kit = { status: await import(pathToFileURL(join(KIT, "status.js")).href) };

test("motion off stops the live dot and the loading lines too", () => {
  assert.match(css("kit/status.css"), /\[data-motion="off"\] \.k-dot--pulse \.k-dot__mark::after\s*\{\s*animation: none;/);
  assert.match(css("kit/states.css"), /\[data-motion="off"\] \.k-loading__line\s*\{\s*animation: none;/);
});

test("St: a 14 px glyph for its tone and the words on one line; the words keep the first ink unless good or bad", async () => {
  installDom();
  const { St } = kit.status;
  let root = await showTree(St, { tone: "warn", children: "Saved, not tested" });
  let el = root.firstChild;
  assert.match(el.getAttribute("class"), /^k-st k-st--warn$/);
  const svg = elements(root).find((e) => e.localName === "svg");
  assert.ok(svg, "a glyph");
  assert.equal(svg.getAttribute("width"), "14");
  assert.match(textOf(root), /Saved, not tested/);
  root = await showTree(St, { tone: "ok", children: "Passed" });
  assert.match(root.firstChild.getAttribute("class"), /k-st--good/, "ok is good");
  root = await showTree(St, { tone: "purple", children: "x" });
  assert.match(root.firstChild.getAttribute("class"), /k-st--neutral/);
  assert.equal(elements(root).some((e) => e.localName === "svg"), false, "neutral has no glyph of its own");
  root = await showTree(St, { icon: "key", children: "Key" });
  assert.ok(elements(root).some((e) => e.localName === "svg"), "an icon given is drawn");
  const s = css("kit/status.css");
  assert.match(/\.k-st\s*\{([^}]*)\}/.exec(s)[1], /color: var\(--ink\);/);
  assert.match(s, /\.k-st--good,\s*\.k-st--good \.k-icon \{ color: var\(--good\); \}/);
  assert.match(s, /\.k-st--bad,\s*\.k-st--bad \.k-icon \{ color: var\(--bad\); \}/);
  assert.match(s, /\.k-st--warn \.k-icon \{ color: var\(--warn\); \}/);
  const mark = /\.k-dot__mark\s*\{([^}]*)\}/.exec(s)[1];
  assert.match(mark, /width: 7px;\s*height: 7px;/, "the dot is 7 px");
});

primitiveSheetTests("status");
