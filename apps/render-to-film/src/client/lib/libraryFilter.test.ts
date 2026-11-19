import assert from 'node:assert/strict';
import { test } from 'node:test';

import { facets, filterItems, isFiltering, libraryItems, NO_FILTER, tagCounts } from './libraryFilter.ts';
import { clip, lib, still } from './testFixtures.ts';

const library = lib(
  [
    still({ id: 's1', createdAt: '2026-11-19T09:00:00.000Z', tags: ['pool', 'favourite'], direction: 'wet stone' }),
    still({ id: 's2', createdAt: '2026-11-19T10:00:00.000Z', look: 'blue-hour', imageModel: 'gen-4-image' }),
    still({ id: 'gone', status: 'failed' }),
  ],
  [clip({ id: 'c1', stillId: 's1', createdAt: '2026-11-19T11:00:00.000Z', tags: ['client'] })]
);
const items = libraryItems(library);

test('libraryItems lists what did not fail, newest first, a clip with its still', () => {
  assert.deepEqual(items.map((i) => i.id), ['c1', 's2', 's1']);
  const c = items[0]!;
  assert.equal(c.kind, 'clip');
  assert.equal(c.kind === 'clip' && c.still?.id, 's1');
  assert.equal(c.look, 'golden-hour');
  assert.ok(Math.abs(c.ratio - 2560 / 1440) < 1e-9);
});

test('kind, model and look narrow the list', () => {
  const ids = (f: Partial<typeof NO_FILTER>) => filterItems(items, { ...NO_FILTER, ...f }).map((i) => i.id);
  assert.deepEqual(ids({ kind: 'still' }), ['s2', 's1']);
  assert.deepEqual(ids({ kind: 'clip' }), ['c1']);
  assert.deepEqual(ids({ model: 'gen-4-image' }), ['s2']);
  assert.deepEqual(ids({ look: 'golden-hour' }), ['c1', 's1']);
});

test('"Favourites only" keeps starred items', () => {
  assert.deepEqual(filterItems(items, { ...NO_FILTER, favouritesOnly: true }).map((i) => i.id), ['s1']);
});

test('picked tags must all be on the item, own or automatic', () => {
  assert.deepEqual(filterItems(items, { ...NO_FILTER, tags: ['pool'] }).map((i) => i.id), ['s1']);
  assert.deepEqual(filterItems(items, { ...NO_FILTER, tags: ['video', 'client'] }).map((i) => i.id), ['c1']);
  // The star is not a tag the picker offers.
  assert.deepEqual(filterItems(items, { ...NO_FILTER, tags: ['favourite'] }).length, 0);
});

test('search keeps the old @tag behaviour and plain words', () => {
  const ids = (text: string) => filterItems(items, { ...NO_FILTER, text }).map((i) => i.id);
  assert.deepEqual(ids('@po'), ['s1']);
  assert.deepEqual(ids('@Client'), ['c1']);
  assert.deepEqual(ids('wet stone'), ['s1']);
  assert.deepEqual(ids('blue'), ['s2']);
  assert.deepEqual(ids('@nothing'), []);
});

test('isFiltering, tagCounts and facets', () => {
  assert.equal(isFiltering(NO_FILTER), false);
  assert.equal(isFiltering({ ...NO_FILTER, text: ' x ' }), true);
  const counts = tagCounts(items);
  assert.ok(!counts.some((t) => t.tag === 'favourite'));
  assert.deepEqual(counts.slice(0, 2).map((t) => t.own), [true, true]);
  assert.deepEqual(facets(items), { models: ['seedance-2', 'gen-4-image', 'nano-banana-pro'], looks: ['golden-hour', 'blue-hour'] });
});
