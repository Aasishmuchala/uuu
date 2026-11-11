import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const math = await import("../../studio/sprite-math.js");
const { sequence, nextIndex, prevIndex, fitZoom, frameDelay, neighbours, startPlace, tagPlace, keyAction, describeFrame, safeColours, stageSize } = math;

test("sprite-player: sequence plays a forward tag once", () => {
  assert.deepEqual(sequence({ from: 2, to: 5, direction: "forward" }, 8), [2, 3, 4, 5]);
});

test("sprite-player: sequence plays a reverse tag backwards", () => {
  assert.deepEqual(sequence({ from: 2, to: 5, direction: "reverse" }, 8), [5, 4, 3, 2]);
});

test("sprite-player: sequence plays a pingpong tag there and back without repeating the ends", () => {
  assert.deepEqual(sequence({ from: 2, to: 5, direction: "pingpong" }, 8), [2, 3, 4, 5, 4, 3]);
});

test("sprite-player: a one-frame tag is that frame in any direction", () => {
  for (const direction of ["forward", "reverse", "pingpong", undefined]) {
    assert.deepEqual(sequence({ from: 3, to: 3, direction }, 8), [3]);
  }
});

test("sprite-player: no tag plays every frame", () => {
  assert.deepEqual(sequence(null, 4), [0, 1, 2, 3]);
  assert.deepEqual(sequence(null, 0), []);
});

test("sprite-player: nextIndex stops at the end or loops", () => {
  assert.equal(nextIndex([2, 3, 4, 5], 3, false), null);
  assert.equal(nextIndex([2, 3, 4, 5], 3, true), 0);
  assert.equal(nextIndex([2, 3, 4, 5], 1, false), 2);
  assert.equal(nextIndex([], 0, true), null);
  assert.equal(prevIndex([2, 3, 4, 5], 0, false), null);
  assert.equal(prevIndex([2, 3, 4, 5], 0, true), 3);
});

test("sprite-player: fitZoom picks the largest whole zoom from 1 to 16", () => {
  assert.equal(fitZoom(16, 16, 300, 200), 12);
  assert.equal(fitZoom(512, 512, 300, 200), 1);
  assert.equal(fitZoom(1, 1, 1000, 1000), 16);
  assert.ok(Number.isInteger(fitZoom(7, 9, 333, 211)));
});

test("sprite-player: a frame stays for its own duration divided by the speed", () => {
  assert.equal(frameDelay(120, 1), 120);
  assert.equal(frameDelay(120, 2), 60);
  assert.equal(frameDelay(120, 0.5), 240);
  assert.equal(frameDelay(undefined, 1), 100);
  assert.equal(frameDelay(5, 1), 10);
});

test("sprite-player: the onion skin is the previous and next frame of the sequence", () => {
  const seq = [2, 3, 4, 5];
  assert.deepEqual(neighbours(seq, 1, false), { prev: 2, next: 4 });
  assert.deepEqual(neighbours(seq, 0, false), { prev: null, next: 3 });
  assert.deepEqual(neighbours(seq, 3, false), { prev: 4, next: null });
  assert.deepEqual(neighbours(seq, 3, true), { prev: 4, next: 2 });
  assert.deepEqual(neighbours([3], 0, true), { prev: null, next: null });
});

test("sprite-player: the address's tag and frame pick where the player starts", () => {
  const tags = [{ name: "walk", from: 0, to: 3 }, { name: "jump", from: 4, to: 5 }];
  assert.equal(tagPlace(tags, "jump"), 1);
  assert.equal(tagPlace(tags, "fly"), -1);
  assert.equal(tagPlace(tags, null), -1);
  assert.equal(startPlace([0, 1, 2, 3], 3), 2);
  assert.equal(startPlace([4, 5], 6), 1);
  assert.equal(startPlace([4, 5], 1), 0);
  assert.equal(startPlace([0, 1], "x"), 0);
});

test("sprite-player: keys, the text alternative, colours and the stage size", () => {
  assert.equal(keyAction(" "), "toggle");
  assert.equal(keyAction("ArrowLeft"), "prev");
  assert.equal(keyAction("ArrowRight"), "next");
  assert.equal(keyAction("["), "zoomOut");
  assert.equal(keyAction("]"), "zoomIn");
  assert.equal(keyAction("a"), null);
  assert.equal(describeFrame({ title: "Mascot walk cycle", frame: 1, total: 4, tag: "walk" }), "Mascot walk cycle, frame 2 of 4, animation walk");
  assert.equal(describeFrame({ title: "Mascot", frame: 0, total: 4, tag: "" }), "Mascot, frame 1 of 4, all frames");
  assert.deepEqual(safeColours(["#1b1b1f", "red; background: url(x)", "#F4A261", 7]), ["#1b1b1f", "#F4A261"]);
  assert.equal(safeColours(Array.from({ length: 100 }, () => "#000000")).length, 64);
  assert.deepEqual(stageSize([{ w: 16, h: 16 }, { w: 20, h: 8 }], 3), { w: 60, h: 48, frameW: 20, frameH: 16 });
});

test("sprite-player: the module draws on a canvas from the sheet, without the address or a library", () => {
  const src = readFileSync(join(PUBLIC, "studio/sprite-player.js"), "utf8");
  assert.match(src, /export function SpritePlayer\(\{ sheetUrl, frames, tags, palette, title, gif, initialTag, initialFrame \}\)/);
  assert.match(src, /requestAnimationFrame/);
  assert.match(src, /imageSmoothingEnabled = false/);
  assert.match(src, /globalAlpha = 0\.3/);
  assert.match(src, /The sheet could not be loaded\./);
  assert.match(src, /class="p-sprite-player"/);
  assert.doesNotMatch(src, /\blocation\b/);
  assert.doesNotMatch(src, /innerHTML|dangerouslySetInnerHTML/);
  const imports = [...src.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["../kit/index.js", "../vendor/preact-htm.js", "./sprite-math.js"].sort());
});

test("sprite-player: the stylesheet keeps to its root class and the tokens", () => {
  const css = readFileSync(join(PUBLIC, "styles/pages/sprite-player.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /image-rendering:\s*pixelated/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /rgb\(|font-family:(?!\s*var\()|font-size:\s*\d+px/);
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const sel = m[1].trim();
    if (sel.startsWith("@")) continue;
    for (const one of sel.split(",")) assert.ok(one.trim().startsWith(".p-sprite-player"), `${one.trim()} starts with .p-sprite-player`);
  }
});

test("sprite-player: loads in Node and exports the player", { skip: !existsSync(join(PUBLIC, "kit/index.js")) && "the kit is not there yet" }, async () => {
  const mod = await import("../../studio/sprite-player.js");
  assert.equal(typeof mod.SpritePlayer, "function");
  assert.equal(mod.default, mod.SpritePlayer);
});
