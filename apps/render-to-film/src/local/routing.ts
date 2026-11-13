/**
 * Which model makes what: the app keeps Runway's task names at its boundary
 * (the gateway), and this turns one of them into a body for the engine's door.
 *
 * The table is .router/V5-MODELS.md's, by K24.6's rule: Runway when its public
 * API offers the model, else Higgsfield when `models_explore` lists it with a
 * picture input, else dropped. A row below is the app's view of the door's row
 * (K20): its ratios, resolutions, seconds, reference limit and prompt limit.
 *
 * Marks used in the comments:
 *   LITERAL   - read from Runway's openapi.json (evidence/v5/t63/runway-openapi-candidates.txt)
 *               or Higgsfield's models_explore list (evidence/v5/t63/hf-models-list.json)
 *   INFERRED  - a guess from names or order, to be confirmed by T69 or the first live job
 *
 * Most Runway image and Kling/Veo sizes are pixel pairs, and the pair also sets
 * the price tier. So the call sites keep sending a shape ("16:9", or a width and
 * height), and `routeTask` turns it into the pair of the tier chosen from the
 * app's resolution. `snapAspectRatio` is the SDK's signature, snapping to the
 * labels the app offers for the preset.
 */
import { clampPrompt, droppedSentence, IMAGE_MODELS } from '../models.ts';

/** One picture sent with a job: its address on this Mac and its part. */
export type EngineInput = { url: string; role: 'first' | 'last' | 'ref' | 'image' };

/** The body the gateway sends to `POST /gen/app/jobs`, with addresses not yet uploaded. */
export type EngineBody = {
  model: string;
  kind: 'image_to_video' | 'text_to_video' | 'still_variation' | 'still_upscale';
  inputs: EngineInput[];
  prompt: string;
  seconds?: number | undefined;
  ratio?: string | undefined;
  resolution?: string | undefined;
  scale?: number | undefined;
};

export type Routed =
  | { engine: EngineBody }
  | { claude: Record<string, unknown> }
  | { media: Record<string, unknown> }
  | { dropped: string };

/** The door's list of models (`GET /gen/app/models`), or null when it could not be read. */
export type ModelList = Array<Record<string, unknown>> | null;

type Role = EngineInput['role'];
type Kind = EngineBody['kind'];

// ---------------------------------------------------------------------------
// Ratios the app asks for

/** Ratios offered when the preset has no list of its own (Kling, Gen-4, unknown aliases). */
const FIXED_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '3:2', '2:3', '5:4', '4:5'] as const;

/** Seedance's six shapes per size group (LITERAL; the shapes are read off the pairs). */
const SEEDANCE_LABELS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
const VIDEO_LABELS: Record<string, readonly string[]> = {
  seedance_2: SEEDANCE_LABELS,
  seedance_2_fast: SEEDANCE_LABELS,
  seedance_2_5: SEEDANCE_LABELS,
};

/** "16:9" or "1920:1080" as a number (width over height), else undefined. */
function ratioValue(r: unknown): number | undefined {
  if (typeof r !== 'string') return undefined;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(r);
  if (!m) return undefined;
  const v = Number(m[1]) / Number(m[2]);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Index of the entry nearest `target` (by the log of the ratio); a tie goes to the larger picture. */
function nearest(list: readonly string[], target: number): number {
  let best = -1;
  let bestGap = Infinity;
  let bestArea = -1;
  list.forEach((r, i) => {
    const v = ratioValue(r);
    if (v === undefined) return;
    const gap = Math.abs(Math.log(v) - Math.log(target));
    const [w, h] = r.split(':').map(Number);
    const area = w! * h!;
    if (gap < bestGap - 1e-9 || (Math.abs(gap - bestGap) <= 1e-9 && area > bestArea)) {
      best = i;
      bestGap = gap;
      bestArea = area;
    }
  });
  return best;
}

/**
 * The listed ratio nearest to `width` x `height`, or undefined when the size is
 * not usable. `alias` is the task type the ratio is for: an image preset snaps
 * to the shapes the app offers for it (models.ts), Seedance to its six, any
 * other to one fixed list.
 */
export function snapAspectRatio(width: number, height: number, alias?: string): string | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const own = IMAGE_MODELS.find((m) => m.alias === alias)?.aspectRatios as readonly string[] | undefined;
  const list = own ?? (alias ? VIDEO_LABELS[alias] : undefined) ?? FIXED_RATIOS;
  return list[nearest(list, width / height)];
}

