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

test("an urgent card says so once, by its tag or its amber rule, with no tint over glass; drawer cards line up (M18-11, M18-12)", () => {
  const c = css("kit/card.css");
  assert.match(c, /\.k-card--warm::after\s*\{\s*box-shadow: inset 2px 0 0 var\(--warn\);\s*\}/, "the amber rule at the left");
  assert.doesNotMatch(c, /linear-gradient|--bg-warm|--warn-bg|--glass/, "no tint and no glass under a card");
  const d = css("kit/decision.css");
  assert.match(d, /\.k-decision--high\s*\{\s*border-color: var\(--border-warm\);/);
  assert.match(d, /\.k-decision--compact \.k-decision__details\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(d, /dd::first-letter\s*\{\s*text-transform: capitalize;/, "a detail still starts with a capital, without the banned uppercase rule");
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
  assert.doesNotMatch(card, /var\(--shadow-card\)\s*[,;][^;]*,\s*var\(--shadow-card\)|,\s*var\(--shadow-card\)|var\(--shadow-card\),/, "the card shadow is never in a list: it is none in dark");
});

test("card: a ghost card has no fill", () => {
  const card = stripComments(readFileSync(join(STYLES, "card.css"), "utf8"));
  assert.match(card, /\.k-card--ghost \{[^}]*background: transparent/, "a ghost card has no fill");
});

primitiveSheetTests("card");
