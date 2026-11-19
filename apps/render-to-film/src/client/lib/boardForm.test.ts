import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boardUploads } from './boardForm.ts';

test('a planned board fills the panel with its own images, already hosted', () => {
  const got = boardUploads([
    { url: '/files/uploads/a.jpg', width: 2560, height: 1440, name: 'a.jpg' },
    { url: '/files/uploads/b.jpg', width: 1920, height: 1080, name: 'b.jpg' },
  ]);
  assert.equal(got.length, 2);
  assert.deepEqual(got[0], { key: 'board-0-/files/uploads/a.jpg', src: '/files/uploads/a.jpg', name: 'a.jpg', width: 2560, height: 1440, hostedUrl: '/files/uploads/a.jpg' });
  assert.notEqual(got[0]!.key, got[1]!.key);
});

test('nothing but the app\'s own files, and nothing without a size, is taken back', () => {
  assert.deepEqual(boardUploads(undefined), []);
  assert.deepEqual(
    boardUploads([
      { url: 'https://example.com/x.jpg', width: 10, height: 10, name: 'x' },
      { url: 'javascript:alert(1)', width: 10, height: 10, name: 'y' },
      { url: '/files/uploads/z.jpg', width: 0, height: 10, name: 'z' },
    ]),
    []
  );
});
