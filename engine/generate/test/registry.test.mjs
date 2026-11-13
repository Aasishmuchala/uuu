// The table of models for two services (PLAN-V5 K20), what an app may send (K19) and Runway's
// bodies with the door's pins. Pure: no file, no socket.
import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_JOB_BYTES, DEFAULT_CENTS_PER_CREDIT, HF_UPLOAD_SUFFIXES, NEEDS, NO_PRICE, ROWS, appModels, defineRow, estimateCents, estimateUnits,
  parseAppJob, rowOf, runwayRequest, upscaleFits,
} from "../registry.mjs";
import { PRICES, buildRequest } from "../runway.mjs";

const job = (o) => Buffer.from(JSON.stringify(o));
const I1 = "i0123456789abcdef0123";
const I2 = "i1123456789abcdef0123";
const I3 = "i2123456789abcdef0123";
const pic = (role, byte = 0x61) => ({ type: "image/png", bytes: Buffer.from([byte, byte, byte]), role });

// Every model id the app's routing table (apps/render-to-film/src/local/routing.ts, T72) sends,
// copied here: each must be a row, or be one the door deliberately cannot price.
const ROUTED = [
  "gemini_image3_pro", "gemini_image3.1_flash", "nano_banana_2.1", "gpt_image_2", "gpt_image_2_5_sunburst", "gpt_image_2_5_flare",
  "seedream5_pro", "seedream5_lite", "grok_imagine_image_2", "gen4_image", "hf.flux_2", "gen4.5", "gen4_turbo", "veo3.1", "veo3.1_fast",
  "seedance2", "seedance2_fast", "seedance2_5", "kling3.0_pro", "kling3.0_4k", "klingO3_pro", "hailuo3", "hf.wan2_6",
  "magnific_precision_upscaler_v2", "hf.upscale_image",
];
const UNPRICED_ON_PURPOSE = ["gpt_image_2_5_sunburst", "gpt_image_2_5_flare"];

test("step 3's five Runway rows are PRICES, ids, kinds and prices unchanged", () => {
  for (const [id, p] of Object.entries(PRICES)) {
    const r = rowOf(id);
    assert.ok(r, id);
    assert.equal(r.provider, "runway");
    assert.equal(r.remote, id);
    assert.deepEqual([...r.kinds], [...p.kinds]);
    assert.equal(r.price.credits, p.perSecond !== undefined ? p.perSecond : p.perPicture, id);
    assert.equal(r.price.per, p.perSecond !== undefined ? "second" : "picture");
  }
});

test("every model the app routes is a row, but the two GPT Image 2.5 variants the door cannot price", () => {
  for (const id of ROUTED) {
    if (UNPRICED_ON_PURPOSE.includes(id)) assert.equal(rowOf(id), null, id);
    else assert.ok(rowOf(id), id);
  }
  const ids = ROWS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ROWS.every((r) => r.provider === (r.id.startsWith("hf.") ? "higgsfield" : "runway")));
});

test("rows are frozen to the bottom; rowOf knows only the table's ids", () => {
  const r = rowOf("veo3.1");
  assert.throws(() => { r.price.credits = 1; }, TypeError);
  assert.throws(() => { r.ratios.push("1:1"); }, TypeError);
  assert.throws(() => { r.fixed.audio = true; }, TypeError);
  assert.throws(() => { ROWS.push(r); }, TypeError);
  for (const bad of ["toString", "__proto__", "constructor", "hf.", "GEN4_TURBO", " gen4_turbo", undefined, null, 5, {}]) assert.equal(rowOf(bad), null, String(bad));
});

test("the door's pins: Veo, Kling and Seedance silent, GPT Image high, Grok an edit, FLUX.2 max, Higgsfield sizes in small letters", () => {
  for (const id of ["veo3.1", "veo3.1_fast", "kling3.0_pro", "kling3.0_4k", "klingO3_pro", "seedance2", "seedance2_fast", "seedance2_5"]) assert.equal(rowOf(id).fixed.audio, false, id);
  assert.deepEqual({ ...rowOf("gpt_image_2").fixed }, { quality: "high" });
  assert.deepEqual({ ...rowOf("grok_imagine_image_2").fixed }, { quality: "medium", edit: true });
  assert.deepEqual({ ...rowOf("hf.flux_2").fixed }, { variant: "max" });
  for (const r of ROWS.filter((x) => x.provider === "higgsfield" && x.resolutions)) for (const w of r.resolutions) assert.equal(w, w.toLowerCase(), r.id);
  assert.equal(rowOf("hf.wan2_6").resolutionParam, "quality");
  assert.equal(rowOf("gen4_image").tags, true);
  assert.equal(rowOf("seedream5_pro").tags, false);
});

