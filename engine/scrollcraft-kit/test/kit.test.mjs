// PLAN-ASTRYX T13: the scroll-craft kit is the published files byte for byte, pinned by sha256, plus the engine's own
// layer; its list is the folder; its pages and examples name no outside address, no paid service, no browser tool and
// no web font. The upstream folder (untrusted data) is only read and hashed, never run.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lockOf, verify } from "../lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, "..");
const UPSTREAM = "/Users/aasish/skill-downloads/scroll-craft/nateherkai-scroll-craft-75d81f7";
const sha = (b) => createHash("sha256").update(b).digest("hex");

// The published files' sha256, as read on 18 Nov 2026 from commit 75d81f7.
const PINNED = {
  "LICENSE.txt": ["LICENSE", "dd471a27eca72488a53e6ea6fbe9392d81aa3f01e950e63fe328affb2ddfa6e3"],
  "scrollcraft.css": ["plugins/nateherk-design/skills/scroll-craft/engine/scrollcraft.css", "e19eb3aa73b0944626ca56e6e427c76f44753481e04d60f4bac20e8cf1d7758a"],
  "scrollcraft.js": ["plugins/nateherk-design/skills/scroll-craft/engine/scrollcraft.js", "4a419b3ede51f64790af7b56c0195ea01c98a84df8e0e768ebf343956b922f39"],
};

function filesUnder(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else out.push(r);
  }
  return out.sort();
}

test("the published files are byte for byte the pinned ones", () => {
  for (const [name, [, hash]] of Object.entries(PINNED)) assert.equal(sha(readFileSync(join(KIT, "scrollcraft", name))), hash, name);
  assert.deepEqual(readdirSync(join(KIT, "scrollcraft")).sort(),
    ["LICENSE.txt", "scrollcraft-brand.css", "scrollcraft-mount.js", "scrollcraft.css", "scrollcraft.js"]);
});

test("the published files equal the upstream folder, read as data", (t) => {
  if (!existsSync(UPSTREAM)) { t.skip(`the upstream folder is not on this Mac (${UPSTREAM})`); return; }
  for (const [name, [path, hash]] of Object.entries(PINNED)) {
    const up = readFileSync(join(UPSTREAM, path));
    assert.equal(sha(up), hash, path);
    assert.ok(up.equals(readFileSync(join(KIT, "scrollcraft", name))), name);
  }
});

