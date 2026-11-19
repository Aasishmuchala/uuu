/**
 * The pure half of the money on the screens: what to ask `money.quote` for
 * each spending button, how to add the answers up, and whether the button may
 * be pressed. Free of React so plain Node can test it (`spend.test.ts`).
 *
 * The door decides about money; these only decide what the page shows first.
 */
import {
  approvedEnhancement,
  type Project,
  type ProjectImage,
  type Shot,
} from '../../shared/project.ts';
import {
  type AppModel,
  type EnhanceModel,
  enhanceSize,
  MASTER_MODEL,
  masterPlan,
  masterTarget,
  MODEL_INFO,
  SHOT_MODEL,
} from '../../server/models.ts';
import { ALLOW_SENTENCE, CHECKING_PRICE, NOT_LISTED, PRICE_UNKNOWN, priceWords } from './words.ts';

export type QuoteKind = 'still_variation' | 'still_upscale' | 'image_to_video';

/** One buy as `money.quote` takes it. */
export type QuoteAsk = {
  model: AppModel;
  kind: QuoteKind;
  seconds?: number | undefined;
  resolution?: '1K' | '2K' | '4K' | undefined;
  scale?: 2 | 4 | undefined;
};

/** The most `money.quote` takes in one call. */
export const MAX_ASKS = 20;

/** An enhancement of `image` with `model`, at the size its settings ask for now. */
export function enhanceAsk(image: Pick<ProjectImage, 'settings' | 'width' | 'height'>, model: EnhanceModel): QuoteAsk {
  return { model, kind: MODEL_INFO[model].kind as QuoteKind, resolution: enhanceSize(image.settings, image) };
}

/**
 * What a master of `image` costs: nothing when the approved picture is already
 * at size (or past what the upscaler makes), else one upscale. `null` when
 * there is no approved picture to make it from.
 */
export type MasterCost =
  | { free: true; capped: boolean; target: number }
  | { free: false; ask: QuoteAsk; target: number };

export function masterCost(image: ProjectImage): MasterCost | null {
  const run = approvedEnhancement(image);
  if (!run || run.state !== 'succeeded' || !run.storedKey) return null;
  const target = masterTarget(run.settings, image);
  const ask: QuoteAsk = { model: MASTER_MODEL, kind: 'still_upscale' };
  // The size of the approved picture is learnt when it is kept; until then the upscale's price is shown.
  if (!run.outputSize) return { free: false, ask, target };
  const plan = masterPlan(Math.max(run.outputSize.width, run.outputSize.height), target);
  if (plan.reuse) return { free: true, capped: plan.capped, target };
  return { free: false, ask: { ...ask, scale: plan.scale }, target };
}

/** A clip of `shot`: its seconds at the model's rate. */
/** Why a clip button is held while a shot's new length is not yet saved. */
export const SAVING_LENGTH = 'Saving the new length.';

/**
 * A shot's "Make clip" is priced from its saved length. While a change of
 * length is on its way (the update is in flight, or the field shows another
 * length than the saved shot), a press would make the clip at a length the
 * price did not cover, so the button is held. REVIEW-APPS-ASTRYX finding 2.
 */
export function lengthHold(updating: boolean, draftSeconds: number, savedSeconds: number): string | null {
  return updating || draftSeconds !== savedSeconds ? SAVING_LENGTH : null;
}

export function shotAsk(shot: Pick<Shot, 'durationSeconds'>): QuoteAsk {
  return { model: SHOT_MODEL, kind: 'image_to_video', seconds: shot.durationSeconds };
}

/** Every ask this project still has to pay for to be finished, by kind. */
export function remainingAsks(
  p: Project,
  model: EnhanceModel
): { enhance: QuoteAsk[]; masters: QuoteAsk[]; clips: QuoteAsk[] } {
  const held = (j: { state: string } | undefined) => j?.state === 'queued' || j?.state === 'running' || j?.state === 'succeeded';
  const busy = (j: { state: string } | undefined) => j?.state === 'queued' || j?.state === 'running';
  const enhance: QuoteAsk[] = [];
  const masters: QuoteAsk[] = [];
  const clips: QuoteAsk[] = [];
  for (const image of p.images) {
    if (!image.enhancements.some(held)) enhance.push(enhanceAsk(image, model));
    if (image.master?.locked || busy(image.master)) continue;
    const cost = masterCost(image);
    if (cost && !cost.free) masters.push(cost.ask);
  }
  for (const shot of p.storyboard?.shots ?? []) {
    if (!held(shot.video)) clips.push(shotAsk(shot));
  }
  return { enhance, masters, clips };
}

/** `items` in runs of at most `size`, in order. */
export function chunk<T>(items: readonly T[], size: number = MAX_ASKS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Equal asks joined with their count, in first-seen order. More than `MAX_ASKS` groups cannot be priced in one call. */
export function groupAsks(asks: readonly QuoteAsk[]): Array<{ ask: QuoteAsk; count: number }> {
  const byKey = new Map<string, { ask: QuoteAsk; count: number }>();
  for (const a of asks) {
    const ask: QuoteAsk = { model: a.model, kind: a.kind };
    if (a.seconds !== undefined) ask.seconds = a.seconds;
    if (a.resolution !== undefined) ask.resolution = a.resolution;
    if (a.scale !== undefined) ask.scale = a.scale;
    const key = JSON.stringify(ask);
    const seen = byKey.get(key);
    if (seen) seen.count += 1;
    else byKey.set(key, { ask, count: 1 });
  }
  return [...byKey.values()];
}

/**
 * The sum of the door's answers, in the order `groupAsks` gave the asks. One
 * missing price makes the whole "Price unknown": a total of only some of the
 * buys would tell less than the truth.
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
export type ModelRead = { id: string; ready: boolean; why: string | null };

/** What a spending button shows and whether it may be pressed. */
export type SpendState = {
  disabled: boolean;
  /** The price words beside the button. */
  price: string;
  /** Why it is disabled, when there is something to tell. */
  why: string | null;
};

/**
 * May a spending button be pressed? Not while the allowance is unread or
 * closed ("Allow spending in the bar above."), not while one of its models is
 * not ready (the model's own reason), not without a price ("Price unknown"),
 * and not with nothing to buy.
 */
export function spendState(input: {
  models: readonly AppModel[];
  allowance: AllowanceRead;
  modelRows: readonly ModelRead[] | undefined;
  /** The door's total; undefined while it is being asked. */
  quote: { cents: number | null; words: string } | undefined;
  /** How many things the button buys. */
  count: number;
}): SpendState {
  const price = input.quote ? input.quote.words : CHECKING_PRICE;
  if (!input.allowance) return { disabled: true, price, why: null };
  if (!input.allowance.open) return { disabled: true, price, why: input.allowance.needs ?? ALLOW_SENTENCE };
  if (!input.modelRows) return { disabled: true, price, why: null };
  for (const id of input.models) {
    const row = input.modelRows.find((m) => m.id === id);
    if (!row || !row.ready) return { disabled: true, price, why: row?.why ?? NOT_LISTED };
  }
  if (input.count < 1) return { disabled: true, price, why: null };
  if (!input.quote) return { disabled: true, price, why: null };
  if (input.quote.cents === null) return { disabled: true, price, why: PRICE_UNKNOWN };
  return { disabled: false, price, why: null };
}

/** "Enhance all", "Make all clips": the label with how many it makes. */
export function bulkLabel(verb: string, count: number): string {
  return count > 0 ? `${verb} (${count})` : verb;
}
