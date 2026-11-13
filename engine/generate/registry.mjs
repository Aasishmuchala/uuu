// The table of every model the generation door will pay for (PLAN-V5 K20), on two services:
// Runway (its public API, the key, credits of one US cent) and Higgsfield (its MCP server, the
// owner's sign-in, credits turned into cents at the owner's rate). Runway's five first rows are
// runway.mjs's PRICES, ids and prices unchanged; the rest come from `.router/V5-MODELS.md`
// (T63) and are marked there LITERAL (Runway's openapi.json and pricing page) or UNCONFIRMED
// (every Higgsfield price, until a signed-in `get_cost` is seen). A model that is not here, or
// whose price is null, costs nothing because the door makes nothing with it.
//
// Also here: what an app may send (`parseAppJob`, K19's body and every A3 case but the one the
// door's own store answers), the list an app reads (`appModels`), the bodies Runway is sent for
// these rows with the door's pins (`runwayRequest`), and the hosts a Higgsfield upload may go
// to (`HF_UPLOAD_SUFFIXES`, empty until the real upload host is seen). Pure; zero dependencies.
import { KINDS, MAX_SECONDS, MIN_SECONDS, PRICES, UPSCALE_MAX_SIDE, VIDEO_KINDS } from "./runway.mjs";

// The hosts a Higgsfield upload address may end with. EMPTY on purpose: T63 could not see the
// real upload host (no signed-in `media_upload`), so every upload is refused until one is
// recorded here from a real answer (`.router/V5-MODELS.md`, "Not found: be tolerant").
export const HF_UPLOAD_SUFFIXES = Object.freeze([]);

export const ROLES = Object.freeze(["first", "last", "ref", "image"]);
export const DEFAULT_CENTS_PER_CREDIT = 5;   // the owner's S3 answer; whole, 1 to 50 (K20)
export const APP_JOB_BYTES = 256 * 1024;     // one app job body, its prompt included
export const INPUT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RATIO_RE = /^([0-9]{1,5}:[0-9]{1,5}|adaptive)$/;
const RES_RE = /^[0-9A-Za-z]{1,8}$/;
const RUNWAY_PATHS = Object.freeze({
  image_to_video: "/v1/image_to_video", text_to_video: "/v1/text_to_video",
  still_variation: "/v1/text_to_image", still_upscale: "/v1/image_upscale",
});
const HF_TOOLS = new Set(["generate_image", "generate_video", "upscale_image"]);
const HF_MEDIA_ROLES = new Set(["start_image", "end_image", "image_references"]);

export const NEEDS = Object.freeze({
  runway: "Needs a Runway key. Add it in Settings on the home screen.",
  higgsfield: "Needs Higgsfield. Switch it on and sign in from Settings on the home screen.",
});
export const NO_PRICE = "The door has no price for this model, so nothing is made with it.";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const whole = (v) => Number.isInteger(v) && v >= 0;
const units = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