// ---------------------------------------------------------------------------
// The rows

type Tier = { word: string; ratios: readonly string[] };
type Row = {
  model: string;
  kind: Kind;
  roles: readonly Role[];
  /** `refs.max`: all pictures sent with one job. */
  refs: number;
  /** Prompt limit in characters (0: the row takes no prompt). */
  promptMax: number;
  /** Size tiers, lowest first. Each lists the ratios (pixel pairs or labels) of that tier. */
  tiers: readonly Tier[];
  /** The tier used when the app asks for none. */
  dflt: string;
  /** Whether the tier's word goes in the body as `resolution` (else the tier only picks the pair). */
  send: boolean;
  /** Seconds the row accepts: a range or a list. */
  seconds?: { min: number; max: number } | { list: readonly number[] };
  /** `adaptive` is a ratio of its own on this row. */
  adaptive?: boolean;
};

const P = (s: string): string[] => s.split(',');
/** Cut a flat list of ratios into tiers by position. The groups are INFERRED from the enum order. */
function groups(words: readonly string[], flat: string, size: number): Tier[] {
  const all = P(flat);
  return words.map((word, i) => ({ word, ratios: all.slice(i * size, (i + 1) * size) }));
}

const ROW = {
  // Runway, still_variation. Tiers by position in the schema's enum (10 | 10 | 10 pairs): INFERRED.
  gemini_image3_pro: {
    model: 'gemini_image3_pro', kind: 'still_variation', roles: ['ref'], refs: 14, promptMax: 45000,
    tiers: groups(['1K', '2K', '4K'],
      '1344:768,768:1344,1024:1024,1184:864,864:1184,1536:672,832:1248,1248:832,896:1152,1152:896,' +
      '2048:2048,1696:2528,2528:1696,1792:2400,2400:1792,1856:2304,2304:1856,1536:2752,2752:1536,3168:1344,' +
      '4096:4096,3392:5056,5056:3392,3584:4800,4800:3584,3712:4608,4608:3712,3072:5504,5504:3072,6336:2688', 10),
    dflt: '2K', send: true,
  },
  'gemini_image3.1_flash': {
    model: 'gemini_image3.1_flash', kind: 'still_variation', roles: ['ref'], refs: 14, promptMax: 45000,
    tiers: groups(['512px', '1K', '2K', '4K'],
      '512:512,416:624,624:416,432:592,592:432,448:576,576:448,384:672,672:384,768:336,256:1024,1024:256,176:1408,1408:176,' +
      '1024:1024,832:1248,1248:832,864:1184,1184:864,896:1152,1152:896,768:1344,1344:768,1536:672,512:2048,2048:512,352:2816,2816:352,' +
      '2048:2048,1696:2528,2528:1696,1792:2400,2400:1792,1856:2304,2304:1856,1536:2752,2752:1536,3168:1344,1024:4096,4096:1024,704:5632,5632:704,' +
      '4096:4096,3392:5056,5056:3392,3584:4800,4800:3584,3712:4608,4608:3712,3072:5504,5504:3072,6336:2688,2048:8192,8192:2048,1408:11264,11264:1408', 14),
    dflt: '2K', send: true,
  },
  'nano_banana_2.1': {
    model: 'nano_banana_2.1', kind: 'still_variation', roles: ['ref'], refs: 14, promptMax: 45000,
    tiers: groups(['1K', '2K', '4K'],
      '1024:1024,848:1264,1264:848,896:1200,1200:896,928:1152,1152:928,768:1376,1376:768,1584:672,512:2064,2064:512,352:2928,2928:352,' +
      '2048:2048,1696:2528,2528:1696,1792:2400,2400:1792,1856:2304,2304:1856,1536:2752,2752:1536,3168:1344,1024:4128,4128:1024,704:5856,5856:704,' +
      '4096:4096,3392:5056,5056:3392,3584:4800,4800:3584,3712:4608,4608:3712,3072:5504,5504:3072,6336:2688,2048:8256,8256:2048,1408:11712,11712:1408', 14),
    dflt: '2K', send: true,
  },
  // gpt_image_2 and the 2.5 variants share one list (LITERAL), 10 | 10 | 10 by position (INFERRED).
  gpt_image_2: gptRow('gpt_image_2'),
  gpt_image_2_5_sunburst: gptRow('gpt_image_2_5_sunburst'),
  gpt_image_2_5_flare: gptRow('gpt_image_2_5_flare'),
  seedream5_pro: {
    model: 'seedream5_pro', kind: 'still_variation', roles: ['ref'], refs: 10, promptMax: 4000,
    tiers: groups(['1K', '2K'],
      '1024:1024,1184:896,896:1184,1376:768,768:1376,1296:864,864:1296,' +
      '2048:2048,2304:1728,1728:2304,2720:1530,1530:2720,2496:1664,1664:2496', 7),
    dflt: '2K', send: true,
  },
  // Seedream Lite is priced flat (4 credits), so the tier only picks the pair. The match to the
  // app's "Seedream 5.0" preset is INFERRED by name and by its 2k/3k tiers (V5-MODELS.md).
  seedream5_lite: {
    model: 'seedream5_lite', kind: 'still_variation', roles: ['ref'], refs: 14, promptMax: 4000,
    tiers: groups(['2K', '3K'],
      '2048:2048,2304:1728,1728:2304,2848:1600,1600:2848,2496:1664,1664:2496,3136:1344,' +
      '3072:3072,3456:2592,2592:3456,4096:2304,2304:4096,3744:2496,2496:3744,4704:2016', 8),
    dflt: '2K', send: false,
  },
  grok_imagine_image_2: {
    model: 'grok_imagine_image_2', kind: 'still_variation', roles: ['ref'], refs: 3, promptMax: 2500,
    tiers: groups(['1K', '2K'],
      '1024:1024,1280:720,720:1280,1152:864,864:1152,1248:832,832:1248,1248:576,576:1248,1280:576,576:1280,1408:704,704:1408,' +
      '2048:2048,2816:1584,1584:2816,2368:1776,1776:2368,2496:1664,1664:2496,2912:1344,1344:2912,3200:1440,1440:3200,2912:1456,1456:2912', 13),
    dflt: '2K', send: true,
  },
  // Gen-4 Image: 16 pairs, no tiers in the schema. Split by short side, 768 or less is the 720p
  // price (5 credits), the rest the 1080p price (8): INFERRED from the pairs' names.
  gen4_image: {
    model: 'gen4_image', kind: 'still_variation', roles: ['ref'], refs: 3, promptMax: 1000,
    tiers: [
      { word: '720p', ratios: P('1280:720,720:1280,720:720,960:720,720:960,1680:720,1360:768,1808:768') },
      { word: '1080p', ratios: P('1920:1080,1080:1920,1080:1080,1440:1080,1080:1440,2112:912,1168:880,1024:1024') },
    ],
    dflt: '1080p', send: true,
  },
  // Higgsfield. `flux_2` has `variant` pro | flex | max (LITERAL); the preset is "max", so the
  // door's row for hf.flux_2 must pin variant "max" (the body has no field for it). Its
  // reference and prompt limits are not listed: 8 and 4000 are the app's old figures (INFERRED).
  'hf.flux_2': {
    model: 'hf.flux_2', kind: 'still_variation', roles: ['ref'], refs: 8, promptMax: 4000,
    tiers: [
      { word: '1k', ratios: P('1:1,4:3,3:4,16:9,9:16') },
      { word: '2k', ratios: P('1:1,4:3,3:4,16:9,9:16') },
    ],
    dflt: '2k', send: true,
  },
  // Videos, Runway.
  'gen4.5': {
    model: 'gen4.5', kind: 'image_to_video', roles: ['first'], refs: 1, promptMax: 1000,
    tiers: [{ word: '720p', ratios: P('1280:720,720:1280,1104:832,960:960,832:1104,1584:672') }],
    dflt: '720p', send: false, seconds: { min: 2, max: 10 },
  },
  gen4_turbo: {
    model: 'gen4_turbo', kind: 'image_to_video', roles: ['first'], refs: 1, promptMax: 1000,
    tiers: [{ word: '720p', ratios: P('1280:720,720:1280,1104:832,832:1104,960:960,1584:672') }],
    dflt: '720p', send: false, seconds: { min: 2, max: 10 },
  },
  // Veo is priced flat per second, so the app's 720p/1080p only picks the pair.
  'veo3.1': veoRow('veo3.1'),
  'veo3.1_fast': veoRow('veo3.1_fast'),
  // Seedance: 6 | 6 | 6 | 6 by position (INFERRED tier by position); the 4K group is not priced on 2.5.
  seedance2: {
    model: 'seedance2', kind: 'image_to_video', roles: ['first', 'last', 'ref'], refs: 9, promptMax: 10000,
    tiers: groups(['480p', '720p', '1080p', '4K'],
      '992:432,864:496,752:560,640:640,560:752,496:864,' +
      '1470:630,1280:720,1112:834,960:960,834:1112,720:1280,' +
      '2206:946,1920:1080,1664:1248,1440:1440,1248:1664,1080:1920,' +
      '3840:1646,3840:2160,3840:2880,3840:3840,2880:3840,2160:3840', 6),
    dflt: '1080p', send: true, seconds: { min: 4, max: 15 },
  },
  seedance2_fast: {
    model: 'seedance2_fast', kind: 'image_to_video', roles: ['first', 'last', 'ref'], refs: 9, promptMax: 10000,
    tiers: groups(['480p', '720p'],
      '992:432,864:496,752:560,640:640,560:752,496:864,' +
      '1470:630,1280:720,1112:834,960:960,834:1112,720:1280', 6),
    dflt: '720p', send: true, seconds: { min: 4, max: 15 },
  },
  seedance2_5: {
    model: 'seedance2_5', kind: 'image_to_video', roles: ['first', 'last', 'ref'], refs: 30, promptMax: 15000,
    tiers: groups(['480p', '720p', '1080p'],
      '992:432,854:480,752:560,640:640,560:752,480:854,' +
      '1470:630,1280:720,1112:834,960:960,834:1112,720:1280,' +
      '2206:946,1920:1080,1664:1248,1440:1440,1248:1664,1080:1920', 6),
    dflt: '1080p', send: true, seconds: { min: 4, max: 30 },
  },
  // Kling: the tier is the model, no resolution is sent (LITERAL).
  'kling3.0_pro': {
    model: 'kling3.0_pro', kind: 'image_to_video', roles: ['first', 'last'], refs: 2, promptMax: 2500,
    tiers: [{ word: '1080p', ratios: P('1920:1080,1080:1920,1440:1440') }],
    dflt: '1080p', send: false, seconds: { min: 3, max: 15 },
  },
  'kling3.0_4k': {
    model: 'kling3.0_4k', kind: 'image_to_video', roles: ['first', 'last'], refs: 2, promptMax: 2500,
    tiers: [{ word: '4K', ratios: P('3840:2160,2160:3840,2880:2880') }],
    dflt: '4K', send: false, seconds: { min: 3, max: 15 },
  },
  klingO3_pro: {
    model: 'klingO3_pro', kind: 'image_to_video', roles: ['first', 'last'], refs: 2, promptMax: 2500,
    tiers: [{ word: '1080p', ratios: P('1920:1080,1080:1920,1440:1440') }],
    dflt: '1080p', send: false, seconds: { min: 3, max: 15 },
  },
  // MiniMax H3 is `hailuo3` on Runway; ratios are labels, not pairs.
  hailuo3: {
    model: 'hailuo3', kind: 'image_to_video', roles: ['first', 'last', 'ref'], refs: 9, promptMax: 6000,
    tiers: [
      { word: '768p', ratios: P('21:9,16:9,4:3,1:1,3:4,9:16') },
      { word: '2k', ratios: P('21:9,16:9,4:3,1:1,3:4,9:16') },
    ],
    dflt: '2k', send: true, seconds: { min: 5, max: 15 }, adaptive: true,
  },
  // Wan 2.6 is not on Runway (it has wan3); Higgsfield's `wan2_6` lists 16:9, 9:16, 1:1, quality
  // 720p | 1080p, duration 5 | 10 | 15 and one image_references picture (LITERAL). That picture
  // is not typed as a first frame, so it goes as a `ref`. Prompt limit INFERRED (the app's 4000).
  'hf.wan2_6': {
    model: 'hf.wan2_6', kind: 'image_to_video', roles: ['ref'], refs: 1, promptMax: 4000,
    tiers: [
      { word: '720p', ratios: P('16:9,9:16,1:1') },
      { word: '1080p', ratios: P('16:9,9:16,1:1') },
    ],
    dflt: '1080p', send: true, seconds: { list: [5, 10, 15] },
  },
  // Upscalers.
  magnific_precision_upscaler_v2: {
    model: 'magnific_precision_upscaler_v2', kind: 'still_upscale', roles: ['image'], refs: 1, promptMax: 0,
    tiers: [{ word: '', ratios: [] }], dflt: '', send: false,
  },
  // Higgsfield's `upscale_image`: resolution 2k | 4k, provider bytedance (V5-HIGGSFIELD.md,
  // UNCONFIRMED: no price seen). The app's 2x maps to 2k and 4x to 4k (INFERRED).
  'hf.upscale_image': {
    model: 'hf.upscale_image', kind: 'still_upscale', roles: ['image'], refs: 1, promptMax: 0,
    tiers: [{ word: '2k', ratios: [] }, { word: '4k', ratios: [] }], dflt: '4k', send: true,
  },
} as const satisfies Record<string, Row>;

