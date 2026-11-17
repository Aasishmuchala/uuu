// The world's files only through the manifest (PLAN-3D D9, D19, T6 e): assetUrl gives an address under
// /assets/world/v2/ for a key the manifest holds and refuses everything else; a need picks exactly one file for its
// tier, mode and theme; and the world's own modules are reached by no page, shell, kit or lib module statically
// (only stage.js, by import()).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..");
const { assetUrl, entryOf, useManifest, bytesOf, familyOf, MANIFEST_PATH } = await import(pathToFileURL(join(PUBLIC, "world", "assets.js")).href);
const manifest = JSON.parse(readFileSync(join(PUBLIC, "assets", "world", "v2", "manifest.json"), "utf8"));

test("before the manifest is read, no key gives an address", async () => {
  // a fresh copy of the module, so the shared one's state does not matter
  const fresh = await import(`${pathToFileURL(join(PUBLIC, "world", "assets.js")).href}?fresh`);
  assert.throws(() => fresh.assetUrl("tex.wood_floor.diff"));
});

test("assetUrl gives a path under /assets/world/v2/ for a key the manifest holds", () => {
  useManifest(manifest);
  const url = assetUrl("tex.wood_floor.diff");
  assert.ok(url.startsWith("/assets/world/v2/"), url);
  assert.equal(url, "/assets/world/v2/tex/1k/wood_floor_diff.jpg");
  assert.equal(assetUrl("tex.wood_floor.diff", { tier: "phone" }), "/assets/world/v2/tex/512/wood_floor_diff.jpg");
  assert.equal(assetUrl("model.fern_02"), "/assets/world/v2/models/fern_02/fern_02.gltf");
  assert.equal(MANIFEST_PATH, "/assets/world/v2/manifest.json");
});

test("assetUrl refuses a key the manifest does not hold, and anything with a slash, a dot-dot or a colon", () => {
  useManifest(manifest);
  // the address is built from parts, so this file names no host (test/static.test.mjs)
  const outside = ["http", "://", "a.example", "/x"].join("");
  for (const bad of ["../x", outside, "nope", "", null, undefined, 7, {}, "tex/1k", "tex..diff", "a:b", "tex.wood_floor.diff/../../x", "TEX.wood_floor.diff", "vendor.three"]) {
    assert.throws(() => assetUrl(bad), `${String(bad)} is refused`);
  }
});

test("each need of the world's two modes picks exactly one file per tier, from the D20 set", () => {
  useManifest(manifest);
  const where = (tier, mode) => ({ tier, mode, theme: "dark" });
  // desktop: 1k textures, the full colour atlas, the half normal atlas, the 4k sky, the 512 HDR
  assert.match(assetUrl("tex.concrete_floor_02.nor", where("desktop", "map")), /\/1k\//);
  assert.match(assetUrl("trees.color", where("desktop", "map")), /trees_color\.webp$/);
  assert.match(assetUrl("trees.normal", where("desktop", "map")), /trees_normal_half\.webp$/);
  assert.match(assetUrl("sky.dusk.jpg", where("desktop", "map")), /_4k\.jpg$/);
  assert.match(assetUrl("sky.dusk.hdr", where("desktop", "desk")), /_512\.hdr$/);
  // phone: 512 textures, the half colour atlas, the same normal atlas, the 2k sky, the 256 HDR
  assert.match(assetUrl("tex.concrete_floor_02.nor", where("phone", "map")), /\/512\//);
  assert.match(assetUrl("trees.color", where("phone", "map")), /trees_color_half\.webp$/);
  assert.match(assetUrl("trees.normal", where("phone", "map")), /trees_normal_half\.webp$/);
  assert.match(assetUrl("sky.dusk.jpg", where("phone", "map")), /_2k\.jpg$/);
  assert.match(assetUrl("sky.dusk.hdr", where("phone", "desk")), /_256\.hdr$/);
  // desk mode has no ground, no trees and no grass
  for (const k of ["tex.forest_ground_04.diff", "trees.color", "model.grass_medium_01", "model.modern_arm_chair_01"]) assert.throws(() => entryOf(k, where("desktop", "desk")), k);
  // a model's family: its .gltf, its .bin and its pictures
  const fern = familyOf("model.fern_02", where("desktop", "desk")).map((f) => f.path);
  assert.ok(fern.some((p) => p.endsWith(".gltf")) && fern.some((p) => p.endsWith(".bin")) && fern.length >= 3);
  assert.ok(bytesOf(where("desktop", "map")) > bytesOf(where("desktop", "desk")));
});

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

test("world.js and world/scene/ are imported statically by nothing under pages/, shell/, kit/ or lib/", () => {
  const files = ["pages", "shell", "kit", "lib"].flatMap((d) => filesUnder(join(PUBLIC, d)));
  assert.ok(files.length > 10, "the folders were read");
  const STATIC = /(?:^|[\s;])import\s+(?:[^'"()]*?\sfrom\s*)?["']([^"']+)["']|export\s+[^'"()]*?\sfrom\s*["']([^"']+)["']/gm;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(STATIC)) {
      const spec = m[1] || m[2];
      assert.ok(!/(^|\/)world\/(world\.js|scene\/)/.test(spec) && !/^\.\/(world\.js|scene\/)/.test(spec), `${relative(PUBLIC, f)} imports ${spec}`);
    }
  }
  // and within world/, only stage.js reaches world.js, by import()
  for (const f of filesUnder(join(PUBLIC, "world"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(STATIC)) assert.ok(!/(^|\/)world\.js$/.test(m[1] || m[2] || ""), `${relative(PUBLIC, f)} imports world.js statically`);
  }
  assert.match(readFileSync(join(PUBLIC, "world", "stage.js"), "utf8"), /import\(["']\.\/world\.js["']\)/);
});
