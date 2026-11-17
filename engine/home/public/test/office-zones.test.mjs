// The loft's zones (office/zones.js; the owner chose photographs over 3D on 18 Nov 2026): the seven departments of
// the seed at their furniture in the picture, measured on its pixels and pinned here; no two zones cross and each
// anchor lies in its own zone only; which zone each room takes (seven at most, the rest in the list only); and the
// framing: the overview keeps every zone in the free area, a room opened is scaled onto its zone, the desk always
// covers its stage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..");
const Z = await import(pathToFileURL(join(PUBLIC, "office", "zones.js")).href);
const { stageView } = await import(pathToFileURL(join(PUBLIC, "office", "stage.js")).href);
const F = await import(pathToFileURL(join(PUBLIC, "world", "fixtures.js")).href);

const crosses = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inBox = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

test("the zones are pinned: each department's box and anchor in percent of the 5504 x 3072 picture", () => {
  assert.equal(Z.ASPECT, 5504 / 3072);
  const pinned = Object.fromEntries(Object.values(Z.ZONES).map((z) => [z.id, [z.box.x, z.box.y, z.box.w, z.box.h, z.anchor.x, z.anchor.y]]));
  assert.deepEqual(pinned, {
    studio: [11.5, 57, 25.5, 26, 28.5, 66],
    books: [28.5, 22, 16.5, 35, 36.5, 40],
    operations: [42, 62, 21, 21, 52.5, 69],
    support: [66, 62, 21, 21, 76.5, 70],
    people: [61, 51, 12.5, 11, 66.5, 56],
    sales: [55.5, 25, 10, 18, 61.2, 33.5],
    marketing: [65.5, 11, 23.5, 37.5, 78.3, 36.5],
  });
  assert.deepEqual([Z.DOORS.box, Z.DOORS.anchor], [{ x: 10.5, y: 25.5, w: 13.5, h: 31 }, { x: 17, y: 42 }]);
  assert.deepEqual(Z.DESK, { stack: { x: 30.5, y: 72.5 }, model: { x: 44, y: 62 }, tray: { x: 37.5, y: 85 }, focus: { x: 22, y: 52, w: 34, h: 38 } });
  assert.deepEqual([...Z.ZONE_ORDER], ["operations", "sales", "marketing", "studio", "support", "people", "books"]);
  assert.equal(Z.ZONE_COUNT, 7);
  assert.ok(Object.isFrozen(Z.ZONES) && Object.isFrozen(Z.DOORS) && Object.isFrozen(Z.DESK));
});

test("every box is inside the picture, no two boxes cross, each anchor is in its own box and in no other", () => {
  const all = [...Object.values(Z.ZONES), Z.DOORS];
  for (const z of all) {
    assert.ok(z.box.x >= 0 && z.box.y >= 0 && z.box.x + z.box.w <= 100 && z.box.y + z.box.h <= 100, `${z.id} is inside the picture`);
    assert.ok(inBox(z.anchor, z.box), `${z.id}'s anchor is in its box`);
    assert.ok(inBox(z.box, Z.OVERVIEW) || crosses(z.box, Z.OVERVIEW), `${z.id} is in the overview`);
    assert.ok(inBox(z.anchor, Z.OVERVIEW), `${z.id}'s anchor is in the overview`);
    assert.ok(inBox(z.anchor, Z.BUILDING), `${z.id}'s anchor is in the building`);
    for (const o of all) {
      if (o === z) continue;
      assert.ok(!crosses(z.box, o.box), `${z.id} and ${o.id} do not cross`);
      assert.ok(!inBox(z.anchor, o.box) || z.anchor.x === o.box.x + o.box.w || z.anchor.y === o.box.y + o.box.h, `${z.id}'s anchor is not in ${o.id}`);
    }
  }
  for (const p of Object.values(Z.DESK).slice(0, 3)) assert.ok(p.x > 0 && p.x < 100 && p.y > 0 && p.y < 100);
});

test("which zone each room takes: its own by name, else the first free in the seed's order; seven at most", () => {
  const seed = Z.zonesFor(F.seed.world.rooms);
  assert.deepEqual([...seed], F.seed.world.rooms.map((r) => [r.id, r.id]));
  const big = Z.zonesFor(F.big.world.rooms);
  assert.equal(big.size, 7);
  assert.deepEqual([...big], ["operations", "sales", "marketing", "studio", "support", "people", "books"].map((z, i) => [`dept-${i}`, z]));
  // a known room keeps its zone wherever it comes in the list; the others fill what is left in order
  const mixed = Z.zonesFor([{ id: "lab" }, { id: "books" }, { id: "x" }, { id: "operations" }, { id: "../bad" }, { id: "lab" }, null, "str"]);
  assert.deepEqual([...mixed], [["lab", "sales"], ["books", "books"], ["x", "marketing"], ["operations", "operations"]]);
  // fewer than seven: the other zones stay free (lit dim, unlabelled)
  assert.deepEqual([...Z.zonesFor(F.one.world.rooms)], [["operations", "operations"]]);
  assert.equal(Z.zonesFor(null).size, 0);
  assert.equal(Z.zonesFor([]).size, 0);
  // the hostile fixture's bad id is never placed
  assert.ok(![...Z.zonesFor(F.hostile.world.rooms).keys()].includes(F.HOSTILE_ID));
});

