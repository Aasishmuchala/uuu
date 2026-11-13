import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createPictures, type SharpInstance } from './pictures.ts';

/** A fake `sharp` whose JPEG gets smaller as quality falls. */
function fakeSharp(sizeAt: (q: number) => number, meta = { width: 800, height: 600 }) {
  const log: Array<Record<string, unknown>> = [];
  const sharp = (_input: Buffer, options?: Record<string, unknown>): SharpInstance => {
    let quality = 0;
    const self: SharpInstance = {
      rotate: () => self,
      resize: (o) => (log.push({ resize: o, options }), self),
      flatten: () => self,
      jpeg: (o) => ((quality = Number(o['quality'])), log.push({ quality }), self),
      toBuffer: async () => Buffer.alloc(sizeAt(quality)),
      metadata: async () => meta,
    };
    return self;
  };
  return { sharp, log };
}

describe('pictures', () => {
  test('steps quality 90, 80, 70, 60 until the picture fits', async () => {
    const { sharp, log } = fakeSharp((q) => q * 1000);
    const p = createPictures(async () => sharp);
    const out = await p.toJpeg(Buffer.from('x'), { maxSide: 4096, maxBytes: 75_000 });
    assert.equal(out.length, 70_000);
    assert.deepEqual(log.filter((l) => 'quality' in l).map((l) => l['quality']), [90, 80, 70]);
    const resize = log.find((l) => 'resize' in l)!['resize'] as Record<string, unknown>;
    assert.deepEqual(resize, { width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true });
  });

  test('the first quality is used when it already fits', async () => {
    const { sharp, log } = fakeSharp(() => 10);
    await createPictures(async () => sharp).toJpeg(Buffer.from('x'), { maxSide: 1000, maxBytes: 100 });
    assert.deepEqual(log.filter((l) => 'quality' in l).map((l) => l['quality']), [90]);
  });

  test('a picture that never fits is refused', async () => {
    const { sharp } = fakeSharp(() => 9_999_999);
    await assert.rejects(createPictures(async () => sharp).toJpeg(Buffer.from('x'), { maxSide: 1000, maxBytes: 100 }), /too large/);
  });

  test('size reads width and height, and refuses what has none', async () => {
    assert.deepEqual(await createPictures(async () => fakeSharp(() => 1).sharp).size(Buffer.from('x')), { width: 800, height: 600 });
    const none = fakeSharp(() => 1, {} as never).sharp;
    await assert.rejects(createPictures(async () => none).size(Buffer.from('x')), /not a picture/);
  });

  test('sharp is not loaded until it is needed', () => {
    let loaded = false;
    createPictures(async () => {
      loaded = true;
      return fakeSharp(() => 1).sharp;
    });
    assert.equal(loaded, false);
  });
});
