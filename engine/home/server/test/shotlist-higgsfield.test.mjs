// A film's cost and the owner's batches with a Higgsfield model (PLAN-V5 K20, T79): every price the home server shows
// or approves is in US cents at the owner's rate (`centsPerCredit`), as the generation door prices it, and a batch
// naming a Higgsfield model is one the door's own readBatch takes, its budget the door's own estimateCents. No
// Higgsfield clip model has a price in the door's table yet, so the clip rows here are a made-up table (a test's
// `table`); the still is the table's own FLUX.2. Temp folders and made-up values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineRow, estimateCents, ROWS } from "../../../generate/registry.mjs";
import { readBatch } from "../../../generate/state.mjs";
import { generationNow, writeBatch } from "../lib/batches.mjs";
import { updateDoors } from "../lib/doors.mjs";
import { costWords, priceShotlist } from "../lib/shotlist.mjs";

const TASK = "e0000000-0000-4000-8000-000000000079";
// K20's vector: a Higgsfield row of 6 credits a second.
const HF_CLIP = defineRow({
  id: "hf.test_clip", provider: "higgsfield", remote: "test_clip", words: "Test Clip on Higgsfield", kinds: ["image_to_video"],
  tool: "generate_video", hfRoles: { first: "start_image" }, refs: { max: 1, roles: ["first"] }, ratios: ["16:9", "9:16", "1:1"],
  seconds: { min: 2, max: 10 }, promptMax: 1000, price: { per: "second", credits: 6 }, source: "a test",
});
const HF_BEST = defineRow({
  id: "hf.test_best", provider: "higgsfield", remote: "test_best", words: "Test Best on Higgsfield", kinds: ["image_to_video", "text_to_video"],
  tool: "generate_video", hfRoles: { first: "start_image" }, refs: { max: 1, roles: ["first"] }, ratios: ["16:9"], resolutions: ["720p", "1080p"],
  seconds: { min: 2, max: 10 }, promptMax: 1000, price: { per: "second", byResolution: { "720p": 4, "1080p": 9 } }, source: "a test",
});
const TABLE = [...ROWS, HF_CLIP, HF_BEST];
const HF_MODELS = { video: "hf.test_clip", videoBest: "hf.test_best" };

const shot = (n, f = {}) => ({ id: `s0${n}`, kind: "image_to_video", render: `r${n}.png`, seconds: 5, move: "Slow push in.", prompt: "The stair at dawn.", best: false, ...f });
const film = (shots, ratio = "1280:720") => ({ title: "A film", seconds: 30, ratio, shots });