test("a row that is not right stops the table at once", () => {
  const good = { id: "hf.x", provider: "higgsfield", remote: "x", words: "X on Higgsfield", kinds: ["still_variation"], tool: "generate_image",
    hfRoles: { ref: "image_references" }, refs: { max: 1, roles: ["ref"] }, promptMax: 10, price: { per: "picture", credits: 1 }, source: "test" };
  assert.equal(defineRow(good).id, "hf.x");
  for (const [field, value] of [["id", "x"], ["provider", "other"], ["kinds", ["paint"]], ["price", { per: "second", credits: 1 }], ["price", { per: "picture", credits: -1 }],
    ["price", { per: "picture", credits: Infinity }], ["refs", { max: 1, roles: ["side"] }], ["tool", "show_widget"], ["hfRoles", { ref: "anything" }], ["seconds", { min: 1, max: 5 }]]) {
    assert.throws(() => defineRow({ ...good, [field]: value }), /registry/, field);
  }
  assert.throws(() => defineRow({ ...good, provider: "runway" }), /hf\. id/);
  assert.throws(() => defineRow({ ...good, id: "x2" }), /hf\. id/);
});

test("K20's vectors: gen4_turbo 5 s is 25 cents; 6 Higgsfield credits a second for 5 s is 150 at 5 cents, 210 at 7; gen4_image is 8", () => {
  assert.equal(estimateCents({ kind: "image_to_video", model: "gen4_turbo", seconds: 5 }), 25);
  const six = defineRow({ id: "hf.six", provider: "higgsfield", remote: "six", words: "Six on Higgsfield", kinds: ["image_to_video"], tool: "generate_video",
    hfRoles: { first: "start_image" }, refs: { max: 1, roles: ["first"] }, seconds: { min: 1, max: 15 }, promptMax: 100, price: { per: "second", credits: 6 }, source: "test" });
  assert.equal(estimateCents({ kind: "image_to_video", model: "hf.six", seconds: 5 }, { centsPerCredit: 5, table: [six] }), 150);
  assert.equal(estimateCents({ kind: "image_to_video", model: "hf.six", seconds: 5 }, { centsPerCredit: 7, table: [six] }), 210);
  assert.equal(estimateCents({ kind: "still_variation", model: "gen4_image" }), 8);
  assert.equal(estimateCents({ kind: "still_variation", model: "gen4_image", resolution: "720p" }), 8);
  assert.equal(DEFAULT_CENTS_PER_CREDIT, 5);
});

test("estimateCents is null when the row, kind, seconds, resolution, scale or rate is not the row's", () => {
  const nulls = [
    [{ kind: "image_to_video", model: "veo9", seconds: 4 }],
    [{ kind: "text_to_video", model: "gen4_turbo", seconds: 5 }],
    [{ kind: "image_to_video", model: "gen4_turbo", seconds: 11 }],
    [{ kind: "image_to_video", model: "gen4_turbo", seconds: 4.5 }],
    [{ kind: "image_to_video", model: "gen4_turbo" }],
    [{ kind: "image_to_video", model: "veo3.1", seconds: 5 }],
    [{ kind: "image_to_video", model: "seedance2", seconds: 5 }],
    [{ kind: "image_to_video", model: "seedance2", seconds: 5, resolution: "8K" }],
    [{ kind: "image_to_video", model: "gen4_turbo", seconds: 5, resolution: "720p" }],
    [{ kind: "still_variation", model: "gen4_image", seconds: 5 }],
    [{ kind: "still_upscale", model: "magnific_precision_upscaler_v2", scale: 8 }],
    [{ kind: "still_variation", model: "hf.flux_2", resolution: "2k" }, { centsPerCredit: 0 }],
    [{ kind: "still_variation", model: "hf.flux_2", resolution: "2k" }, { centsPerCredit: 51 }],
    [{ kind: "still_variation", model: "hf.flux_2", resolution: "2k" }, { centsPerCredit: 1.5 }],
    [{ kind: "still_variation", model: "hf.flux_2", resolution: "2k" }, { centsPerCredit: "5" }],
    [{ kind: "image_to_video", model: "hf.wan2_6", seconds: 5, resolution: "720p" }],
    [{ kind: "still_upscale", model: "hf.upscale_image", resolution: "4k" }],
    [{ kind: "still_variation", model: "grok_imagine_image_2", resolution: "1K", refs: 4 }],
    [undefined],
  ];
  for (const [item, opts] of nulls) assert.equal(estimateCents(item, opts), null, JSON.stringify(item) + JSON.stringify(opts || {}));
});

