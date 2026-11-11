// Static checks for the home screen's interface: every referenced file exists, nothing is loaded from
// another host or from outside public/, and the stylesheet carries the dark, focus, motion and narrow rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(PUBLIC, "vendor");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (full === VENDOR) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const FILES = walk(PUBLIC);
const MODULES = FILES.filter((f) => f.endsWith(".js") || f.endsWith(".mjs")).filter((f) => !f.startsWith(join(PUBLIC, "test") + sep));
const inside = (p) => p === PUBLIC || p.startsWith(PUBLIC + sep);

function importsOf(file) {
  const src = readFileSync(file, "utf8");
  const specs = [];
  const patterns = [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g];
  for (const re of patterns) for (const m of src.matchAll(re)) specs.push(m[1]);
  return specs;
}

test("every file index.html refers to exists inside public/", () => {
  const html = readFileSync(join(PUBLIC, "index.html"), "utf8");
  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1]).filter((r) => !r.startsWith("data:"));
  assert.ok(refs.includes("./styles.css"), "index.html loads styles.css");
  assert.ok(refs.includes("./app.js"), "index.html loads app.js");
  for (const ref of refs) {
    assert.ok(!/^[a-z]+:/i.test(ref) && !ref.startsWith("//"), `${ref} is a local address`);
    const target = resolve(PUBLIC, ref);
    assert.ok(inside(target), `${ref} stays inside public/`);
    assert.ok(existsSync(target), `${ref} exists`);
  }
});

test("every module's imports exist and stay inside public/", () => {
  assert.ok(MODULES.length >= 10, "the modules were found");
  for (const file of MODULES) {
    for (const spec of importsOf(file)) {
      const where = relative(PUBLIC, file);
      assert.ok(spec.startsWith("./") || spec.startsWith("../"), `${where} imports "${spec}" by a relative path only`);
      const target = resolve(dirname(file), spec);
      assert.ok(inside(target), `${where} imports "${spec}" from inside public/`);
      assert.ok(existsSync(target), `${where} imports "${spec}", which exists`);
    }
  }
});

test("the seven pages and the shell are present", () => {
  for (const p of ["inbox", "goals", "goal", "company", "health", "search", "department"]) {
    assert.ok(existsSync(join(PUBLIC, "pages", `${p}.js`)), `pages/${p}.js exists`);
  }
  const app = readFileSync(join(PUBLIC, "app.js"), "utf8");
  for (const page of ["inbox", "goals", "company", "books", "customers", "support", "people", "marketing", "studio", "knowledge", "health", "search"]) {
    assert.match(app, new RegExp(`\\b${page}:`), `app.js routes #/${page}`);
  }
});

test("no file outside vendor/ names another host", () => {
  for (const file of FILES) {
    const text = readFileSync(file, "utf8");
    if (file.endsWith("static.test.mjs")) continue;
    assert.doesNotMatch(text, /https?:\/\//i, `${relative(PUBLIC, file)} has no http(s) address`);
  }
});

test("the vendor library is the only third-party code and is left as it is", () => {
  const vendored = readdirSync(VENDOR).sort();
  assert.deepEqual(vendored, ["LICENSE-htm.txt", "LICENSE-preact.txt", "README.txt", "preact-htm.js"]);
  for (const file of MODULES) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /<script[^>]+src=["']https?:/i, `${relative(PUBLIC, file)} loads no remote script`);
  }
});

test("the stylesheet carries dark, focus, reduced motion and the narrow layout", () => {
  const css = readFileSync(join(PUBLIC, "styles.css"), "utf8");
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /max-width:\s*899px|min-width:\s*900px/);
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/i, "no remote stylesheet or font");
  assert.doesNotMatch(css, /gradient\(/, "no gradients");
  const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  for (const s of sizes) assert.ok([14, 16, 20, 28].includes(s), `font size ${s}px is on the scale`);
});

test("index.html has no inline script (the server's content policy forbids it)", () => {
  const html = readFileSync(join(PUBLIC, "index.html"), "utf8");
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(m[1], /\bsrc=/, "every script has a src");
    assert.equal(m[2].trim(), "", "and no inline body");
  }
});
