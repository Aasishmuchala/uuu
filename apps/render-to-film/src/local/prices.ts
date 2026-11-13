/**
 * Money on the screens (K24.11): what a button will cost, whether its model is
 * ready, and what the owner has allowed this app to spend today.
 *
 * A preset (a picture model, a clip model or an upscaler, by the id the pickers
 * use) and its options become a "probe": the task type and options the call
 * site would send. `routeTask` turns the probe into the engine's row, the
 * engine's `POST /gen/app/estimate` prices the row from its table (no call out,
 * nothing spent), and the cents become words. Everything the engine is asked
 * goes through the injected `engine`, so the tests use a fake. Only `node:`
 * imports and erasable TypeScript, so the tests run on plain Node.
 */
import {
  defaultImageResolution,
  defaultVideoResolution,
  defaultVideoSeconds,
  IMAGE_MODELS,
  type ImageModelId,
  snapVideoSeconds,
  STILL_UPSCALERS,
  VIDEO_MODELS,
  type VideoModelId,
} from '../models.ts';
import type { Engine } from './engine.ts';
import { routeTask } from './routing.ts';

// ---------------------------------------------------------------------------
// The words (K23)

export const PRICE_UNKNOWN = 'Price unknown';
export const ALLOW_SENTENCE = 'Allow spending in the bar above.';
export const NO_SPENDING = 'This app cannot spend anything right now.';
export const NEEDS_RUNWAY_KEY = 'Needs a Runway key. Add it in Settings on the home screen.';
export const NEEDS_HIGGSFIELD = 'Needs Higgsfield. Switch it on and sign in from Settings on the home screen.';
export const ENGINE_UNREACHABLE = 'The engine could not be reached.';
export const NOT_LISTED = 'This model is not available right now.';

