import assert from 'node:assert/strict';
import { test } from 'node:test';

import { capForSpend, inOrder, overCapWords, rangeTo, selectAll, toggle } from './selection.ts';

const order = ['a', 'b', 'c', 'd', 'e'];

test('a click adds a picture, a second click takes it away', () => {
  assert.deepEqual(toggle([], 'b'), ['b']);
  assert.deepEqual(toggle(['a', 'b'], 'b'), ['a']);
});

test('Shift-click adds the run between the last click and this one, either way round', () => {
  assert.deepEqual(rangeTo(['b'], order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeTo([], order, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(rangeTo(['a'], order, 'c', 'e'), ['a', 'c', 'd', 'e']);
  assert.deepEqual(rangeTo([], order, null, 'c'), ['c'], 'no anchor: only the picture clicked');
  assert.deepEqual(rangeTo([], order, 'gone', 'c'), ['c'], 'an anchor no longer in view');
  assert.deepEqual(rangeTo(['a'], order, 'a', 'missing'), ['a']);
});

test('Cmd+A takes every picture in view, once', () => {
  assert.deepEqual(selectAll(order), order);
  assert.deepEqual(selectAll(['a', 'a', 'b']), ['a', 'b']);
});

test('the selection goes in screen order, without what left the view', () => {
  assert.deepEqual(inOrder(['e', 'a', 'x'], order), ['a', 'e']);
});

test('a spending press sends at most 20, the first ones in order', () => {
  const ids = Array.from({ length: 45 }, (_, i) => `id-${i}`);
  const sent = capForSpend(ids, 20);
  assert.equal(sent.length, 20);
  assert.deepEqual(sent, ids.slice(0, 20));
  assert.deepEqual(capForSpend(['a', 'a', 'b']), ['a', 'b'], 'an id is sent once');
  assert.deepEqual(capForSpend(ids).length, 20, 'twenty by default');
  assert.equal(overCapWords(21), 'Up to 20 at a time. The first 20 are sent.');
  assert.equal(overCapWords(20), null);
});