function withState(fn) {
  const root = mkdtempSync(join(tmpdir(), "uuu-shotlist-hf-"));
  try {
    const state = join(root, "state");
    mkdirSync(state, { recursive: true });
    const s = (...p) => join(state, ...p);
    const config = {
      paths: {
        state, doors: s("doors"), batches: s("doors", "batches"), doorsState: s("doors", "state.json"), ledger: s("doors", "generate-ledger.jsonl"),
        secrets: s("secrets"), doorSecrets: s("secrets", "doors"), runwayKey: s("secrets", "doors", "runway-key"), searchKey: s("secrets", "doors", "search-key"),
      },
    };
    return fn({ config });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a shotlist on a Higgsfield model: 6 credits a second, 5 s, is 150 cents at rate 5 and 210 at rate 7 (K20's vectors)", () => {
  const list = film([shot(1)]);
  const at5 = priceShotlist(list, HF_MODELS, { centsPerCredit: 5, table: TABLE });
  assert.equal(at5.ok, true, at5.problem);
  assert.deepEqual(at5.shots, [{ id: "s01", kind: "image_to_video", model: "hf.test_clip", seconds: 5, credits: 150 }]);
  assert.deepEqual([at5.base, at5.most, at5.centsPerCredit], [150, 300, 5]);
  const at7 = priceShotlist(list, HF_MODELS, { centsPerCredit: 7, table: TABLE });
  assert.deepEqual([at7.shots[0].credits, at7.base, at7.most], [210, 210, 420]);
  assert.equal(at7.shots[0].credits, estimateCents({ kind: "image_to_video", model: "hf.test_clip", seconds: 5 }, { centsPerCredit: 7, table: TABLE }));
  assert.equal(costWords(at7, { daily: 3000 }), "1 clip, 5 seconds: about $2.10, up to $4.20 with one retake. Today's limit: $30.00.");
});

test("a best shot on a Higgsfield row priced by size takes its largest size, as the door does; a mixed film adds Runway's cents", () => {
  const list = film([shot(1, { best: true }), shot(2, { seconds: 4 })]);
  const p = priceShotlist(list, HF_MODELS, { centsPerCredit: 5, table: TABLE });
  assert.equal(p.ok, true, p.problem);
  assert.deepEqual(p.shots.map((s) => [s.model, s.credits]), [["hf.test_best", 9 * 5 * 5], ["hf.test_clip", 6 * 4 * 5]]);
  const mixed = priceShotlist(list, { video: "gen4_turbo", videoBest: "hf.test_best" }, { centsPerCredit: 3, table: TABLE });
  assert.deepEqual(mixed.shots.map((s) => s.credits), [9 * 5 * 3, 5 * 4], "a Runway credit is a cent whatever the rate");
});

test("a Higgsfield model must make the film's ratio by its lowest terms; a rate out of bounds or a row with no price prices nothing", () => {
  assert.equal(priceShotlist(film([shot(1)], "720:1280"), HF_MODELS, { table: TABLE }).ok, true, "720:1280 is 9:16");
  const odd = priceShotlist(film([shot(1)], "1104:832"), HF_MODELS, { table: TABLE });
  assert.equal(odd.ok, false);
  assert.match(odd.problem, /cannot make the ratio 1104:832/);
  assert.match(priceShotlist(film([shot(1)]), HF_MODELS, { centsPerCredit: 51, table: TABLE }).problem, /no price for hf\.test_clip/);
  assert.match(priceShotlist(film([shot(1)]), { video: "hf.wan2_6", videoBest: "gen4.5" }).problem, /no price for hf\.wan2_6/);
  assert.equal(priceShotlist(film([shot(1)]), { video: "gen4_turbo", videoBest: "gen4.5" }).shots[0].credits, 25, "Runway unchanged");
});

test("a batch with a Higgsfield still: its budget at the state's rate, the door's readBatch takes it, estimateCents agrees", () => {
  withState(({ config }) => {
    updateDoors(config, (s) => { s.generate.higgsfield = { on: true, centsPerCredit: 7 }; });
    assert.equal(generationNow(config).centsPerCredit, 7);
    const now = Date.now();
    const shots = [{ id: "v1", kind: "still_variation", model: "hf.flux_2" }, { id: "v2", kind: "still_variation", model: "hf.flux_2" }];
    const w = writeBatch(config, { task: TASK, slug: "artist", shots, takes: 1, now });
    const one = estimateCents({ kind: "still_variation", model: "hf.flux_2", resolution: "2k" }, { centsPerCredit: 7 });
    assert.equal(one, 28);
    assert.equal(w.budget, 2 * one);
    const back = readBatch(config.paths.batches, w.id, { slug: "artist", now });
    assert.equal(back.ok, true, back.why);
    assert.equal(back.batch.budgetCredits, 56);
    assert.deepEqual(back.batch.shots.v1, { kind: "still_variation", model: "hf.flux_2", maxSeconds: null, takes: 1 });
    // The rate the owner's price was worked out at wins over the file's now; a rate out of bounds approves nothing.
    assert.equal(writeBatch(config, { task: TASK, slug: "artist", shots, takes: 2, now, centsPerCredit: 5 }).budget, 2 * 2 * 20);
    assert.throws(() => writeBatch(config, { task: TASK, slug: "artist", shots, takes: 1, now, centsPerCredit: 0 }));
  });
});

test("a batch never prices a Runway row the door does not price for the Artist, nor a Higgsfield row with no price", () => {
  withState(({ config }) => {
    for (const model of ["veo3.1", "hf.wan2_6"]) {
      assert.throws(() => writeBatch(config, { task: TASK, slug: "artist", shots: [{ id: "s01", kind: "image_to_video", model, seconds: 5 }], takes: 2 }),
        (e) => e.code === "no_price", model);
    }
  });
});