test("the list is the folder: --verify passes, a changed byte or an extra file fails it", () => {
  assert.deepEqual(verify(), []);
  const lock = JSON.parse(readFileSync(join(KIT, "scrollcraft.lock.json"), "utf8"));
  assert.equal(lock.scrollcraft, "75d81f7");
  for (const f of lock.files) {
    assert.equal(f.from === "engine", f.name.startsWith("scrollcraft-"), f.name);
    if (PINNED[f.name]) assert.equal(f.sha256, PINNED[f.name][1]);
  }
  // what reaches out: one fetch( (a clip of the site's own), one address (the SVG namespace in a data: picture)
  assert.deepEqual(lock.addresses, ["http://www.w3.org/2000/svg"]);
  assert.deepEqual(Object.entries(lock.calls).filter(([, n]) => n > 0), [["fetch(", 1]]);
  const dir = mkdtempSync(join(tmpdir(), "sc-lock-"));
  try {
    for (const n of readdirSync(join(KIT, "scrollcraft"))) copyFileSync(join(KIT, "scrollcraft", n), join(dir, n));
    const js = readFileSync(join(dir, "scrollcraft.js"));
    js[100] ^= 1;
    writeFileSync(join(dir, "scrollcraft.js"), js);
    assert.deepEqual(verify(dir), ["scrollcraft/scrollcraft.js is not the file the list names"]);
    copyFileSync(join(KIT, "scrollcraft", "scrollcraft.js"), join(dir, "scrollcraft.js"));
    writeFileSync(join(dir, "evil.js"), "fetch('x')\n");
    assert.throws(() => lockOf(dir), /has no known source/);
    assert.equal(verify(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the engine's layer sets no colour, face or size of its own and shows every part with less motion asked", () => {
  const css = readFileSync(join(KIT, "scrollcraft", "scrollcraft-brand.css"), "utf8");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|url\(|@import|https?:/);
  assert.match(css, /--sc-font-display: var\(--brand-heading\);/);
  assert.match(css, /--sc-t-xs: max\(var\(--brand-min-size\)/);
  const reduce = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  for (const s of ["[data-sc-act]", "[data-sc-cue]", "[data-sc-in]", ".sc-split__i", "[data-sc-pan]", "opacity: 1 !important", "position: relative !important"]) {
    assert.ok(reduce.includes(s), s);
  }
});

test("pages and examples name no outside address, paid service, browser tool or web font", () => {
  const bad = /https?:\/\/|kie\.ai|kie\.mjs|playwright|shoot\.mjs|doctor\.mjs|npm i|npx|fonts\.googleapis|gstatic|cdn|unpkg|jsdelivr|esm\.sh|@import/i;
  const found = [];
  for (const f of filesUnder(KIT)) {
    if (f.startsWith("scrollcraft/") || f.startsWith("test/") || f === "lock.mjs" || f.endsWith(".json")) continue;
    const text = readFileSync(join(KIT, f), "utf8");
    const m = bad.exec(text);
    if (m) found.push(`${f}: ${m[0]}`);
    assert.ok(Buffer.byteLength(text) <= 64 * 1024, `${f} is over 64 KB`);
  }
  assert.deepEqual(found, []);
});

test("the examples: the stylesheet order, the kit's script, no colour of their own but the plain page's four roles", () => {
  const order = (html, names) => {
    const at = names.map((n) => html.indexOf(`href="${n}"`));
    assert.ok(at.every((i, k) => i > 0 && (k === 0 || i > at[k - 1])), names.join(", "));
  };
  const a = readFileSync(join(KIT, "example", "index.html"), "utf8");
  order(a, ["astryx/reset.css", "astryx/astryx.css", "astryx/theme.css", "kit.css", "astryx-theme.css", "scrollcraft/scrollcraft.css", "scrollcraft/scrollcraft-brand.css", "style.css"]);
  assert.ok(a.indexOf('<script src="scrollcraft/scrollcraft.js" defer></script>') > a.indexOf("</script>"), "the kit's script after the import map");
  assert.match(a, /<header class="page-header"><img src=/);
  assert.equal(a.split("data-astryx-root").length - 1, 1);
  const app = readFileSync(join(KIT, "example", "app.js"), "utf8");
  assert.doesNotMatch(app, /#[0-9a-fA-F]{3,6}\b|rgb\(|\bpx\b|fetch\(|style:|xstyle|data-sc-drift|sc-grain|worldflight/);
  assert.match(app, /window\.ScrollCraft\.mount\(document\.querySelector\('\[data-astryx-root\]'\)\)/);
  const p = readFileSync(join(KIT, "example-plain", "index.html"), "utf8");
  order(p, ["reset.css", "kit.css", "layout.css", "scrollcraft/scrollcraft.css", "scrollcraft/scrollcraft-brand.css", "style.css"]);
  assert.ok(p.indexOf("scrollcraft/scrollcraft.js") < p.indexOf("scrollcraft/scrollcraft-mount.js"));
  for (const f of ["example/style.css", "example-plain/style.css"]) {
    const css = readFileSync(join(KIT, f), "utf8");
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b|rgba?\(|font-family|font-size|prefers-reduced-motion/, f);
  }
  const roles = [...readFileSync(join(KIT, "example-plain", "style.css"), "utf8").matchAll(/(--sc-[a-z-]+): var\(--brand-[a-z]+\)/g)].map((m) => m[1]);
  assert.deepEqual(roles, ["--sc-canvas", "--sc-ink", "--sc-accent", "--sc-accent-ink"]);
});
