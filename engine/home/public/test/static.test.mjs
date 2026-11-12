// Static checks for the home screen's interface (CONTRACTS-V2 11, CONTRACTS-V3 24.1, 27.3 and 39):
// index.html links every stylesheet in its order and every file it links exists; every static import exists
// and stays inside the tree; nothing names another host outside vendor/ and assets/; vendor/ is as it was;
// no inline script; no file names the folder the tree is built in; only the chrome blurs what is behind it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(PUBLIC, "vendor");
const ASSETS = join(PUBLIC, "assets");
const SELF = fileURLToPath(import.meta.url);

const KIT_SHEETS = "button icon avatar status tag card tabs fields states overlays text page decision task-card brief composer conversation table timeline checks doc agent segmented job answer ring forms upload pick".split(" ");
const PAGE_SHEETS = "map needs-you tasks task dashboards dashboard marketing studio sprite-player dept team agent jobs job files brain routines health settings search brand-kit".split(" ");
const SHEETS = [
  "./assets/fonts/fonts.css",
  "./styles/tokens.css",
  "./styles/base.css",
  "./styles/canvas.css",
  "./styles/creature.css",
  ...KIT_SHEETS.map((k) => `./styles/kit/${k}.css`),
  "./styles/shell.css",
  ...PAGE_SHEETS.map((p) => `./styles/pages/${p}.css`),
];

// Where backdrop-filter may be used (CONTRACTS-V3 27.3), relative to the tree.
const MAY_BLUR = ["styles/canvas.css", "styles/shell.css", "styles/kit/overlays.css", "styles/kit/composer.css"];

// The vendored library as it was checked in; replacing it is a deliberate change to this list.
const VENDOR_FILES = {
  "LICENSE-htm.txt": "740725f7252e750af735d0028cc534970772f513331e9f68150fede8fb3ce00f",
  "LICENSE-preact.txt": "1fe6958409c8c257a70c587a18b6f7f412b179b456630790d30b2ec9a8e4b7d4",
  "README.txt": "a7b17feafbc132f7a9cbcbe3b1e2d1f5d68aacc66cb5c58ac88540e6c5ca1c26",
  "preact-htm.js": "72284e8e9079c87817145df1110f74e8a2aa040b2fc384922e18dfcb46fc1fd7",
};

// Other work may save files in the tree while the tests run (an editor writes a temporary file and renames it
// away): a file that is gone by the time it is looked at or read is not part of the tree any more.
const gone = (e) => e && e.code === "ENOENT";

function walk(dir, skip = [], out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (skip.includes(full)) continue;
    let st;
    try { st = statSync(full); } catch (e) { if (gone(e)) continue; throw e; }
    if (st.isDirectory()) walk(full, skip, out);
    else out.push(full);
  }
  return out;
}

// The text of a file found by walk(), or null when it has been removed since.
function textOf(file) {
  try { return readFileSync(file, "utf8"); } catch (e) { if (gone(e)) return null; throw e; }
}

const inside = (p) => p === PUBLIC || p.startsWith(PUBLIC + sep);
const FILES = walk(PUBLIC, [VENDOR, ASSETS]);
const TESTS = join(PUBLIC, "test") + sep;
const MODULES = FILES.filter((f) => /\.m?js$/.test(f) && !f.startsWith(TESTS));
const HTML = FILES.filter((f) => f.endsWith(".html"));
const CSS = walk(PUBLIC, [VENDOR]).filter((f) => f.endsWith(".css"));
const index = () => readFileSync(join(PUBLIC, "index.html"), "utf8");
const stripCss = (css) => String(css).replace(/\/\*[\s\S]*?\*\//g, " ");

// Static imports only: `from "x"` and `import "x"`. A dynamic import() of a page is the shell's
// business and is allowed to point at a file that is not there yet.
function staticImports(src) {
  const code = String(src).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
  const out = [];
  for (const re of [/\bfrom\s*["']([^"']+)["']/g, /(?:^|[\s;])import\s*["']([^"']+)["']/g]) {
    for (const m of code.matchAll(re)) out.push(m[1]);
  }
  return out;
}

const linksOf = (html) => [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
const scriptsOf = (html) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1], body: m[2] }));

