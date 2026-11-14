// The kit's timeline (CONTRACTS-V2 13.2): the layout's vectors. Split out of kit-b (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { KIT } from "./_dom.mjs";
import { shape } from "./_fixtures.mjs";
import { compositeSheetTests } from "./_rules.mjs";

const load = (name) => import(join(KIT, `${name}.js`));

test("layout: back-to-back items share the axis; an open item runs to now; widths are at least 1", async () => {
  const { layout } = await load("timeline");
  const t0 = Date.parse("2026-11-11T08:00:00.000Z");
  const iso = (s) => new Date(t0 + s * 1000).toISOString();
  const two = [
    { id: "a", startedAt: iso(0), endedAt: iso(60) },
    { id: "b", startedAt: iso(60), endedAt: iso(120) },
  ];
  assert.deepEqual(layout(two, new Date(t0 + 120000)), [
    { id: "a", leftPct: 0, widthPct: 50 },
    { id: "b", leftPct: 50, widthPct: 50 },
  ]);
  const open = layout([{ id: "a", startedAt: iso(0), endedAt: iso(60) }, { id: "b", startedAt: iso(60), endedAt: null }], new Date(t0 + 120000));
  assert.deepEqual(open[1], { id: "b", leftPct: 50, widthPct: 50 });
  const tiny = layout([{ id: "a", startedAt: iso(0), endedAt: iso(1000) }, { id: "b", startedAt: iso(500), endedAt: iso(500) }], new Date(t0 + 1000000));
  assert.ok(tiny.every((p) => p.widthPct >= 1 && p.leftPct >= 0 && p.leftPct + p.widthPct <= 100));
  assert.equal(tiny[1].widthPct, 1);
  const task = shape("task");
  const one = layout(task.timeline, new Date(task.generatedAt));
  assert.equal(one.length, 1);
  assert.equal(one[0].widthPct, 100);
  assert.deepEqual(layout([], new Date()), []);
});

compositeSheetTests("timeline");
