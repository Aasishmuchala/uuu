// The kit's Tile (fix round R5): the small landmark at a row's or a card's left, neutral or one of six quiet tints,
// the same tint for the same key every time and the same family as the avatar of that key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, PUBLIC, elements, installDom, showTree, textOf } from "./_dom.mjs";
import { css, primitiveSheetTests } from "./_rules.mjs";

const tile = await import(pathToFileURL(join(KIT, "tile.js")).href);
const avatar = await import(pathToFileURL(join(KIT, "avatar.js")).href);

test("six named tints, fixed, in the avatar's order", () => {
  assert.deepEqual(tile.TILE_TINTS, ["blue", "green", "violet", "orange", "rose", "teal"]);
});

test("tintFor: the same tint for the same key every time, one of the six; no key is neutral", () => {
  const seen = new Set();
  for (const key of ["md", "json", "py", "brief", "plan", "work", "check", "sales", "marketing", "studio", "books", "support"]) {
    const a = tile.tintFor(key);
    assert.equal(tile.tintFor(key), a, `${key} keeps its tint`);
    assert.ok(tile.TILE_TINTS.includes(a), `${key} → ${a} is one of the six`);
    assert.equal(a, tile.TILE_TINTS[avatar.avatarTint(key) - 1], `${key}: the avatar's family`);
    seen.add(a);
  }
  assert.ok(seen.size >= 3, "keys spread over the tints");
  for (const none of [undefined, null, "", "   "]) assert.equal(tile.tintFor(none), "neutral");
});

test("Tile: a glyph or up to two letters, at 28 or 32 px, in a tone; anything else falls back", async () => {
  installDom();
  let root = await showTree(tile.Tile, { icon: "file", tint: "teal", size: 32 });
  let el = root.firstChild;
  assert.equal(el.getAttribute("class"), "k-tile k-tile--32 k-tile--teal");
  assert.ok(elements(el).some((e) => e.localName === "svg"), "the glyph is drawn");
  assert.equal(el.getAttribute("aria-hidden"), "true", "decoration without a label");
  root = await showTree(tile.Tile, { text: "Marketing", tint: "purple", size: 40 });
  el = root.firstChild;
  assert.equal(el.getAttribute("class"), "k-tile k-tile--28 k-tile--neutral", "an unknown tint is neutral, an unknown size 28");
  assert.equal(textOf(root), "Ma", "two letters at most");
  root = await showTree(tile.Tile, { icon: "jobs", text: "J", label: "Stage: work" });
  el = root.firstChild;
  assert.equal(el.getAttribute("role"), "img");
  assert.equal(el.getAttribute("aria-label"), "Stage: work");
  assert.equal(el.getAttribute("aria-hidden"), null);
  assert.equal(textOf(root), "", "the glyph wins over the letters");
  root = await showTree(tile.Tile, { text: '<img src=x onerror=alert(1)>' });
  assert.ok(!elements(root).some((e) => e.localName === "img"), "letters are text, never markup");
});

test("the tile's sheet: 28 and 32 px on the 8 px corner, 12 px 600; neutral is the raised step; each tint its own ink on its own fill", () => {
  const s = css("kit/tile.css");
  const base = /\.k-tile\s*\{([^}]*)\}/.exec(s)[1];
  assert.match(base, /border-radius: var\(--r-2\);/);
  assert.match(base, /background: var\(--raise\);/);
  assert.match(base, /color: var\(--ink-2\);/);
  assert.match(base, /font-size: var\(--fs-label\);/);
  assert.match(base, /font-weight: var\(--fw-bold\);/);
  assert.match(s, /\.k-tile--28 \{ --k-tile-size: var\(--s-7\); \}/);
  assert.match(s, /\.k-tile--32 \{ --k-tile-size: var\(--s-8\); \}/);
  for (const t of tile.TILE_TINTS) {
    const r = new RegExp(`\\.k-tile--${t} \\{([^}]*)\\}`).exec(s);
    assert.ok(r, `${t} has its rule`);
    assert.match(r[1], new RegExp(`color: var\\(--tint-${t}\\);`));
    assert.match(r[1], new RegExp(`background: var\\(--tint-${t}-bg\\);`));
  }
});

test("kit/index.js re-exports the tile, and index.html links its sheet", async () => {
  const index = await import(pathToFileURL(join(KIT, "index.js")).href);
  for (const n of ["Tile", "tintFor", "TILE_TINTS"]) assert.ok(n in index, `index.js exports ${n}`);
  assert.match(readFileSync(join(PUBLIC, "index.html"), "utf8"), /href="\.\/styles\/kit\/tile\.css"/);
});

primitiveSheetTests("tile");
