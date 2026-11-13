import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isLocalAddress, localKeyOf, readLocal } from './files-read.ts';

const files: Record<string, Buffer> = {
  'renders/local/a.png': Buffer.from('png-bytes'),
  'media/big.mp4': Buffer.alloc(100),
};
const get = async (key: string) => files[key] ?? null;

describe('localKeyOf', () => {
  test('a /files/ address gives its key; a query is ignored', () => {
    assert.equal(localKeyOf('/files/renders/local/a.png'), 'renders/local/a.png');
    assert.equal(localKeyOf('/files/renders/local/a.png?v=2#x'), 'renders/local/a.png');
    assert.equal(localKeyOf('/files/uploads/a%2Db.png'), 'uploads/a-b.png');
  });
  test('anything else is null', () => {
    for (const u of ['https://example.com/a.png', '/files/../etc/passwd', '/files/A.png', '/files/', '/other/a.png', '/files/a//b.png', '/files/%zz', '']) {
      assert.equal(localKeyOf(u), null, u);
    }
  });
});

describe('isLocalAddress', () => {
  test('relative addresses are local, absolute ones are not', () => {
    assert.equal(isLocalAddress('/files/a.png'), true);
    assert.equal(isLocalAddress('https://x.test/a.png'), false);
  });
});

describe('readLocal', () => {
  test('reads a kept file without any fetch', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('no network in tests');
    }) as typeof fetch;
    try {
      const b = await readLocal('/files/renders/local/a.png', 'render', 1000, get);
      assert.equal(b.toString(), 'png-bytes');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  test('a missing file and a bad address say it is not on this Mac', async () => {
    await assert.rejects(readLocal('/files/renders/local/zz.png', 'render', 1000, get), /no longer on this Mac/);
    await assert.rejects(readLocal('/files/../x.png', 'render', 1000, get), /no longer on this Mac/);
  });
  test('a file over the cap is too large', async () => {
    await assert.rejects(readLocal('/files/media/big.mp4', 'clip', 50, get), /too large to process/);
  });
});
