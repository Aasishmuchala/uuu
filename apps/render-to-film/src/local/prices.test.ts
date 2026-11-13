import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CLIP_UPSCALERS, IMAGE_MODELS, STILL_UPSCALERS, VIDEO_MODELS } from '../models.ts';
import {
  ALLOW_SENTENCE,
  allowanceWords,
  createPrices,
  dollars,
  estimateItemOf,
  NEEDS_HIGGSFIELD,
  NEEDS_RUNWAY_KEY,
  NO_SPENDING,
  offeredPresets,
  PRICE_UNKNOWN,
  priceWords,
  probeOf,
  readAllowance,
} from './prices.ts';

type Call = { method: string; path: string; body?: unknown };

/** A fake engine: answers by path, keeps what it was asked. */
function fake(answers: Record<string, { status?: number; json: any } | Error>) {
  const calls: Call[] = [];
  return {
    calls,
    json: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      const a = answers[`${method} ${path}`];
      if (a instanceof Error) throw a;
      return { status: a?.status ?? 200, json: a?.json ?? null };
    },
  };
}

describe('price words', () => {
  test('cents 1, 40, 150 and 1999', () => {
    assert.equal(priceWords(1), 'About $0.01');
    assert.equal(priceWords(40), 'About $0.40');
    assert.equal(priceWords(150), 'About $1.50');
    assert.equal(priceWords(1999), 'About $19.99');
    assert.equal(priceWords(0), 'About $0.00');
  });
  test('no price reads "Price unknown"', () => {
    for (const v of [null, undefined, NaN, -5]) assert.equal(priceWords(v as number | null), PRICE_UNKNOWN);
    assert.equal(PRICE_UNKNOWN, 'Price unknown');
  });
  test('dollars', () => {
    assert.equal(dollars(500), '$5.00');
    assert.equal(dollars(120), '$1.20');
  });
});

describe('the allowance words', () => {
  test('open and closed', () => {
    assert.equal(allowanceWords({ open: true, budget: 500, spent: 120 }), 'Allowed today: $5.00. Spent: $1.20.');
    assert.equal(allowanceWords({ open: false, budget: 0, spent: 0 }), 'This app cannot spend anything right now.');
    assert.equal(NO_SPENDING, 'This app cannot spend anything right now.');
  });
  test('readAllowance: open', () => {
    const a = readAllowance({ open: true, budget: 500, spent: 120, left: 380, expiresAt: '2026-11-14T00:00:00+05:30' });
    assert.deepEqual(a, { open: true, budget: 500, spent: 120, left: 380, expiresAt: '2026-11-14T00:00:00+05:30', words: 'Allowed today: $5.00. Spent: $1.20.', needs: null });
  });
  test('readAllowance: closed, empty and junk answers all read as closed', () => {
    for (const j of [{ open: false, budget: 500 }, null, undefined, 'x', { open: 'yes' }, {}]) {
      const a = readAllowance(j);
      assert.equal(a.open, false);
      assert.equal(a.budget, 0);
      assert.equal(a.left, 0);
      assert.equal(a.expiresAt, null);
      assert.equal(a.words, NO_SPENDING);
      assert.equal(a.needs, ALLOW_SENTENCE);
    }
    assert.equal(ALLOW_SENTENCE, 'Allow spending in the bar above.');
  });
  test('left is worked out when the door leaves it out', () => {
    assert.equal(readAllowance({ open: true, budget: 500, spent: 700 }).left, 0);
    assert.equal(readAllowance({ open: true, budget: 500, spent: 100 }).left, 400);
  });
});

