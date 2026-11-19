// The kit's timeline (CONTRACTS-V2 13.2): the layout's vectors. Split out of kit-b (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { KIT, textOf, withClass, showNow } from "./_dom.mjs";
import { UNTRUSTED, shape } from "./_fixtures.mjs";
import { css, compositeSheetTests } from "./_rules.mjs";

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

// PLAN-COOK T37: a hairline spine with a 7 px dot a step, 13 px entries, the state and the time at the right; no
// frame, no glass, no bar drawn from a style attribute.
test("Timeline: a hairline spine, a 7 px dot in each step's tone, 13 px entries, the duration at the right", async () => {
  const { Timeline } = await load("timeline");
  const c = css("kit/timeline.css");
  assert.match(c, /\.k-timeline__row::before,\s*\.k-timeline__row::after\s*\{[^}]*width: 1px;[^}]*background: var\(--line-2\);/);
  assert.match(c, /\.k-timeline__dot\s*\{[^}]*width: 7px;[^}]*height: 7px;/);
  assert.match(c, /\.k-timeline__row\s*\{[^}]*font-size: var\(--fs-note\);/);
  assert.match(c, /\.k-timeline__when\s*\{[^}]*align-items: flex-end;[^}]*font-variant-numeric: tabular-nums;/);
  assert.doesNotMatch(c, /--glass|--highlight|--r-pill|var\(--dept/);
  const t0 = Date.parse("2026-11-11T08:00:00.000Z");
  const root = showNow(Timeline, { items: [
    { id: "a", title: UNTRUSTED, who: { slug: "artist", name: "Artist" }, identifier: "STH-9", state: "done", plainState: "Done", startedAt: new Date(t0).toISOString(), endedAt: new Date(t0 + 60000).toISOString(), durationMs: 60000 },
    { id: "b", title: "Check it", kind: "check", who: { slug: "checker", name: "Checker" }, state: "working", startedAt: new Date(t0 + 60000).toISOString(), endedAt: null, durationMs: 9 * 60000 },
  ], now: new Date(t0 + 600000) });
  assert.equal(withClass(root, "k-timeline__dot").length, 2);
  assert.equal(withClass(root, "k-timeline__dot--running").length, 1, "the running step is a ring");
  assert.ok(withClass(root, "k-timeline__row--ok").length === 1 && withClass(root, "k-timeline__row--live").length === 1);
  assert.ok(textOf(root).includes(UNTRUSTED), "a step's title is text");
  assert.match(textOf(root), /9 minutes so far/);
  assert.match(textOf(root), /Working/, "a step with no plain state says its tone in words");
  assert.equal(withClass(root, "k-timeline__bar").length, 0);
});

// S-page-2b621398 (stress pass 2): a step's title is cut with an ellipsis at 1280 px ("Check the pr..."); the whole
// title is its tooltip, so it can always be read.
test("Timeline: a step's title, cut to one line, carries the whole title as its tooltip", async () => {
  const { Timeline } = await load("timeline");
  assert.match(css("kit/timeline.css"), /\.k-timeline__title > span\s*\{[^}]*text-overflow: ellipsis;/);
  const long = "Check the price list against last year's quotations and the supplier's new sheet";
  const root = showNow(Timeline, { items: [{ id: "a", title: long, state: "waiting", startedAt: new Date().toISOString(), endedAt: null, durationMs: 1000 }] });
  const inner = withClass(root, "k-timeline__title")[0].childNodes.filter((n) => n.nodeType === 1 && n.localName === "span");
  assert.equal(inner.length, 1);
  assert.equal(inner[0].getAttribute("title"), long);
});

compositeSheetTests("timeline");