function gptRow(model: string): Row {
  return {
    model, kind: 'still_variation', roles: ['ref'], refs: 16, promptMax: 32000,
    tiers: groups(['1K', '2K', '4K'],
      '2048:880,1920:1088,1920:1280,1920:1440,1920:1536,1920:1920,1536:1920,1440:1920,1280:1920,1088:1920,' +
      '2912:1248,2560:1440,2560:1712,2560:1920,2560:2048,2560:2560,2048:2560,1920:2560,1712:2560,1440:2560,' +
      '3840:1648,3840:2160,3504:2336,3264:2448,3200:2560,2880:2880,2560:3200,2448:3264,2336:3504,2160:3840', 10),
    dflt: '2K', send: true,
  };
}

function veoRow(model: string): Row {
  return {
    model, kind: 'image_to_video', roles: ['first', 'last'], refs: 2, promptMax: 1000,
    tiers: [
      { word: '720p', ratios: P('1280:720,720:1280') },
      { word: '1080p', ratios: P('1920:1080,1080:1920') },
    ],
    dflt: '1080p', send: false, seconds: { list: [4, 6, 8] },
  };
}

/** Every model id the table can send, for the tests and for T69's table. */
export const ROUTED_MODELS: readonly string[] = Object.values(ROW).map((r) => r.model);

