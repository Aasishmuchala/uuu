// Every custom property a stylesheet reads must be defined somewhere (M51 F16, M55): a `var(--name)` with no
// fallback, under styles/, whose name no stylesheet defines (and no script sets on an element) falls back to
// nothing, so a corner turns square or a gap disappears without a sound. Names read with a fallback
// (`var(--dept, var(--text-2))`) are allowed, since the fallback is what shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TREE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STYLES = join(TREE, "styles");

function filesUnder(dir, ext) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "vendor" || name === "node_modules" || name === "test") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, ext));
    else if (ext.test(name)) out.push(p);
  }
  return out;
}
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// The names read without a fallback: `var(--x)` with nothing after the name but the closing bracket.
export function readsWithoutFallback(css) {
  return [...stripComments(css).matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1]);
}
// The names a stylesheet defines: `--x:` as a declaration.
export function definedIn(css) {
  return [...stripComments(css).matchAll(/(?:^|[{;\s])(--[\w-]+)\s*:/g)].map((m) => m[1]);
}

const SHEETS = filesUnder(STYLES, /\.css$/);
const SCRIPTS = filesUnder(TREE, /\.(m?js|html)$/);

test("the helpers read a stylesheet as expected", () => {
  assert.deepEqual(readsWithoutFallback("a { color: var(--text); gap: var(--dept, var(--s-2)); }"), ["--text", "--s-2"]);
  assert.deepEqual(definedIn(":root { --s-2: 8px; --text:#fff } .x{--k-a: 1}"), ["--s-2", "--text", "--k-a"]);
});

test("every var(--name) used under styles/ without a fallback is defined by a stylesheet or set by a script", () => {
  assert.ok(SHEETS.length > 20, "the stylesheets were found");
  const defined = new Set(SHEETS.flatMap((f) => definedIn(readFileSync(f, "utf8"))));
  // A script may set a custom property on an element (a creature's frame count, a ring's share).
  for (const f of SCRIPTS) for (const m of readFileSync(f, "utf8").matchAll(/["'`\s;{](--[a-z][\w-]*)["'`]?\s*[:,]/g)) defined.add(m[1]);
  const missing = [];
  for (const f of SHEETS) {
    const where = relative(TREE, f).split(sep).join("/");
    for (const name of new Set(readsWithoutFallback(readFileSync(f, "utf8")))) {
      if (!defined.has(name)) missing.push(`${where}: ${name}`);
    }
  }
  assert.deepEqual(missing, [], `names read but never defined:\n${missing.join("\n")}`);
});
