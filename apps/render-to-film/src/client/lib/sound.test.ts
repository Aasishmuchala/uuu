import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { blessPlaying, soundLabel, startMuted } from './sound.ts';

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a clip starts muted and is asked to play', async () => {
  let plays = 0;
  const v = { muted: false, defaultMuted: false, paused: true, play: async () => void plays++ };
  startMuted(v);
  assert.equal(v.muted, true);
  assert.equal(v.defaultMuted, true);
  assert.equal((v as { loop?: boolean }).loop, true);
  assert.equal(plays, 1);
  const playing = { muted: false, defaultMuted: false, paused: false, play: async () => void plays++ };
  startMuted(playing);
  assert.equal(playing.muted, true);
  assert.equal(plays, 1, 'a clip already playing is only muted');
});

test('a refused play is not an error', async () => {
  const v = { muted: false, defaultMuted: false, paused: true, play: () => Promise.reject(new Error('NotAllowedError')) };
  startMuted(v);
  await new Promise((r) => setTimeout(r, 0));
});

test('a press asks a playing or finished clip to play (so it may have its sound), never one paused part way', () => {
  let plays = 0;
  blessPlaying({ muted: true, defaultMuted: true, paused: false, play: async () => void plays++ });
  assert.equal(plays, 1);
  blessPlaying({ muted: true, defaultMuted: true, paused: true, play: async () => void plays++ });
  assert.equal(plays, 1);
  blessPlaying({ muted: true, defaultMuted: true, paused: true, ended: true, play: async () => void plays++ });
  assert.equal(plays, 2, 'a clip at its end starts again');
  blessPlaying(null);
});

test('the button says what it will do', () => {
  assert.equal(soundLabel(true), 'Turn sound on');
  assert.equal(soundLabel(false), 'Turn sound off');
});

test('every lightbox that can show a clip has the sound button', () => {
  for (const p of ['ui/FullSize.tsx', 'LibraryPage.tsx', 'screens/FavouritesPage.tsx']) {
    const text = readFileSync(join(CLIENT, p), 'utf8');
    assert.match(text, /<Lightbox\b/, p);
    assert.match(text, /<LightboxSound\b/, p);
  }
});
