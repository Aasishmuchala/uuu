// Where the tags over the studio go (PLAN-3D T3, D23.2): never two crossing, never outside the bounds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORLD = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "world");
const { placeTags, GAP } = await import(pathToFileURL(join(WORLD, "tags.js")).href);

const cross = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (b, B) => b.x >= (B.x || 0) && b.y >= (B.y || 0) && b.x + b.w <= (B.x || 0) + B.w && b.y + b.h <= (B.y || 0) + B.h;

function holds(out, bounds, what) {
  const shown = out.filter((b) => !b.hidden);
  for (const b of shown) assert.ok(inside(b, bounds), `${what}: ${b.id} lies inside`);
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) assert.ok(!cross(shown[i], shown[j]), `${what}: ${shown[i].id} and ${shown[j].id} cross`);
  return shown;
}

test("two overlapping tags: the second moves below the first, neither hidden", () => {
  const out = placeTags([{ id: "a", x: 0, y: 0, w: 100, h: 24 }, { id: "b", x: 50, y: 10, w: 100, h: 24 }], { w: 400, h: 300 });
  const [a, b] = out;
  assert.equal(a.hidden, false);
  assert.equal(b.hidden, false);
  assert.deepEqual([a.x, a.y], [0, 0], "the first keeps its spot");
  assert.ok(b.y >= 28, `b.y is ${b.y}`);
  assert.equal(b.y, 24 + GAP);
  holds(out, { w: 400, h: 300 }, "two");
});

test("thirty tags at one point in 200 x 60: none crossing, the rest hidden", () => {
  const boxes = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, x: 50, y: 20, w: 80, h: 24 }));
  const bounds = { w: 200, h: 60 };
  const out = placeTags(boxes, bounds);
  assert.equal(out.length, 30);
  const shown = holds(out, bounds, "thirty");
  assert.ok(shown.length >= 1 && shown.length < 30, `${shown.length} shown`);
  assert.equal(out.filter((b) => b.hidden === true).length, 30 - shown.length);
  assert.deepEqual(out.map((b) => b.id), boxes.map((b) => b.id), "the same order");
});

test("a tag asked for outside the bounds is brought inside", () => {
  const out = placeTags([{ id: "a", x: -40, y: 290, w: 100, h: 24 }], { w: 400, h: 300 });
  assert.deepEqual([out[0].x, out[0].y, out[0].hidden], [0, 276, false]);
  const offset = placeTags([{ id: "a", x: 0, y: 0, w: 50, h: 20 }], { x: 100, y: 50, w: 200, h: 100 });
  assert.deepEqual([offset[0].x, offset[0].y], [100, 50]);
});

test("a tag wider than the bounds is hidden and keeps the spot it asked for", () => {
  const out = placeTags([{ id: "a", x: 10, y: 10, w: 500, h: 24 }], { w: 400, h: 300 });
  assert.deepEqual(out, [{ id: "a", x: 10, y: 10, w: 500, h: 24, hidden: true }]);
});

test("many tags in a lattice of spots: the rules hold, and the same input gives the same answer", () => {
  const bounds = { w: 640, h: 360 };
  const boxes = [];
  for (let i = 0; i < 60; i++) boxes.push({ id: `t${i}`, x: (i * 37) % 600, y: (i * 53) % 340, w: 60 + (i % 5) * 20, h: 24 });
  const out = placeTags(boxes, bounds);
  holds(out, bounds, "lattice");
  assert.deepEqual(placeTags(boxes, bounds), out);
  assert.ok(out.filter((b) => !b.hidden).length > 10);
});

test("tags far apart are left where they are", () => {
  const boxes = [{ id: "a", x: 10, y: 10, w: 80, h: 24 }, { id: "b", x: 200, y: 200, w: 80, h: 24 }];
  assert.deepEqual(placeTags(boxes, { w: 400, h: 300 }).map((b) => [b.x, b.y, b.hidden]), [[10, 10, false], [200, 200, false]]);
});

test("wrong input never throws", () => {
  for (const v of [null, undefined, 3, "x", {}, [null, 3, "x"], [{ id: "a" }]]) {
    for (const bd of [null, undefined, 3, {}, { w: "x" }, { w: 100, h: 100 }]) {
      const out = placeTags(v, bd);
      assert.ok(Array.isArray(out));
    }
  }
  assert.deepEqual(placeTags([{ id: "a", x: NaN, y: "x", w: 10, h: 10 }], { w: 100, h: 100 }), [{ id: "a", x: 0, y: 0, w: 10, h: 10, hidden: false }]);
});
