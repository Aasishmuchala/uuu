// The kit's layouts (T33 of PLAN-COOK): StageLayout, DocLayout, Group, Rows, Row and Blk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, html, installDom, mount, unmount, elements, textOf, byClass, fire, walkDom } from "./_dom.mjs";
import { HOSTILE } from "./_fixtures.mjs";
import { css, ROOTS, newSheetTest } from "./_rules.mjs";

const mod = await import(pathToFileURL(join(KIT, "layout.js")).href);
const { StageLayout, DocLayout, Group, Rows, Row, Blk } = mod;

const texts = (root) => [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);

test("layout.js loads in Node and exports its parts as functions", () => {
  for (const name of ["StageLayout", "DocLayout", "Group", "Rows", "Row", "Blk"]) assert.equal(typeof mod[name], "function", `${name} is a function`);
});

test("a StageLayout with all its slots puts the page title in the rail head, and each slot in its place", async () => {
  installDom();
  const root = await mount(StageLayout, {
    kind: "Chief of staff · today 08:09", title: "A film of the lake house", lede: "Approve one treatment.", label: "The storyboard",
    stage: html`<p>the stage</p>`, strip: html`<p>the strip</p>`, rail: html`<${Blk} title="Treatment A costs" aside="$1.85"><p>money</p><//>`,
    foot: html`<button type="button">Approve</button>`, more: html`<p>the scores</p>`,
  });
  const [head] = byClass(root, "k-rail__head");
  assert.ok(head, "the rail has a head");
  const title = elements(head).find((e) => e.getAttribute("id") === "page-title");
  assert.ok(title, "page-title is in the rail head");
  assert.equal(title.localName, "h1");
  assert.equal(textOf(title), "A film of the lake house");
  assert.equal(elements(root).filter((e) => e.getAttribute("id") === "page-title").length, 1, "one page title");
  const [stage] = byClass(root, "k-work__stage");
  assert.equal(stage.getAttribute("aria-label"), "The storyboard");
  assert.equal(textOf(stage), "the stage");
  assert.equal(textOf(byClass(root, "k-work__strip")[0]), "the strip");
  assert.equal(textOf(byClass(root, "k-work__more")[0]), "the scores");
  assert.match(textOf(byClass(root, "k-rail__body")[0]), /Treatment A costs\$1\.85money/);
  assert.equal(textOf(byClass(root, "k-rail__foot")[0]).trim(), "Approve");
  assert.equal(byClass(root, "k-rail__more").length, 0, "a foot given whole has no More button");
  unmount(root);
});

test("a StageLayout without a strip draws no strip, and its foot split in two has a More button that opens a sheet", async () => {
  installDom();
  const root = await mount(StageLayout, {
    title: "A landing page", stage: "s",
    foot: { primary: html`<button type="button">Pick A</button>`, rest: html`<button type="button">Send all back</button>` },
  });
  assert.equal(byClass(root, "k-work__strip").length, 0);
  assert.ok(byClass(root, "k-work--no-strip").length === 1);
  const [more] = byClass(root, "k-rail__more");
  assert.ok(more, "a More button");
  assert.equal(more.getAttribute("aria-haspopup"), "dialog");
  assert.equal(more.getAttribute("aria-expanded"), "false");
  assert.match(textOf(byClass(root, "k-rail__rest")[0]), /Send all back/);
  fire(more, "click");
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(more.getAttribute("aria-expanded"), "true");
  assert.ok(elements(root).some((e) => e.getAttribute("role") === "dialog"), "the rest opens in a dialog");
  unmount(root);
});

test("the layouts render agents' words as text", async () => {
  installDom();
  let root = await mount(StageLayout, { kind: HOSTILE, title: HOSTILE, lede: HOSTILE, stage: HOSTILE });
  assert.ok(texts(root).filter((t) => t === HOSTILE).length >= 3);
  assert.ok(!elements(root).some((e) => e.localName === "script" || e.localName === "img"));
  unmount(root);
  root = await mount(DocLayout, { title: HOSTILE, intro: HOSTILE, state: { tone: "good", text: HOSTILE }, sections: [{ id: "a", label: HOSTILE, status: HOSTILE }], current: "a" });
  assert.ok(texts(root).filter((t) => t === HOSTILE).length >= 5);
  assert.ok(!elements(root).some((e) => e.localName === "script" || e.localName === "img"));
  unmount(root);
});