// ---------------------------------------------------------------------------
// Reading the options the call sites send

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.map(obj) : []);

/** The prompt, whichever name the call site gave it. */
const promptOf = (o: Record<string, unknown>): string => str(o['text_prompt']) || str(o['textPrompt']) || str(o['prompt']);

/** Size words: "1k", "2K", "1080p", "768P", "512px" and the bare "1", "2", "4" (megapixels or K) as a number to order by. */
function rank(word: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(k|p|px|mp)?$/i.exec(word.trim());
  if (!m) return NaN;
  const n = Number(m[1]);
  const u = (m[2] ?? 'k').toLowerCase();
  return u === 'k' || u === 'mp' ? n * 1000 : n;
}

/** The row's tier for what the app asked: the nearest not above, else the lowest; none asked, the default. */
function tierOf(row: Row, asked: unknown): Tier {
  const word = typeof asked === 'string' ? asked : '';
  const want = rank(word);
  const first = row.tiers[0]!;
  if (row.tiers.length === 1) return first;
  if (!Number.isFinite(want)) return row.tiers.find((t) => t.word === row.dflt) ?? first;
  let pick: Tier | undefined;
  for (const t of row.tiers) if (rank(t.word) <= want) pick = t;
  return pick ?? first;
}

/** The ratio of the tier nearest the shape asked for (a label, a pair, or a width and a height). */
function ratioIn(row: Row, tier: Tier, shape: unknown, width?: number, height?: number): string | undefined {
  if (row.adaptive && shape === 'adaptive') return 'adaptive';
  if (tier.ratios.length === 0) return undefined;
  const target = ratioValue(shape) ?? (width && height ? width / height : 16 / 9);
  return tier.ratios[nearest(tier.ratios, target)];
}

