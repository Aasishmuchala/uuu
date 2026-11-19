import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type Koa from 'koa';

import { defaultSettings, imageKeys, type ProjectImage } from '../shared/project.ts';
import { store } from '../storage.ts';
import { filesRoute } from './files.ts';
import { createProject, getProject, updateProject } from './store.ts';
import {
  acceptUpload,
  type Copies,
  fileName,
  NOT_A_PICTURE,
  PROJECT_FULL,
  TOO_BIG,
  TOO_LARGE_TO_OPEN,
  TooLargeToOpen,
} from './upload.ts';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('rest of a jpeg')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png')]);

/** Copies without sharp: the size is fixed, the copies are labelled. */
const copies: Copies = async (bytes) => {
  if (bytes.includes(Buffer.from('huge'))) throw new TooLargeToOpen();
  return { width: 3000, height: 2000, work: Buffer.from('work'), thumb: Buffer.from('thumb') };
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'afs-up-'));
  process.env['APP_DATA'] = dir;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function newProject() {
  const id = randomUUID();
  const at = new Date().toISOString();
  await createProject({ id, name: 'Test', createdAt: at, updatedAt: at, nextImageNumber: 1, images: [] });
  return id;
}

async function* chunks(...parts: Buffer[]) {
  for (const p of parts) yield p;
}

const upload = (projectId: string, type: string, body: Buffer[], name = 'render%20one.jpg') =>
  acceptUpload({ store, copies }, { projectId, type, name, body: chunks(...body) });

describe('upload', () => {
  test('a JPEG is kept with its copies and the next code', async () => {
    const id = await newProject();
    const a = await upload(id, 'image/jpeg', [JPEG]);
    assert.equal(a.status, 200);
    const image = (a.body as { image: ProjectImage }).image;
    assert.equal(image.code, 'IMG-001');
    assert.equal(image.name, 'render one.jpg');
    assert.equal(image.width, 3000);
    assert.match(image.originalKey, /\/original\.jpg$/);
    assert.deepEqual(await store.getObject(image.originalKey), JPEG);
    assert.equal((await store.getObject(image.workKey))!.toString(), 'work');
    assert.equal((await store.getObject(image.thumbKey))!.toString(), 'thumb');
    const b = await upload(id, 'image/png', [PNG]);
    assert.equal((b.body as { image: ProjectImage }).image.code, 'IMG-002');
    assert.equal((await getProject(id)).nextImageNumber, 3);
  });

  test('a text file named .jpg is refused', async () => {
    const id = await newProject();
    const a = await upload(id, 'image/jpeg', [Buffer.from('hello, this is text')], 'notes.jpg');
    assert.deepEqual(a, { status: 400, body: { error: { message: NOT_A_PICTURE } } });
    assert.equal(NOT_A_PICTURE, 'That file is not a JPG, PNG or WebP picture.');
    // Bytes of one type sent as another are refused too.
    assert.equal((await upload(id, 'image/png', [JPEG])).status, 400);
    assert.equal((await upload(id, 'text/plain', [JPEG])).status, 400);
    assert.equal((await getProject(id)).images.length, 0);
  });

  test('26 MB is refused', async () => {
    const id = await newProject();
    const mb = Buffer.alloc(1024 * 1024);
    const parts = [JPEG, ...Array.from({ length: 26 }, () => mb)];
    const a = await upload(id, 'image/jpeg', parts);
    assert.deepEqual(a, { status: 400, body: { error: { message: TOO_BIG } } });
    assert.equal(TOO_BIG, 'That picture is larger than 25 MB.');
  });

  test('a picture too large to open is refused', async () => {
    const id = await newProject();
    const a = await upload(id, 'image/jpeg', [JPEG, Buffer.from('huge')]);
    assert.deepEqual(a, { status: 400, body: { error: { message: TOO_LARGE_TO_OPEN } } });
  });

  test('the 201st picture is refused', async () => {
    const id = await newProject();
    await updateProject(id, (d) => {
      for (let i = 0; i < 200; i++) {
        const imageId = randomUUID();
        d.images.push({
          id: imageId,
          code: `IMG-${String(i + 1).padStart(3, '0')}`,
          name: 'r',
          width: 1,
          height: 1,
          ...imageKeys(id, imageId, 'jpg'),
          uploadedAt: '',
          settings: defaultSettings(),
          enhancements: [],
        });
      }
      d.nextImageNumber = 201;
    });
    const a = await upload(id, 'image/jpeg', [JPEG]);
    assert.deepEqual(a, { status: 400, body: { error: { message: PROJECT_FULL } } });
    assert.equal(PROJECT_FULL, 'A project holds at most 200 pictures.');
  });

  test('an unknown project is not found', async () => {
    const a = await upload(randomUUID(), 'image/jpeg', [JPEG]);
    assert.equal(a.status, 404);
    assert.equal((await upload('../x', 'image/jpeg', [JPEG])).status, 404);
  });

  test('the name is decoded, one line, at most 120 characters', () => {
    assert.equal(fileName('a%0Ab.jpg'), 'a b.jpg');
    assert.equal(fileName('%E0%A4%A'), '%E0%A4%A');
    assert.equal(fileName('x'.repeat(300)).length, 120);
    assert.equal(fileName(undefined), 'Untitled');
  });
});

/** Just enough of a Koa context for the files route. */
function fakeCtx(path: string, query: Record<string, string> = {}) {
  const headers: Record<string, string> = {};
  const ctx = {
    path,
    method: 'GET',
    query,
    status: 404,
    body: undefined as unknown,
    set(k: string, v: string) {
      headers[k] = v;
    },
    get(_k: string) {
      return '';
    },
  };
  return { ctx: ctx as unknown as Koa.Context, headers, raw: ctx };
}

describe('/files/', () => {
  const route = filesRoute();
  const next = async () => {};

  async function body(b: unknown): Promise<string> {
    const parts: Buffer[] = [];
    for await (const c of b as AsyncIterable<Buffer>) parts.push(c);
    return Buffer.concat(parts).toString();
  }

  test('serves a kept file, and asks to save it with ?download', async () => {
    await store.putObject('media/a.png', Buffer.from('picture'));
    const { ctx, headers, raw } = fakeCtx('/files/media/a.png');
    await route(ctx, next);
    assert.equal(headers['Content-Type'], 'image/png');
    assert.equal(await body(raw.body), 'picture');
    assert.equal(headers['Content-Disposition'], undefined);
    const dl = fakeCtx('/files/media/a.png', { download: '' });
    await route(dl.ctx, next);
    assert.equal(dl.headers['Content-Disposition'], 'attachment; filename="a.png"');
    await body(dl.raw.body);
  });

  test('refuses ../ and an unknown ending', async () => {
    await store.putObject('media/a.txt', Buffer.from('text'));
    await createProject({ id: randomUUID(), name: 'x', createdAt: '', updatedAt: '', nextImageNumber: 1, images: [] });
    for (const path of [
      '/files/../docs/meta/index.json',
      '/files/media/../../docs/meta/index.json',
      '/files/media%2F..%2F..%2Fdocs%2Fmeta%2Findex.json',
      '/files/media/a.txt',
      '/files/%E0%A4%A',
    ]) {
      const { ctx, raw } = fakeCtx(path);
      await route(ctx, next);
      assert.equal(raw.status, 404, path);
      assert.deepEqual(raw.body, { error: 'That file is not available.' }, path);
    }
  });
});