test("index.html links every stylesheet in the order of 24.1, then theme-boot.js, then app.js as a module", () => {
  const html = index();
  assert.deepEqual(linksOf(html), SHEETS);
  const scripts = scriptsOf(html);
  assert.equal(scripts.length, 2, "two scripts");
  assert.match(scripts[0].attrs, /\bsrc="\.\/lib\/theme-boot\.js"/);
  assert.doesNotMatch(scripts[0].attrs, /type="module"/, "theme-boot.js is a classic script, so it runs before paint");
  assert.match(scripts[1].attrs, /\bsrc="\.\/app\.js"/);
  assert.match(scripts[1].attrs, /\btype="module"/);
  assert.ok(html.lastIndexOf("<link") < html.indexOf("<script"), "the scripts come after the stylesheets");
});

test("every file index.html refers to exists inside the tree", () => {
  const refs = [...index().matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1]).filter((r) => !r.startsWith("data:"));
  assert.ok(refs.length >= SHEETS.length + 2);
  for (const ref of refs) {
    assert.ok(!/^[a-z]+:/i.test(ref) && !ref.startsWith("//") && !ref.startsWith("/"), `${ref} is a relative address`);
    const target = resolve(PUBLIC, ref);
    assert.ok(inside(target), `${ref} stays inside the tree`);
    assert.ok(existsSync(target), `${ref} exists`);
  }
});

test("every stylesheet in styles/kit/ and styles/pages/ is linked exactly once", () => {
  const links = linksOf(index());
  for (const dir of ["kit", "pages"]) {
    for (const name of readdirSync(join(PUBLIC, "styles", dir)).filter((f) => f.endsWith(".css"))) {
      const ref = `./styles/${dir}/${name}`;
      assert.equal(links.filter((l) => l === ref).length, 1, `${ref} is linked once`);
    }
  }
  assert.equal(new Set(links).size, links.length, "no stylesheet is linked twice");
});

test("package.json makes every module a plain ES module", () => {
  assert.deepEqual(JSON.parse(readFileSync(join(PUBLIC, "package.json"), "utf8")), { type: "module", private: true });
});

test("every static import of every module exists and stays inside the tree", () => {
  assert.ok(MODULES.length >= 15, "the modules were found");
  for (const file of MODULES) {
    const where = relative(PUBLIC, file);
    const text = textOf(file);
    if (text === null) continue;
    for (const spec of staticImports(text)) {
      assert.ok(spec.startsWith("./") || spec.startsWith("../"), `${where} imports "${spec}" by a relative path only`);
      const target = resolve(dirname(file), spec);
      assert.ok(inside(target), `${where} imports "${spec}" from inside the tree`);
      assert.ok(existsSync(target), `${where} imports "${spec}", which exists`);
    }
  }
});

test("no file outside vendor/ and assets/ names another host", () => {
  for (const file of FILES) {
    if (file === SELF || /\.(png|gif|jpe?g|webp|woff2?)$/i.test(file)) continue;
    const text = textOf(file);
    if (text === null) continue;
    // The W3C's namespace names (for SVG) are names, not addresses.
    const hosts = [...text.matchAll(/\b(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\d+\.\d+\.\d+\.\d+)(?::\d+)?/gi)]
      .filter((m) => !/^www\.w3\.org$/i.test(m[1]) && /^https?:/i.test(m[0]))
      .map((m) => m[0]);
    assert.deepEqual(hosts, [], `${relative(PUBLIC, file)} names no other host`);
  }
});

test("no file names the folder the tree is built in, so the switch is a move and nothing else", () => {
  // Built from parts, so this file does not hold the words it looks for.
  const folder = ["n", "e", "x", "t"].join("");
  const named = new RegExp(`public\\/${folder}|\\/${folder}\\/`);
  for (const file of FILES.filter((f) => /\.(m?js|html|css)$/.test(f))) {
    const text = textOf(file);
    if (text === null) continue;
    assert.doesNotMatch(text, named, `${relative(PUBLIC, file)} names the folder`);
  }
  for (const file of MODULES) {
    for (const spec of staticImports(textOf(file) || "")) {
      assert.ok(!spec.split("/").includes(folder), `${relative(PUBLIC, file)} imports "${spec}" through the folder's name`);
    }
  }
});

test("vendor/ is left as it is", () => {
  assert.deepEqual(readdirSync(VENDOR).sort(), Object.keys(VENDOR_FILES).sort());
  for (const [name, sum] of Object.entries(VENDOR_FILES)) {
    const got = createHash("sha256").update(readFileSync(join(VENDOR, name))).digest("hex");
    assert.equal(got, sum, `vendor/${name} is unchanged`);
  }
});