/** `seconds` to the row's nearest allowed length (the shorter on a tie). */
function secondsIn(row: Row, asked: unknown): number | undefined {
  const s = row.seconds;
  const n = num(asked);
  if (!s || n === undefined) return undefined;
  if ('list' in s) return s.list.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best));
  return Math.min(s.max, Math.max(s.min, Math.round(n)));
}

/** Keep the pictures the row can take: wrong roles out, then the most it allows (the tail goes first). */
function fit(row: Row, inputs: EngineInput[]): EngineInput[] {
  return inputs.filter((i) => row.roles.includes(i.role)).slice(0, row.refs);
}

function body(row: Row, o: Record<string, unknown>, parts: {
  inputs: EngineInput[];
  prompt?: string;
  seconds?: unknown;
  res?: unknown;
  shape?: unknown;
  width?: number;
  height?: number;
}): Routed {
  const tier = tierOf(row, parts.res);
  const out: EngineBody = {
    model: row.model,
    kind: row.kind,
    inputs: fit(row, parts.inputs),
    prompt: row.promptMax > 0 ? clampPrompt(parts.prompt ?? promptOf(o), row.promptMax) : '',
  };
  const seconds = secondsIn(row, parts.seconds);
  if (seconds !== undefined) out.seconds = seconds;
  const ratio = ratioIn(row, tier, parts.shape, parts.width, parts.height);
  if (ratio !== undefined) out.ratio = ratio;
  if (row.send) out.resolution = tier.word;
  return { engine: out };
}