test("a DocLayout lists its sections, marks the current one, and picks by button or by link", async () => {
  installDom();
  let picked = null;
  const root = await mount(DocLayout, {
    title: "Generation", intro: "The Artist makes clips.", state: { tone: "good", text: "On, within your limits" }, current: "gen",
    onPick: (id) => { picked = id; },
    sections: [
      { id: "look", label: "Appearance", icon: "sun" },
      { id: "gen", label: "Generation", icon: "film", status: { tone: "good", text: "On" } },
      { id: "web", label: "Web", href: "#/settings/web", status: "Off" },
      { id: "bad", label: "Bad", href: "javascript:alert(1)" },
    ],
  });
  const picks = byClass(root, "k-doc__pick");
  assert.equal(picks.length, 4);
  assert.deepEqual(picks.map((p) => p.getAttribute("aria-current")), [null, "page", null, null]);
  const states = byClass(root, "k-doc__pick-state");
  assert.deepEqual(states.map((e) => e.getAttribute("title")), ["On", "Off"], "the dot's words are also its tooltip");
  // Fix round B2: one line an item; the state is a dot, its words for a screen reader only.
  for (const st of states) {
    assert.equal(byClass(st, "k-doc__pick-dot").length, 1);
    assert.equal(byClass(st, "k-sr").length, 1, "the words are the screen reader's");
  }
  assert.equal(picks[2].localName, "a");
  assert.equal(picks[2].getAttribute("href"), "#/settings/web");
  assert.equal(picks[3].localName, "button", "an address that is not the app's own is not a link");
  fire(picks[0], "click");
  assert.equal(picked, "look");
  const title = elements(root).find((e) => e.getAttribute("id") === "page-title");
  assert.equal(textOf(title), "Generation");
  assert.equal(textOf(byClass(root, "k-doc__state--good")[0]), "On, within your limits");
  assert.ok(byClass(root, "k-doc--layout").length === 1);
  unmount(root);
});

test("a Group holds Rows; a warned Row carries its warning inside the panel, under the row", async () => {
  installDom();
  const Tree = () => html`<${Group} title="Limits" aside="Newest first" say="The Artist can never spend more.">
    <${Rows}>
      <${Row} icon="power" title="Let the Artist use Runway" say="Only the Artist can ask." control=${html`<button type="button">On</button>`}
        warned="Renders and prompts you approve go to Runway." />
      <${Row} icon="key" title="Runway key" state="Saved, not tested" />
    <//>
  <//>`;
  const root = await mount(Tree, {});
  const [rows] = byClass(root, "k-rows");
  const items = byClass(rows, "k-rows__row");
  assert.equal(items.length, 2);
  const [warned] = byClass(items[0], "k-rows__warned");
  assert.ok(warned, "the warning is inside the first row");
  assert.ok(byClass(warned, "k-notice--warn").length === 1, "it is a warning notice");
  assert.equal(textOf(warned).trim(), "Renders and prompts you approve go to Runway.");
  assert.equal(byClass(items[1], "k-rows__warned").length, 0);
  assert.equal(textOf(byClass(items[1], "k-rows__state")[0]), "Saved, not tested");
  assert.equal(textOf(byClass(root, "k-group__aside")[0]), "Newest first");
  unmount(root);
});

test("fix round B2: a row's tile is 32 px and a row with no icon has none; section items are 32 px at 13 px with a 6 px dot; group heads 13 px muted, 32 px apart; the column about 640 px", async () => {
  installDom();
  const Tree = () => html`<${Rows}>
    <${Row} icon="key" title="Runway key" say="Test asks how many credits you have." />
    <${Row} title="Who may ask" say="Only the Researcher." />
  <//>`;
  const root = await mount(Tree, {});
  const rows = byClass(root, "k-rows__row");
  assert.equal(byClass(rows[0], "k-rows__icon").length, 1);
  assert.equal(byClass(rows[1], "k-rows__icon").length, 0, "a secondary row has no tile");
  assert.match(rows[1].getAttribute("class"), /k-rows__row--bare/);
  unmount(root);
  const sheet = css("kit/layout.css");
  assert.match(/\.k-rows__icon \{([^}]*)\}/.exec(sheet)[1], /width: 32px;\s*height: 32px;/);
  assert.match(/\.k-rows__title \{([^}]*)\}/.exec(sheet)[1], /font-size: var\(--fs-fact\);[^}]*font-weight: var\(--fw-bold\);/, "row titles 15 px 600");
  const pick = /\.k-doc__pick \{([^}]*)\}/.exec(sheet)[1];
  assert.match(pick, /min-height: 32px;/);
  assert.match(/\.k-doc__pick-name \{([^}]*)\}/.exec(sheet)[1], /font-size: var\(--fs-note\);/);
  assert.match(/\.k-doc__pick-dot \{([^}]*)\}/.exec(sheet)[1], /width: 6px;\s*height: 6px;/);
  const head = /\.k-group__title \{([^}]*)\}/.exec(sheet)[1];
  assert.match(head, /font-size: var\(--fs-note\);[^}]*font-weight: var\(--fw-bold\);[^}]*color: var\(--ink-2\);/);
  assert.match(/\.k-group \{([^}]*)\}/.exec(sheet)[1], /margin-top: var\(--s-8\);/);
  assert.match(/\.k-doc__main \{([^}]*)\}/.exec(sheet)[1], /max-width: calc\(640px \+ 2 \* var\(--s-10\)\);/);
  assert.doesNotMatch(/\.k-doc__state \{([^}]*)\}/.exec(sheet)?.[1] || "", /margin-left: auto/, "the chip sits beside the title");
});

