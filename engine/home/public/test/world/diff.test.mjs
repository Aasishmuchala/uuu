// What changed between two readings, as events for the world (PLAN-3D T3, D22).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORLD = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "world");
const { diffWorld } = await import(pathToFileURL(join(WORLD, "diff.js")).href);
const { worldState } = await import(pathToFileURL(join(WORLD, "state.js")).href);
const F = await import(pathToFileURL(join(WORLD, "fixtures.js")).href);

const clone = (v) => JSON.parse(JSON.stringify(v));
const agentIn = (input, slug) => input.world.rooms.flatMap((r) => r.agents).find((a) => a.slug === slug);
const ws = (input) => worldState(input);

// The seed with every agent free and nothing queued: a quiet start where every change is the test's own.
function quiet() {
  const s = clone(F.seed);
  for (const r of s.world.rooms) for (const a of r.agents) Object.assign(a, { state: "free", waitingForYou: false, doing: null });
  s.inbox.items = [];
  return s;
}

test("the first reading never animates: prev null gives nothing", () => {
  assert.deepEqual(diffWorld(null, ws(F.seed)), []);
  assert.deepEqual(diffWorld(undefined, ws(F.seed)), []);
});

test("identical states give nothing", () => {
  assert.deepEqual(diffWorld(ws(F.seed), ws(F.seed)), []);
  assert.deepEqual(diffWorld(ws(F.big), ws(clone(F.big))), []);
});

test("one lamp off to on: one event that animates", () => {
  const a = quiet();
  const b = quiet();
  agentIn(b, "drafter").state = "working";
  assert.deepEqual(diffWorld(ws(a), ws(b)), [{ type: "lamp", slug: "drafter", room: "studio", from: "off", to: "on", animate: true }]);
});

test("six lamp changes: six events, four animate, red and amber first, then room order", () => {
  const a = quiet();
  const b = quiet();
  agentIn(b, "chief-of-staff").state = "working";       // operations, on
  agentIn(b, "sales").state = "working";                // sales, on
  agentIn(b, "marketer").state = "paused";              // marketing, down
  agentIn(b, "drafter").waitingForYou = true;           // studio, amber
  agentIn(b, "people").state = "problem";               // people, red
  agentIn(b, "bookkeeper").waitingForYou = true;        // books, amber
  const ev = diffWorld(ws(a), ws(b));
  assert.equal(ev.length, 6);
  assert.ok(ev.every((e) => e.type === "lamp"));
  assert.deepEqual(ev.map((e) => [e.slug, e.to]), [
    ["people", "red"], ["drafter", "amber"], ["bookkeeper", "amber"], ["chief-of-staff", "on"], ["sales", "on"], ["marketer", "down"],
  ]);
  assert.equal(ev.filter((e) => e.animate).length, 4);
  assert.deepEqual(ev.map((e) => e.animate), [true, true, true, true, false, false]);
});

const working = (a, taskId) => Object.assign(a, { state: "working", doing: { title: "A task", taskId, identifier: "STH-1" } });

test("A stops working task T while B starts it: exactly one hand-off", () => {
  const a = quiet();
  working(agentIn(a, "sales"), "task-t");
  const b = quiet();
  working(agentIn(b, "bookkeeper"), "task-t");
  const ev = diffWorld(ws(a), ws(b));
  const hand = ev.filter((e) => e.type === "handoff");
  assert.deepEqual(hand, [{ type: "handoff", from: "sales", to: "bookkeeper", animate: true }]);
  assert.ok(!JSON.stringify(ev).includes("task-t"), "events carry no task id");
});

test("two hand-offs at once: still one, the first in room order", () => {
  const a = quiet();
  working(agentIn(a, "support"), "task-u");
  working(agentIn(a, "chief-of-staff"), "task-t");
  const b = quiet();
  working(agentIn(b, "marketer"), "task-t");
  working(agentIn(b, "people"), "task-u");
  const hand = diffWorld(ws(a), ws(b)).filter((e) => e.type === "handoff");
  assert.deepEqual(hand, [{ type: "handoff", from: "chief-of-staff", to: "marketer", animate: true }]);
});

test("no hand-off when the task simply ends, or when the same agent keeps it", () => {
  const a = quiet();
  working(agentIn(a, "sales"), "task-t");
  assert.equal(diffWorld(ws(a), ws(quiet())).filter((e) => e.type === "handoff").length, 0);
  const b = clone(a);
  agentIn(b, "sales").doing.title = "Renamed";
  assert.deepEqual(diffWorld(ws(a), ws(b)), []);
});

test("a door on to off: one door event that animates", () => {
  const ev = diffWorld(ws(F.seed), ws(F.doorOff));
  assert.deepEqual(ev, [{ type: "door", id: "web", from: "open", to: "shut", animate: true }]);
  assert.deepEqual(diffWorld(ws(F.seed), ws(F.doorBlocked)), [{ type: "door", id: "generation", from: "open", to: "blocked", animate: true }]);
});

test("the queue grows from 3 to 5 items: one sheet event", () => {
  const b = clone(F.seed);
  b.inbox.items.push({ id: "n9", agent: { slug: "artist" } }, { id: "n10", agent: { slug: "builder" } });
  assert.deepEqual(diffWorld(ws(F.seed), ws(b)), [{ type: "sheet", delta: 2, animate: true }]);
  assert.deepEqual(diffWorld(ws(b), ws(F.seed)), [{ type: "sheet", delta: -2, animate: true }]);
});

test("an app switched on with an allowance: one app event", () => {
  const ev = diffWorld(ws(F.seed), ws(F.app));
  assert.deepEqual(ev.filter((e) => e.type === "app"), [{ type: "app", slug: "lake-house-site", on: true, allowance: true, animate: true }]);
});

test("with the tab hidden every event changes at once", () => {
  for (const [p, n] of [[F.seed, F.allOff], [F.allOff, F.seed], [F.seed, F.doorOff], [F.seed, F.app], [F.empty, F.seed]]) {
    const ev = diffWorld(ws(p), ws(n), { visible: false });
    assert.ok(ev.length > 0);
    assert.ok(ev.every((e) => e.animate === false));
  }
});

test("events carry only slugs, enums and numbers, even from the hostile fixture", () => {
  const ev = diffWorld(ws(F.empty), ws(F.hostile));
  assert.ok(ev.length > 0);
  for (const e of ev) {
    for (const [k, v] of Object.entries(e)) {
      if (typeof v === "string") assert.match(v, /^[a-z][a-z0-9-]{0,40}$/, `${e.type}.${k}`);
    }
  }
});

test("wrong input never throws", () => {
  const W = [null, undefined, 3, "x", [], {}, { rooms: "x", doors: 3, apps: {}, counts: null }];
  for (const p of W) for (const n of W) assert.ok(Array.isArray(diffWorld(p, n, p)));
});
