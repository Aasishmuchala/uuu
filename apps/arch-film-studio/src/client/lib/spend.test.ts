import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultSettings, type EnhancementRun, type ProjectImage } from '../../shared/project.ts';
import { bulkLabel, enhanceAsk, groupAsks, masterCost, shotAsk, spendState, totalOf, type QuoteAsk } from './spend.ts';

function image(over: Partial<ProjectImage> = {}): ProjectImage {
  return {
    id: 'img-00001',
    code: 'IMG-001',
    name: 'Lobby.jpg',
    width: 2000,
    height: 1333,
    originalKey: 'p/proj-0001/img/img-00001/original.jpg',
    workKey: 'p/proj-0001/img/img-00001/work.jpg',
    thumbKey: 'p/proj-0001/img/img-00001/thumb.jpg',
    uploadedAt: '2026-11-18T00:00:00.000Z',
    settings: defaultSettings(),
    enhancements: [],
    ...over,
  };
}

function approved(over: Partial<EnhancementRun> = {}): EnhancementRun {
  return {
    id: 'run-00001',
    version: 1,
    createdAt: '2026-11-18T00:00:00.000Z',
    settings: defaultSettings(),
    prompt: 'p',
    imageSize: '4K',
    state: 'succeeded',
    storedKey: 'media/a.png',
    decision: 'approved',
    ...over,
  };
}

const open = { open: true, needs: null };
const ready = [
  { id: 'gemini_image3_pro', ready: true, why: null },
  { id: 'magnific_precision_upscaler_v2', ready: true, why: null },
  { id: 'gen4.5', ready: false, why: 'Needs the Runway sign-in. Check Settings.' },
];

test('enhanceAsk: the size class the settings ask for', () => {
  assert.deepEqual(enhanceAsk(image(), 'gemini_image3_pro'), { model: 'gemini_image3_pro', kind: 'still_variation', resolution: '4K' });
  const original = image({ settings: { ...defaultSettings(), output: 'original' } });
  assert.equal(enhanceAsk(original, 'nano_banana_2.1').resolution, '2K');
  const custom = image({ settings: { ...defaultSettings(), output: 'custom', customLongEdge: 1200 } });
  assert.equal(enhanceAsk(custom, 'gemini_image3.1_flash').resolution, '1K');
});

test('masterCost: none without an approved, finished version', () => {
  assert.equal(masterCost(image()), null);
  assert.equal(masterCost(image({ enhancements: [approved({ decision: 'pending' })] })), null);
  assert.equal(masterCost(image({ enhancements: [approved({ state: 'running', storedKey: undefined })] })), null);
});

test('masterCost: already at size is free; under it is one upscale at the right scale', () => {
  const big = masterCost(image({ enhancements: [approved({ outputSize: { width: 5056, height: 2848 } })] }));
  assert.deepEqual(big, { free: true, capped: false, target: 3840 });
  const half = masterCost(image({ enhancements: [approved({ outputSize: { width: 1920, height: 1080 } })] }));
  assert.deepEqual(half, { free: false, ask: { model: 'magnific_precision_upscaler_v2', kind: 'still_upscale', scale: 2 }, target: 3840 });
  const small = masterCost(image({ enhancements: [approved({ outputSize: { width: 960, height: 540 } })] }));
  assert.equal(small && !small.free && small.ask.scale, 4);
  const capped = masterCost(image({ enhancements: [approved({ outputSize: { width: 2528, height: 1696 } })] }));
  assert.deepEqual(capped, { free: true, capped: true, target: 3840 });
});

test('masterCost: an unknown approved size is priced as an upscale', () => {
  const c = masterCost(image({ enhancements: [approved()] }));
  assert.deepEqual(c, { free: false, ask: { model: 'magnific_precision_upscaler_v2', kind: 'still_upscale' }, target: 3840 });
});

test('shotAsk: the shot seconds at gen4.5', () => {
  assert.deepEqual(shotAsk({ durationSeconds: 6 }), { model: 'gen4.5', kind: 'image_to_video', seconds: 6 });
});

