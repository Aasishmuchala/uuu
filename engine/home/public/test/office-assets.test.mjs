// The loft's pictures (assets/office/v1/; the owner chose photographs over 3D on 18 Nov 2026): every file in v1/ is in
// the manifest with its bytes, pixels and SHA-256, and every file the manifest names is there; each stays under its
// byte limit, so the Map's first view on a desktop is far under the old world's 12 MB; office/assets.js asks only for
// files the manifest holds (a phone only ever for the 900 px one); the moving picture is not asked for until it is in
// the set; NOTICE.md names the pictures as the owner's own. A changed file without a new folder (v2) fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..");
const V1 = join(PUBLIC, "assets", "office", "v1");
const manifest = JSON.parse(readFileSync(join(V1, "manifest.json"), "utf8"));
const FILES = manifest.files;
const A = await import(pathToFileURL(join(PUBLIC, "office", "assets.js")).href);

// Byte limits by width: the owner's aim was under 1.5 MB a picture at the desktop's largest.
const LIMIT = { 2560: 1_500_000, 1600: 700_000, 900: 250_000, 3: 1_000 };
// The old world's first view on a desktop (assets/world v2 and three.js) was about 12 MB.
const OLD_FIRST_VIEW = 12_000_000;

test("the manifest's shape: version 1, four pictures in two lights at three widths and a ground each, own licence", () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.video, null);
  assert.equal(FILES.length, 16);
  const keys = new Set();
  for (const f of FILES) {
    assert.deepEqual(Object.keys(f).sort(), ["bytes", "height", "key", "licence", "light", "path", "picture", "sha256", "theme", "tier", "width"], f.key);
    assert.ok(!keys.has(f.key), `${f.key} once`); keys.add(f.key);
    assert.match(f.path, /^assets\/office\/v1\/(loft|desk)-(dusk|morning)-(2560|1600|900|ground)\.webp$/);
    assert.equal(f.licence, "own");
    assert.ok(["loft", "desk"].includes(f.picture) && ["dusk", "morning"].includes(f.light));
    assert.equal(f.theme, f.light === "dusk" ? "dark" : "light");
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
  }
  for (const picture of A.PICTURES) for (const light of A.LIGHTS) {
    for (const w of A.WIDTHS) assert.ok(keys.has(`${picture}.${light}.${w}`), `${picture} ${light} ${w}`);
    assert.ok(keys.has(`${picture}.${light}.ground`));
  }
});

test("every file in the manifest is there with its bytes and SHA-256, and nothing else is in v1/", () => {
  for (const f of FILES) {
    const data = readFileSync(join(PUBLIC, ...f.path.split("/")));
    assert.equal(data.length, f.bytes, `${f.path} has ${f.bytes} bytes`);
    assert.equal(createHash("sha256").update(data).digest("hex"), f.sha256, `${f.path} is unchanged`);
    // a WebP: RIFF....WEBP
    assert.equal(data.subarray(0, 4).toString("latin1"), "RIFF");
    assert.equal(data.subarray(8, 12).toString("latin1"), "WEBP");
  }
  const listed = new Set(FILES.map((f) => f.path.split("/").pop()));
  assert.deepEqual(readdirSync(V1).filter((n) => n !== "manifest.json").sort(), [...listed].sort());
});

test("each picture keeps the 5504 x 3072 shape and stays under its byte limit; the first view is far under 12 MB", () => {
  for (const f of FILES) {
    if (f.width === 3) { assert.equal(f.height, 3); assert.ok(f.bytes <= LIMIT[3], f.key); continue; }
    assert.ok(Math.abs(f.height - (f.width * 3072) / 5504) <= 1, `${f.key} keeps the shape`);
    assert.ok(f.bytes <= LIMIT[f.width], `${f.key}: ${f.bytes} bytes, at most ${LIMIT[f.width]}`);
    assert.equal(f.tier, f.width === 900 ? "phone" : "desktop");
  }
  const bytes = (key) => FILES.find((f) => f.key === key).bytes;
  for (const light of A.LIGHTS) {
    // the most a desktop asks for on the Map's first view: the largest picture and its ground
    const first = bytes(`loft.${light}.2560`) + bytes(`loft.${light}.ground`);
    assert.ok(first < 1_500_000 && first < OLD_FIRST_VIEW / 8, `the Map's first view at ${light}: ${first} bytes`);
    assert.ok(bytes(`loft.${light}.900`) + bytes(`loft.${light}.ground`) < 250_000, "a phone's first view");
  }
});

test("office/assets.js asks only for files the manifest holds; a phone only for the 900 px one", () => {
  const paths = new Set(FILES.map((f) => `/${f.path}`));
  for (const picture of A.PICTURES) for (const light of A.LIGHTS) {
    for (const w of A.WIDTHS) assert.ok(paths.has(A.picturePath(picture, light, w)), A.picturePath(picture, light, w));
    assert.ok(paths.has(A.groundPath(picture, light)));
    const phone = A.sourcesOf(picture, light, "phone");
    assert.equal(phone.src, `/assets/office/v1/${picture}-${light}-900.webp`);
    assert.equal(phone.srcset, `${phone.src} 900w`);
    const desk = A.sourcesOf(picture, light, "desktop");
    assert.ok(paths.has(desk.src));
    for (const part of desk.srcset.split(", ")) assert.ok(paths.has(part.split(" ")[0]), part);
    assert.doesNotMatch(desk.srcset, /-900\./, "a desktop never asks for the phone's file");
  }
  assert.equal(A.lightOf("light"), "morning");
  assert.equal(A.lightOf("dark"), "dusk");
  assert.equal(A.lightOf("auto"), "dusk");
  // anything odd falls back to a file that exists
  assert.ok(paths.has(A.picturePath("x", "y", 7)));
});

test("the moving picture: not asked for until it is in the set; then only the dusk loft, on a desktop, with motion", () => {
  assert.equal(A.VIDEO, null);
  assert.equal(A.videoOf({ picture: "loft", light: "dusk", tier: "desktop", still: false }), null);
  const v = "/assets/office/v1/loop-dusk.mp4";
  assert.equal(A.videoOf({ picture: "loft", light: "dusk", tier: "desktop", still: false, video: v }), v);
  for (const o of [{ picture: "desk" }, { light: "morning" }, { tier: "phone" }, { still: true }]) {
    assert.equal(A.videoOf({ picture: "loft", light: "dusk", tier: "desktop", still: false, video: v, ...o }), null, JSON.stringify(o));
  }
  for (const bad of ["data:video/mp4,x", "//elsewhere/x.mp4", "/assets/world/v2/x.mp4", "/assets/office/v1/../x.mp4", 7]) {
    assert.equal(A.videoOf({ picture: "loft", light: "dusk", tier: "desktop", still: false, video: bad }), null);
  }
});

test("NOTICE.md names the four pictures as the owner's own", () => {
  const notice = readFileSync(join(PUBLIC, "assets", "office", "NOTICE.md"), "utf8");
  for (const name of ["loft-dusk", "loft-morning", "desk-dusk", "desk-morning"]) assert.ok(notice.includes(`\`${name}\``), name);
  assert.match(notice, /owner's own generated images/);
  assert.match(notice, /v1\/manifest\.json/);
});
