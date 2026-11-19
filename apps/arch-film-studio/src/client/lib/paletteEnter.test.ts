import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldTakeFirst } from './paletteEnter.ts';

const typed = { key: 'Enter', isComposing: false, role: 'combobox', inOpenDialog: true, activeDescendant: null, hasResult: true };

test('Enter on typed words with nothing highlighted takes the first result', () => {
  assert.equal(shouldTakeFirst(typed), true);
});

test('otherwise Enter is the palette\'s own, or not the palette\'s at all', () => {
  assert.equal(shouldTakeFirst({ ...typed, activeDescendant: 'item-2' }), false, 'a result is highlighted');
  assert.equal(shouldTakeFirst({ ...typed, hasResult: false }), false, 'nothing found');
  assert.equal(shouldTakeFirst({ ...typed, isComposing: true }), false, 'an input method is composing');
  assert.equal(shouldTakeFirst({ ...typed, role: 'textbox' }), false, 'another field');
  assert.equal(shouldTakeFirst({ ...typed, inOpenDialog: false }), false, 'not in the palette');
  assert.equal(shouldTakeFirst({ ...typed, key: 'a' }), false, 'another key');
});