test("no HTML file has an inline script (the server's content policy forbids it)", () => {
  assert.ok(HTML.includes(join(PUBLIC, "index.html")));
  for (const file of HTML) {
    for (const s of scriptsOf(readFileSync(file, "utf8"))) {
      assert.match(s.attrs, /\bsrc=/, `${relative(PUBLIC, file)}: every script has a src`);
      assert.equal(s.body.trim(), "", `${relative(PUBLIC, file)}: and no inline body`);
    }
    assert.doesNotMatch(readFileSync(file, "utf8"), /\son[a-z]+\s*=\s*["']/i, `${relative(PUBLIC, file)} has no inline event handler`);
  }
});

test("backdrop-filter only where 27.3 allows it; no filter: blur and no will-change outside canvas.css", () => {
  assert.ok(CSS.length >= SHEETS.length - 1, "the stylesheets were found");
  for (const file of CSS) {
    const where = relative(PUBLIC, file).split(sep).join("/");
    const css = stripCss(textOf(file) || "");
    if (!MAY_BLUR.includes(where)) assert.doesNotMatch(css, /backdrop-filter/, `${where} does not blur what is behind it`);
    assert.doesNotMatch(css, /(^|[\s;{])filter\s*:[^;}]*blur/, `${where} has no filter: blur`);
    if (where !== "styles/canvas.css") assert.doesNotMatch(css, /will-change/, `${where} has no will-change`);
  }
});

test("every page of the route table has its stylesheet, and the old pages and the sidebar are gone", () => {
  for (const id of PAGE_SHEETS) assert.ok(existsSync(join(PUBLIC, "styles", "pages", `${id}.css`)), `styles/pages/${id}.css exists`);
  assert.ok(!existsSync(join(PUBLIC, "shell", "sidebar.js")), "shell/sidebar.js is removed");
  for (const p of ["home", "docs", "gallery", "department", "inbox", "goals", "goal", "company"]) {
    assert.ok(!existsSync(join(PUBLIC, "pages", `${p}.js`)), `pages/${p}.js is removed`);
    assert.ok(!existsSync(join(PUBLIC, "test", "pages", `${p}.test.mjs`)), `test/pages/${p}.test.mjs is removed`);
  }
  for (const p of ["home", "docs", "gallery", "department"]) assert.ok(!existsSync(join(PUBLIC, "styles", "pages", `${p}.css`)), `styles/pages/${p}.css is removed`);
  assert.ok(existsSync(join(PUBLIC, "pages", "dashboard.js")), "the record dashboards' page is pages/dashboard.js");
  assert.ok(!existsSync(join(PUBLIC, "styles.css")), "styles.css is removed");
  assert.ok(!existsSync(join(PUBLIC, "components")), "components/ is removed");
});

test("shell.css uses the shell's own classes, tokens only, and carries the narrow layout and the motion rules", () => {
  const css = stripCss(readFileSync(join(PUBLIC, "styles", "shell.css"), "utf8"));
  assert.match(css, /@media \(max-width: 859px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\[data-motion="off"\]/);
  assert.match(css, /backdrop-filter/, "the chrome blurs what is behind it");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b\s*;|rgba?\(|hsla?\(/, "colours come from the tokens");
  assert.doesNotMatch(css, /font-size\s*:\s*\d+px/, "sizes come from the tokens");
  assert.doesNotMatch(css, /font-family/, "the type comes from base.css");
  for (const m of css.matchAll(/(^|[{}])\s*([^{}@]+)\{/g)) {
    const head = m[2].trim();
    if (/^(from|to|\d+%)/.test(head)) continue;
    for (const sel of head.split(",")) {
      assert.match(sel.trim(), /^(:root\[data-[a-z]+="[a-z]+"\]\s+)?[a-z]*\.s-/, `shell.css selector "${sel.trim()}" starts with .s-`);
    }
  }
  for (const m of css.matchAll(/transition\s*:\s*([^;}]+)/g)) {
    for (const item of m[1].split(",")) {
      const prop = item.trim().split(/\s+/)[0];
      if (prop === "none") continue;
      assert.ok(["transform", "opacity", "color", "background-color", "border-color"].includes(prop), `shell.css moves only transform and opacity, or a colour ("${item.trim()}")`);
      if (!["transform", "opacity"].includes(prop)) assert.match(item, /var\(--t-(fast|med)\)/, `a colour moves within --t-med ("${item.trim()}")`);
    }
  }
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)) {
    assert.ok(m[1].startsWith("s-"), `keyframes ${m[1]} start with s-`);
    for (const d of m[2].matchAll(/([a-z-]+)\s*:/g)) assert.ok(["transform", "opacity"].includes(d[1]), `keyframes ${m[1]} animate only transform and opacity`);
  }
});
