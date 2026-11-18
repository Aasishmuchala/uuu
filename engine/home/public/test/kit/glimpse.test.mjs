// The baked glimpses (PLAN-3D-ALL D7, U3): the room headers' pictures under assets/glimpse/v1, their manifest, and
// that every key of kit/room.js's table has its four files (dusk and morning, 1600 and 780 wide). Since U18 H2 the
// headers use v2 (glimpse-v2.test.mjs); v1 stays until the dead assets are deleted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, PUBLIC } from "./_dom.mjs";

const DIR = join(PUBLIC, "assets", "glimpse", "v1");
const { GLIMPSES } = await import(pathToFileURL(join(KIT, "room.js")).href);
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
const NAME = /^[a-z-]+-(dusk|morning)-(1600|780)\.webp$/;
const LIMIT = { 1600: 90_000, 780: 45_000 };
const HEIGHT = { 1600: 304, 780: 192 };

// A WebP's width and height from its first chunk (lossy VP8, lossless VP8L or extended VP8X).
function webpSize(b) {
  assert.equal(b.toString("latin1", 0, 4), "RIFF");
  assert.equal(b.toString("latin1", 8, 12), "WEBP");
  const kind = b.toString("latin1", 12, 16);
  if (kind === "VP8 ") {
    assert.deepEqual([...b.subarray(23, 26)], [0x9d, 0x01, 0x2a], "the VP8 start code");
    return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  if (kind === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  throw new Error(`unknown WebP chunk ${kind}`);
}

test("glimpses: the manifest's shape", () => {
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
  for (const f of manifest.files) {
    assert.deepEqual(Object.keys(f).sort(), ["bytes", "key", "path", "sha256", "theme", "width"]);
    assert.match(f.path, NAME);
    assert.equal(f.path, `${f.key}-${f.theme}-${f.width}.webp`);
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(new Set(manifest.files.map((f) => f.path)).size, manifest.files.length, "no file twice");
});

test("glimpses: every manifest file exists with its bytes, its sum and its size in pixels", () => {
  for (const f of manifest.files) {
    const b = readFileSync(join(DIR, f.path));
    assert.equal(b.length, f.bytes, `${f.path}: bytes`);
    assert.equal(createHash("sha256").update(b).digest("hex"), f.sha256, `${f.path}: sha256`);
    assert.deepEqual(webpSize(b), { w: f.width, h: HEIGHT[f.width] }, `${f.path}: pixels`);
  }
});

test("glimpses: no file in the folder is missing from the manifest, and every name has the pinned form", () => {
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const name of readdirSync(DIR)) {
    if (name === "manifest.json") continue;
    assert.match(name, NAME);
    assert.ok(listed.has(name), `${name} is in the manifest`);
  }
});

test("glimpses: every key of kit/room.js's table has four files", () => {
  assert.equal(GLIMPSES.length, 14);
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const key of GLIMPSES) {
    for (const theme of ["dusk", "morning"]) for (const width of [1600, 780]) assert.ok(listed.has(`${key}-${theme}-${width}.webp`), `${key}-${theme}-${width}`);
  }
  assert.equal(manifest.files.length, GLIMPSES.length * 4);
  assert.ok(manifest.files.every((f) => GLIMPSES.includes(f.key)), "no key outside the table");
});

test("glimpses: each file within its limit, and the whole folder at most 3,500,000 bytes", () => {
  for (const f of manifest.files) assert.ok(f.bytes <= LIMIT[f.width], `${f.path}: ${f.bytes} over ${LIMIT[f.width]}`);
  assert.ok(manifest.files.reduce((s, f) => s + f.bytes, 0) <= 3_500_000);
});
