// The kit's page header and section (CONTRACTS-V2 13.1, V3 27, PLAN-COOK T32): the kind line, the title and the
// lede; the crumbs given to the top bar (the chip, the back chip and the creature are no longer drawn); and the
// stylesheet's rules. Split out of kit-a (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, PUBLIC, html, render, installDom, elements, textOf, showTree } from "./_dom.mjs";
import { css, primitiveSheetTests, narrowControlsTest } from "./_rules.mjs";

const kit = { page: await import(pathToFileURL(join(KIT, "page.js")).href) };

test("PageHeader: the kind line above the title, the lede under it; the creature, the chip and the back chip are not drawn", async () => {
  installDom();
  let root = await showTree(kit.page.PageHeader, {
    title: "Carousel production",
    over: "Marketing · Design",
    lede: "Ten slides from one concept.",
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
  assert.ok(all.indexOf(over) < all.indexOf(h1), "the kind line comes before the title");
  const lede = find("k-page-header__lede");
  assert.equal(textOf(lede), "Ten slides from one concept.");
  assert.ok(all.indexOf(h1) < all.indexOf(lede), "the lede comes after the title");
  const names = all.flatMap(cls);
  for (const gone of ["k-creature", "k-page-header--creature", "k-page-header__chip", "k-page-header__chip-close", "k-page-header__back", "k-page-header__top"]) {
    assert.ok(!names.includes(gone), `${gone} is not drawn`);
  }
  assert.ok(!all.some((e) => e.localName === "a"), "no link in the header: where you are is the top bar's");
  assert.equal(h1.getAttribute("id"), "page-title");
  render(null, root);

  // The older `lead` is still shown, as the lede; a kind line in capitals is shown in sentence case.
  root = await showTree(kit.page.PageHeader, { title: "Studio", over: "DASHBOARD", lead: "Films and pictures." });
  const after = elements(root);
  assert.equal(textOf(after.find((e) => cls(e).includes("k-page-header__over"))), "Dashboard");
  assert.equal(textOf(after.find((e) => cls(e).includes("k-page-header__lede"))), "Films and pictures.");
  render(null, root);
  root = await showTree(kit.page.PageHeader, { title: "Tasks" });
  assert.ok(!elements(root).flatMap(cls).some((c) => c === "k-page-header__over" || c === "k-page-header__lede"), "no kind line or lede unless asked");
});

test("PageHeader: the crumbs go to the top bar through setTop, from the chip or the crumbs prop; no setTop, no harm", async () => {
  const { headerCrumbs, kindLine, PageHeader } = kit.page;
  assert.deepEqual(headerCrumbs({ chip: { label: ["Marketing", "A carousel from a concept"], href: "#/jobs" } }), [
    { label: "Marketing", href: "#/jobs" },
    { label: "A carousel from a concept" },
  ]);
  assert.deepEqual(headerCrumbs({ chip: { label: "Somewhere", href: "javascript:alert(1)" } }), [{ label: "Somewhere" }]);
  assert.deepEqual(headerCrumbs({ chip: { label: ["Files", "Brand kit"], href: "https:" + "//elsewhere.example" } }), [{ label: "Files" }, { label: "Brand kit" }]);
  assert.deepEqual(headerCrumbs({ crumbs: [{ label: "Tasks", href: "#/tasks" }, { label: "STH-25", href: "#/task/STH-25" }] }), [
    { label: "Tasks", href: "#/tasks" },
    { label: "STH-25" },
  ]);
  assert.equal(headerCrumbs({ crumbs: [{ label: "x".repeat(90) }] })[0].label.length, 60);
  assert.deepEqual(headerCrumbs({ back: { href: "#/map", label: "Map" } }), []);
  assert.deepEqual(headerCrumbs(), []);
  assert.equal(kindLine("DASHBOARD"), "Dashboard");
  assert.equal(kindLine("Company brain"), "Company brain");
  assert.equal(kindLine("Marketing · Design"), "Marketing · Design");

  installDom();
  const { AppContext } = await import(pathToFileURL(join(PUBLIC, "lib", "context.js")).href);
  const calls = [];
  const withTop = (props) => html`<${AppContext.Provider} value=${{ setTop: (t) => calls.push(t) }}><${PageHeader} ...${props} /><//>`;
  let root = await showTree(withTop, { title: "Brand kit", chip: { label: ["Files", "Brand kit"], href: "#/files" } });
  assert.deepEqual(calls.at(-1), { crumbs: [{ label: "Files", href: "#/files" }, { label: "Brand kit" }] });
  render(null, root);
  const before = calls.length;
  root = await showTree(withTop, { title: "Tasks" });
  assert.equal(calls.length, before, "a header with nothing to say leaves the shell's own crumbs");
  render(null, root);
  // A context without setTop (the shell before T20): the header still draws.
  root = await showTree((props) => html`<${AppContext.Provider} value=${{}}><${PageHeader} ...${props} /><//>`, { title: "Files", chip: { label: "Files" } });
  assert.equal(textOf(elements(root).find((e) => e.localName === "h1")), "Files");
  render(null, root);
});

test("page: the title is the page size, balanced; the kind line 13 px in the second grey; a section heading is 16 px semibold", () => {
  const p = css("kit/page.css");
  assert.match(p, /\.k-page-header__title \{[^}]*font-size: var\(--fs-page\);[^}]*text-wrap: balance;/);
  assert.match(p, /\.k-page-header__over \{[^}]*font-size: var\(--fs-note\);[^}]*color: var\(--ink-2\);/);
  assert.match(p, /\.k-section__title \{[^}]*font-size: var\(--fs-section\);[^}]*font-weight: var\(--fw-bold\);/);
  assert.doesNotMatch(p, /k-page-header__(chip|back|crumb)/, "no chip and no back chip are styled");
});

primitiveSheetTests("page");
narrowControlsTest("page");