describe('a preset and its options become an engine row', () => {
  test('every offered picture and clip model and the Precision upscaler has a row', () => {
    for (const m of IMAGE_MODELS) {
      // Krea-style dropped presets are not in the list at all (T72), so every listed one routes.
      const item = estimateItemOf({ preset: m.id });
      assert.ok(item, `${m.id} has no row`);
      assert.equal(item.kind, 'still_variation');
    }
    for (const m of VIDEO_MODELS) {
      const item = estimateItemOf({ preset: m.id });
      assert.ok(item, `${m.id} has no row`);
      assert.match(item.kind, /video/);
    }
    for (const u of STILL_UPSCALERS) assert.equal(estimateItemOf({ preset: u.id })?.kind, 'still_upscale');
  });
  test('a dropped preset or an unknown id has no probe and no row', () => {
    for (const u of CLIP_UPSCALERS) assert.equal(estimateItemOf({ preset: u.id }), null);
    assert.equal(probeOf({ preset: 'krea-image-3' }), null);
    assert.equal(probeOf({ preset: 'no-such-model' }), null);
    assert.equal(estimateItemOf({ preset: 'ltx-2-5-pro' }), null);
  });
  test('seconds and resolution reach the row; the factor reaches the upscaler', () => {
    const clip = estimateItemOf({ preset: 'kling-3-pro', seconds: 10 })!;
    assert.equal(clip.seconds, 10);
    const small = estimateItemOf({ preset: 'seedance-2', seconds: 5, resolution: '480p' })!;
    const big = estimateItemOf({ preset: 'seedance-2', seconds: 5, resolution: '1080p' })!;
    assert.notEqual(small.resolution, big.resolution);
    assert.equal(estimateItemOf({ preset: 'precision', scale: 4 })!.scale, 4);
    assert.equal(estimateItemOf({ preset: 'precision' })!.scale, 2);
  });
  test('Veo fast and Veo are different rows', () => {
    assert.notEqual(estimateItemOf({ preset: 'veo-3-1' })!.model, estimateItemOf({ preset: 'veo-3-1-fast' })!.model);
  });
});

describe('prices', () => {
  test('one estimate call for many buys; the cents come back as words', async () => {
    const eng = fake({ 'POST /gen/app/estimate': { json: { items: [{ model: 'a', cents: 40 }, { model: 'b', cents: 150 }], total: 190 } } });
    const p = createPrices({ engine: eng });
    const out = await p.prices([{ preset: 'nano-banana-pro' }, { preset: 'kling-3-pro', seconds: 5 }]);
    assert.deepEqual(out, [
      { preset: 'nano-banana-pro', cents: 40, words: 'About $0.40' },
      { preset: 'kling-3-pro', cents: 150, words: 'About $1.50' },
    ]);
    assert.equal(eng.calls.length, 1);
    const sent = (eng.calls[0]!.body as { items: Array<{ model: string; kind: string }> }).items;
    assert.equal(sent.length, 2);
    assert.equal(sent[0]!.kind, 'still_variation');
  });
  test('a dropped preset is "Price unknown" and is not sent', async () => {
    const eng = fake({ 'POST /gen/app/estimate': { json: { items: [{ model: 'a', cents: 40 }] } } });
    const out = await createPrices({ engine: eng }).prices([{ preset: 'media_upscale' }, { preset: 'nano-banana-pro' }]);
    assert.deepEqual(out.map((o) => o.words), [PRICE_UNKNOWN, 'About $0.40']);
    assert.equal((eng.calls[0]!.body as { items: unknown[] }).items.length, 1);
  });
  test('only dropped presets: nothing is asked', async () => {
    const eng = fake({});
    const out = await createPrices({ engine: eng }).prices([{ preset: 'media_upscale' }]);
    assert.deepEqual(out, [{ preset: 'media_upscale', cents: null, words: PRICE_UNKNOWN }]);
    assert.equal(eng.calls.length, 0);
  });
  test('a refusal, an unreachable engine and a short answer are all "Price unknown"', async () => {
    const asks = [{ preset: 'nano-banana-pro' }];
    for (const a of [{ status: 403, json: { code: 'gen_off' } }, new Error('down'), { json: { items: [] } }, { json: { items: [{ cents: 'x' }] } }, { json: null }]) {
      const out = await createPrices({ engine: fake({ 'POST /gen/app/estimate': a }) }).prices(asks);
      assert.equal(out[0]!.words, PRICE_UNKNOWN);
      assert.equal(out[0]!.cents, null);
    }
  });
  test('more than 20 buys go in batches of 20', async () => {
    const eng = fake({});
    eng.json = async (method: string, path: string, body?: unknown) => {
      eng.calls.push({ method, path, body });
      const n = (body as { items: unknown[] }).items.length;
      return { status: 200, json: { items: Array.from({ length: n }, () => ({ cents: 7 })) } };
    };
    const asks = Array.from({ length: 45 }, () => ({ preset: 'nano-banana-pro' }));
    const out = await createPrices({ engine: eng }).prices(asks);
    assert.deepEqual(eng.calls.map((c) => (c.body as { items: unknown[] }).items.length), [20, 20, 5]);
    assert.ok(out.every((o) => o.cents === 7));
  });
});