test("prices by size, by the second, a minimum per job and a price per picture sent", () => {
  const c = (o) => estimateCents(o);
  assert.equal(c({ kind: "image_to_video", model: "seedance2", seconds: 5, resolution: "1080p" }), 200);
  assert.equal(c({ kind: "image_to_video", model: "seedance2", seconds: 4, resolution: "480p" }), 56);
  assert.equal(c({ kind: "image_to_video", model: "seedance2_5", seconds: 4, resolution: "480p" }), 80);    // 4 x 20 = 80, the minimum
  assert.equal(c({ kind: "image_to_video", model: "seedance2_5", seconds: 10, resolution: "1080p" }), 680);
  assert.equal(c({ kind: "image_to_video", model: "veo3.1", seconds: 8 }), 160);
  assert.equal(c({ kind: "image_to_video", model: "veo3.1_fast", seconds: 4 }), 40);
  assert.equal(c({ kind: "image_to_video", model: "kling3.0_4k", seconds: 5 }), 215);
  assert.equal(c({ kind: "still_variation", model: "gemini_image3_pro", resolution: "4K" }), 40);
  assert.equal(c({ kind: "still_variation", model: "gemini_image3.1_flash", resolution: "512px" }), 5);
  assert.equal(c({ kind: "still_variation", model: "gpt_image_2", resolution: "4K" }), 41);
  assert.equal(c({ kind: "image_to_video", model: "hailuo3", seconds: 5, resolution: "2k", refs: 1 }), 77);
  assert.equal(c({ kind: "image_to_video", model: "hailuo3", seconds: 5, resolution: "2k" }), 93);       // refs left out: its most, 9
  assert.equal(c({ kind: "still_variation", model: "grok_imagine_image_2", resolution: "2K", refs: 2 }), 10);
  assert.equal(c({ kind: "still_upscale", model: "magnific_precision_upscaler_v2", scale: 4 }), 25);
  assert.equal(estimateUnits({ kind: "still_variation", model: "hf.flux_2", resolution: "1k" }), 4);
  assert.equal(estimateCents({ kind: "still_variation", model: "hf.flux_2", resolution: "1k" }, { centsPerCredit: 7 }), 28);
  assert.equal(estimateCents({ kind: "still_variation", model: "hf.flux_2", resolution: "1k" }), 20);
});

test("the upscale's 4096 px step: a result past it does not fit", () => {
  const r = rowOf("magnific_precision_upscaler_v2");
  assert.equal(upscaleFits(r, 2048, 1152, 2), true);
  assert.equal(upscaleFits(r, 2049, 1152, 2), false);
  assert.equal(upscaleFits(r, 1024, 1024, 4), true);
  assert.equal(upscaleFits(r, 1025, 800, 4), false);
  assert.equal(upscaleFits(r, "2048", 1152, 2), false);
  assert.equal(upscaleFits(rowOf("hf.upscale_image"), 9000, 9000, 4), true);
});

test("uploads to Higgsfield go nowhere until the real upload host is recorded", () => {
  assert.deepEqual([...HF_UPLOAD_SUFFIXES], []);
  assert.ok(Object.isFrozen(HF_UPLOAD_SUFFIXES));
});