test('groupAsks joins equal asks and counts them, in first-seen order', () => {
  const a: QuoteAsk = { model: 'gemini_image3_pro', kind: 'still_variation', resolution: '4K' };
  const b: QuoteAsk = { model: 'gemini_image3_pro', kind: 'still_variation', resolution: '2K' };
  const g = groupAsks([a, b, { ...a }, a]);
  assert.deepEqual(g, [
    { ask: a, count: 3 },
    { ask: b, count: 1 },
  ]);
  assert.deepEqual(groupAsks([]), []);
});

test('totalOf: the summed quote items, times their counts', () => {
  assert.deepEqual(totalOf([{ count: 3 }, { count: 1 }], [{ cents: 40 }, { cents: 20 }]), { cents: 140, words: 'About $1.40' });
});

test('totalOf: one unknown price makes the whole "Price unknown"', () => {
  assert.deepEqual(totalOf([{ count: 1 }, { count: 1 }], [{ cents: 40 }, { cents: null }]), { cents: null, words: 'Price unknown' });
  assert.equal(totalOf([{ count: 1 }], undefined).words, 'Price unknown');
  assert.equal(totalOf([{ count: 1 }], []).words, 'Price unknown');
  assert.equal(totalOf([], []).words, 'About $0.00');
});

test('spendState: a closed allowance disables with the pinned sentence, the price still shown', () => {
  const s = spendState({
    models: ['gemini_image3_pro'],
    allowance: { open: false, needs: 'Allow spending in the bar above.' },
    modelRows: ready,
    quote: { cents: 40, words: 'About $0.40' },
    count: 1,
  });
  assert.deepEqual(s, { disabled: true, price: 'About $0.40', why: 'Allow spending in the bar above.' });
  const noNeeds = spendState({ models: ['gemini_image3_pro'], allowance: { open: false, needs: null }, modelRows: ready, quote: undefined, count: 1 });
  assert.equal(noNeeds.why, 'Allow spending in the bar above.');
});

test("spendState: a model that is not ready disables with the model's why", () => {
  const s = spendState({ models: ['gen4.5'], allowance: open, modelRows: ready, quote: { cents: 60, words: 'About $0.60' }, count: 1 });
  assert.deepEqual(s, { disabled: true, price: 'About $0.60', why: 'Needs the Runway sign-in. Check Settings.' });
  const missing = spendState({ models: ['nano_banana_2.1'], allowance: open, modelRows: ready, quote: { cents: 12, words: 'About $0.12' }, count: 1 });
  assert.equal(missing.why, 'This model is not available right now.');
});

test('spendState: no price disables with "Price unknown"', () => {
  const s = spendState({ models: ['gemini_image3_pro'], allowance: open, modelRows: ready, quote: { cents: null, words: 'Price unknown' }, count: 1 });
  assert.deepEqual(s, { disabled: true, price: 'Price unknown', why: 'Price unknown' });
});

test('spendState: held without a sentence while still reading, or with nothing to buy', () => {
  assert.deepEqual(spendState({ models: [], allowance: undefined, modelRows: ready, quote: undefined, count: 1 }), {
    disabled: true,
    price: 'Checking the price…',
    why: null,
  });
  assert.equal(spendState({ models: ['gemini_image3_pro'], allowance: open, modelRows: undefined, quote: undefined, count: 1 }).why, null);
  assert.equal(spendState({ models: [], allowance: open, modelRows: ready, quote: { cents: 0, words: 'About $0.00' }, count: 0 }).disabled, true);
});

test('spendState: open, ready and priced lets it through', () => {
  const s = spendState({
    models: ['gemini_image3_pro', 'magnific_precision_upscaler_v2'],
    allowance: open,
    modelRows: ready,
    quote: { cents: 65, words: 'About $0.65' },
    count: 2,
  });
  assert.deepEqual(s, { disabled: false, price: 'About $0.65', why: null });
});

test('bulkLabel says how many', () => {
  assert.equal(bulkLabel('Enhance all', 3), 'Enhance all (3)');
  assert.equal(bulkLabel('Make all clips', 0), 'Make all clips');
});
