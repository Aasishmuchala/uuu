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

test("Tag: five tones (ok is good's old name and keeps its class); anything else is neutral", async () => {
  installDom();
  for (const [tone, cls] of [["good", "k-tag--good"], ["ok", "k-tag--ok"], ["warn", "k-tag--warn"], ["bad", "k-tag--bad"], ["info", "k-tag--info"], ["purple", "k-tag--neutral"]]) {
    const root = await showTree(kit.tag.Tag, { tone, children: "Passed" });
    assert.equal(root.firstChild.getAttribute("class"), `k-tag ${cls}`, tone);
    assert.match(textOf(root), /Passed/);
  }
});

test("Tag: dot: true leads with a 6 px dot in the tag's ink, hidden from a screen reader; anything else draws none", async () => {
  installDom();
  let root = await showTree(kit.tag.Tag, { tone: "warn", dot: true, children: "Waiting" });
  const dot = root.firstChild.firstChild;
  assert.equal(dot.getAttribute("class"), "k-tag__dot");
  assert.equal(dot.getAttribute("aria-hidden"), "true");
  assert.match(textOf(root), /Waiting/);
  for (const bad of [undefined, false, "warn", 1]) {
    root = await showTree(kit.tag.Tag, { dot: bad, children: "x" });
    assert.ok(!elements(root).some((e) => (e.getAttribute("class") || "") === "k-tag__dot"), `no dot for ${String(bad)}`);
  }
  assert.match(/(?:^|\n)\.k-tag__dot\s*\{([^}]*)\}/.exec(css("kit/tag.css"))[1], /width: 6px;\s*height: 6px;[\s\S]*background: currentColor;/);
});

test("Tag: quiet (fix round R6) is the tone's words with a 6 px dot and no fill; only quiet: true draws it", async () => {
  installDom();
  let root = await showTree(kit.tag.Tag, { tone: "warn", quiet: true, children: "Stuck" });
  const el = root.firstChild;
  assert.equal(el.getAttribute("class"), "k-tag k-tag--warn k-tag--quiet");
  assert.equal(el.firstChild.getAttribute("class"), "k-tag__dot");
  assert.match(textOf(root), /Stuck/);
  root = await showTree(kit.tag.Tag, { tone: "warn", quiet: "yes", children: "x" });
  assert.doesNotMatch(root.firstChild.getAttribute("class"), /k-tag--quiet/);
  const s = css("kit/tag.css");
  const q = /\.k-tag--quiet,[^{]*\.k-tag--quiet\.k-tag--info \{([^}]*)\}/.exec(s);
  assert.ok(q, "every tone has its quiet form");
  assert.match(q[1], /background: transparent;/);
  assert.match(q[1], /padding: 0;/);
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

test("tags and chips: one system (fix round A3), 22 px, 12 px at 500, 8 px sides on a 6 px corner, grey by default, five tones each on its tint; a selected chip is lifted; one 6 px dot", () => {
  const s = css("kit/tag.css");
  const base = /\.k-tag,\s*\.k-chip\s*\{([^}]*)\}/.exec(s)[1];
  assert.match(base, /border-radius: var\(--r-1\);/);
  assert.match(base, /min-height: 22px;/);
  assert.match(base, /padding: 0 var\(--s-2\);/);
  assert.match(base, /background: var\(--chip\);/, "the neutral fill is opaque and stands off a card (fix round R5)");
  assert.match(base, /color: var\(--ink-2\);/);
  assert.match(base, /font-size: var\(--fs-label\);/);
  assert.match(base, /font-weight: var\(--fw-medium\);/);
  for (const [t, ink, bg] of [["ok", "good", "good-bg"], ["good", "good", "good-bg"], ["warn", "warn", "warn-bg"], ["bad", "bad", "bad-bg"], ["info", "accent", "info-bg"]]) {
    const r = new RegExp(`\\.k-tag--${t}(?:,\\s*\\.k-tag--good)?\\s*\\{([^}]*)\\}`).exec(s)[1];
    assert.match(r, new RegExp(`color: var\\(--${ink}\\);`));
    assert.match(r, new RegExp(`background: var\\(--${bg}\\);`));
  }
  const on = /\.k-chip--on,[^{]*\{([^}]*)\}/.exec(s)[1];
  assert.match(on, /background: var\(--raise\);/);
  assert.match(on, /border-color: var\(--accent\);/);
  assert.doesNotMatch(s, /r-pill/);
  assert.match(/\.k-chip__dot\s*\{([^}]*)\}/.exec(s)[1], /width: 6px;\s*height: 6px;/, "one dot size");
});

primitiveSheetTests("tag");
