// The kit's diff part: diffWords' vectors from section 4 of PLAN-COOK, and what DiffText draws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, show, byClass, textOf, elements } from "./_dom.mjs";
import { ROOTS, newSheetTest, css } from "./_rules.mjs";

installDom();
const mod = await import(pathToFileURL(join(KIT, "diff.js")).href);
const { diffWords, DiffText } = mod;

test("diff.js loads in Node and exports its parts as functions", () => {
  for (const name of ["diffWords", "DiffText"]) assert.equal(typeof mod[name], "function", `${name} is a function`);
});

test("diffWords: the same text is one run", () => {
  assert.deepEqual(diffWords("a b c", "a b c"), [{ t: "same", s: "a b c" }]);
});

test("diffWords: removed words", () => {
  assert.deepEqual(diffWords("pulls back slowly through the morning mist to show", "pulls back slowly to show"), [
    { t: "same", s: "pulls back slowly " },
    { t: "del", s: "through the morning mist " },
    { t: "same", s: "to show" },
  ]);
});

test("diffWords: a removal and an addition that meet, the removal first", () => {
  assert.deepEqual(diffWords("the pool. No people.", "the pool. Soft light, no people."), [
    { t: "same", s: "the pool. " },
    { t: "del", s: "No " },
    { t: "add", s: "Soft light, no " },
    { t: "same", s: "people." },
  ]);
});

test("diffWords: empty sides", () => {
  assert.deepEqual(diffWords("", "x"), [{ t: "add", s: "x" }]);
  assert.deepEqual(diffWords("x", ""), [{ t: "del", s: "x" }]);
  assert.deepEqual(diffWords("", ""), []);
});

test("diffWords: more than 400 tokens on either side gives null", () => {
  const long = Array.from({ length: 401 }, () => "w").join(" ");
  assert.equal(diffWords(long.slice(0, 2000), "anything"), null);
  assert.equal(diffWords("anything", long.slice(0, 2000)), null);
  assert.equal(diffWords(Array.from({ length: 401 }, () => "w").join(" "), "x"), null);
});

test("diffWords: inputs are capped at 2000 characters", () => {
  const r = diffWords("a".repeat(5000), "a".repeat(5000));
  assert.equal(r.reduce((n, p) => n + p.s.length, 0), 2000);
});

test("DiffText: removed words in del, added words in ins, the key line with the caller's labels", async () => {
  const root = await show(DiffText, { a: "the pool. No people.", b: "the pool. Soft light, no people.", labels: { a: "you approved, not sent", b: "sent, not approved" } });
  assert.equal(elements(root).filter((e) => e.localName === "del").map(textOf).join(""), "No ");
  assert.equal(elements(root).filter((e) => e.localName === "ins").map(textOf).join(""), "Soft light, no ");
  const key = textOf(byClass(root, "k-diff__key")[0]);
  assert.ok(key.includes("you approved, not sent") && key.includes("sent, not approved"));
  assert.equal(byClass(root, "k-diff__swatch").length, 2);
});

test("DiffText: two equal texts show no del and no ins", async () => {
  const root = await show(DiffText, { a: "a b c", b: "a b c", labels: { a: "A", b: "B" } });
  assert.equal(elements(root).filter((e) => e.localName === "del" || e.localName === "ins").length, 0);
  assert.equal(textOf(byClass(root, "k-diff__text")[0]), "a b c");
});

test("DiffText: when the diff is null both texts show plainly under their labels", async () => {
  const long = Array.from({ length: 401 }, () => "w").join(" ");
  const root = await show(DiffText, { a: long, b: "short", labels: { a: "Approved", b: "Sent" } });
  assert.equal(byClass(root, "k-diff--plain").length, 1);
  assert.equal(elements(root).filter((e) => e.localName === "del" || e.localName === "ins").length, 0);
  const t = textOf(root);
  assert.ok(t.includes("Approved") && t.includes("Sent") && t.includes("short"));
});

test("DiffText: markup in a text stays text", async () => {
  const root = await show(DiffText, { a: "x", b: "<img src=x onerror=1>", labels: { a: "A", b: "B" } });
  assert.equal(elements(root).filter((e) => e.localName === "img").length, 0);
});

test("the difference is 14 px text with tints and 12 px swatches", () => {
  const c = css("kit/diff.css");
  assert.match(c, /\.k-diff__text \{[^}]*var\(--fs-ui\)/);
  assert.match(c, /\.k-diff__del \{[^}]*var\(--del-bg\)/);
  assert.match(c, /\.k-diff__add \{[^}]*var\(--add-bg\)/);
  assert.match(c, /\.k-diff__swatch \{[^}]*width: 12px; height: 12px/);
  assert.match(c, /\.k-diff__swatch--del \{[^}]*var\(--del-bg\)/);
  assert.match(c, /\.k-diff__swatch--add \{[^}]*var\(--add-bg\)/);
});

ROOTS.diff = "k-diff";
newSheetTest("diff");