function deepFreeze(v) {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

// One row, checked and frozen; throws on anything off, so a typo in the table stops the door at
// start rather than mispricing a job. Fields beyond K20's (all optional):
//   ratiosBy        resolution -> the ratios of that size (the price follows the ratio's size)
//   fixed           fields the door always sends (Veo's and Kling's `audio: false`, GPT Image's
//                   quality, Grok's `edit`, FLUX.2's `variant`): what the price assumes
//   tags            Runway reference pictures carry a tag (ref1, ref2, ...)
//   sendResolution  Runway takes `resolution` in the body (else the ratio sets the size)
//   noMix           first or last frames and plain references may not be sent together
//   scales          the upscale factors taken; maxSide, the result's longest side
//   promptNeeded    the service needs a prompt
//   tool, hfRoles, resolutionParam   Higgsfield: the tool, its media roles, the resolution's name
//   price           { per, credits | byResolution, minimum (a job), perRef (each picture sent) }
//                   in the service's unit, or null (no price yet: nothing is made)
//   source          where the numbers came from
export function defineRow(spec) {
  // Copies of what is normalised below, so the caller's objects are never changed or frozen.
  const r = { ...spec };
  for (const k of ["refs", "price", "fixed", "hfRoles", "seconds", "ratiosBy"]) if (isObj(r[k])) r[k] = { ...r[k] };
  const bad = (what) => { throw new Error(`registry: row ${String(r.id)}: ${what}`); };
  if (typeof r.id !== "string" || !MODEL_ID_RE.test(r.id)) bad("id");
  if (r.provider !== "runway" && r.provider !== "higgsfield") bad("provider");
  if (r.provider === "higgsfield" ? !r.id.startsWith("hf.") : r.id.startsWith("hf.")) bad("an hf. id is Higgsfield's and only Higgsfield's");
  if (typeof r.remote !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(r.remote)) bad("remote");
  if (typeof r.words !== "string" || r.words.length < 3 || r.words.length > 80) bad("words");
  if (!Array.isArray(r.kinds) || r.kinds.length === 0 || !r.kinds.every((k) => KINDS.includes(k))) bad("kinds");
  if (!isObj(r.refs) || !Number.isInteger(r.refs.max) || r.refs.max < 0 || r.refs.max > 30) bad("refs.max");
  if (!Array.isArray(r.refs.roles) || !r.refs.roles.every((x) => ROLES.includes(x))) bad("refs.roles");
  const video = r.kinds.some((k) => VIDEO_KINDS.includes(k));
  if (r.kinds.some((k) => VIDEO_KINDS.includes(k)) && r.kinds.some((k) => !VIDEO_KINDS.includes(k))) bad("video and still kinds in one row");
  r.ratios = r.ratios === undefined ? null : r.ratios;
  if (r.ratios !== null && !(Array.isArray(r.ratios) && r.ratios.length > 0 && r.ratios.every((x) => RATIO_RE.test(x)))) bad("ratios");
  r.resolutions = r.resolutions === undefined ? null : r.resolutions;
  if (r.resolutions !== null && !(Array.isArray(r.resolutions) && r.resolutions.length > 0 && r.resolutions.every((x) => RES_RE.test(x)))) bad("resolutions");
  r.ratiosBy = r.ratiosBy === undefined ? null : r.ratiosBy;
  if (r.ratiosBy !== null) {
    if (!isObj(r.ratiosBy) || r.resolutions === null || r.ratios === null) bad("ratiosBy");
    for (const res of r.resolutions) if (!Array.isArray(r.ratiosBy[res]) || !r.ratiosBy[res].every((x) => r.ratios.includes(x))) bad(`ratiosBy.${res}`);
    if (Object.keys(r.ratiosBy).some((k) => !r.resolutions.includes(k))) bad("ratiosBy has a size not in resolutions");
  }
  r.seconds = r.seconds === undefined ? null : r.seconds;
  if (video !== (r.seconds !== null)) bad("seconds belong to video rows only");
  if (r.seconds !== null) {
    const s = r.seconds;
    const okRange = whole(s.min) && whole(s.max) && s.min >= 1 && s.max >= s.min && s.max <= 60 && s.list === undefined;
    const okList = Array.isArray(s.list) && s.list.length > 0 && s.list.every((x) => whole(x) && x >= 1 && x <= 60) && s.min === undefined;
    if (!okRange && !okList) bad("seconds");
  }
  if (!whole(r.promptMax) || r.promptMax > 50_000) bad("promptMax");
  r.promptNeeded = r.promptNeeded === true;
  if (r.promptNeeded && r.promptMax === 0) bad("a needed prompt with promptMax 0");
  r.scales = r.scales === undefined ? null : r.scales;
  if (r.scales !== null && !(Array.isArray(r.scales) && r.scales.every((x) => x === 2 || x === 4))) bad("scales");
  r.maxSide = r.maxSide === undefined ? null : r.maxSide;
  r.fixed = r.fixed === undefined ? {} : r.fixed;
  if (!isObj(r.fixed)) bad("fixed");
  r.tags = r.tags === true;
  r.sendResolution = r.sendResolution === true;
  r.noMix = r.noMix === true;
  if (r.price !== null) {
    const p = r.price;
    if (!isObj(p) || (p.per !== "second" && p.per !== "picture")) bad("price.per");
    if ((p.per === "second") !== video) bad("a video row is priced by the second, a picture row by the picture");
    p.byResolution = p.byResolution === undefined ? null : p.byResolution;
    if (p.byResolution === null ? !units(p.credits) : (p.credits !== undefined || !isObj(p.byResolution))) bad("price.credits or byResolution");
    if (p.byResolution !== null) {
      if (r.resolutions === null || r.resolutions.some((x) => !units(p.byResolution[x])) || Object.keys(p.byResolution).length !== r.resolutions.length) bad("price.byResolution");
    }
    p.minimum = p.minimum === undefined ? null : p.minimum;
    p.perRef = p.perRef === undefined ? null : p.perRef;
    if ((p.minimum !== null && !units(p.minimum)) || (p.perRef !== null && !units(p.perRef))) bad("price.minimum or perRef");
  } else if (r.provider === "runway") {
    bad("a Runway row needs a price");
  }
  if (r.provider === "higgsfield") {
    if (!HF_TOOLS.has(r.tool)) bad("tool");
    if (!isObj(r.hfRoles) || !r.refs.roles.every((x) => (r.tool === "upscale_image" ? x === "image" : HF_MEDIA_ROLES.has(r.hfRoles[x])))) bad("hfRoles");
    if (r.resolutionParam !== undefined && !/^[a-z_]{1,32}$/.test(r.resolutionParam)) bad("resolutionParam");
  }
  if (typeof r.source !== "string") bad("source");
  return deepFreeze(r);
}

const P = (s) => s.split(",");
// A flat list cut into sizes by position (Runway lists each model's ratios size by size; the
// size of each group is INFERRED from the order, as `apps/render-to-film/src/local/routing.ts`).
function bySize(words, flat, size) {
  const all = P(flat);
  if (all.length !== words.length * size) throw new Error("registry: a ratio list does not cut evenly");
  return Object.fromEntries(words.map((w, i) => [w, all.slice(i * size, (i + 1) * size)]));
}
const sized = (words, flat, size) => {
  const ratiosBy = bySize(words, flat, size);
  return { resolutions: words, ratiosBy, ratios: words.flatMap((w) => ratiosBy[w]) };
};

// Runway's five rows of step 3, from runway.mjs's PRICES, ids and prices unchanged.
function fromPrices(id, extra) {
  const p = PRICES[id];
  const video = p.kinds.some((k) => VIDEO_KINDS.includes(k));
  return defineRow({
    id, provider: "runway", remote: id, kinds: [...p.kinds], ratios: p.ratios ? [...p.ratios] : null,
    seconds: video ? { min: MIN_SECONDS, max: MAX_SECONDS } : null,
    price: video ? { per: "second", credits: p.perSecond } : { per: "picture", credits: p.perPicture },
    source: "runway.mjs PRICES (Runway's pricing page)",
    ...extra,
  });
}

const RUNWAY = "Runway's openapi.json and pricing page, 13 November 2026 (LITERAL)";
const HF_UNCONFIRMED = "Higgsfield's models_explore list (LITERAL); price UNCONFIRMED until a signed-in get_cost";

const SEEDANCE_SIZES = "992:432,864:496,752:560,640:640,560:752,496:864," +
  "1470:630,1280:720,1112:834,960:960,834:1112,720:1280," +
  "2206:946,1920:1080,1664:1248,1440:1440,1248:1664,1080:1920," +
  "3840:1646,3840:2160,3840:2880,3840:3840,2880:3840,2160:3840";
const GPT_SIZES = "2048:880,1920:1088,1920:1280,1920:1440,1920:1536,1920:1920,1536:1920,1440:1920,1280:1920,1088:1920," +
  "2912:1248,2560:1440,2560:1712,2560:1920,2560:2048,2560:2560,2048:2560,1920:2560,1712:2560,1440:2560," +
  "3840:1648,3840:2160,3504:2336,3264:2448,3200:2560,2880:2880,2560:3200,2448:3264,2336:3504,2160:3840";
const VEO = { kinds: ["image_to_video"], refs: { max: 2, roles: ["first", "last"] }, ratios: P("1280:720,720:1280,1080:1920,1920:1080"),
  seconds: { list: [4, 6, 8] }, promptMax: 1000, fixed: { audio: false }, source: RUNWAY };
const KLING = { kinds: ["image_to_video"], refs: { max: 2, roles: ["first", "last"] }, seconds: { min: 3, max: 15 }, promptMax: 2500,
  fixed: { audio: false }, source: RUNWAY };
const STILL = { kinds: ["still_variation"], promptNeeded: true, source: RUNWAY };

const TABLE = [
  // ---- Runway, step 3's rows (runway.mjs PRICES) ----
  fromPrices("gen4_turbo", { words: "Gen-4 Turbo on Runway", refs: { max: 1, roles: ["first"] }, promptMax: 1000 }),
  fromPrices("gen4.5", { words: "Gen-4.5 on Runway", refs: { max: 1, roles: ["first"] }, promptMax: 1000, promptNeeded: true }),
  // A still is priced at its highest row (8, the 1080p price), as step 3 does; the app's size
  // word only picks the ratio and is not sent.
  fromPrices("gen4_image", { words: "Gen-4 Image on Runway", refs: { max: 3, roles: ["ref"] }, resolutions: ["720p", "1080p"],
    promptMax: 1000, promptNeeded: true, tags: true }),
  fromPrices("gen4_image_turbo", { words: "Gen-4 Image Turbo on Runway", refs: { max: 3, roles: ["ref"] }, promptMax: 1000,
    promptNeeded: true, tags: true }),
  // 25 credits while the result stays within 4096 px; past it Runway charges 150, so a job
  // whose picture times the scale passes 4096 px is refused by the door (`upscaleFits`).
  fromPrices("magnific_precision_upscaler_v2", { words: "Magnific Precision upscale on Runway", refs: { max: 1, roles: ["image"] },
    promptMax: 0, scales: [2, 4], maxSide: UPSCALE_MAX_SIDE }),

  // ---- Runway, the rows T63 confirmed (V5-MODELS.md section 3) ----
  // Veo and Kling are priced without sound: the door always sends `audio: false`.
  defineRow({ id: "veo3.1", provider: "runway", remote: "veo3.1", words: "Veo 3.1 on Runway", ...VEO, price: { per: "second", credits: 20 } }),
  defineRow({ id: "veo3.1_fast", provider: "runway", remote: "veo3.1_fast", words: "Veo 3.1 Fast on Runway", ...VEO, price: { per: "second", credits: 10 } }),
  // Seedance: the size follows the ratio (no `resolution` field); a minimum per job; `auto`
  // seconds never (its price is not known beforehand).
  defineRow({ id: "seedance2", provider: "runway", remote: "seedance2", words: "Seedance 2.0 on Runway", kinds: ["image_to_video"],
    refs: { max: 9, roles: ["first", "last", "ref"] }, ...sized(["480p", "720p", "1080p", "4K"], SEEDANCE_SIZES, 6),
    seconds: { min: 4, max: 15 }, promptMax: 10000, fixed: { audio: false },
    price: { per: "second", byResolution: { "480p": 14, "720p": 30, "1080p": 40, "4K": 150 }, minimum: 56 }, source: RUNWAY }),
  defineRow({ id: "seedance2_fast", provider: "runway", remote: "seedance2_fast", words: "Seedance 2.0 Fast on Runway", kinds: ["image_to_video"],
    refs: { max: 9, roles: ["first", "last", "ref"] }, ...sized(["480p", "720p"], P(SEEDANCE_SIZES).slice(0, 12).join(","), 6),
    seconds: { min: 4, max: 15 }, promptMax: 10000, fixed: { audio: false },
    price: { per: "second", byResolution: { "480p": 11, "720p": 24 }, minimum: 44 }, source: RUNWAY }),
  defineRow({ id: "seedance2_5", provider: "runway", remote: "seedance2_5", words: "Seedance 2.5 on Runway", kinds: ["image_to_video"],
    refs: { max: 30, roles: ["first", "last", "ref"] },
    ...sized(["480p", "720p", "1080p"], "992:432,854:480,752:560,640:640,560:752,480:854," + P(SEEDANCE_SIZES).slice(6, 18).join(","), 6),
    seconds: { min: 4, max: 30 }, promptMax: 15000, fixed: { audio: false },
    price: { per: "second", byResolution: { "480p": 20, "720p": 30, "1080p": 68 }, minimum: 80 }, source: RUNWAY }),
  defineRow({ id: "kling3.0_pro", provider: "runway", remote: "kling3.0_pro", words: "Kling 3.0 Pro on Runway", ...KLING,
    ratios: P("1920:1080,1080:1920,1440:1440"), price: { per: "second", credits: 12 } }),
  defineRow({ id: "kling3.0_4k", provider: "runway", remote: "kling3.0_4k", words: "Kling 3.0 4K on Runway", ...KLING,
    ratios: P("3840:2160,2160:3840,2880:2880"), price: { per: "second", credits: 43 } }),
  defineRow({ id: "kling3.0_standard", provider: "runway", remote: "kling3.0_standard", words: "Kling 3.0 Standard on Runway", ...KLING,
    ratios: P("1280:720,720:1280,960:960"), price: { per: "second", credits: 9 } }),
  defineRow({ id: "klingO3_pro", provider: "runway", remote: "klingO3_pro", words: "Kling O3 Pro on Runway", ...KLING,
    ratios: P("1920:1080,1080:1920,1440:1440"), price: { per: "second", credits: 17 } }),
  // Hailuo 3 (the app's MiniMax H3): 2 credits more for each picture sent, the first frame too;
  // keyframes and plain references may not be mixed.
  defineRow({ id: "hailuo3", provider: "runway", remote: "hailuo3", words: "MiniMax Hailuo 3 on Runway", kinds: ["image_to_video"],
    refs: { max: 9, roles: ["first", "last", "ref"] }, noMix: true, ratios: P("adaptive,21:9,16:9,4:3,1:1,3:4,9:16"),
    resolutions: ["768p", "2k"], sendResolution: true, seconds: { min: 5, max: 15 }, promptMax: 6000, promptNeeded: true,
    price: { per: "second", byResolution: { "768p": 10, "2k": 15 }, perRef: 2 }, source: RUNWAY }),
  defineRow({ id: "gemini_image3_pro", provider: "runway", remote: "gemini_image3_pro", words: "Nano Banana Pro on Runway", ...STILL,
    refs: { max: 14, roles: ["ref"] }, tags: true, promptMax: 45000,
    ...sized(["1K", "2K", "4K"],
      "1344:768,768:1344,1024:1024,1184:864,864:1184,1536:672,832:1248,1248:832,896:1152,1152:896," +
      "2048:2048,1696:2528,2528:1696,1792:2400,2400:1792,1856:2304,2304:1856,1536:2752,2752:1536,3168:1344," +
      "4096:4096,3392:5056,5056:3392,3584:4800,4800:3584,3712:4608,4608:3712,3072:5504,5504:3072,6336:2688", 10),
    price: { per: "picture", byResolution: { "1K": 20, "2K": 20, "4K": 40 } } }),
  defineRow({ id: "gemini_image3.1_flash", provider: "runway", remote: "gemini_image3.1_flash", words: "Nano Banana 2 on Runway", ...STILL,
    refs: { max: 14, roles: ["ref"] }, tags: true, promptMax: 45000,
    ...sized(["512px", "1K", "2K", "4K"],
      "512:512,416:624,624:416,432:592,592:432,448:576,576:448,384:672,672:384,768:336,256:1024,1024:256,176:1408,1408:176," +
      "1024:1024,832:1248,1248:832,864:1184,1184:864,896:1152,1152:896,768:1344,1344:768,1536:672,512:2048,2048:512,352:2816,2816:352," +
      "2048:2048,1696:2528,2528:1696,1792:2400,2400:1792,1856:2304,2304:1856,1536:2752,2752:1536,3168:1344,1024:4096,4096:1024,704:5632,5632:704," +
      "4096:4096,3392:5056,5056:3392,3584:4800,4800:3584,3712:4608,4608:3712,3072:5504,5504:3072,6336:2688,2048:8192,8192:2048,1408:11264,11264:1408", 14),
    price: { per: "picture", byResolution: { "512px": 5, "1K": 7, "2K": 11, "4K": 16 } } }),
  defineRow({ id: "nano_banana_2.1", provider: "runway", remote: "nano_banana_2.1", words: "Nano Banana 2.1 on Runway", ...STILL,
    refs: { max: 14, roles: ["ref"] }, tags: true, promptMax: 45000,
    ...sized(["1K", "2K", "4K"],
      "1024:1024,848:1264,1264:848,896:1200,1200:896,928:1152,1152:928,768:1376,1376:768,1584:672,512:2064,2064:512,352:2928,2928:352," +
      "2048:2048,1696:2528,2528:1696,1792:2400,2400:1792,1856:2304,2304:1856,1536:2752,2752:1536,3168:1344,1024:4128,4128:1024,704:5856,5856:704," +
      "4096:4096,3392:5056,5056:3392,3584:4800,4800:3584,3712:4608,4608:3712,3072:5504,5504:3072,6336:2688,2048:8256,8256:2048,1408:11712,11712:1408", 14),
    price: { per: "picture", byResolution: { "1K": 4, "2K": 6, "4K": 12 } } }),
  // GPT Image 2 at quality high (the app's own choice): 20 credits at 1K or 2K, 41 at 4K. Its
  // `auto` ratio (billed as 4K) is not taken.
  defineRow({ id: "gpt_image_2", provider: "runway", remote: "gpt_image_2", words: "GPT Image 2 on Runway", ...STILL,
    refs: { max: 16, roles: ["ref"] }, tags: true, promptMax: 32000, fixed: { quality: "high" }, ...sized(["1K", "2K", "4K"], GPT_SIZES, 10),
    price: { per: "picture", byResolution: { "1K": 20, "2K": 20, "4K": 41 } } }),
  defineRow({ id: "seedream5_pro", provider: "runway", remote: "seedream5_pro", words: "Seedream 5.0 Pro on Runway", ...STILL,
    refs: { max: 10, roles: ["ref"] }, promptMax: 4000,
    ...sized(["1K", "2K"], "1024:1024,1184:896,896:1184,1376:768,768:1376,1296:864,864:1296,2048:2048,2304:1728,1728:2304,2720:1530,1530:2720,2496:1664,1664:2496", 7),
    price: { per: "picture", byResolution: { "1K": 5, "2K": 9 } } }),
  defineRow({ id: "seedream5_lite", provider: "runway", remote: "seedream5_lite", words: "Seedream 5.0 Lite on Runway", ...STILL,
    refs: { max: 14, roles: ["ref"] }, promptMax: 4000,
    ratios: P("2048:2048,2304:1728,1728:2304,2848:1600,1600:2848,2496:1664,1664:2496,3136:1344,3072:3072,3456:2592,2592:3456,4096:2304,2304:4096,3744:2496,2496:3744,4704:2016"),
    price: { per: "picture", credits: 4 } }),
  // Grok Imagine Image 2: the render is the picture it edits (`edit: true`, as the app sent it),
  // at quality medium; 1 credit more for each picture sent.
  defineRow({ id: "grok_imagine_image_2", provider: "runway", remote: "grok_imagine_image_2", words: "Grok Imagine Image 2 on Runway", ...STILL,
    refs: { max: 3, roles: ["ref"] }, promptMax: 2500, fixed: { quality: "medium", edit: true },
    ...sized(["1K", "2K"],
      "1024:1024,1280:720,720:1280,1152:864,864:1152,1248:832,832:1248,1248:576,576:1248,1280:576,576:1280,1408:704,704:1408," +
      "2048:2048,2816:1584,1584:2816,2368:1776,1776:2368,2496:1664,1664:2496,2912:1344,1344:2912,3200:1440,1440:3200,2912:1456,1456:2912", 13),
    price: { per: "picture", byResolution: { "1K": 6, "2K": 8 }, perRef: 1 } }),
  // Not here: gpt_image_2_5_sunburst and gpt_image_2_5_flare. Runway offers them, but their
  // price table (by quality, size and ratio, plus 1 per reference) was not recorded by T63, so
  // the door has no exact price and makes nothing with them.

  // ---- Higgsfield (only what Runway does not offer: K20's "Runway first") ----
  // FLUX.2 at variant max (the app's preset): 4 credits a picture, from Higgsfield's pricing
  // explainer. The live `get_cost` guards it: a higher live price refuses the job.
  defineRow({ id: "hf.flux_2", provider: "higgsfield", remote: "flux_2", words: "FLUX.2 Max on Higgsfield", kinds: ["still_variation"],
    tool: "generate_image", hfRoles: { ref: "image_references" }, resolutionParam: "resolution",
    refs: { max: 8, roles: ["ref"] }, ratios: P("1:1,4:3,3:4,16:9,9:16"), resolutions: ["1k", "2k"], promptMax: 4000, promptNeeded: true,
    fixed: { variant: "max" }, price: { per: "picture", credits: 4 }, source: HF_UNCONFIRMED }),
  // Wan 2.6: its size word is `quality`; one reference picture. No price seen anywhere yet.
  defineRow({ id: "hf.wan2_6", provider: "higgsfield", remote: "wan2_6", words: "Wan 2.6 on Higgsfield", kinds: ["image_to_video"],
    tool: "generate_video", hfRoles: { ref: "image_references" }, resolutionParam: "quality",
    refs: { max: 1, roles: ["ref"] }, ratios: P("16:9,9:16,1:1"), resolutions: ["720p", "1080p"], seconds: { list: [5, 10, 15] },
    promptMax: 4000, promptNeeded: true, price: null, source: `${HF_UNCONFIRMED}; no price seen` }),
  // `upscale_image` (bytedance, the app's Creative upscaler, "Higgsfield 4K"). No price seen.
  defineRow({ id: "hf.upscale_image", provider: "higgsfield", remote: "upscale_image", words: "Higgsfield 4K upscale", kinds: ["still_upscale"],
    tool: "upscale_image", hfRoles: {}, refs: { max: 1, roles: ["image"] }, resolutions: ["2k", "4k"], promptMax: 0,
    fixed: { provider: "bytedance" }, price: null, source: "V5-HIGGSFIELD.md section 3 (the tool's schema); no price seen" }),
];

export const ROWS = Object.freeze(TABLE);
const BY_ID = new Map(TABLE.map((r) => [r.id, r]));
if (BY_ID.size !== TABLE.length) throw new Error("registry: two rows with one id");

// The row for a model id, or null (any string not in the table, a prototype name included).
export const rowOf = (id) => (typeof id === "string" && BY_ID.has(id) ? BY_ID.get(id) : null);

// ---- prices -------------------------------------------------------------------------------

const given = (v) => v !== undefined && v !== null;
function secondsFit(row, s) {
  if (!Number.isInteger(s) || row.seconds === null) return false;
  return row.seconds.list ? row.seconds.list.includes(s) : s >= row.seconds.min && s <= row.seconds.max;
}

// The price of one job in the row's own unit (Runway or Higgsfield credits), or null when the
// row, the kind, the seconds, the resolution, the scale or the number of pictures is not the
// row's, or the row has no price. `refs` (pictures sent) counts only where the row charges per
// picture; left out, it is the row's most, so an estimate is never below the job.
// `table` (tests only) is a list of rows used instead of the door's.
export function estimateUnits({ kind, model, seconds, resolution, scale, refs } = {}, { table } = {}) {
  const row = table ? (table.find((r) => r.id === model) || null) : rowOf(model);
  if (row === null || row.price === null || !row.kinds.includes(kind)) return null;
  const p = row.price;
  if (given(resolution) && (row.resolutions === null || !row.resolutions.includes(resolution))) return null;
  if (given(scale) && (row.scales === null || !row.scales.includes(scale))) return null;
  const base = p.byResolution === null ? p.credits : given(resolution) ? p.byResolution[resolution] : null;
  if (!units(base)) return null;
  let total;
  if (p.per === "second") {
    if (!secondsFit(row, seconds)) return null;
    total = base * seconds;
  } else {
    if (given(seconds)) return null;
    total = base;
  }
  if (p.perRef !== null) {
    const n = given(refs) ? refs : row.refs.max;
    if (!Number.isInteger(n) || n < 0 || n > row.refs.max) return null;
    total += p.perRef * n;
  }
  if (p.minimum !== null) total = Math.max(total, p.minimum);
  return total;
}

const rateOk = (r) => Number.isInteger(r) && r >= 1 && r <= 50;
// Units times a rate, rounded up to a whole cent (the float error of the product removed first).
const toCents = (u, rate) => Math.ceil(Math.round(u * rate * 1e6) / 1e6);

// The price of one job in US cents (K20): a Runway credit is a cent; a Higgsfield credit is
// `centsPerCredit` cents (whole, 1 to 50), rounded up to a whole cent. Null whenever
// `estimateUnits` is, or the rate is not a whole number from 1 to 50: then nothing is spent.
export function estimateCents(item, { centsPerCredit = DEFAULT_CENTS_PER_CREDIT, table } = {}) {
  const u = estimateUnits(item, { table });
  if (u === null) return null;
  const row = table ? table.find((r) => r.id === item.model) : rowOf(item.model);
  if (row.provider === "runway") return Math.ceil(u);
  return rateOk(centsPerCredit) ? toCents(u, centsPerCredit) : null;
}

// An upscale's result stays within the row's longest side (Runway's 25-credit row ends at
// 4096 px; past it the price is 150). True when the row has no such limit.
export function upscaleFits(row, width, height, scale) {
  if (!row || row.maxSide === null) return true;
  return Number.isInteger(width) && Number.isInteger(height) && Number.isInteger(scale) && Math.max(width, height) * scale <= row.maxSide;
}

// ---- what an app reads ----------------------------------------------------------------------

// The owner's rate from the switches (`readGenState(...).higgsfield.centsPerCredit`, T73); the
// default when the state has none yet; null (no Higgsfield price) when it is there but wrong.
function rateOf(genState) {
  const h = genState && genState.ok !== false && isObj(genState.higgsfield) ? genState.higgsfield : null;
  if (h === null || h.centsPerCredit === undefined) return DEFAULT_CENTS_PER_CREDIT;
  return rateOk(h.centsPerCredit) ? h.centsPerCredit : null;
}

function priceForApp(row, rate) {
  if (row.price === null) return null;
  const p = row.price;
  const c = row.provider === "runway" ? (u) => Math.ceil(u) : rate === null ? null : (u) => toCents(u, rate);
  if (c === null) return null;
  return {
    per: p.per,
    cents: p.byResolution === null ? c(p.credits) : null,
    byResolution: p.byResolution === null ? null : Object.fromEntries(Object.entries(p.byResolution).map(([k, v]) => [k, c(v)])),
    minimumCents: p.minimum === null ? null : c(p.minimum),
    perRefCents: p.perRef === null ? null : c(p.perRef),
  };
}

// K19's `GET /gen/app/models`: every row, its price in cents at the owner's rate, and whether it
// can be used now. `ready` is { runway: <a key is saved>, higgsfield: <on and signed in> }.
export function appModels(genState, ready) {
  const rate = rateOf(genState);
  const r = isObj(ready) ? ready : {};
  return ROWS.map((row) => {
    const providerReady = r[row.provider] === true;
    const price = priceForApp(row, rate);
    return {
      id: row.id, provider: row.provider, words: row.words, kinds: [...row.kinds],
      ratios: row.ratios ? [...row.ratios] : null, resolutions: row.resolutions ? [...row.resolutions] : null,
      seconds: row.seconds ? { ...row.seconds, ...(row.seconds.list ? { list: [...row.seconds.list] } : {}) } : null,
      refs: { max: row.refs.max, roles: [...row.refs.roles] }, promptMax: row.promptMax, price,
      ready: providerReady && price !== null,
      why: !providerReady ? NEEDS[row.provider] : price === null ? NO_PRICE : null,
    };
  });
}

// ---- what an app may send: K19's `POST /gen/app/jobs` body ----------------------------------

const APP_JOB_KEYS = new Set(["model", "kind", "inputs", "prompt", "seconds", "ratio", "resolution", "scale"]);
// Control characters but a line break (K19 A3).
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;

// An app's job body, checked against its row: { ok: true, job: { model, kind, inputs: [ {
// input, role } ], prompt, seconds, ratio, resolution, scale } } (absent fields null), or
// { ok: false, why } with a sentence the app may show (every A3 case, answered `gen_bad_request`).
// Not checked here, because only the door's store knows: whether each input is one this app
// sent in the last day.
export function parseAppJob(buf) {
  const no = (why) => ({ ok: false, why });
  if (!Buffer.isBuffer(buf) || buf.length > APP_JOB_BYTES) return no("The job is not one JSON object of at most 256 KB.");
  let v;
  try { v = JSON.parse(buf.toString("utf8")); } catch { return no("The job is not one JSON object of at most 256 KB."); }
  if (!isObj(v)) return no("The job is not one JSON object of at most 256 KB.");
  const keys = Object.keys(v);
  if (!keys.every((k) => APP_JOB_KEYS.has(k))) return no("The job has a key the door does not take.");
  for (const k of ["model", "kind", "inputs", "prompt"]) if (!Object.hasOwn(v, k)) return no(`The job needs ${k}.`);
  const row = rowOf(v.model);
  if (row === null) return no("This model is not in the door's table.");
  if (!row.kinds.includes(v.kind)) return no("This model does not make this kind of job.");

  // The pictures: each { input, role }, the row's roles, at most its refs.max.
  if (!Array.isArray(v.inputs) || v.inputs.length > row.refs.max) return no(`This model takes at most ${row.refs.max} pictures.`);
  const inputs = [];
  const seen = new Set();
  for (const it of v.inputs) {
    if (!isObj(it) || Object.keys(it).length !== 2 || typeof it.input !== "string" || typeof it.role !== "string") return no("Each picture is { input, role }.");
    if (!INPUT_ID_RE.test(it.input)) return no("A picture is not one the door kept.");
    if (!row.refs.roles.includes(it.role)) return no("A picture's role is not one this model takes.");
    const pair = `${it.input} ${it.role}`;
    if (seen.has(pair)) return no("A picture is sent twice in one role.");
    seen.add(pair);
    inputs.push({ input: it.input, role: it.role });
  }
  const count = (role) => inputs.filter((i) => i.role === role).length;
  if (count("first") > 1 || count("last") > 1) return no("A clip has one first frame and one last frame at most.");
  if (count("last") === 1 && count("first") === 0 && row.refs.roles.includes("first")) return no("A last frame needs a first frame.");
  if (row.noMix && count("ref") > 0 && count("first") + count("last") > 0) return no("This model takes frames or references, not both.");
  const need = { image_to_video: [1, row.refs.max], text_to_video: [0, 0], still_variation: [1, row.refs.max], still_upscale: [1, 1] }[v.kind];
  if (inputs.length < need[0] || inputs.length > need[1]) return no("This kind of job takes a different number of pictures.");

  // The prompt.
  if (typeof v.prompt !== "string") return no("The prompt is text.");
  if (v.prompt.length > row.promptMax) return no(`This model takes a prompt of at most ${row.promptMax} characters.`);
  if (CONTROL.test(v.prompt)) return no("The prompt has a control character.");
  if (row.promptNeeded && v.prompt.trim() === "") return no("This model needs a prompt.");

  // Seconds, ratio, resolution, scale: each exactly where the row has them.
  const opt = (k) => (Object.hasOwn(v, k) ? v[k] : undefined);
  const seconds = opt("seconds");
  if (row.seconds === null ? seconds !== undefined : !secondsFit(row, seconds)) return no("These seconds are not ones this model makes.");
  const resolution = opt("resolution");
  if (row.resolutions === null ? resolution !== undefined : !row.resolutions.includes(resolution)) return no("This size is not one this model makes.");
  const ratio = opt("ratio");
  if (row.ratios === null ? ratio !== undefined : typeof ratio !== "string" || !row.ratios.includes(ratio)) return no("This shape is not one this model makes.");
  if (row.ratiosBy !== null && !row.ratiosBy[resolution].includes(ratio)) return no("This shape is not one this model makes at this size.");
  const scale = opt("scale");
  if (row.scales === null ? scale !== undefined : !row.scales.includes(scale)) return no("This upscale factor is not one this model takes.");

  return {
    ok: true,
    job: {
      model: row.id, kind: v.kind, inputs, prompt: v.prompt, seconds: seconds === undefined ? null : seconds,
      ratio: ratio === undefined ? null : ratio, resolution: resolution === undefined ? null : resolution, scale: scale === undefined ? null : scale,
    },
  };
}

// ---- Runway's bodies for these rows -----------------------------------------------------------

const dataUri = (pic) => `data:${pic.type};base64,${pic.bytes.toString("base64")}`;

// { path, body } for one Runway job of a checked `job` (parseAppJob's) on `row`. `pictures` are
// the door's own kept inputs in the job's order: [ { type, bytes, role } ]. The row's pins go
// last, so nothing of the job can replace them. For step 3's five rows and one picture this is
// exactly runway.mjs's `buildRequest`.
export function runwayRequest(row, job, pictures) {
  if (!row || row.provider !== "runway" || !row.kinds.includes(job.kind)) throw new Error("runwayRequest: not a Runway row for this kind");
  const path = RUNWAY_PATHS[job.kind];
  const pins = { ...row.fixed };
  if (job.kind === "still_upscale") return { path, body: { model: row.remote, imageUri: dataUri(pictures[0]), scaleFactor: job.scale, ...pins } };
  if (job.kind === "still_variation") {
    const referenceImages = pictures.map((p, i) => (row.tags ? { uri: dataUri(p), tag: `ref${i + 1}` } : { uri: dataUri(p) }));
    return { path, body: { model: row.remote, promptText: job.prompt, ratio: job.ratio, referenceImages, ...pins } };
  }
  const body = { model: row.remote };
  if (job.kind === "image_to_video") {
    body.promptImage = pictures.length === 1 && pictures[0].role === "first" ? dataUri(pictures[0])
      : pictures.map((p) => (p.role === "first" || p.role === "last" ? { uri: dataUri(p), position: p.role } : { uri: dataUri(p) }));
  }
  body.ratio = job.ratio;
  body.duration = job.seconds;
  if (typeof job.prompt === "string" && job.prompt !== "") body.promptText = job.prompt;
  if (row.sendResolution) body.resolution = job.resolution;
  return { path, body: { ...body, ...pins } };
}
