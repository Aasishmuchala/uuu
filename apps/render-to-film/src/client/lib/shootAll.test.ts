import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shootInLoop } from './shootAll.ts';

const none = new Set<number>();

test('an unshot frame, or one whose take failed, is shot', () => {
  assert.equal(shootInLoop(3, { inFlight: none, sent: none }), true);
  assert.equal(shootInLoop(3, { inFlight: none, sent: none, take: { status: 'failed' } }), true);
});

test('a frame being shot by its own button is skipped', () => {
  assert.equal(shootInLoop(6, { inFlight: new Set([6]), sent: none }), false);
});

test('a frame sent since the click is skipped, even before its take is listed', () => {
  assert.equal(shootInLoop(6, { inFlight: none, sent: new Set([6]) }), false);
});

test('a frame whose take is being made or made is skipped', () => {
  assert.equal(shootInLoop(2, { inFlight: none, sent: none, take: { status: 'pending' } }), false);
  assert.equal(shootInLoop(2, { inFlight: none, sent: none, take: { status: 'succeeded' } }), false);
});
