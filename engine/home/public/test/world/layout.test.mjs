// The studio building's plan (PLAN-3D T3, D8): the floors of the seed, the overflow, the empty building, the desks of
// a crowded room, the rules that must hold for every count of rooms and agents, and the seed's numbers, pinned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORLD = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "world");
const { planBuilding, roomWidth, MIN_ROOM, MAX_ROOMS } = await import(pathToFileURL(join(WORLD, "layout.js")).href);

const SEED = [["operations", 4], ["sales", 1], ["marketing", 2], ["studio", 2], ["support", 1], ["people", 1], ["books", 1]];
const roomsOf = (pairs) => pairs.map(([id, n]) => ({ id, agents: Array.from({ length: n }, (_, i) => ({ slug: `${id}-a${i}` })) }));
const gen = (rooms, agents) => Array.from({ length: rooms }, (_, i) => [`room-${i}`, agents]);
const EPS = 1e-6;

test("the seed: two rooms on the ground, three above, two on top, nothing over", () => {
  const plan = planBuilding(roomsOf(SEED));
  assert.deepEqual(plan.floors, [["operations", "sales"], ["marketing", "studio", "support"], ["people", "books"]]);
  assert.deepEqual(plan.overflow, []);
  assert.equal(plan.empty, false);
});

test("twelve rooms: four floors hold eleven, the twelfth is list-only", () => {
  const plan = planBuilding(roomsOf(gen(12, 1)));
  assert.equal(MAX_ROOMS, 11);
  assert.equal(plan.floors.length, 4);
  assert.deepEqual(plan.floors.map((f) => f.length), [2, 3, 3, 3]);
  assert.equal(plan.rooms.length, 11);
  assert.deepEqual(plan.overflow, ["room-11"]);
});

test("no rooms: an empty plan, still with the annex for the three doors", () => {
  for (const v of [[], null, undefined, "x", 3, {}, [null, 4, "x", { id: "../x" }]]) {
    const plan = planBuilding(v);
    assert.equal(plan.empty, true);
    assert.deepEqual(plan.rooms, []);
    assert.deepEqual(plan.floors, []);
    assert.deepEqual(plan.annex.doors.map((d) => d.id), ["web", "generation", "higgsfield"]);
    assert.equal(plan.terrace, null);
  }
});

test("a room with thirteen agents: six desks and seven more", () => {
  const plan = planBuilding(roomsOf([["crowd", 13]]));
  assert.equal(plan.rooms[0].desks.length, 6);
  assert.equal(plan.rooms[0].more, 7);
  assert.deepEqual(plan.rooms[0].desks.map((d) => d.slug), ["crowd-a0", "crowd-a1", "crowd-a2", "crowd-a3", "crowd-a4", "crowd-a5"]);
});

test("a room's width follows its agents, clamped 2 to 6, never under 4.0 m", () => {
  assert.equal(roomWidth(0), roomWidth(2));
  assert.equal(roomWidth(1), roomWidth(2));
  assert.equal(roomWidth(13), roomWidth(6));
  assert.ok(roomWidth(6) > roomWidth(4) && roomWidth(4) > roomWidth(2));
  for (const n of [0, 1, 2, 6, null, "x", -1]) assert.ok(roomWidth(n) >= MIN_ROOM);
});