describe('models', () => {
  const rows = (ready: boolean, why = '') => ({
    json: { models: estimateAll().map((model) => ({ id: model, ready, ...(why ? { why } : {}) })) },
  });
  function estimateAll() {
    return offeredPresets().map((p) => estimateItemOf({ preset: p })?.model).filter((m): m is string => !!m);
  }
  test('ready rows read ready', async () => {
    const out = await createPrices({ engine: fake({ 'GET /gen/app/models': rows(true) }) }).models();
    assert.ok(out.length >= IMAGE_MODELS.length + VIDEO_MODELS.length);
    assert.ok(out.every((m) => m.ready && m.why === null));
  });
  test('not ready: the door\'s own words, else the Runway or Higgsfield sentence', async () => {
    const withWhy = await createPrices({ engine: fake({ 'GET /gen/app/models': rows(false, 'Needs a Runway key. Add it in Settings on the home screen.') }) }).models();
    assert.ok(withWhy.every((m) => !m.ready && m.why === NEEDS_RUNWAY_KEY));
    const bare = await createPrices({ engine: fake({ 'GET /gen/app/models': rows(false) }) }).models();
    const hf = bare.find((m) => m.model?.startsWith('hf.'));
    const rw = bare.find((m) => m.model && !m.model.startsWith('hf.'));
    assert.equal(hf?.why, NEEDS_HIGGSFIELD);
    assert.equal(rw?.why, NEEDS_RUNWAY_KEY);
  });
  test('the door unreachable or refusing: nothing is ready, with a reason', async () => {
    const down = await createPrices({ engine: fake({ 'GET /gen/app/models': new Error('x') }) }).models();
    assert.ok(down.every((m) => !m.ready && m.why === 'The engine could not be reached.'));
    const off = await createPrices({ engine: fake({ 'GET /gen/app/models': { status: 403, json: { error: { message: 'Generation is off.' }, code: 'gen_off' } } }) }).models();
    assert.ok(off.every((m) => !m.ready && m.why === 'Generation is off.'));
  });
  test('the list is kept 30 seconds', async () => {
    let t = 1000;
    const eng = fake({ 'GET /gen/app/models': rows(true) });
    const p = createPrices({ engine: eng, now: () => t });
    await p.models();
    t += 29_000;
    await p.models();
    assert.equal(eng.calls.length, 1);
    t += 2_000;
    await p.models();
    assert.equal(eng.calls.length, 2);
  });
});

describe('allowance', () => {
  test('open', async () => {
    const eng = fake({ 'GET /gen/app/allowance': { json: { open: true, budget: 500, spent: 120, left: 380, expiresAt: 'x' } } });
    const a = await createPrices({ engine: eng }).allowance();
    assert.equal(a.words, 'Allowed today: $5.00. Spent: $1.20.');
    assert.equal(a.left, 380);
  });
  test('closed, refused or unreachable all read as closed', async () => {
    for (const a of [{ json: { open: false } }, { status: 403, json: { code: 'gen_no_allowance' } }, new Error('down')]) {
      const out = await createPrices({ engine: fake({ 'GET /gen/app/allowance': a }) }).allowance();
      assert.equal(out.open, false);
      assert.equal(out.words, 'This app cannot spend anything right now.');
    }
  });
});
