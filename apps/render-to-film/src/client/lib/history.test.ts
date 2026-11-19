import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dayKey, groupByDay, promptHistory, search } from './history.ts';
import { clip, lib, still } from './testFixtures.ts';

test('promptHistory lists directions newest first and leaves out empty ones', () => {
  const h = promptHistory(
    lib(
      [
        still({ id: 'a', createdAt: '2026-11-18T09:00:00.000Z', direction: 'wet stone after rain' }),
        still({ id: 'b', createdAt: '2026-11-19T09:00:00.000Z', direction: '   ' }),
        still({ id: 'c', createdAt: '2026-11-19T10:00:00.000Z', direction: 'a woman reading', status: 'failed' }),
      ],
      [clip({ id: 'v', stillId: 'a', createdAt: '2026-11-19T12:00:00.000Z', direction: 'leaves drift' })]
    )
  );
  assert.deepEqual(
    h.map((e) => [e.kind, e.id, e.direction]),
    [
      ['clip', 'v', 'leaves drift'],
      ['still', 'a', 'wet stone after rain'],
    ]
  );
  assert.equal(h[0]!.motion, 'push-in');
  assert.equal(h[0]!.thumb, '/api/library/still/a?thumb');
  assert.equal(h[1]!.look, 'golden-hour');
  assert.equal(h[1]!.model, 'nano-banana-pro');
});

test('the same direction with the same settings folds into one entry with a count', () => {
  const h = promptHistory(
    lib([
      still({ id: 'old', createdAt: '2026-11-17T09:00:00.000Z', direction: 'Wet stone' }),
      still({ id: 'new', createdAt: '2026-11-19T09:00:00.000Z', direction: 'wet stone ' }),
      still({ id: 'other', createdAt: '2026-11-18T09:00:00.000Z', direction: 'wet stone', look: 'blue-hour' }),
    ])
  );
  assert.equal(h.length, 2);
  assert.equal(h[0]!.id, 'new');
  assert.equal(h[0]!.count, 2);
  assert.equal(h[1]!.id, 'other');
  assert.equal(h[1]!.count, 1);
});

test('a still lit from a reference has no look', () => {
  const [e] = promptHistory(lib([still({ id: 'r', direction: 'x', lightRefUrl: '/files/ref.jpg' })]));
  assert.equal(e!.look, undefined);
});

test('groupByDay names today and yesterday and keeps newest days first', () => {
  const now = new Date(2026, 10, 19, 15, 0);
  const at = (d: number, h: number) => new Date(2026, 10, d, h).toISOString();
  const entries = promptHistory(
    lib([
      still({ id: 't', createdAt: at(19, 9), direction: 'one' }),
      still({ id: 'y', createdAt: at(18, 22), direction: 'two' }),
      still({ id: 'o', createdAt: at(12, 8), direction: 'three' }),
    ])
  );
  const g = groupByDay(entries, now);
  assert.deepEqual(
    g.map((x) => x.day),
    [dayKey(at(19, 9)), dayKey(at(18, 22)), dayKey(at(12, 8))]
  );
  assert.equal(g[0]!.label, 'Today');
  assert.equal(g[1]!.label, 'Yesterday');
  assert.notEqual(g[2]!.label, 'Today');
});

test('search keeps entries holding every word, in the direction or the given names', () => {
  const entries = promptHistory(
    lib([
      still({ id: 'a', direction: 'wet stone after rain' }),
      still({ id: 'b', direction: 'a couple walks by the pool', createdAt: '2026-11-19T11:00:00.000Z' }),
    ])
  );
  assert.deepEqual(search(entries, 'stone RAIN').map((e) => e.id), ['a']);
  assert.deepEqual(search(entries, '').length, 2);
  assert.deepEqual(search(entries, 'golden', () => 'Golden hour').length, 2);
  assert.deepEqual(search(entries, 'nothing like this').length, 0);
});