// ---------------------------------------------------------------------------
// Stills

const MP = (v: unknown): unknown => (typeof v === 'string' && /^\d+$/.test(v) ? `${v}K` : v);

function still(row: Row, o: Record<string, unknown>): Routed {
  const refs = list(o['reference_images'] ?? o['referenceImages']);
  // The render first, then the cast sheet, then the light reference: over the limit, the tail goes
  // first, so the light reference leaves before the cast sheet and the render always stays.
  return body(row, o, {
    inputs: refs.map((r): EngineInput => ({ url: str(r['url']), role: 'ref' })),
    res: MP(o['image_size'] ?? o['resolution'] ?? o['size']),
    shape: o['aspect_ratio'] ?? o['aspectRatio'],
    width: num(o['width']),
    height: num(o['height']),
  });
}

/** Gen-4 Image sends a size, not a resolution: the size says which price tier. */
function gen4Image(o: Record<string, unknown>): Routed {
  const w = num(o['width']);
  const h = num(o['height']);
  const hd = w && h ? Math.min(w, h) >= 1000 : true;
  const refs = list(o['reference_images']);
  return body(ROW.gen4_image, o, {
    inputs: refs.map((r): EngineInput => ({ url: str(r['url']), role: 'ref' })),
    res: hd ? '1080p' : '720p',
    width: w,
    height: h,
  });
}

