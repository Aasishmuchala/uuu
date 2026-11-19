import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clipPreset, savePreset, stillPreset, takePreset } from './reuse.ts';
import { clip, still } from './testFixtures.ts';

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
}

test('a still preset fills the form with how the still was made, and its render', () => {
  const s = still({ id: 's', direction: 'wet stone', crowd: 'few', people: 'a couple', resolution: '2k', aspectRatio: '16:9' });
  const store = memory();
  savePreset('still', stillPreset(s), store);
  const p = takePreset('still', store);
  assert.equal(p?.imageModel, 'nano-banana-pro');
  assert.equal(p?.look, 'golden-hour');
  assert.equal(p?.crowd, 'few');
  assert.equal(p?.direction, 'wet stone');
  assert.deepEqual(p?.source, { url: '/files/uploads/render-a.jpg', width: 2560, height: 1440 });
});

test('a preset is read once, then gone', () => {
  const store = memory();
  savePreset('clip', clipPreset(clip({ id: 'c', stillId: 's', seconds: 5 })), store);
  assert.ok(takePreset('clip', store));
  assert.equal(store.size(), 0);
  assert.equal(takePreset('clip', store), null);
});

test('unknown values are dropped, never passed to the form', () => {
  const store = memory();
  store.setItem(
    'render-to-film:preset:still',
    JSON.stringify({
      imageModel: 'not-a-model',
      resolution: '2k',
      look: 'golden-hour',
      angle: 'upside-down',
      crowd: 'none',
      direction: 'x'.repeat(601),
      people: 42,
      source: { url: 'https://example.invalid/a.jpg', width: 10, height: 10 },
    })
  );
  const p = takePreset('still', store)!;
  assert.deepEqual(Object.keys(p).sort(), ['crowd', 'look']);
});

test('a source outside the app\'s kept uploads is refused', () => {
  const store = memory();
  for (const url of ['/files/../secret', '/api/x', 'javascript:alert(1)', '/files/a b.jpg']) {
    store.setItem('render-to-film:preset:still', JSON.stringify({ source: { url, width: 10, height: 10 } }));
    assert.equal(takePreset('still', store)?.source, undefined, url);
  }
});

test('a clip preset keeps only what the chosen model can run', () => {
  const store = memory();
  store.setItem(
    'render-to-film:preset:clip',
    JSON.stringify({ stillId: 'abc-1', videoModel: 'seedance-2', motion: 'push-in', seconds: 999, resolution: 'nope', speed: 'slow' })
  );
  const p = takePreset('clip', store)!;
  assert.equal(p.stillId, 'abc-1');
  assert.equal(p.videoModel, 'seedance-2');
  assert.equal(p.motion, 'push-in');
  assert.equal(p.speed, 'slow');
  assert.equal(p.seconds, undefined);
  assert.equal(p.resolution, undefined);
});

test('a broken or missing store reads as nothing', () => {
  const store = memory();
  store.setItem('render-to-film:preset:clip', '{not json');
  assert.equal(takePreset('clip', store), null);
  assert.equal(takePreset('still', null), null);
});