test("for 0 to 12 rooms crossed with 0, 1, 6 and 13 agents, every rule holds", () => {
  for (let n = 0; n <= 12; n++) {
    for (const k of [0, 1, 6, 13]) {
      const input = roomsOf(gen(n, k));
      const plan = planBuilding(input);
      const what = `${n} rooms of ${k}`;
      assert.deepEqual(planBuilding(input), plan, `${what}: the same answer twice`);
      assert.equal(plan.rooms.length, Math.min(n, 11), what);
      assert.equal(plan.overflow.length, Math.max(0, n - 11), what);
      const { x0, x1 } = plan.building;
      assert.ok(Math.abs(plan.annex.x0 - x1) < EPS, `${what}: the annex starts where the building ends`);
      for (let f = 0; f < plan.floors.length; f++) {
        const rooms = plan.rooms.filter((r) => r.floor === f).sort((a, b) => a.x0 - b.x0);
        assert.deepEqual(rooms.map((r) => r.id).sort(), [...plan.floors[f]].sort(), `${what}: floor ${f}`);
        for (let i = 0; i < rooms.length; i++) {
          const r = rooms[i];
          assert.ok(r.x0 >= x0 - EPS && r.x1 <= x1 + EPS, `${what}: ${r.id} lies inside the span`);
          assert.ok(r.x1 - r.x0 >= MIN_ROOM - EPS, `${what}: ${r.id} is ${r.x1 - r.x0} m wide`);
          if (i) assert.ok(r.x0 >= rooms[i - 1].x1 - EPS, `${what}: ${r.id} does not overlap ${rooms[i - 1].id}`);
          assert.equal(r.desks.length, Math.min(k, 6));
          assert.equal(r.more, Math.max(0, k - 6));
          for (const d of r.desks) assert.ok(d.x >= r.x0 + 0.6 - EPS && d.x <= r.x1 - 0.6 + EPS, `${what}: a desk 0.6 m inside ${r.id}`);
          for (let a = 0; a < r.desks.length; a++) {
            for (let b = a + 1; b < r.desks.length; b++) {
              const dist = Math.hypot(r.desks[a].x - r.desks[b].x, r.desks[a].z - r.desks[b].z);
              assert.ok(dist >= 1.5 - EPS, `${what}: desks ${dist} m apart in ${r.id}`);
            }
          }
        }
      }
      if (n) {
        const t = plan.terrace;
        assert.ok(t.x1 - t.x0 >= 4.0 - EPS, `${what}: the terrace is at least 4.0 m`);
        const sameFloor = plan.rooms.filter((r) => r.floor === t.floor);
        for (const r of sameFloor) assert.ok(r.x1 <= t.x0 + EPS, `${what}: the terrace is clear of ${r.id}`);
      }
    }
  }
});

test("rooms keep the server's order, a bad or repeated id is left out, an agent sits at one desk", () => {
  const plan = planBuilding([
    { id: "b", agents: ["x", { slug: "y" }] }, { id: "a", agents: ["x"] }, { id: "b", agents: [] }, { id: "../../x" }, { id: "Up" },
    { id: "c", agents: [{ slug: "bad slug" }, null, 7, { slug: "z" }] },
  ]);
  assert.deepEqual(plan.floors, [["b", "a"], ["c"]]);
  assert.deepEqual(plan.rooms.map((r) => r.desks.map((d) => d.slug)), [["x", "y"], [], ["z"]]);
});

test("the seed's numbers, pinned", () => {
  const plan = planBuilding(roomsOf(SEED));
  assert.deepEqual(plan.building, { x0: -8.75, x1: 5.65, storeys: 3, floorH: 3.3, groundY: 0.6, z0: -3.6, z1: 3.6 });
  assert.deepEqual(plan.rooms.map((r) => [r.id, r.floor, r.y, r.x0, r.x1, r.desks.map((d) => d.x), r.more]), [
    ["operations", 0, 0.6, -8.75, 0.33, [-7.09, -5.17, -3.25, -1.33], 0],
    ["sales", 0, 0.6, 0.33, 5.65, [2.99], 0],
    ["marketing", 1, 3.9, -8.75, -3.95, [-7.2, -5.5], 0],
    ["studio", 1, 3.9, -3.95, 0.85, [-2.4, -0.7], 0],
    ["support", 1, 3.9, 0.85, 5.65, [3.25], 0],
    ["people", 2, 7.2, -8.75, -3.95, [-6.35], 0],
    ["books", 2, 7.2, -3.95, 0.85, [-1.55], 0],
  ]);
  assert.ok(plan.rooms.every((r) => r.desks.every((d) => d.z === -1.25)));
  assert.deepEqual(plan.terrace, { floor: 2, x0: 0.85, x1: 5.65, onRoof: false });
  assert.deepEqual(plan.annex, { floor: 0, x0: 5.65, x1: 8.75, doors: [{ id: "web", x: 6.2 }, { id: "generation", x: 7.2 }, { id: "higgsfield", x: 8.2 }] });
});

test("one floor: the terrace stands on the roof", () => {
  const plan = planBuilding(roomsOf([["operations", 1]]));
  assert.deepEqual(plan.floors, [["operations"]]);
  assert.equal(plan.terrace.onRoof, true);
  assert.equal(plan.terrace.floor, 1);
});
