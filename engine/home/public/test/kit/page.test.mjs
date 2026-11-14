// The kit's page header and section (CONTRACTS-V2 13.1, V3 27): the overline, the creature, the breadcrumb
// chip and the back chip, and the stylesheet's rules. Split out of kit-a (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, render, installDom, elements, textOf, showTree } from "./_dom.mjs";
import { primitiveSheetTests, narrowControlsTest } from "./_rules.mjs";

const kit = { page: await import(pathToFileURL(join(KIT, "page.js")).href) };

test("PageHeader: the overline above the title, the creature at 48 px, the breadcrumb chip with a close link, the back chip", async () => {
  installDom();
  let root = await showTree(kit.page.PageHeader, {
    title: "Carousel production",
    over: "Marketing · Design",
    creature: "marketing",
    chip: { label: ["Marketing", "A carousel from a concept"], href: "#/jobs" },
    back: { href: "#/map", label: "All departments" },
  });
  const all = elements(root);
  const cls = (e) => (e.getAttribute("class") || "").split(" ");
  const find = (c) => all.find((e) => cls(e).includes(c));
  const over = find("k-page-header__over");
  const h1 = all.find((e) => e.localName === "h1");
  assert.equal(textOf(over), "Marketing · Design");
  assert.ok(all.indexOf(over) < all.indexOf(h1), "the overline comes before the title");
  const pet = find("k-creature");
  assert.equal(pet.getAttribute("data-creature"), "marketing");
  assert.match(pet.style.cssText || pet.getAttribute("style") || "", /--k-creature-size: 48px/);
  assert.ok(all.indexOf(pet) < all.indexOf(h1), "the creature is left of (before) the title");
  assert.match(cls(root.firstChild).join(" "), /k-page-header--creature/);
  const chip = find("k-page-header__chip");
  assert.match(textOf(chip), /Marketing\/A carousel from a concept/);
  const close = find("k-page-header__chip-close");
  assert.equal(close.localName, "a");
  assert.equal(close.getAttribute("href"), "#/jobs");
  assert.equal(close.getAttribute("aria-label"), "Close");
  const back = find("k-page-header__back");
  assert.equal(back.getAttribute("href"), "#/map");
  assert.match(textOf(back), /All departments/);
  assert.ok(elements(back).some((e) => e.localName === "svg"), "the back chip has its arrow");
  assert.equal(h1.getAttribute("id"), "page-title");
  render(null, root);

  // No overline, creature or chip unless asked; an unknown creature and an outside close link draw nothing.
  root = await showTree(kit.page.PageHeader, { title: "Tasks", creature: "dragon", chip: { label: "Somewhere", href: "javascript:alert(1)" } });
  const names = elements(root).flatMap(cls);
  assert.ok(!names.includes("k-page-header__over"));
  assert.ok(!names.includes("k-creature"));
  assert.ok(!names.includes("k-page-header--creature"));
  assert.ok(names.includes("k-page-header__chip"), "the chip still names where you are");
  assert.ok(!names.includes("k-page-header__chip-close"), "no close link to another place");
  render(null, root);
  root = await showTree(kit.page.PageHeader, { title: "Tasks" });
  assert.ok(!elements(root).flatMap(cls).includes("k-page-header__top"), "no top row without back or chip");
});

primitiveSheetTests("page");
narrowControlsTest("page");