test("appModels: each row's price in cents at the owner's rate, and why it cannot be used", () => {
  const list = appModels({ ok: true, higgsfield: { on: true, centsPerCredit: 7 } }, { runway: true, higgsfield: false });
  assert.equal(list.length, ROWS.length);
  const by = Object.fromEntries(list.map((m) => [m.id, m]));
  assert.deepEqual(by.gen4_turbo.price, { per: "second", cents: 5, byResolution: null, minimumCents: null, perRefCents: null });
  assert.equal(by.gen4_turbo.ready, true);
  assert.equal(by.gen4_turbo.why, null);
  assert.deepEqual(by.seedance2.price.byResolution, { "480p": 14, "720p": 30, "1080p": 40, "4K": 150 });
  assert.equal(by.seedance2.price.minimumCents, 56);
  assert.equal(by["hf.flux_2"].price.cents, 28);
  assert.equal(by["hf.flux_2"].ready, false);
  assert.equal(by["hf.flux_2"].why, NEEDS.higgsfield);
  const on = Object.fromEntries(appModels({ ok: true }, { runway: false, higgsfield: true }).map((m) => [m.id, m]));
  assert.equal(on["hf.flux_2"].price.cents, 20);                 // no rate saved yet: 5 cents a credit
  assert.equal(on["hf.flux_2"].ready, true);
  assert.equal(on.gen4_turbo.why, NEEDS.runway);
  assert.equal(on["hf.wan2_6"].price, null);
  assert.equal(on["hf.wan2_6"].ready, false);
  assert.equal(on["hf.wan2_6"].why, NO_PRICE);
  const wrongRate = Object.fromEntries(appModels({ ok: true, higgsfield: { centsPerCredit: 80 } }, { runway: true, higgsfield: true }).map((m) => [m.id, m]));
  assert.equal(wrongRate["hf.flux_2"].price, null);
  assert.equal(wrongRate.gen4_turbo.price.cents, 5);
  assert.deepEqual(Object.keys(on.gen4_turbo).sort(), ["id", "kinds", "price", "promptMax", "provider", "ratios", "ready", "refs", "resolutions", "seconds", "why", "words"]);
  on.gen4_turbo.ratios.push("x");
  assert.ok(!rowOf("gen4_turbo").ratios.includes("x"));
});

test("parseAppJob takes K19's body for each kind of row", () => {
  const ok = (o) => {
    const r = parseAppJob(job(o));
    assert.equal(r.ok, true, `${JSON.stringify(o)}: ${r.why}`);
    return r.job;
  };
  assert.deepEqual(ok({ model: "gen4_turbo", kind: "image_to_video", inputs: [{ input: I1, role: "first" }], prompt: "a slow push\nmorning", seconds: 5, ratio: "1280:720" }), {
    model: "gen4_turbo", kind: "image_to_video", inputs: [{ input: I1, role: "first" }], prompt: "a slow push\nmorning", seconds: 5, ratio: "1280:720", resolution: null, scale: null,
  });
  ok({ model: "veo3.1", kind: "image_to_video", inputs: [{ input: I1, role: "first" }, { input: I1, role: "last" }], prompt: "", seconds: 8, ratio: "1920:1080" });
  ok({ model: "seedance2", kind: "image_to_video", inputs: [{ input: I1, role: "ref" }, { input: I2, role: "ref" }], prompt: "p", seconds: 6, ratio: "1920:1080", resolution: "1080p" });
  ok({ model: "gen4_image", kind: "still_variation", inputs: [{ input: I1, role: "ref" }, { input: I2, role: "ref" }, { input: I3, role: "ref" }], prompt: "p", ratio: "1920:1080", resolution: "1080p" });
  ok({ model: "magnific_precision_upscaler_v2", kind: "still_upscale", inputs: [{ input: I1, role: "image" }], prompt: "", scale: 4 });
  ok({ model: "hf.flux_2", kind: "still_variation", inputs: [{ input: I1, role: "ref" }], prompt: "p", ratio: "16:9", resolution: "2k" });
  ok({ model: "hf.upscale_image", kind: "still_upscale", inputs: [{ input: I1, role: "image" }], prompt: "", resolution: "4k" });
  ok({ model: "gen4.5", kind: "text_to_video", inputs: [], prompt: "p", seconds: 5, ratio: "1280:720" });
  ok({ model: "hailuo3", kind: "image_to_video", inputs: [{ input: I1, role: "first" }], prompt: "p", seconds: 5, ratio: "adaptive", resolution: "2k" });
});

