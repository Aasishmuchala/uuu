// The kit's ring (CONTRACTS-V3 28). Split out of kit-c (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, isVNode } from "./_dom.mjs";
import { css, newSheetTest } from "./_rules.mjs";

const kit = { ring: await import(pathToFileURL(join(KIT, "ring.js")).href) };

test("Ring loads in Node: the count inside, the words for screen readers, the share drawn", () => {
  const { Ring, ringShare } = kit.ring;
  const v = Ring({ value: 4, total: 9 });
  assert.ok(isVNode(v));
  assert.equal(v.props.class, "k-ring");
  assert.equal(v.props.role, "img");
  assert.equal(v.props["aria-label"], "4 of 9");
  assert.match(v.props.style, /--k-ring-size: 40px;/);
  assert.equal(Ring({ value: 9, total: 9, label: "All nine", size: 56 }).props.class, "k-ring k-ring--full");
  assert.equal(ringShare(4, 8), 0.5);
  assert.equal(ringShare(12, 9), 1);
  assert.equal(ringShare(-1, 9), 0);
  assert.equal(ringShare(3, 0), 0);
  assert.equal(ringShare("x", 9), 0);
});

test("ring: the share is drawn in the ink on the meter's track", () => {
  const r = css("kit/ring.css");
  assert.match(r, /\.k-ring__track \{\s*stroke: var\(--raise-2\);/);
  assert.match(r, /\.k-ring__value,\s*\.k-ring--full \.k-ring__value \{\s*stroke: var\(--ink\);/);
});

newSheetTest("ring");
