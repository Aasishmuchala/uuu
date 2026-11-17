// A sheet of paper (PLAN-3D-ALL D4, 4.2, U2): the paper scope on its root, a label when given, children untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, PUBLIC, html, render, installDom, showTree, elements, textOf, classesOf } from "./_dom.mjs";
import { compositeSheetTests } from "./_rules.mjs";

installDom();
const { Sheet } = await import(pathToFileURL(join(KIT, "sheet.js")).href);

test("Sheet: data-surface=\"paper\" on a .k-sheet root; a div unless asked; no name unless given", async () => {
  const root = await showTree(Sheet, { children: html`<p>Read me</p>` });
  const sheet = elements(root)[1];
  assert.equal(sheet.localName, "div");
  assert.deepEqual(classesOf(sheet), ["k-sheet"]);
  assert.equal(sheet.getAttribute("data-surface"), "paper");
  assert.equal(sheet.getAttribute("aria-label"), null);
  render(null, root);
});

test("Sheet: `as` picks one of four elements, `label` names it, `wide` drops the measure", async () => {
  for (const as of ["section", "article", "aside"]) {
    const root = await showTree(Sheet, { as, label: "The brief", wide: true, children: "x" });
    const sheet = elements(root)[1];
    assert.equal(sheet.localName, as);
    assert.equal(sheet.getAttribute("aria-label"), "The brief");
    assert.deepEqual(classesOf(sheet), ["k-sheet", "k-sheet--wide"]);
    render(null, root);
  }
  for (const as of ["script", "iframe", "img", "<b>", undefined]) {
    const root = await showTree(Sheet, { as, children: "x" });
    assert.equal(elements(root)[1].localName, "div", String(as));
    render(null, root);
  }
});

test("Sheet: children are placed as given; hostile words stay text", async () => {
  installDom();
  const bad = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const root = await showTree(Sheet, { label: bad, children: html`<h2>One</h2><p>${bad}</p><button type="button">Two</button>` });
  const sheet = elements(root)[1];
  assert.deepEqual(sheet.childNodes.map((n) => n.localName), ["h2", "p", "button"]);
  assert.equal(textOf(sheet), `One${bad}Two`);
  assert.equal(sheet.getAttribute("aria-label"), bad, "an escaped attribute");
  assert.ok(!elements(root).some((e) => e.localName === "img" || e.localName === "script"));
  render(null, root);
});

test("Sheet's sheet: paper with a fall of light, the paper's shadow for its edge; placed once in 220 ms on transform and opacity", () => {
  const c = readFileSync(join(PUBLIC, "styles", "kit", "sheet.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const root = /\.k-sheet \{([^}]*)\}/.exec(c)[1];
  assert.match(root, /background:[^;]*linear-gradient\([^;]*var\(--paper\)/);
  assert.match(root, /box-shadow: var\(--paper-shadow\);/);
  assert.doesNotMatch(root, /border:/, "the paper's shadow draws its edge; a border beside it read as a double line");
  assert.match(root, /animation: k-sheet-place 220ms var\(--ease\) both;/);
  assert.doesNotMatch(root, /overflow|height|line-clamp|text-overflow/, "a sentence on paper is never cut");
  const frames = /@keyframes k-sheet-place \{([\s\S]*?)\n\}/.exec(c)[1];
  for (const p of frames.matchAll(/([a-z-]+)\s*:/g)) assert.ok(["opacity", "transform"].includes(p[1]), p[1]);
  assert.doesNotMatch(c, /infinite/);
});

compositeSheetTests("sheet");

// PLAN-3D-ALL U16: `slim`, a slimmer inset for a few short lines (Files set one of its own).
test("Sheet: `slim` is a class with a slimmer inset; only true turns it on", async () => {
  let root = await showTree(Sheet, { slim: true, children: "x" });
  assert.deepEqual(classesOf(elements(root)[1]), ["k-sheet", "k-sheet--slim"]);
  render(null, root);
  root = await showTree(Sheet, { slim: "yes", children: "x" });
  assert.deepEqual(classesOf(elements(root)[1]), ["k-sheet"]);
  render(null, root);
  const c = readFileSync(join(PUBLIC, "styles", "kit", "sheet.css"), "utf8");
  assert.match(c, /\.k-sheet--slim \{\s*padding: var\(--s-2\) var\(--s-5\);/);
});
