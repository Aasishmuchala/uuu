import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canCompare } from './compare.ts';

const s = { kind: 'still' as const };
const c = { kind: 'clip' as const };

test('two to four stills compare', () => {
  assert.deepEqual(canCompare([s, s]), { ok: true, kind: 'still' });
  assert.deepEqual(canCompare([s, s, s, s]), { ok: true, kind: 'still' });
});

test('exactly two clips compare', () => {
  assert.deepEqual(canCompare([c, c]), { ok: true, kind: 'clip' });
});

test('anything else says what to change', () => {
  for (const pick of [[], [s], [s, s, s, s, s], [c], [c, c, c], [s, c]]) {
    const r = canCompare(pick);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.why, /\.$/);
  }
  const mixed = canCompare([s, c]);
  assert.ok(!mixed.ok && mixed.why === 'Compare stills with stills, or videos with videos.');
});
