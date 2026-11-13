/**
 * The pure half of the money on the screens (K24.11): what to ask
 * `engine.prices`, how to add the answers up, and whether a spending button
 * may be pressed. Kept free of React so plain Node can test it
 * (`lib/spend.test.ts`). The words come from `src/local/prices.ts`, so the
 * screens and the server say the same thing.
 */
import { ALLOW_SENTENCE, NOT_LISTED, PRICE_UNKNOWN, priceWords } from '../../local/prices.ts';

/** One buy: a preset (the id the pickers use), what changes its price, and how many are made. */
export type PriceItem = {
  preset: string;
  seconds?: number | undefined;
  resolution?: string | undefined;
  scale?: number | undefined;
  /** How many of it (default 1). Not sent to the server: the screen multiplies. */
  count?: number | undefined;
};

/** What `engine.prices` takes: one ask, no count. */
export type PriceAsk = Omit<PriceItem, 'count'>;

/** The most `engine.prices` takes in one call. */
export const MAX_ASKS = 60;

/** Items with equal asks joined, counts added; items that make nothing (count under 1) dropped. */
export function groupItems(items: readonly PriceItem[]): Array<{ ask: PriceAsk; count: number }> {
  const byKey = new Map<string, { ask: PriceAsk; count: number }>();
  for (const it of items) {
    const count = Math.floor(it.count ?? 1);
    if (!(count >= 1) || !it.preset) continue;
    const ask: PriceAsk = { preset: it.preset };
    if (it.seconds !== undefined) ask.seconds = it.seconds;
    if (it.resolution !== undefined) ask.resolution = it.resolution;
    if (it.scale !== undefined) ask.scale = it.scale;
    const key = JSON.stringify(ask);
    const seen = byKey.get(key);
    if (seen) seen.count += count;
    else byKey.set(key, { ask, count });
  }
  return [...byKey.values()].slice(0, MAX_ASKS);
}

/**
 * The words for the sum of the answers, in the order `groupItems` gave the
 * asks. Any missing price makes the whole "Price unknown": a total of only
 * some of the buys would tell the owner less than the truth.
 */
export function totalOf(
  groups: ReadonlyArray<{ count: number }>,
  answers: ReadonlyArray<{ cents: number | null } | undefined> | undefined
): { cents: number | null; words: string } {
  if (groups.length === 0) return { cents: 0, words: priceWords(0) };
  if (!answers || answers.length !== groups.length) return { cents: null, words: PRICE_UNKNOWN };
  let sum = 0;
  for (let i = 0; i < groups.length; i++) {
    const c = answers[i]?.cents;
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0) return { cents: null, words: PRICE_UNKNOWN };
    sum += c * groups[i]!.count;
  }
  return { cents: sum, words: priceWords(sum) };
}

export type AllowanceRead = { open: boolean; needs: string | null } | undefined;
export type ModelRead = { preset: string; ready: boolean; why: string | null };

/**
 * May the spending button be pressed? Not while the allowance is unread or
 * closed (the sentence is K23's), and not when a preset it uses is not ready
 * (the door's own reason). `why` is null while still reading: the button is
 * held, but there is nothing to tell yet.
 */
export function gateOf(
  presets: readonly string[],
  allowance: AllowanceRead,
  models: readonly ModelRead[] | undefined
): { blocked: boolean; why: string | null } {
  if (!allowance) return { blocked: true, why: null };
  if (!allowance.open) return { blocked: true, why: allowance.needs ?? ALLOW_SENTENCE };
  if (!models) return { blocked: true, why: null };
  for (const preset of presets) {
    const row = models.find((m) => m.preset === preset);
    if (row && !row.ready) return { blocked: true, why: row.why ?? NOT_LISTED };
  }
  return { blocked: false, why: null };
}
