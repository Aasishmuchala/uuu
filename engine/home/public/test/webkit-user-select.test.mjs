// The Mac app's web view is WebKit, which reads only -webkit-user-select (PLAN-MAC-2 M6 (c), fixed in M7): every rule
// that sets user-select under styles/ also sets -webkit-user-select to the same value, in the same block, so buttons,
// strips, tiles and initials are not selected by a double-click in the app and a command still selects whole.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const STYLES = join(dirname(fileURLToPath(import.meta.url)), "..", "styles");
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".css")) files.push(p);
  }
})(STYLES);

function blocksWithUserSelect(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const body = m[2];
    const plain = [...body.matchAll(/(?:^|[;\s])user-select\s*:\s*([a-z-]+)/g)].map((x) => x[1]);
    const prefixed = [...body.matchAll(/-webkit-user-select\s*:\s*([a-z-]+)/g)].map((x) => x[1]);
    if (plain.length) out.push({ selector: m[1].trim(), plain, prefixed });
  }
  return out;
}

test("every user-select under styles/ has -webkit-user-select beside it with the same value", () => {
  let seen = 0;
  for (const f of files) {
    for (const b of blocksWithUserSelect(readFileSync(f, "utf8"))) {
      seen++;
      assert.deepEqual(b.prefixed, b.plain, `${relative(STYLES, f)} ${b.selector}: -webkit-user-select must match user-select`);
    }
  }
  assert.ok(seen >= 7, `expected the seven known user-select rules, saw ${seen}`);
});

test("the five rules M7 fixed carry the prefix", () => {
  const want = { "kit/button.css": "none", "kit/strip.css": "none", "kit/tile.css": "none", "kit/avatar.css": "none", "kit/states.css": "all" };
  for (const [f, v] of Object.entries(want)) {
    assert.match(readFileSync(join(STYLES, f), "utf8"), new RegExp(`user-select: ${v};\\n\\s*-webkit-user-select: ${v};`), f);
  }
});