test("the cover frame has the picture's shape and covers the stage", () => {
  for (const [w, h] of [[1064, 852], [1920, 1032], [390, 300], [390, 200], [2560, 600]]) {
    const c = Z.coverOf(w, h);
    assert.ok(c.w >= w - 0.01 && c.h >= h - 0.01, `${w}x${h}`);
    assert.ok(Math.abs(c.w / c.h - Z.ASPECT) < 1e-9);
    assert.ok(Math.abs(c.w - w) < 0.01 || Math.abs(c.h - h) < 0.01, "the smallest such frame");
  }
  assert.equal(Z.viewOf({ stage: { w: 0, h: 10 } }), null);
});

// The page column at 1280 x 900 less the sidebar and the top bar, the rail's 340 px, the foot.
const DESKTOP = { stage: { w: 1064, h: 852 }, safe: { x: 340, y: 0, w: 724, h: 712 } };

test("the overview keeps every zone and the doors in the free area, desktop and phone", () => {
  for (const { stage, safe } of [DESKTOP, { stage: { w: 1704, h: 1032 }, safe: { x: 340, y: 0, w: 1364, h: 890 } }, { stage: { w: 390, h: 300 }, safe: null }]) {
    const v = Z.viewOf({ stage, safe, target: Z.OVERVIEW, fill: 0.94, least: 0.45, most: 1 });
    const box = safe || { x: 0, y: 0, ...stage };
    for (const z of [...Object.values(Z.ZONES), Z.DOORS]) {
      const p = Z.project(v, z.anchor);
      assert.ok(p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h, `${z.id} at ${Math.round(p.x)},${Math.round(p.y)} in ${stage.w}x${stage.h}`);
    }
    assert.ok(v.s <= 1 && v.s >= 0.45);
  }
});

test("a room opened: its zone scaled up into the free area; the desk covers its stage", () => {
  const safe = { x: 0, y: 0, w: 672, h: 712 };
  for (const id of Object.keys(Z.ZONES)) {
    const v = Z.viewOf({ stage: DESKTOP.stage, safe, target: Z.roomTarget(id), fill: 0.9, least: 0.6, most: 2.4 });
    assert.ok(v.s > 1, `${id} is closer than the overview`);
    const p = Z.project(v, Z.ZONES[id].anchor);
    assert.ok(p.x >= 0 && p.x <= safe.w && p.y >= 0 && p.y <= safe.h, `${id}'s anchor in the free area`);
    // a frame larger than the stage always covers it
    assert.ok(v.x <= 0 && v.y <= 0 && v.x + v.w * v.s >= DESKTOP.stage.w - 0.5 && v.y + v.h * v.s >= DESKTOP.stage.h - 0.5, `${id} covers`);
  }
  assert.deepEqual(Z.roomTarget("nowhere"), Z.OVERVIEW);
  for (const stage of [{ w: 1064, h: 852 }, { w: 1704, h: 1032 }, { w: 390, h: 200 }, { w: 1200, h: 240 }]) {
    const v = Z.viewOf({ stage, safe: { x: 420, y: 0, w: 320, h: stage.h }, target: Z.DESK.focus, fill: 1, least: 1, most: 1.15, cover: true });
    assert.ok(v.s >= 1);
    assert.ok(v.x <= 0 && v.y <= 0 && v.x + v.w * v.s >= stage.w - 0.5 && v.y + v.h * v.s >= stage.h - 0.5, `the desk covers ${stage.w}x${stage.h}`);
  }
});

test("the stage's own views: beside the rail the overview keeps clear of the scrim's fade; a room fills the free area", () => {
  const v = stageView({ mode: "map", size: DESKTOP.stage, safe: DESKTOP.safe, zone: null, tier: "desktop" });
  for (const z of [...Object.values(Z.ZONES), Z.DOORS]) assert.ok(Z.project(v, z.anchor).x >= DESKTOP.safe.x + 80, `${z.id} is past the scrim`);
  const r = stageView({ mode: "map", size: DESKTOP.stage, safe: { x: 0, y: 0, w: 672, h: 712 }, zone: "sales", tier: "desktop" });
  assert.ok(r.s > 1);
  const d = stageView({ mode: "desk", size: { w: 390, h: 200 }, safe: null, zone: null, tier: "phone" });
  assert.ok(d.s >= 1 && d.x <= 0 && d.y <= 0);
  assert.equal(stageView({ mode: "map", size: null }), null);
});
