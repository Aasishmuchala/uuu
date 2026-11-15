// The kit's card (CONTRACTS-V2 13.1, V3 27, PLAN-COOK T32): the ghost tone, the urgent card's one amber rule (with
// the decision card's matching rules), no frame in a frame, the lifted choice, and the stylesheet's rules. Split out of kit-a and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, STYLES, installDom, showTree } from "./_dom.mjs";
import { css, stripComments, primitiveSheetTests } from "./_rules.mjs";

const kit = { card: await import(pathToFileURL(join(KIT, "card.js")).href) };

test("Card: flat (fix round R6) is a hairline group: no fill, no side edges, no corner, no shadow; only flat: true draws it", async () => {
  installDom();
  let root = await showTree(kit.card.Card, { flat: true, padding: "none", children: "Rows" });
  assert.equal(root.firstChild.getAttribute("class"), "k-card k-card--plain k-card--pad-none k-card--flat");
  root = await showTree(kit.card.Card, { flat: "yes", children: "x" });
  assert.doesNotMatch(root.firstChild.getAttribute("class"), /k-card--flat/);
  const r = /\.k-card--flat \{([^}]*)\}/.exec(css("kit/card.css"))[1];
  for (const d of [/border-width: 1px 0;/, /border-radius: 0;/, /background: transparent;/, /box-shadow: none;/]) assert.match(r, d);
});

test("Card: tone ghost has its own class; an unknown tone falls back to plain", async () => {
  installDom();
  let root = await showTree(kit.card.Card, { tone: "ghost", children: "Quiet" });
  assert.match(root.firstChild.getAttribute("class"), /\bk-card k-card--ghost\b/);
  root = await showTree(kit.card.Card, { tone: "ghost", href: "#/files", children: "Files" });
  assert.equal(root.firstChild.localName, "a");
  assert.match(root.firstChild.getAttribute("class"), /k-card--ghost .*k-card--action/);
  root = await showTree(kit.card.Card, { tone: "loud", children: "x" });
  assert.match(root.firstChild.getAttribute("class"), /k-card--plain/);
});

// The decision card's half of this test (urgent, drawer cards lining up) moved to decision.test.mjs with T36.
test("an urgent card says so once, by its amber rule, with no tint over glass (M18-11)", () => {
  const c = css("kit/card.css");
  assert.match(c, /\.k-card--warm::after\s*\{\s*box-shadow: inset 2px 0 0 var\(--warn\);\s*\}/, "the amber rule at the left");
  assert.doesNotMatch(c, /linear-gradient|--bg-warm|--warn-bg|--glass/, "no tint and no glass under a card");
});

// From "the primitives' stylesheets follow the rules of V3 27.3" (kit-a); rewritten for the corrections after round 3 (1).
test("card: a card is on the raised step, with a hairline edge and the card shadow", () => {
  const card = stripComments(readFileSync(join(STYLES, "card.css"), "utf8"));
  assert.match(card, /\.k-card \{[^}]*border: 1px solid var\(--line\);[^}]*border-radius: var\(--r-3\);[^}]*background: var\(--card\);[^}]*box-shadow: var\(--shadow-card\)/, "a card is the card fill with an edge and the card shadow");
});

test("card: no frame inside a frame; what is chosen is lifted with the accent ring", () => {
  const card = css("kit/card.css");
  assert.match(card, /\.k-card \.k-card:not\(\.k-card--sunken\) \{\s*border-color: transparent;\s*background: transparent;\s*box-shadow: none;/, "a nested card loses its edge and its fill");
  assert.match(card, /\.k-card\[aria-checked="true"\] \{\s*border-color: transparent;\s*background: var\(--raise\);/, "a chosen card is on the raised step");
  assert.match(card, /\.k-card\[aria-checked="true"\]::after \{\s*box-shadow: inset 0 0 0 2px var\(--accent\);/, "with a 2 px accent ring");
  // The chosen ring and the amber rule are drawn by ::after, so the card keeps its own shadow under them.
  assert.match(card, /\.k-card\[aria-checked="true"\] \{\s*border-color: transparent;\s*background: var\(--raise\);\s*\}/, "a chosen card keeps the card shadow");
  assert.doesNotMatch(card, /\.k-card\[aria-checked="true"\]::after \{[^}]*var\(--shadow-card\)/, "the ring does not repeat the shadow");
});

test("card: a ghost card has no fill", () => {
  const card = stripComments(readFileSync(join(STYLES, "card.css"), "utf8"));
  assert.match(card, /\.k-card--ghost \{[^}]*background: transparent/, "a ghost card has no fill");
});

primitiveSheetTests("card");
