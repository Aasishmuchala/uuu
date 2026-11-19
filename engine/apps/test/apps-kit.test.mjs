// The Astryx kit inside both App Studio apps (PLAN-APPS-ASTRYX T1, decisions 1 and 2), checked
// without Chrome or the fence: each app's public/astryx/ is the kit, file for file, held to the
// sha256 and size pinned in engine/astryx-kit/astryx.lock.json; the type shim names exactly the
// kit's exports; the wiring files are the same bytes in both apps; no package of Astryx is
// added; and neither page carries an inline script or an import map (script-src 'self').
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const LOCK = JSON.parse(readFileSync(join(REPO, "engine", "astryx-kit", "astryx.lock.json"), "utf8"));
const APPS = ["arch-film-studio", "render-to-film"];
const app = (slug, ...p) => join(REPO, "apps", slug, ...p);
const SAME = ["src/client/kit.ts", "src/client/astryx.d.ts", "src/client/styles/studio.css", "vite.config.ts"];

// The names a `declare module '<name>' { ... }` block of the shim exports.
function declared(text, name) {
  const start = text.indexOf(`declare module '${name}' {`);
  assert.ok(start >= 0, `the shim declares ${name}`);
  const body = text.slice(start, text.indexOf("\n}", start));
  return [...body.matchAll(/^\s*export const ([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]);
}

for (const slug of APPS) {
  test(`${slug}: public/astryx/ holds exactly the kit's files, each at its pinned sha256 and size`, () => {
    const dir = app(slug, "public", "astryx");
    const names = readdirSync(dir).sort();
    assert.deepEqual(names, LOCK.files.map((f) => f.name).sort());
    for (const f of LOCK.files) {
      const p = join(dir, f.name);
      assert.ok(statSync(p).isFile(), `${f.name} is a plain file`);
      const bytes = readFileSync(p);
      assert.equal(bytes.length, f.bytes, `${f.name} size`);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256, `${f.name} sha256`);
    }
  });

  test(`${slug}: astryx.d.ts declares exactly the kit's exports`, () => {
    const text = readFileSync(app(slug, "src", "client", "astryx.d.ts"), "utf8");
    assert.deepEqual(declared(text, "@astryxdesign/core").sort(), [...LOCK.exports["core.js"]].sort());
    assert.deepEqual(declared(text, "@astryxdesign/theme-neutral").sort(), [...LOCK.exports["theme-neutral.js"]].sort());
  });

  test(`${slug}: kit.ts re-exports only names the kit has`, () => {
    const text = readFileSync(app(slug, "src", "client", "kit.ts"), "utf8");
    const m = text.match(/export \{([^}]*)\} from '@astryxdesign\/core';/);
    assert.ok(m, "kit.ts re-exports from @astryxdesign/core");
    const names = m[1].split("\n").map((l) => l.replace(/\/\/.*$/, "").trim().replace(/,$/, "")).filter(Boolean);
    const have = new Set(LOCK.exports["core.js"]);
    assert.ok(names.includes("LayerProvider") && names.includes("registerIcons"));
    assert.deepEqual(names.filter((n) => !have.has(n)), []);
  });

  test(`${slug}: package.json names no Astryx package`, () => {
    assert.doesNotMatch(readFileSync(app(slug, "package.json"), "utf8"), /@astryxdesign/);
  });

  test(`${slug}: index.html has no inline script and no import map, and loads the kit's three style sheets`, () => {
    const html = readFileSync(app(slug, "index.html"), "utf8");
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    assert.ok(scripts.length >= 1, "the module script is there");
    assert.deepEqual(scripts.filter((s) => !/\bsrc\s*=/.test(s)), [], "a <script> without src");
    assert.doesNotMatch(html, /importmap/i);
    assert.match(html, /<html lang="en" data-theme="dark" data-astryx-theme="neutral">/);
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(sheets, ["/astryx/reset.css", "/astryx/astryx.css", "/astryx/theme.css"]);
  });
}

test("both apps carry the same bytes in the kit's wiring files", () => {
  for (const p of SAME) {
    const [a, b] = APPS.map((slug) => readFileSync(app(slug, ...p.split("/"))));
    assert.ok(a.equals(b), `${p} differs between the two apps`);
  }
});
