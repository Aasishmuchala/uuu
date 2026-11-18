// U19 fix 2: the approved card's Cost fact comes whole from the server (cost.about), priced by the same numbers as
// cost.words and cost.confirm, so the page composes no money sentence of its own. Made-up table rows, no files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defineRow, ROWS } from "../../../generate/registry.mjs";
import { aboutWords, costWords, priceShotlist } from "../lib/shotlist.mjs";

const HF_CLIP = defineRow({
  id: "hf.test_clip", provider: "higgsfield", remote: "test_clip", words: "Test Clip on Higgsfield", kinds: ["image_to_video"],
  tool: "generate_video", hfRoles: { first: "start_image" }, refs: { max: 1, roles: ["first"] }, ratios: ["16:9", "9:16", "1:1"],
  seconds: { min: 2, max: 10 }, promptMax: 1000, price: { per: "second", credits: 6 }, source: "a test",
});
const TABLE = [...ROWS, HF_CLIP];
const list = {
  title: "T", seconds: 10, ratio: "1280:720",
  shots: [{ id: "s01", kind: "image_to_video", seconds: 5, best: false }, { id: "s02", kind: "image_to_video", seconds: 5, best: false }],
};

test("aboutWords: 'about $X, up to $Y', the same dollars as the cost's own sentence", () => {
  const p = priceShotlist(list, { video: "gen4_turbo", videoBest: "gen4_turbo" }, { table: TABLE });
  assert.equal(p.ok, true);
  const about = aboutWords(p);
  assert.equal(about, `about $${(p.base / 100).toFixed(2)}, up to $${(p.most / 100).toFixed(2)}`);
  assert.ok(costWords(p).includes(about), "the same figures as the cost's sentence");
});

test("aboutWords: Higgsfield at the owner's rate; no price gives null; no room for a retake gives the base alone", () => {
  const hf = priceShotlist(list, { video: "hf.test_clip", videoBest: "hf.test_clip" }, { centsPerCredit: 5, table: TABLE });
  assert.equal(hf.ok, true);
  assert.equal(aboutWords(hf), `about $${(hf.base / 100).toFixed(2)}, up to $${(hf.most / 100).toFixed(2)}`);
  assert.equal(aboutWords({ ok: false, shots: [], base: 0, most: 0 }), null);
  assert.equal(aboutWords(null), null);
  assert.equal(aboutWords({ ok: true, shots: [{}], base: 150, most: 150 }), "about $1.50");
});
