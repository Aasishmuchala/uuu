// The byte readers of routes/_images.mjs (CONTRACTS-V2 17.8): pngSize, gifFrameCount and sniff, on the
// pinned vectors, the seed's sheet, and bytes that are not what they claim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import register, { gifFrameCount, pngSize, sniff } from "../routes/_images.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WALKER = join(HERE, "..", "..", "..", "test", "stubs", "state-seed-v2", "tasks", "company-work", "STH-8", "art", "walker");
const hex = (s) => Buffer.from(s.replace(/\s+/g, ""), "hex");

// The vector of 17.8: a GIF of two 1 x 1 frames.
const TWO_FRAMES = hex(`47 49 46 38 39 61 01 00 01 00 80 00 00 FF FF FF 00 00 00
  21 F9 04 00 0A 00 00 00 2C 00 00 00 00 01 00 01 00 00 02 02 44 01 00
  21 F9 04 00 0A 00 00 00 2C 00 00 00 00 01 00 01 00 00 02 02 4C 01 00 3B`);
const HEAD = hex("47 49 46 38 39 61 01 00 01 00 80 00 00 FF FF FF 00 00 00");
const FRAME = hex("21 F9 04 00 0A 00 00 00 2C 00 00 00 00 01 00 01 00 00 02 02 44 01 00");
const gifOf = (n) => Buffer.concat([HEAD, ...Array.from({ length: n }, () => FRAME), hex("3B")]);

test("gifFrameCount: the pinned two-frame vector is 2, and sniff says gif", () => {
  assert.equal(gifFrameCount(TWO_FRAMES), 2);
  assert.equal(sniff(TWO_FRAMES), "gif");
});

test("gifFrameCount: the same bytes cut off after the first 30 are null", () => {
  assert.equal(gifFrameCount(TWO_FRAMES.subarray(0, 30)), null);
});

test("gifFrameCount: repeating the frame makes more frames", () => {
  assert.equal(gifFrameCount(gifOf(1)), 1);
  assert.equal(gifFrameCount(gifOf(4)), 4);
  assert.equal(gifFrameCount(gifOf(37)), 37);
});

test("gifFrameCount: a GIF with no images is 0, a GIF without its trailer is null", () => {
  assert.equal(gifFrameCount(Buffer.concat([HEAD, hex("3B")])), 0);
  assert.equal(gifFrameCount(gifOf(3).subarray(0, gifOf(3).length - 1)), null);
});

test("gifFrameCount: a frame with a local colour table is counted and its table skipped", () => {
  // No global table (packed 00); the image descriptor's packed byte 81 means a local table of 4 colours.
  const gif = hex(`47 49 46 38 39 61 01 00 01 00 00 00 00
    2C 00 00 00 00 01 00 01 00 81  00 00 00 FF FF FF 2C 2C 2C 3B 3B 3B  02 02 44 01 00
    2C 00 00 00 00 01 00 01 00 00  02 02 44 01 00 3B`);
  assert.equal(gifFrameCount(gif), 2);
});

test("gifFrameCount: a comment extension and an application extension are skipped", () => {
  const comment = hex("21 FE 05 68 65 6C 6C 6F 00");                       // "hello"
  const netscape = hex("21 FF 0B 4E 45 54 53 43 41 50 45 32 2E 30 03 01 00 00 00");
  const gif = Buffer.concat([HEAD, netscape, comment, FRAME, comment, FRAME, hex("3B")]);
  assert.equal(gifFrameCount(gif), 2);
});

test("gifFrameCount: a block that is not an extension, an image or the end is null", () => {
  assert.equal(gifFrameCount(Buffer.concat([HEAD, hex("99"), FRAME, hex("3B")])), null);
});

test("gifFrameCount: a global colour table that runs off the end is null", () => {
  assert.equal(gifFrameCount(hex("47 49 46 38 39 61 01 00 01 00 87 00 00 FF FF")), null);
});

test("gifFrameCount: the seed's GIF has four frames", () => {
  assert.equal(gifFrameCount(readFileSync(join(WALKER, "walker.gif"))), 4);
});

test("gifFrameCount: anything that is not a GIF is null", () => {
  assert.equal(gifFrameCount(Buffer.from("GIF88a not really")), null);
  assert.equal(gifFrameCount(Buffer.alloc(0)), null);
  assert.equal(gifFrameCount("GIF89a"), null);
  assert.equal(gifFrameCount(null), null);
});

test("pngSize: the seed's sheet is 64 x 16", () => {
  assert.deepEqual(pngSize(readFileSync(join(WALKER, "walker-sheet.png"))), { w: 64, h: 16 });
});

test("pngSize: 20 random bytes are null, and so is a PNG cut before its size", () => {
  for (let i = 0; i < 20; i += 1) assert.equal(pngSize(randomBytes(20)), null);
  const sheet = readFileSync(join(WALKER, "walker-sheet.png"));
  assert.equal(pngSize(sheet.subarray(0, 23)), null);
  assert.equal(pngSize(Buffer.concat([hex("89504E470D0A1A0A"), Buffer.alloc(16)])), null);
});

test("sniff: png, gif (87a and 89a), jpeg and webp from their first bytes", () => {
  assert.equal(sniff(readFileSync(join(WALKER, "walker-sheet.png"))), "png");
  assert.equal(sniff(Buffer.from("GIF87a......")), "gif");
  assert.equal(sniff(Buffer.from("GIF89a......")), "gif");
  assert.equal(sniff(hex("FF D8 FF E0 00 10 4A 46 49 46")), "jpeg");
  assert.equal(sniff(Buffer.concat([Buffer.from("RIFF"), hex("24 00 00 00"), Buffer.from("WEBPVP8 ")])), "webp");
});

test("sniff: text, HTML, an SVG and short or odd bytes are null", () => {
  assert.equal(sniff(Buffer.from("<!doctype html><script>alert(1)</script>")), null);
  assert.equal(sniff(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  assert.equal(sniff(Buffer.from("RIFF1234WAVE")), null);
  assert.equal(sniff(hex("89 50 4E 47")), null);
  assert.equal(sniff(Buffer.alloc(0)), null);
  assert.equal(sniff(undefined), null);
});

test("the helper registers nothing", () => {
  const seen = [];
  register({ get: (p) => seen.push(p), post: (p) => seen.push(p), delete: (p) => seen.push(p) });
  assert.deepEqual(seen, []);
});
