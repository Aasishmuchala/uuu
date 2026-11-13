import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gateOf, groupItems, totalOf } from './spend.ts';

test('groupItems joins equal asks and adds their counts', () => {
  const g = groupItems([
    { preset: 'gen-4-image', count: 3 },
    { preset: 'gen-4-image', count: 2 },
    { preset: 'gen-4-image', resolution: '2k' },
    { preset: 'kling-3-pro', seconds: 5 },
  ]);
  assert.equal(g.length, 3);
  assert.deepEqual(g[0], { ask: { preset: 'gen-4-image' }, count: 5 });
  assert.deepEqual(g[1], { ask: { preset: 'gen-4-image', resolution: '2k' }, count: 1 });
});

test('groupItems drops zero counts and empty presets, never sends the count', () => {
  const g = groupItems([{ preset: 'a', count: 0 }, { preset: '' }, { preset: 'b', count: 2.9 }]);
  assert.deepEqual(g, [{ ask: { preset: 'b' }, count: 2 }]);
  assert.equal('count' in g[0]!.ask, false);
});

test('groupItems keeps at most 60 asks', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ preset: `p${i}` }));
  assert.equal(groupItems(many).length, 60);
});

test('totalOf multiplies by the count and says About', () => {
  const t = totalOf([{ count: 3 }, { count: 1 }], [{ cents: 40 }, { cents: 150 }]);
  assert.deepEqual(t, { cents: 270, words: 'About $2.70' });
});

test('totalOf: one unknown makes the whole price unknown', () => {
  assert.equal(totalOf([{ count: 1 }, { count: 1 }], [{ cents: 40 }, { cents: null }]).words, 'Price unknown');
  assert.equal(totalOf([{ count: 1 }], undefined).cents, null);
  assert.equal(totalOf([{ count: 1 }], []).words, 'Price unknown');
});

test('totalOf: nothing to buy costs $0.00', () => {
  assert.equal(totalOf([], []).words, 'About $0.00');
});

test('gateOf: unread allowance holds the button without a sentence', () => {
  assert.deepEqual(gateOf(['a'], undefined, []), { blocked: true, why: null });
});

test('gateOf: a closed allowance says K23 words', () => {
  const g = gateOf(['a'], { open: false, needs: null }, []);
  assert.deepEqual(g, { blocked: true, why: 'Allow spending in the bar above.' });
});

test('gateOf: a model that is not ready gives the door reason', () => {
  const models = [{ preset: 'a', ready: false, why: 'Needs a Runway key. Add it in Settings on the home screen.' }];
  assert.equal(gateOf(['a'], { open: true, needs: null }, models).why, models[0]!.why);
  assert.equal(gateOf(['b'], { open: true, needs: null }, models).blocked, false);
});

test('gateOf: open and ready lets it through', () => {
  const models = [{ preset: 'a', ready: true, why: null }];
  assert.deepEqual(gateOf(['a'], { open: true, needs: null }, models), { blocked: false, why: null });
});
