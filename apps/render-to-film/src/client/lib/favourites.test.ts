import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_TAGS } from '../../tags.ts';
import { FAVOURITE_FULL, FAVOURITE_TAG, isFavourite, visibleTags, withFavourite } from './favourites.ts';

test('the star is the stored tag "favourite"', () => {
  assert.equal(FAVOURITE_TAG, 'favourite');
  assert.equal(isFavourite({ tags: ['dusk', 'favourite'] }), true);
  assert.equal(isFavourite({ tags: ['dusk'] }), false);
  assert.equal(isFavourite({}), false);
});

test('withFavourite adds the tag at the end and keeps the others in order', () => {
  assert.deepEqual(withFavourite(['dusk', 'pool'], true), ['dusk', 'pool', 'favourite']);
  assert.deepEqual(withFavourite(['dusk', 'favourite'], true), ['dusk', 'favourite']);
});

test('withFavourite removes only the star', () => {
  assert.deepEqual(withFavourite(['favourite', 'dusk'], false), ['dusk']);
  assert.deepEqual(withFavourite(['dusk'], false), ['dusk']);
});

test('withFavourite refuses a thirteenth tag and says why', () => {
  const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
  assert.deepEqual(withFavourite(full, true), { full: true });
  // Taking the star off a full item always works.
  const starred = [...full.slice(1), 'favourite'];
  assert.deepEqual(withFavourite(starred, false), full.slice(1));
  assert.match(FAVOURITE_FULL, /This has 12 tags\. Remove one to add it to favourites\./);
});

test('visibleTags hides the star from the tag editor', () => {
  assert.deepEqual(visibleTags(['dusk', 'favourite', 'pool']), ['dusk', 'pool']);
  assert.deepEqual(visibleTags(undefined), []);
});
