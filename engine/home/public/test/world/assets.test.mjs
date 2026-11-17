// The world's asset set (PLAN-3D T2, D17 to D20; REAL-1 made v2): every file in assets/world/v2/ is in the manifest with its
// size and SHA-256, and every file the manifest names is there; the first view of each page, per tier and
// theme, stays inside its byte budget (three.js counted); models are .gltf with external files beside them;
// NOTICE.md names everything the manifest holds. A changed file without a new folder (v3) fails here.
// v2 (REAL-1) is v1 whole plus the furniture models and the cladding boards; v1 is gone from the tree with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORLD = join(PUBLIC, "assets", "world");
const V1 = join(WORLD, "v2"); // the set's folder (the name is kept from v1's day)
const MANIFEST = join(V1, "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const FILES = manifest.files;
const rel = (full) => relative(PUBLIC, full).split(sep).join("/");

// D20: raw bytes as the home server sends them (it does not compress), for the first view of each page.
// REAL-1 raised the Map's two: the owner asked for a building that reads as real, and the orchestrator allowed the
// desktop's first view up to 20 MB and the phone's up to 8 MB for the furniture models and the cladding.
const BUDGET = [
  { tier: "desktop", mode: "map", limit: 20_000_000 },
  { tier: "phone", mode: "map", limit: 8_000_000 },
  { tier: "desktop", mode: "desk", limit: 8_000_000 },
  { tier: "phone", mode: "desk", limit: 4_000_000 },
];
const THEMES = ["dark", "light"];
const LICENCES = ["CC0-1.0", "MIT", "own"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("the manifest's shape: version 2, plain unique keys, unique paths, known tiers, modes, themes and licences", () => {
  assert.equal(manifest.version, 2);
  assert.ok(FILES.length > 0);
  const keys = new Set(), paths = new Set();
  for (const f of FILES) {
    assert.deepEqual(Object.keys(f).sort(), ["bytes", "key", "licence", "modes", "path", "sha256", "themes", "tiers"], f.key);
    assert.match(f.key, /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, `${f.key} is a plain key`);
    assert.ok(!keys.has(f.key), `${f.key} is listed once`); keys.add(f.key);
    assert.ok(!paths.has(f.path), `${f.path} is listed once`); paths.add(f.path);
    assert.ok(Number.isInteger(f.bytes) && f.bytes > 0, `${f.key} has a size`);
    assert.match(f.sha256, /^[0-9a-f]{64}$/, `${f.key} has a SHA-256`);
    for (const [field, allowed] of [["tiers", ["desktop", "phone"]], ["modes", ["map", "desk"]], ["themes", THEMES]]) {
      assert.ok(Array.isArray(f[field]) && f[field].length > 0, `${f.key} has ${field}`);
      for (const v of f[field]) assert.ok(allowed.includes(v), `${f.key}: ${field} ${v}`);
    }
    assert.ok(LICENCES.includes(f.licence), `${f.key}: licence ${f.licence}`);
  }
});

test("no path contains .. and every path is a plain address under the tree, in v2/ or three.js's folder", () => {
  for (const f of FILES) {
    assert.ok(!f.path.split("/").includes(".."), `${f.path} has no ..`);
    assert.ok(!f.path.includes(".."), `${f.path} has no ..`);
    assert.ok(!f.path.startsWith("/") && !f.path.includes("\\") && !/^[a-z]+:/i.test(f.path), `${f.path} is relative`);
    assert.equal(posix.normalize(f.path), f.path, `${f.path} is normal`);
    assert.ok(f.path.startsWith("assets/world/v2/") || f.path.startsWith("vendor/three-0.169.0/"), `${f.path} is in the set or three.js`);
    if (f.path.startsWith("vendor/")) assert.equal(f.licence, "MIT", `${f.path} is three.js`);
  }
});

test("every file in the manifest is there with the stated bytes and SHA-256", () => {
  for (const f of FILES) {
    const data = readFileSync(join(PUBLIC, ...f.path.split("/")));
    assert.equal(data.length, f.bytes, `${f.path} has ${f.bytes} bytes`);
    assert.equal(createHash("sha256").update(data).digest("hex"), f.sha256, `${f.path} is unchanged`);
  }
});

test("no file in v2/ is missing from the manifest, and there is no .glb", () => {
  const listed = new Set(FILES.map((f) => f.path));
  for (const full of walk(V1)) {
    const p = rel(full);
    if (full === MANIFEST) continue;
    assert.ok(listed.has(p), `${p} is in the manifest`);
    assert.ok(!/\.glb$/i.test(p), `${p} is not a .glb`);
  }
  for (const f of FILES) assert.ok(!/\.glb$/i.test(f.path), `${f.path} is not a .glb`);
});

test("each budget of D20 holds for both themes, counting three.js and the manifest itself", () => {
  const own = statSync(MANIFEST).size;
  for (const { tier, mode, limit } of BUDGET) {
    for (const theme of THEMES) {
      const files = FILES.filter((f) => f.tiers.includes(tier) && f.modes.includes(mode) && f.themes.includes(theme));
      assert.ok(files.some((f) => f.key === "vendor.three"), `${tier} ${mode} ${theme} counts three.js`);
      assert.ok(files.some((f) => f.key.startsWith("sky.")), `${tier} ${mode} ${theme} has a sky`);
      const sum = own + files.reduce((s, f) => s + f.bytes, 0);
      assert.ok(sum <= limit, `${tier} ${mode} ${theme}: ${sum} bytes, at most ${limit}`);
    }
  }
});

test("one sky per theme in each first view: a picture and an HDR, never the other theme's", () => {
  for (const { tier, mode } of BUDGET) {
    for (const theme of THEMES) {
      const skies = FILES.filter((f) => f.key.startsWith("sky.") && f.tiers.includes(tier) && f.modes.includes(mode) && f.themes.includes(theme));
      assert.deepEqual(skies.map((f) => f.path.split(".").pop()).sort(), ["hdr", "jpg"], `${tier} ${mode} ${theme}`);
      for (const f of skies) assert.deepEqual(f.themes, [theme], `${f.key} belongs to one theme`);
    }
  }
});

test("the desk loads no forest, ground or tree files (D20)", () => {
  for (const f of FILES.filter((x) => x.modes.includes("desk"))) {
    assert.doesNotMatch(f.path, /forest|forrest|wood_floor_deck|grass|\/trees\//, `${f.path} is not for the desk`);
  }
});

test("every .gltf names only relative files inside its own folder, each there and in the manifest; no embedded image", () => {
  const listed = new Set(FILES.map((f) => f.path));
  const gltfs = FILES.filter((f) => f.path.endsWith(".gltf"));
  assert.ok(gltfs.length > 0, "there are models");
  for (const f of gltfs) {
    const g = JSON.parse(readFileSync(join(PUBLIC, ...f.path.split("/")), "utf8"));
    const folder = posix.dirname(f.path);
    const prefix = f.key + ".";
    const uris = [...(g.buffers || []).map((b) => b.uri), ...(g.images || []).map((i) => i.uri)];
    for (const img of g.images || []) assert.equal(img.bufferView, undefined, `${f.path}: no image inside a buffer`);
    assert.ok(uris.length > 0, `${f.path} names its files`);
    for (const uri of uris) {
      assert.equal(typeof uri, "string", `${f.path}: every buffer and image has a uri`);
      assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(uri) && !uri.startsWith("/") && !uri.includes("\\"), `${f.path}: ${uri} is relative`);
      assert.ok(!uri.split("/").includes(".."), `${f.path}: ${uri} stays in its folder`);
      const target = posix.normalize(posix.join(folder, decodeURIComponent(uri)));
      assert.ok(target.startsWith(folder + "/"), `${f.path}: ${uri} stays in its folder`);
      assert.ok(listed.has(target), `${f.path}: ${uri} is in the manifest`);
      const entry = FILES.find((x) => x.path === target);
      assert.ok(entry.key.startsWith(prefix), `${entry.key} shares the key prefix ${f.key}`);
      for (const field of ["tiers", "modes", "themes"]) assert.deepEqual(entry[field], f[field], `${entry.key} goes where ${f.key} goes`);
    }
  }
});

test("NOTICE.md names three.js and every model, texture, sky and tree source in the manifest", () => {
  const notice = readFileSync(join(WORLD, "NOTICE.md"), "utf8");
  assert.match(notice, /three\.js 0\.169\.0/);
  assert.match(notice, /MIT/);
  assert.match(notice, /Copyright © 2010-2024 three\.js authors/);
  assert.match(notice, /CC0 1\.0/);
  assert.match(notice, /16 November 2026/);
  assert.doesNotMatch(notice, /\bv1\//, "the notice names the set that is served");
  assert.match(notice, /Nothing is fetched at run time/);
  const names = new Set();
  for (const f of FILES) {
    const parts = f.path.split("/");
    const base = parts[parts.length - 1];
    if (parts[3] === "models") names.add(parts[4]);
    else if (parts[3] === "tex") names.add(base.replace(/_(diff|nor|rough)\.jpg$/, ""));
    else if (parts[3] === "sky") names.add(base.replace(/_(2k|4k|256|512)\.(jpg|hdr)$/, ""));
    else if (parts[3] === "trees") { names.add("fir_tree_01"); names.add("fir_sapling_medium"); }
    else if (parts[3] === "prints") names.add("our own renders of the Lake House prototype");
  }
  assert.ok(names.size >= 10, "the families were found");
  for (const n of names) assert.ok(notice.includes(n), `NOTICE.md names ${n}`);
});