test("parseAppJob refuses each A3 case once, with a sentence", () => {
  const base = { model: "gen4_turbo", kind: "image_to_video", inputs: [{ input: I1, role: "first" }], prompt: "p", seconds: 5, ratio: "1280:720" };
  const seed = { model: "seedance2", kind: "image_to_video", inputs: [{ input: I1, role: "first" }], prompt: "p", seconds: 5, ratio: "1920:1080", resolution: "1080p" };
  const cases = [
    ["a key not listed", { ...base, cost: 1 }],
    ["a key named __proto__", JSON.parse(`{"model":"gen4_turbo","kind":"image_to_video","inputs":[{"input":"${I1}","role":"first"}],"prompt":"p","seconds":5,"ratio":"1280:720","__proto__":{"x":1}}`)],
    ["no prompt", { ...base, prompt: undefined }],
    ["a model not in the table", { ...base, model: "gen9" }],
    ["a dropped model", { ...base, model: "gpt_image_2_5_flare" }],
    ["a kind not the model's", { ...base, kind: "still_variation" }],
    ["a role not the model's", { ...base, inputs: [{ input: I1, role: "ref" }] }],
    ["a ratio not the model's", { ...base, ratio: "1920:1080" }],
    ["a ratio not of this size", { ...seed, ratio: "1280:720" }],
    ["a resolution not the model's", { ...seed, resolution: "8K" }],
    ["a resolution on a model without", { ...base, resolution: "720p" }],
    ["seconds not the model's", { ...base, seconds: 11 }],
    ["seconds not whole", { ...base, seconds: 4.5 }],
    ["seconds on a picture", { model: "gen4_image", kind: "still_variation", inputs: [{ input: I1, role: "ref" }], prompt: "p", ratio: "1920:1080", resolution: "1080p", seconds: 5 }],
    ["Veo's seconds are 4, 6 or 8", { ...base, model: "veo3.1", seconds: 5, ratio: "1920:1080" }],
    ["more pictures than refs.max", { ...base, inputs: [{ input: I1, role: "first" }, { input: I2, role: "first" }] }],
    ["more references than refs.max", { model: "gen4_image", kind: "still_variation", inputs: [I1, I2, I3, "i4"].map((i) => ({ input: i, role: "ref" })), prompt: "p", ratio: "1920:1080", resolution: "1080p" }],
    ["a prompt over promptMax", { ...base, prompt: "x".repeat(1001) }],
    ["a prompt with a control character", { ...base, prompt: "a\u0007b" }],
    ["a prompt with a tab", { ...base, prompt: "a\tb" }],
    ["an empty prompt where one is needed", { model: "gen4.5", kind: "image_to_video", inputs: [{ input: I1, role: "first" }], prompt: "  ", seconds: 5, ratio: "1280:720" }],
    ["a prompt for an upscaler", { model: "magnific_precision_upscaler_v2", kind: "still_upscale", inputs: [{ input: I1, role: "image" }], prompt: "x", scale: 2 }],
    ["an input id with a slash", { ...base, inputs: [{ input: "i../x", role: "first" }] }],
    ["an input with another key", { ...base, inputs: [{ input: I1, role: "first", url: "/files/x" }] }],
    ["one picture twice in one role", { ...seed, inputs: [{ input: I1, role: "ref" }, { input: I1, role: "ref" }] }],
    ["two first frames", { ...seed, inputs: [{ input: I1, role: "first" }, { input: I2, role: "first" }] }],
    ["a last frame alone", { ...seed, inputs: [{ input: I1, role: "last" }] }],
    ["frames and references together on Hailuo", { model: "hailuo3", kind: "image_to_video", inputs: [{ input: I1, role: "first" }, { input: I2, role: "ref" }], prompt: "p", seconds: 5, ratio: "16:9", resolution: "2k" }],
    ["a clip with no picture", { ...base, inputs: [] }],
    ["a scale not 2 or 4", { model: "magnific_precision_upscaler_v2", kind: "still_upscale", inputs: [{ input: I1, role: "image" }], prompt: "", scale: 8 }],
    ["an upscale with no scale", { model: "magnific_precision_upscaler_v2", kind: "still_upscale", inputs: [{ input: I1, role: "image" }], prompt: "" }],
    ["seconds as null", { ...base, seconds: null }],
  ];
  for (const [name, body] of cases) {
    const r = parseAppJob(job(body));
    assert.equal(r.ok, false, name);
    assert.ok(typeof r.why === "string" && r.why.length > 10 && r.why.endsWith("."), name);
  }
  for (const raw of [Buffer.from("not json"), Buffer.from("[1]"), Buffer.from("null"), Buffer.alloc(APP_JOB_BYTES + 1, 0x20), "a string"]) {
    assert.equal(parseAppJob(raw).ok, false);
  }
});

