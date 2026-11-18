import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as door from '../../local/door.ts';
import { THINKING_REFUSED as CLAUDE_THINKING } from '../../local/claude.ts';
import { UPSCALE_CAPPED as MODELS_CAPPED } from '../../server/models.ts';
import { LOCKED_MASTER as P_LOCKED, MUSIC_SENTENCE as P_MUSIC, NEEDS_MASTER as P_NEEDS } from '../../server/pipeline.ts';
import * as words from './words.ts';

test("the page's sentences are the server's, word for word", () => {
  assert.equal(words.PRICE_UNKNOWN, door.PRICE_UNKNOWN);
  assert.equal(words.ALLOW_SENTENCE, door.ALLOW_SENTENCE);
  assert.equal(words.NO_SPENDING, door.NO_SPENDING);
  assert.equal(words.ENGINE_UNREACHABLE, door.ENGINE_UNREACHABLE);
  assert.equal(words.NOT_LISTED, door.NOT_LISTED);
  assert.equal(words.THINKING_REFUSED, CLAUDE_THINKING);
  assert.equal(words.MUSIC_SENTENCE, P_MUSIC);
  assert.equal(words.NEEDS_MASTER, P_NEEDS);
  assert.equal(words.LOCKED_MASTER, P_LOCKED);
  assert.equal(words.UPSCALE_CAPPED, MODELS_CAPPED);
});

test('the pinned sentences', () => {
  assert.equal(words.ALLOW_SENTENCE, 'Allow spending in the bar above.');
  assert.equal(words.PRICE_UNKNOWN, 'Price unknown');
  assert.equal(words.MUSIC_SENTENCE, "Music is not made on this Mac yet. The storyboard's music direction is kept as words.");
});

test('price words match the server for 1, 40, 1999, 0 and null', () => {
  for (const c of [1, 40, 1999, 0, null, undefined, -5, Number.NaN]) {
    assert.equal(words.priceWords(c), door.priceWords(c), String(c));
  }
  assert.equal(words.priceWords(40), 'About $0.40');
  assert.equal(words.priceWords(1999), 'About $19.99');
  assert.equal(words.priceWords(null), 'Price unknown');
});

test('readable: a zod list of issues reads as its first message; anything else as it is', () => {
  const zod = JSON.stringify([{ code: 'too_small', message: 'Give the project a name.', path: ['name'] }]);
  assert.equal(words.readable(zod), 'Give the project a name.');
  assert.equal(words.readable('This image has a locked master.'), 'This image has a locked master.');
  assert.equal(words.readable('[not json'), '[not json');
  assert.equal(words.readable(''), 'That did not go through. Try again.');
  assert.equal(words.readable(undefined), 'That did not go through. Try again.');
});
