// The kit's card (CONTRACTS-V2 13.1, V3 27): the ghost tone, the warm tint over glass (with the decision card's
// matching rules), and the stylesheet's rules. Split out of kit-a and kit-m55 (T01 of PLAN-COOK).
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

test("the warm tint lies over glass; urgent says so once; drawer cards line up (M18-11, M18-12)", () => {
  assert.match(css("kit/card.css"), /\.k-card--warm\s*\{\s*background: linear-gradient\(var\(--bg-warm\), var\(--bg-warm\)\), var\(--glass\);/);
  const d = css("kit/decision.css");
  assert.match(d, /\.k-decision--high\s*\{\s*border-color: var\(--border-warm\);/);
  assert.match(d, /\.k-decision--compact \.k-decision__details\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(d, /dd::first-letter\s*\{\s*text-transform: capitalize;/, "a detail still starts with a capital, without the banned uppercase rule");
});

// From "the primitives' stylesheets follow the rules of V3 27.3" (kit-a).
test("card: a card is glass with the highlight", () => {
  const card = stripComments(readFileSync(join(STYLES, "card.css"), "utf8"));
  assert.match(card, /\.k-card \{[^}]*background: var\(--glass\)[^}]*box-shadow: var\(--highlight\)/, "a card is glass with the highlight");
});

test("card: a ghost card has no fill", () => {
  const card = stripComments(readFileSync(join(STYLES, "card.css"), "utf8"));
  assert.match(card, /\.k-card--ghost \{[^}]*background: transparent/, "a ghost card has no fill");
});

primitiveSheetTests("card");