// ---------------------------------------------------------------------------
// Clips

/** Seedance and MiniMax: typed first and end frames, or the frame and extras as plain references. */
function frameRefs(o: Record<string, unknown>): EngineInput[] {
  const refs = list(o['referenceImages']);
  if (refs.some((r) => r['type'] === 'first_frame' || r['type'] === 'end_frame')) {
    return refs.map((r): EngineInput => ({ url: str(r['url']), role: r['type'] === 'end_frame' ? 'last' : r['type'] === 'first_frame' ? 'first' : 'ref' }));
  }
  // Plain references: a frame alone is the first frame; with extras they are all references in order
  // (the prompt says "image 1 is the opening photograph"), as the app has always sent them.
  return refs.map((r): EngineInput => ({ url: str(r['url']), role: refs.length === 1 ? 'first' : 'ref' }));
}

function seedance(row: Row, o: Record<string, unknown>): Routed {
  return body(row, o, { inputs: frameRefs(o), seconds: o['duration'], res: o['resolution'], shape: o['aspectRatio'] });
}

function kling(row: Row, o: Record<string, unknown>): Routed {
  // First picture the first frame, a second one (3.0 only) the last frame.
  const refs = list(o['referenceImages']);
  return body(row, o, {
    inputs: refs.map((r, i): EngineInput => ({ url: str(r['url']), role: i === 0 ? 'first' : 'last' })),
    seconds: o['duration'],
    shape: o['aspectRatio'],
  });
}

function gen4Clip(row: Row, o: Record<string, unknown>): Routed {
  // The k2v route sends timed keyframes: the earliest is the first frame; a last frame and the
  // frames in between are not on the public API, so they are left out and the job still goes.
  const keys = list(o['keyframes']);
  let first = str(o['init_image']);
  if (!first && keys.length > 0) {
    const earliest = keys.reduce((a, b) => ((num(b['timestamp']) ?? 0) < (num(a['timestamp']) ?? 0) ? b : a));
    first = str(earliest['image']);
  }
  return body(row, o, {
    inputs: [{ url: first, role: 'first' }],
    seconds: o['seconds'],
    width: num(o['width']),
    height: num(o['height']),
  });
}

function veo(o: Record<string, unknown>): Routed {
  const row = o['model'] === 'veo-3.1-fast' ? ROW['veo3.1_fast'] : ROW['veo3.1'];
  const inputs: EngineInput[] = [{ url: str(obj(o['startFrame'])['url']), role: 'first' }];
  if (o['endFrame']) inputs.push({ url: str(obj(o['endFrame'])['url']), role: 'last' });
  return body(row, o, { inputs, seconds: o['seconds'], res: o['resolution'], shape: o['aspectRatio'] });
}

function wan(o: Record<string, unknown>): Routed {
  // The size comes as "1920x1080": 1440 and up is the 1080p quality, below it 720p.
  const m = /^(\d+)x(\d+)$/.exec(str(o['resolution']));
  const w = m ? Number(m[1]) : undefined;
  const h = m ? Number(m[2]) : undefined;
  const refs = list(o['referenceImages']);
  return body(ROW['hf.wan2_6'], o, {
    inputs: refs.slice(0, 1).map((r): EngineInput => ({ url: str(r['url']), role: 'ref' })),
    seconds: o['duration'],
    res: w && h && Math.max(w, h) >= 1440 ? '1080p' : '720p',
    width: w,
    height: h,
  });
}

// ---------------------------------------------------------------------------
// Upscalers

/** The longest side a Precision result may have: past it the price jumps from 25 to 150 credits. */
export const PRECISION_MAX_SIDE = 4096;

/**
 * `sourceLongSide` is the caller's best figure for the long side of the picture
 * to upscale. With it, the factor is lowered until the result stays within
 * PRECISION_MAX_SIDE; without it, the factor goes as asked.
 */