/** US cents as dollars: 40 -> "$0.40", 1999 -> "$19.99". */
export function dollars(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  return `$${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

/** The words beside a button: "About $0.40", or "Price unknown" when there is no price. */
export function priceWords(cents: number | null | undefined): string {
  return typeof cents === 'number' && Number.isFinite(cents) && cents >= 0 ? `About ${dollars(cents)}` : PRICE_UNKNOWN;
}

/** The allowance, as the bar and the header chip say it. */
export type Allowance = {
  open: boolean;
  /** Cents. */
  budget: number;
  spent: number;
  left: number;
  expiresAt: string | null;
  words: string;
  /** What a disabled spending button says while the allowance is closed. */
  needs: string | null;
};

export function allowanceWords(a: { open: boolean; budget: number; spent: number }): string {
  return a.open ? `Allowed today: ${dollars(a.budget)}. Spent: ${dollars(a.spent)}.` : NO_SPENDING;
}

const nonNeg = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** The door's `GET /gen/app/allowance` answer as the screens read it; anything unreadable is closed. */
export function readAllowance(json: any): Allowance {
  const open = json?.open === true;
  const budget = nonNeg(json?.budget);
  const spent = nonNeg(json?.spent);
  const left = open ? (typeof json?.left === 'number' ? nonNeg(json.left) : Math.max(0, budget - spent)) : 0;
  const expiresAt = open && typeof json?.expiresAt === 'string' ? json.expiresAt : null;
  return { open, budget: open ? budget : 0, spent: open ? spent : 0, left, expiresAt, words: allowanceWords({ open, budget, spent }), needs: open ? null : ALLOW_SENTENCE };
}

// ---------------------------------------------------------------------------
// A preset and its options -> the task the call site would send

/** What the pickers know about one buy: the preset's id and the options that change its price. */
export type PriceAsk = {
  preset: string;
  seconds?: number | undefined;
  resolution?: string | undefined;
  /** An upscaler's factor, 2 or 4. */
  scale?: number | undefined;
};

export type Probe = { type: string; options: Record<string, unknown> };

const PICTURE = { url: '/files/probe.jpg' };

/**
 * The task type and options the app's call sites send for `ask`, written
 * with only the fields that decide the price. null for a preset nothing here
 * routes (a clip upscaler, an unknown id).
 */
export function probeOf(ask: PriceAsk): Probe | null {
  const image = IMAGE_MODELS.find((m) => m.id === ask.preset);
  if (image) {
    const res = ask.resolution ?? defaultImageResolution(image.id as ImageModelId);
    return {
      type: image.alias,
      options: {
        reference_images: [{ tag: 'render', url: PICTURE.url }],
        image_size: res,
        width: 1280,
        height: 720,
      },
    };
  }
  const video = VIDEO_MODELS.find((m) => m.id === ask.preset);
  if (video) {
    const id = video.id as VideoModelId;
    const res = ask.resolution ?? defaultVideoResolution(id);
    const seconds = snapVideoSeconds(id, ask.seconds ?? defaultVideoSeconds(id));
    switch (video.alias) {
      case 'seedance_2':
      case 'seedance_2_fast':
      case 'seedance_2_5':
        return { type: video.alias, options: { referenceImages: [{ ...PICTURE, type: 'first_frame' }], resolution: res, aspectRatio: '16:9', duration: seconds } };
      case 'minimax_hailuo_3_0':
        return { type: video.alias, options: { referenceImages: [{ ...PICTURE, type: 'first_frame' }], resolution: res === '768p' ? '768P' : '2K', duration: seconds } };
      case 'kling_3_0_pro':
      case 'kling_3_0_4k':
      case 'kling_o3_pro':
        return { type: video.alias, options: { referenceImages: [PICTURE], aspectRatio: '16:9', duration: seconds } };
      case 'gen4.5':
      case 'gen4_turbo':
        return { type: video.alias, options: { route: 'i2v', init_image: PICTURE.url, seconds, width: 1280, height: 720 } };
      case 'veo3_1':
        return {
          type: video.alias,
          options: {
            model: id === 'veo-3-1-fast' ? 'veo-3.1-fast' : 'veo-3.1',
            startFrame: PICTURE,
            seconds: seconds === 4 || seconds === 6 ? seconds : 8,
            aspectRatio: '16:9',
            resolution: res,
          },
        };
      case 'wan_2_6':
        return {
          type: video.alias,
          options: {
            referenceImages: [PICTURE],
            resolution: res === '720p' ? '1280x720' : '1920x1080',
            duration: seconds === 15 ? 15 : seconds === 10 ? 10 : 5,
          },
        };
      default:
        return null;
    }
  }
  const up = STILL_UPSCALERS.find((u) => u.id === ask.preset);
  if (up) return { type: up.alias, options: { image: { ...PICTURE, tag: 'still' }, scaleFactor: ask.scale === 4 ? 4 : 2 } };
  return null;
}

/** What `/gen/app/estimate` takes for one buy. */
export type EstimateItem = {
  model: string;
  kind: string;
  seconds?: number | undefined;
  resolution?: string | undefined;
  scale?: number | undefined;
};

/** The engine row for `ask`, as an estimate item; null when the preset is dropped or unknown. */
export function estimateItemOf(ask: PriceAsk): EstimateItem | null {
  const probe = probeOf(ask);
  if (!probe) return null;
  const routed = routeTask(probe.type, probe.options);
  if (!('engine' in routed)) return null;
  const e = routed.engine;
  const item: EstimateItem = { model: e.model, kind: e.kind };
  if (e.seconds !== undefined) item.seconds = e.seconds;
  if (e.resolution !== undefined) item.resolution = e.resolution;
  if (e.scale !== undefined) item.scale = e.scale;
  return item;
}

// ---------------------------------------------------------------------------
// The three calls

export type PriceAnswer = { preset: string; cents: number | null; words: string };

/** Every preset the pickers offer, by id: the key `engine.models` answers by. */
export function offeredPresets(): string[] {
  return [
    ...IMAGE_MODELS.map((m) => m.id as string),
    ...VIDEO_MODELS.map((m) => m.id as string),
    ...STILL_UPSCALERS.map((u) => u.id as string),
  ];
}

export type ModelReady = { preset: string; model: string | null; ready: boolean; why: string | null };

const ESTIMATE_BATCH = 20;
const MODELS_CACHE_MS = 30_000;

function doorSentence(json: any, fallback: string): string {
  const e = json?.error;
  const m = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : '';
  return (m || fallback).replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function createPrices(deps: { engine: Pick<Engine, 'json'>; now?: () => number }) {
  const now = deps.now ?? Date.now;
  let cache: { at: number; list: Array<Record<string, any>> | null; why: string } | null = null;

  async function doorModels() {
    if (cache && now() - cache.at < MODELS_CACHE_MS) return cache;
    let list: Array<Record<string, any>> | null = null;
    let why = ENGINE_UNREACHABLE;
    try {
      const r = await deps.engine.json('GET', '/gen/app/models');
      if (r.status === 200 && Array.isArray(r.json?.models)) list = r.json.models;
      else why = doorSentence(r.json, ENGINE_UNREACHABLE);
    } catch {
      list = null;
    }
    cache = { at: now(), list, why };
    return cache;
  }

  /** Each offered preset: its engine model and whether the door says it is ready (with the door's reason). */
  async function models(): Promise<ModelReady[]> {
    const { list, why } = await doorModels();
    return offeredPresets().map((preset): ModelReady => {
      const item = estimateItemOf({ preset });
      if (!item) return { preset, model: null, ready: false, why: NOT_LISTED };
      if (!list) return { preset, model: item.model, ready: false, why };
      const row = list.find((m) => m['id'] === item.model);
      if (!row) return { preset, model: item.model, ready: false, why: NOT_LISTED };
      const ready = row['ready'] === true;
      const reason = typeof row['why'] === 'string' && row['why'] ? row['why'] : item.model.startsWith('hf.') ? NEEDS_HIGGSFIELD : NEEDS_RUNWAY_KEY;
      return { preset, model: item.model, ready, why: ready ? null : reason };
    });
  }

  /** Prices for a list of buys. A dropped preset, a refusal or an unreadable answer is "Price unknown". */
  async function prices(asks: PriceAsk[]): Promise<PriceAnswer[]> {
    const unknown = (preset: string): PriceAnswer => ({ preset, cents: null, words: PRICE_UNKNOWN });
    const out: PriceAnswer[] = asks.map((a) => unknown(a.preset));
    const todo: Array<{ at: number; item: EstimateItem }> = [];
    asks.forEach((a, at) => {
      const item = estimateItemOf(a);
      if (item) todo.push({ at, item });
    });
    for (let i = 0; i < todo.length; i += ESTIMATE_BATCH) {
      const batch = todo.slice(i, i + ESTIMATE_BATCH);
      let r;
      try {
        r = await deps.engine.json('POST', '/gen/app/estimate', { items: batch.map((b) => b.item) });
      } catch {
        continue;
      }
      const items = r.status === 200 && Array.isArray(r.json?.items) ? r.json.items : null;
      if (!items || items.length !== batch.length) continue;
      batch.forEach((b, k) => {
        const c = items[k]?.cents;
        if (typeof c === 'number' && Number.isFinite(c) && c >= 0) {
          out[b.at] = { preset: asks[b.at]!.preset, cents: Math.round(c), words: priceWords(c) };
        }
      });
    }
    return out;
  }

  async function allowance(): Promise<Allowance> {
    try {
      const r = await deps.engine.json('GET', '/gen/app/allowance');
      return readAllowance(r.status === 200 ? r.json : null);
    } catch {
      return readAllowance(null);
    }
  }

  return { models, prices, allowance };
}

export type Prices = ReturnType<typeof createPrices>;
