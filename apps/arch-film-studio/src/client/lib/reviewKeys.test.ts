import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isTyping, keyAction } from './reviewKeys.ts';

const focus = { view: 'focus' as const };
const grid = { view: 'grid' as const };
const body = { tagName: 'BODY', getAttribute: () => null };

test('each Review key in the focus view', () => {
  const k = (key: string) => keyAction({ key, target: body }, focus);
  assert.deepEqual(k('a'), { type: 'approve' });
  assert.deepEqual(k('A'), { type: 'approve' });
  assert.deepEqual(k('r'), { type: 'reject' });
  assert.deepEqual(k('v'), { type: 'note' });
  assert.deepEqual(k('ArrowLeft'), { type: 'prev' });
  assert.deepEqual(k('j'), { type: 'prev' });
  assert.deepEqual(k('ArrowRight'), { type: 'next' });
  assert.deepEqual(k('k'), { type: 'next' });
  assert.deepEqual(k('1'), { type: 'version', index: 0 });
  assert.deepEqual(k('9'), { type: 'version', index: 8 });
  assert.equal(k('0'), null);
  assert.deepEqual(k(' '), { type: 'showRender' });
  assert.deepEqual(k('f'), { type: 'fullSize' });
  assert.deepEqual(k('g'), { type: 'grid' });
  assert.deepEqual(k('u'), { type: 'nextUndecided' });
  assert.deepEqual(k('?'), { type: 'shortcuts' });
  assert.deepEqual(k('Escape'), { type: 'close' });
  assert.equal(k('x'), null);
  assert.equal(k('Enter'), null, 'Enter is the focused button\'s own');
});

test('no key while typing in a field', () => {
  for (const target of [
    { tagName: 'INPUT' },
    { tagName: 'textarea' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
    { tagName: 'DIV', getAttribute: (n: string) => (n === 'role' ? 'textbox' : null) },
  ]) {
    assert.equal(isTyping(target), true);
    for (const key of ['a', 'r', 'v', 'ArrowLeft', 'j', '1', ' ', 'f', 'g', 'u', '?']) {
      assert.equal(keyAction({ key, target }, focus), null, `${key} in ${target.tagName}`);
    }
    // Escape leaves the field: the note closes with its words kept, and the keys work again.
    assert.deepEqual(keyAction({ key: 'Escape', target }, focus), { type: 'close' }, `Escape in ${target.tagName}`);
  }
  assert.equal(isTyping(body), false);
});

test('no key with Cmd, Ctrl or Alt held', () => {
  for (const mod of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
    for (const key of ['a', 'r', 'ArrowRight', 'g', '?']) assert.equal(keyAction({ key, target: body, ...mod }, focus), null);
  }
});

test('a held key decides once: repeats of A, R and V are not actions', () => {
  for (const key of ['a', 'r', 'v', 'f']) assert.equal(keyAction({ key, repeat: true, target: body }, focus), null);
  assert.deepEqual(keyAction({ key: 'ArrowRight', repeat: true, target: body }, focus), { type: 'next' }, 'moving on repeats');
});

test('Space on a focused button presses the button, not the compare', () => {
  assert.equal(keyAction({ key: ' ', target: { tagName: 'BUTTON' } }, focus), null);
  assert.equal(keyAction({ key: ' ', target: { tagName: 'DIV', getAttribute: () => 'button' } }, focus), null);
});

test('the compare divider keeps its arrows, and the letters still work on it', () => {
  const range = { tagName: 'INPUT', type: 'range', getAttribute: () => null };
  assert.equal(isTyping(range), false);
  assert.equal(keyAction({ key: 'ArrowLeft', target: range }, focus), null);
  assert.deepEqual(keyAction({ key: 'a', target: range }, focus), { type: 'approve' });
  assert.deepEqual(keyAction({ key: ' ', target: range }, focus), { type: 'showRender' });
  assert.equal(isTyping({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(keyAction({ key: ' ', target: { tagName: 'INPUT', type: 'checkbox' } }, focus), null, 'Space ticks the box');
});

test('the grid view takes only G, ? and Escape', () => {
  assert.deepEqual(keyAction({ key: 'g', target: body }, grid), { type: 'grid' });
  assert.deepEqual(keyAction({ key: '?', target: body }, grid), { type: 'shortcuts' });
  assert.deepEqual(keyAction({ key: 'Escape', target: body }, grid), { type: 'close' });
  for (const key of ['a', 'r', 'ArrowLeft', '1', ' ']) assert.equal(keyAction({ key, target: body }, grid), null);
});

test('no key spends: nothing maps to making a revised version or enhancing', () => {
  const all = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ?'.split('').concat(['Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'Tab']);
  const types = new Set(all.map((key) => keyAction({ key, target: body }, focus)?.type).filter(Boolean));
  assert.deepEqual(
    [...types].sort(),
    ['approve', 'close', 'fullSize', 'grid', 'next', 'nextUndecided', 'note', 'prev', 'reject', 'shortcuts', 'showRender', 'version'].sort()
  );
});