test("runwayRequest: step 3's rows send exactly today's body; the new rows carry the door's pins", () => {
  const p1 = pic("first");
  const turbo = parseAppJob(job({ model: "gen4_turbo", kind: "image_to_video", inputs: [{ input: I1, role: "first" }], prompt: "slow push", seconds: 5, ratio: "1280:720" })).job;
  assert.deepEqual(runwayRequest(rowOf("gen4_turbo"), turbo, [p1]),
    buildRequest({ kind: "image_to_video", model: "gen4_turbo", promptText: "slow push", seconds: 5, ratio: "1280:720", pictures: [p1] }));
  const still = parseAppJob(job({ model: "gen4_image", kind: "still_variation", inputs: [{ input: I1, role: "ref" }, { input: I2, role: "ref" }], prompt: "p", ratio: "1920:1080", resolution: "1080p" })).job;
  assert.deepEqual(runwayRequest(rowOf("gen4_image"), still, [pic("ref"), pic("ref")]),
    buildRequest({ kind: "still_variation", model: "gen4_image", promptText: "p", ratio: "1920:1080", pictures: [pic("ref"), pic("ref")] }));

  const veo = parseAppJob(job({ model: "veo3.1", kind: "image_to_video", inputs: [{ input: I1, role: "first" }, { input: I2, role: "last" }], prompt: "", seconds: 8, ratio: "1920:1080" })).job;
  const v = runwayRequest(rowOf("veo3.1"), veo, [pic("first", 0x61), pic("last", 0x62)]);
  assert.equal(v.path, "/v1/image_to_video");
  assert.deepEqual(v.body, { model: "veo3.1", promptImage: [{ uri: "data:image/png;base64,YWFh", position: "first" }, { uri: "data:image/png;base64,YmJi", position: "last" }],
    ratio: "1920:1080", duration: 8, audio: false });

  const sd = parseAppJob(job({ model: "seedance2", kind: "image_to_video", inputs: [{ input: I1, role: "ref" }, { input: I2, role: "ref" }], prompt: "p", seconds: 6, ratio: "1920:1080", resolution: "1080p" })).job;
  const s = runwayRequest(rowOf("seedance2"), sd, [pic("ref"), pic("ref")]);
  assert.deepEqual(s.body.promptImage.map((x) => Object.keys(x)), [["uri"], ["uri"]]);
  assert.equal(s.body.resolution, undefined);
  assert.equal(s.body.audio, false);

  const hl = parseAppJob(job({ model: "hailuo3", kind: "image_to_video", inputs: [{ input: I1, role: "first" }], prompt: "p", seconds: 5, ratio: "16:9", resolution: "768p" })).job;
  assert.equal(runwayRequest(rowOf("hailuo3"), hl, [pic("first")]).body.resolution, "768p");

  const gpt = parseAppJob(job({ model: "gpt_image_2", kind: "still_variation", inputs: [{ input: I1, role: "ref" }], prompt: "p", ratio: "2560:1440", resolution: "2K" })).job;
  const g = runwayRequest(rowOf("gpt_image_2"), gpt, [pic("ref")]);
  assert.equal(g.path, "/v1/text_to_image");
  assert.equal(g.body.quality, "high");
  assert.equal(g.body.referenceImages[0].tag, "ref1");

  const grok = parseAppJob(job({ model: "grok_imagine_image_2", kind: "still_variation", inputs: [{ input: I1, role: "ref" }], prompt: "p", ratio: "2048:2048", resolution: "2K" })).job;
  const k = runwayRequest(rowOf("grok_imagine_image_2"), grok, [pic("ref")]);
  assert.equal(k.body.edit, true);
  assert.equal(k.body.quality, "medium");
  assert.deepEqual(Object.keys(k.body.referenceImages[0]), ["uri"]);

  const up = parseAppJob(job({ model: "magnific_precision_upscaler_v2", kind: "still_upscale", inputs: [{ input: I1, role: "image" }], prompt: "", scale: 2 })).job;
  assert.deepEqual(runwayRequest(rowOf("magnific_precision_upscaler_v2"), up, [pic("image")]),
    buildRequest({ kind: "still_upscale", model: "magnific_precision_upscaler_v2", scale: 2, pictures: [pic("image")] }));
  assert.throws(() => runwayRequest(rowOf("hf.flux_2"), still, [pic("ref")]), /not a Runway row/);
});
