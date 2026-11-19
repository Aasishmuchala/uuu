/**
 * This app's five models and the size rules that decide what each job asks
 * for: the enhance size class, the nearest ratio the door's row offers, the
 * master's target and upscale factor, and the shot's frame. Pure.
 */
import type { FilmFormat, ImageSettings, MasterRun } from '../shared/project.ts';
import type { DoorModel } from '../local/door.ts';

export const ENHANCE_MODELS = ['gemini_image3_pro', 'nano_banana_2.1', 'gemini_image3.1_flash'] as const;
export type EnhanceModel = (typeof ENHANCE_MODELS)[number];
export const DEFAULT_ENHANCE_MODEL: EnhanceModel = 'gemini_image3_pro';
export const MASTER_MODEL = 'magnific_precision_upscaler_v2';
export const SHOT_MODEL = 'gen4.5';

export const APP_MODELS = [...ENHANCE_MODELS, MASTER_MODEL, SHOT_MODEL] as const;
export type AppModel = (typeof APP_MODELS)[number];
export type ModelRole = 'enhance' | 'master' | 'shot';

/** Each model: its job kind, the role its one picture takes, and its words when the door gives none. */
export const MODEL_INFO: Record<AppModel, { role: ModelRole; kind: string; inputRole: string; words: string }> = {
  gemini_image3_pro: { role: 'enhance', kind: 'still_variation', inputRole: 'ref', words: 'Nano Banana Pro on Runway' },
  'nano_banana_2.1': { role: 'enhance', kind: 'still_variation', inputRole: 'ref', words: 'Nano Banana 2.1 on Runway' },
  'gemini_image3.1_flash': { role: 'enhance', kind: 'still_variation', inputRole: 'ref', words: 'Nano Banana 2 on Runway' },
  magnific_precision_upscaler_v2: { role: 'master', kind: 'still_upscale', inputRole: 'image', words: 'Magnific Precision upscale on Runway' },
  'gen4.5': { role: 'shot', kind: 'image_to_video', inputRole: 'first', words: 'Gen-4.5 on Runway' },
};

/** The upscaler's largest result. */
export const UPSCALE_MAX_SIDE = 4096;
export const UPSCALE_CAPPED =
  'The upscaler here stops at 4096 px, so this master stays at its approved size.';

export type SizeClass = '1K' | '2K' | '4K';

/** The smallest size class that covers a long edge: 1K to 1344, 2K to 2752, else 4K. */
export function sizeClassFor(longEdge: number): SizeClass {
  if (longEdge <= 1344) return '1K';
  if (longEdge <= 2752) return '2K';
  return '4K';
}

/** The size class an enhancement asks for (never `512px`, whatever the model). */
export function enhanceSize(settings: ImageSettings, image: { width: number; height: number }): SizeClass {
  if (settings.output === '4k') return '4K';
  if (settings.output === 'custom') return sizeClassFor(settings.customLongEdge);
  return sizeClassFor(Math.max(image.width, image.height));
}

/**
 * The pixel count of each size class, as a band: the door's rows list a size
 * class's ratios by area (1K about 1 MP, 2K about 4 MP, 4K about 16 MP), and
 * some 1K and 2K shapes have a long edge past the next class's bound
 * (1536:672 is 1K, 3168:1344 is 2K), so the long edge alone would misfile them.
 */
const AREA_BANDS: Record<SizeClass, [number, number]> = {
  '1K': [500_000, 2_000_000],
  '2K': [2_000_000, 8_000_000],
  '4K': [8_000_000, Infinity],
};

function parseRatio(r: string): [number, number] | null {
  const m = /^(\d{1,5}):(\d{1,5})$/.exec(r);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? [w, h] : null;
}

/** The ratios a row makes at `size`: its own per-size list when the door gives one, else by area. */
export function ratiosAt(row: DoorModel, size: string): string[] {
  const by = row.ratiosBy?.[size];
  if (Array.isArray(by)) return by.filter((r) => typeof r === 'string');
  const band = AREA_BANDS[size as SizeClass];
  if (!band || !Array.isArray(row.ratios)) return [];
  return row.ratios.filter((r) => {
    const p = typeof r === 'string' ? parseRatio(r) : null;
    if (!p) return false;
    const area = p[0] * p[1];
    return area > band[0] && area <= band[1];
  });
}

/** The ratio of `candidates` whose width over height is nearest the picture's (by logarithm); the first on a tie. */
export function nearestRatio(candidates: string[], width: number, height: number): string | null {
  const want = Math.log(width / height);
  let best: string | null = null;
  let bestGap = Infinity;
  for (const r of candidates) {
    const p = parseRatio(r);
    if (!p) continue;
    const gap = Math.abs(Math.log(p[0] / p[1]) - want);
    if (gap < bestGap) {
      best = r;
      bestGap = gap;
    }
  }
  return best;
}

/** The long edge a master is made to: 3840 for 4K, the upload's for original, the custom one for custom. */
export function masterTarget(settings: ImageSettings, image: { width: number; height: number }): number {
  if (settings.output === '4k') return 3840;
  if (settings.output === 'custom') return settings.customLongEdge;
  return Math.max(image.width, image.height);
}

export type MasterPlan = { reuse: true; capped: boolean } | { reuse: false; scale: 2 | 4 };

/**
 * How a master is made from an approved picture of long edge `side`:
 * reused when it already meets the target; else the smallest factor that
 * meets it within 4096 px; else, when 2x stays within 4096 px, the largest
 * factor that does; else reused at its approved size (`capped`).
 */
export function masterPlan(side: number, target: number): MasterPlan {
  if (side >= target) return { reuse: true, capped: false };
  const fits = ([2, 4] as const).filter((s) => side * s <= UPSCALE_MAX_SIDE);
  const meets = fits.find((s) => side * s >= target);
  if (meets) return { reuse: false, scale: meets };
  if (fits.length > 0) return { reuse: false, scale: fits[fits.length - 1]! };
  return { reuse: true, capped: true };
}

/** The sentence a master shows, if any: the 4096 one when it stayed below its target. */
export function masterNote(master: MasterRun | undefined): string | undefined {
  if (!master?.reusedEnhancement || !master.outputSize) return undefined;
  const side = Math.max(master.outputSize.width, master.outputSize.height);
  return side < master.targetLongEdge ? UPSCALE_CAPPED : undefined;
}

/** gen4.5's frame for each film format. */
export const SHOT_RATIOS: Record<FilmFormat, string> = {
  '16:9': '1280:720',
  '9:16': '720:1280',
  '1:1': '960:960',
};