test("layout.css: a settings-like page's section list stays in view under the top bar while the page scrolls", () => {
  const sheet = readFileSync(join(KIT, "..", "styles", "kit", "layout.css"), "utf8");
  assert.match(sheet, /\.k-doc__list \{[^}]*position: sticky;[^}]*top: var\(--topbar-h\)/, "the list sticks");
  const col = /\.k-doc__sections \{([^}]*)\}/.exec(sheet);
  assert.ok(col && !/position: sticky/.test(col[1]), "the column is as tall as the page, so it cannot be the part that sticks");
  assert.match(sheet, /@media \(max-width: 859px\)[\s\S]*\.k-doc__list \{[^}]*position: static;/, "on a phone the list is a row at the top, not stuck");
});

test("layout.css: the rail is sticky under the top bar, the stage on the deepest ground, one column below 860 px", () => {
  const sheet = css("kit/layout.css");
  assert.match(sheet, /\.k-work \{[^}]*grid-template-columns: minmax\(0, 1fr\) var\(--rail-w\)/);
  assert.match(sheet, /\.k-work__stage \{[^}]*background: var\(--stage\)/);
  // T100: the rail is parted from the stage by its own surface and a 1 px line.
  assert.match(sheet, /\.k-work::before \{[^}]*background: var\(--panel\);[^}]*border-left: 1px solid var\(--line\);/);
  // A current section is a neutral fill with a 2 px accent bar at its left, never a ring.
  const current = /\.k-doc__pick\[aria-current="page"\] \{([^}]*)\}/.exec(sheet)[1];
  assert.match(current, /background: var\(--sel\);/);
  assert.doesNotMatch(current, /box-shadow|outline|border/, "never a ring");
  assert.match(sheet, /\.k-doc__pick\[aria-current="page"\]::before \{[^}]*width: 2px;[^}]*background: var\(--accent\);/, "the 2 px accent bar");
  assert.match(sheet, /\.k-rail \{[^}]*position: sticky;[^}]*top: var\(--topbar-h\)/);
  assert.match(sheet, /\.k-rail__body \{[^}]*overflow-y: auto/);
  assert.match(sheet, /@media \(max-width: 859px\)[\s\S]*\.k-rail \{\s*display: contents;/);
  assert.match(sheet, /@media \(max-width: 859px\)[\s\S]*\.k-rail__foot \{[^}]*position: sticky;[^}]*bottom: var\(--tabbar-h\)/);
});

test("T96: the stage uses its height: what is on it is centred, its real height is a variable, the rail body ends with air", () => {
  const sheet = css("kit/layout.css");
  const stage = /\.k-work__stage \{([^}]*)\}/.exec(sheet)[1];
  assert.match(stage, /--k-stage-h: calc\(100vh - var\(--topbar-h\) - var\(--k-strip-h\) - 2 \* var\(--s-5\)\);/, "the stage's inner height on the first screen");
  assert.match(stage, /justify-content: center;/, "room left is shared above and below, not one band at the bottom");
  assert.match(sheet, /\.k-work \{[^}]*--k-strip-h: calc\(var\(--band\) \+ 1px\);/, "the strip's height until it is measured");
  assert.match(sheet, /\.k-work--no-strip \{\s*--k-strip-h: 0px;/);
  assert.match(sheet, /\.k-rail__body \{[^}]*padding-bottom: var\(--s-4\);/, "16 px of air at the body's end");
  assert.doesNotMatch(/\.k-rail__body \{([^}]*)\}/.exec(sheet)[1], /mask-image/, "nothing in the rail fades: a faded line reads as a fault");
  const src = readFileSync(join(KIT, "layout.js"), "utf8");
  assert.match(src, /setProperty\("--k-strip-h"/, "layout.js tells the sheet the strip's drawn height");
});

ROOTS.layout = "k-work";
newSheetTest("layout");
