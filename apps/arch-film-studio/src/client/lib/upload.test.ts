import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NOT_A_PICTURE, TOO_BIG } from '../../server/upload.ts';
import * as up from './upload.ts';

const jpeg = (name = 'Lobby render.jpg') => Object.assign(new Blob([new Uint8Array(4)], { type: 'image/jpeg' }), { name });

test("the refusal sentences are the server's", () => {
  assert.equal(up.NOT_A_PICTURE, NOT_A_PICTURE);
  assert.equal(up.TOO_BIG, TOO_BIG);
});

test('refused before sending: a type that is not a picture, and more than 25 MB', () => {
  assert.equal(up.refuseEarly({ name: 'a.gif', type: 'image/gif', size: 10 }), NOT_A_PICTURE);
  assert.equal(up.refuseEarly({ name: 'a.jpg', type: 'image/jpeg', size: 25 * 1024 * 1024 + 1 }), TOO_BIG);
  assert.equal(up.refuseEarly({ name: 'a.webp', type: 'image/webp', size: 10 }), null);
});

test('the file name header is percent-encoded and cut to 120 characters', () => {
  assert.equal(up.fileNameHeader('Lobby render é.jpg'), 'Lobby%20render%20%C3%A9.jpg');
  assert.equal(decodeURIComponent(up.fileNameHeader('x'.repeat(300))).length, 120);
});

test('uploadOne sends the raw picture with fetch to /api/upload, never a form', async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fake = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ image: { id: 'img-00001', code: 'IMG-001' } }), { status: 200 });
  }) as unknown as typeof fetch;
  const file = jpeg();
  const r = await up.uploadOne('proj-0001', file, fake);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.image.code, 'IMG-001');
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, '/api/upload?project=proj-0001');
  assert.equal(seen[0]!.init.method, 'POST');
  assert.deepEqual(seen[0]!.init.headers, { 'Content-Type': 'image/jpeg', 'x-file-name': 'Lobby%20render.jpg' });
  assert.equal(seen[0]!.init.body, file);
  assert.ok(!(seen[0]!.init.body instanceof FormData));
});

test("uploadOne shows the server's refusal sentence", async () => {
  const fake = (async () =>
    new Response(JSON.stringify({ error: { message: 'A project holds at most 200 pictures.' } }), { status: 400 })) as unknown as typeof fetch;
  assert.deepEqual(await up.uploadOne('proj-0001', jpeg(), fake), { ok: false, message: 'A project holds at most 200 pictures.' });
});

test('uploadOne: a broken connection or an unreadable answer is a sentence, never a throw', async () => {
  const broken = (async () => {
    throw new TypeError('network');
  }) as unknown as typeof fetch;
  assert.deepEqual(await up.uploadOne('proj-0001', jpeg(), broken), { ok: false, message: up.UNREACHABLE });
  const html = (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch;
  const r = await up.uploadOne('proj-0001', jpeg(), html);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.message : '', /status 502/);
});

test('uploadOne sends nothing for a file it can refuse itself', async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return new Response('{}');
  }) as unknown as typeof fetch;
  const gif = Object.assign(new Blob([], { type: 'image/gif' }), { name: 'a.gif' });
  assert.deepEqual(await up.uploadOne('proj-0001', gif, fake), { ok: false, message: NOT_A_PICTURE });
  assert.equal(calls, 0);
});

test('eachLimited runs at most three at once and every item once', async () => {
  let running = 0;
  let most = 0;
  const done: number[] = [];
  await up.eachLimited([1, 2, 3, 4, 5, 6, 7], up.UPLOAD_AT_ONCE, async (n) => {
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 5));
    done.push(n);
    running--;
  });
  assert.equal(most, 3);
  assert.deepEqual([...done].sort(), [1, 2, 3, 4, 5, 6, 7]);
  await up.eachLimited([], 3, async () => {
    throw new Error('never');
  });
});