function precision(o: Record<string, unknown>): Routed {
  const image = obj(o['image']);
  const asked = num(o['scaleFactor']) === 4 ? 4 : 2;
  const side = num(o['sourceLongSide']);
  let scale = asked;
  if (side !== undefined && side > 0) {
    const ok = [4, 2].find((f) => f <= asked && side * f <= PRECISION_MAX_SIDE);
    if (ok === undefined) return { dropped: 'This picture is already as large as the upscaler goes here.' };
    scale = ok;
  }
  return {
    engine: {
      model: ROW.magnific_precision_upscaler_v2.model,
      kind: 'still_upscale',
      inputs: [{ url: str(image['url']), role: 'image' }],
      prompt: '',
      scale,
    },
  };
}

function creative(o: Record<string, unknown>): Routed {
  const image = obj(o['image']);
  return {
    engine: {
      model: ROW['hf.upscale_image'].model,
      kind: 'still_upscale',
      inputs: [{ url: str(image['url']), role: 'image' }],
      prompt: '',
      resolution: num(o['scaleFactor']) === 4 ? '4k' : '2k',
    },
  };
}

// ---------------------------------------------------------------------------

const NOT_AVAILABLE = 'This kind of job is not available on this Mac yet.';

export function routeTask(type: string, options: Record<string, unknown>, _models?: ModelList): Routed {
  const o = options ?? {};
  switch (type) {
    // Stills
    case 'ref_image_to_image': return gen4Image(o);
    case 'gemini_3_pro': return still(ROW.gemini_image3_pro, o);
    case 'gemini_3_1_flash_image': return still(ROW['gemini_image3.1_flash'], o);
    case 'nano_banana_2_1': return still(ROW['nano_banana_2.1'], o);
    case 'gpt_image_2': return still(ROW.gpt_image_2, o);
    case 'gpt_image_2_5_sunburst': return still(ROW.gpt_image_2_5_sunburst, o);
    case 'gpt_image_2_5_flare': return still(ROW.gpt_image_2_5_flare, o);
    case 'seedream_5_pro': return still(ROW.seedream5_pro, o);
    case 'seedream_5': return still(ROW.seedream5_lite, o);
    case 'bfl_flux_2_max': return still(ROW['hf.flux_2'], o);
    case 'grok_imagine_image_2': return still(ROW.grok_imagine_image_2, o);
    // Clips
    case 'seedance_2': return seedance(ROW.seedance2, o);
    case 'seedance_2_fast': return seedance(ROW.seedance2_fast, o);
    case 'seedance_2_5': return seedance(ROW.seedance2_5, o);
    case 'kling_3_0_pro': return kling(ROW['kling3.0_pro'], o);
    case 'kling_3_0_4k': return kling(ROW['kling3.0_4k'], o);
    case 'kling_o3_pro': return kling(ROW.klingO3_pro, o);
    case 'gen4.5': return gen4Clip(ROW['gen4.5'], o);
    case 'gen4_turbo': return gen4Clip(ROW.gen4_turbo, o);
    case 'veo3_1': return veo(o);
    case 'minimax_hailuo_3_0': return body(ROW.hailuo3, o, { inputs: frameRefs(o), seconds: o['duration'], res: o['resolution'], shape: o['ratio'] });
    case 'wan_2_6': return wan(o);
    // Upscalers
    case 'magnific_precision_upscaler_v2': return precision(o);
    case 'magnific_creative_upscaler': return creative(o);
    // Not through the door
    case 'claude_api': return { claude: o };
    case 'media_processing_v2': return { media: o };
    default: {
      // Presets and task types that are dropped (krea_image_3, ltx_2_5_pro, clip upscale, Aleph).
      const sentence = droppedSentence(DROPPED_BY_TYPE[type] ?? type);
      return { dropped: sentence ?? NOT_AVAILABLE };
    }
  }
}

/** Dropped task types whose name differs from the preset id in `DROPPED`. */
const DROPPED_BY_TYPE: Record<string, string> = {
  krea_image_3: 'krea-image-3',
  ltx_2_5_pro: 'ltx-2-5-pro',
};

export const routing = { routeTask, snapAspectRatio };
export type Routing = typeof routing;
