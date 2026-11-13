import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createStorage, isKey } from './storage.ts';

let root: string;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'rtf-storage-'));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

const fresh = async (hooks = {}) => {
  const dir = await mkdtemp(join(root, 's-'));
  return { dir, s: createStorage({ root: dir, hooks }) };
};

describe('objects', () => {
  test('put, get, head, delete', async () => {
    const { s } = await fresh();
    await s.putObject('a/b/pic.png', Buffer.from('hello'), { contentType: 'image/png' });
    assert.equal((await s.getObject('a/b/pic.png'))?.toString(), 'hello');
    assert.deepEqual(await s.headObject('a/b/pic.png'), { size: 5 });
    await s.deleteObject('a/b/pic.png');
    assert.equal(await s.getObject('a/b/pic.png'), null);
    assert.equal(await s.headObject('a/b/pic.png'), null);
  });

  test('deleting a missing object is not an error, and a missing one reads as null', async () => {
    const { s } = await fresh();
    await s.deleteObject('nothing/here.png');
    assert.equal(await s.getObject('nothing/here.png'), null);
  });

  test('files are 0600 and folders 0700', async () => {
    const { s, dir } = await fresh();
    await s.putObject('x/y/z.png', Buffer.from('1'));
    assert.equal((await stat(join(dir, 'objects/x/y/z.png'))).mode & 0o777, 0o600);
    assert.equal((await stat(join(dir, 'objects/x/y'))).mode & 0o777, 0o700);
    assert.equal((await stat(join(dir, 'objects/x'))).mode & 0o777, 0o700);
  });

  test('keys with .., //, a capital letter, 201 characters, a leading slash or a trailing slash are refused', async () => {
    const { s } = await fresh();
    const bad = ['../x.png', 'a/../b.png', 'a//b.png', 'A.png', 'a/B.png', `${'a'.repeat(197)}.png`, '/abs.png', 'a/', '', '.hidden', 'a b.png', 'a~b.png'];
    for (const key of bad) {
      assert.equal(isKey(key), false, `isKey(${JSON.stringify(key)})`);
      await assert.rejects(s.putObject(key, Buffer.from('x')), /storage key/);
      await assert.rejects(s.getObject(key), /storage key/);
      await assert.rejects(s.presignGet(key), /storage key/);
    }
    assert.equal(`${'a'.repeat(196)}.png`.length, 200);
    assert.equal(isKey(`${'a'.repeat(196)}.png`), true);
  });

  test('presignGet is /files/<key>', async () => {
    const { s } = await fresh();
    assert.equal(await s.presignGet('thumbs/ab/c.webp', { expiresIn: 900 }), '/files/thumbs/ab/c.webp');
  });

  test('a stored link is not read through', async () => {
    const { s, dir } = await fresh();
    await s.putObject('real.png', Buffer.from('secret'));
    await symlink(join(dir, 'objects/real.png'), join(dir, 'objects/link.png'));
    assert.equal(await s.getObject('link.png'), null);
  });

  test('openForServing: serves a png, refuses a link, a linked folder, an unknown ending and a folder', async () => {
    const { s, dir } = await fresh();
    await s.putObject('p/ok.png', Buffer.from('12345'));
    await s.putObject('p/data.bin', Buffer.from('x'));
    await mkdir(join(dir, 'objects/p/adir.png'));
    await symlink(join(dir, 'objects/p/ok.png'), join(dir, 'objects/p/link.png'));
    const outside = await mkdtemp(join(root, 'outside-'));
    await writeFile(join(outside, 'o.png'), 'outside');
    await symlink(outside, join(dir, 'objects/jump'));
    const served = await s.openForServing('p/ok.png');
    assert.ok(served);
    assert.equal(served.type, 'image/png');
    assert.equal(served.size, 5);
    await served.handle.close();
    assert.equal(await s.openForServing('p/link.png'), null);
    assert.equal(await s.openForServing('jump/o.png'), null);
    assert.equal(await s.openForServing('p/data.bin'), null);
    assert.equal(await s.openForServing('p/adir.png'), null);
    assert.equal(await s.openForServing('p/missing.png'), null);
    assert.equal(await s.openForServing('../x.png'), null);
    for (const [key, type] of [['a.jpg', 'image/jpeg'], ['a.webp', 'image/webp'], ['a.mp4', 'video/mp4'], ['a.json', 'application/json']] as const) {
      await s.putObject(key, Buffer.from('z'));
      const f = await s.openForServing(key);
      assert.equal(f?.type, type);
      await f?.handle.close();
    }
  });

  test('a write that fails before the rename leaves the old file and no temp file', async () => {
    let crash = false;
    const { s, dir } = await fresh({
      beforeRename: () => {
        if (crash) throw new Error('crash');
      },
    });
    await s.putObject('keep.png', Buffer.from('old'));
    crash = true;
    await assert.rejects(s.putObject('keep.png', Buffer.from('new')), /crash/);
    crash = false;
    assert.equal((await s.getObject('keep.png'))?.toString(), 'old');
    assert.deepEqual(await readdir(join(dir, 'objects')), ['keep.png']);
  });
});

describe('documents', () => {
  test('get of a missing document is null; the first mutate sees undefined', async () => {
    const { s } = await fresh();
    const store = s.documentStore<{ n: number }>({ prefix: 'library/' });
    assert.equal(await store.get('me.json'), null);
    let seen: unknown = 'unset';
    let calls = 0;
    const next = await store.update('me.json', (cur) => {
      calls++;
      seen = cur;
      return { n: 1 };
    });
    assert.deepEqual(next, { n: 1 });
    assert.equal(seen, undefined);
    assert.equal(calls, 1);
    const got = await store.get('me.json');
    assert.deepEqual(got?.value, { n: 1 });
    assert.match(got!.etag, /^[0-9a-f]{40}$/);
  });

  test('the file is docs/<prefix>/<name>.json, once, whether or not the name ends in .json', async () => {
    const { s, dir } = await fresh();
    const store = s.documentStore<{ n: number }>({ prefix: 'edits/' });
    await store.update('abc.json', () => ({ n: 1 }));
    await store.update('abc', (c) => ({ n: (c?.n ?? 0) + 1 }));
    assert.deepEqual(await readdir(join(dir, 'docs/edits')), ['abc.json']);
    assert.deepEqual((await store.get('abc'))?.value, { n: 2 });
    assert.equal((await stat(join(dir, 'docs/edits/abc.json'))).mode & 0o777, 0o600);
  });

  test('the etag changes when the document does', async () => {
    const { s } = await fresh();
    const store = s.documentStore<{ n: number }>({ prefix: 'x' });
    await store.update('d', () => ({ n: 1 }));
    const a = (await store.get('d'))!.etag;
    await store.update('d', () => ({ n: 2 }));
    assert.notEqual((await store.get('d'))!.etag, a);
  });

  test('two concurrent updates of one document both land', async () => {
    const { s } = await fresh();
    const store = s.documentStore<{ n: number }>({ prefix: 'count/' });
    await Promise.all(
      Array.from({ length: 40 }, () =>
        store.update('c.json', async (cur) => {
          await new Promise((r) => setTimeout(r, 1));
          return { n: (cur?.n ?? 0) + 1 };
        })
      )
    );
    assert.equal((await store.get('c.json'))?.value.n, 40);
  });

  test('updates of different documents do not wait for each other', async () => {
    const { s } = await fresh();
    const store = s.documentStore<{ n: number }>({ prefix: 'two/' });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = store.update('a.json', async () => {
      await gate;
      return { n: 1 };
    });
    await store.update('b.json', () => ({ n: 2 }));
    release();
    await slow;
    assert.equal((await store.get('b.json'))?.value.n, 2);
  });

  test('a mutate that throws leaves the document and does not block the next update', async () => {
    const { s } = await fresh();
    const store = s.documentStore<{ n: number }>({ prefix: 't/' });
    await store.update('d.json', () => ({ n: 1 }));
    await assert.rejects(store.update('d.json', () => { throw new Error('nope'); }), /nope/);
    assert.deepEqual((await store.get('d.json'))?.value, { n: 1 });
    assert.deepEqual(await store.update('d.json', (c) => ({ n: c!.n + 1 })), { n: 2 });
  });

  test('a crash between the temp file and the rename leaves the old document', async () => {
    let crash = false;
    const { s, dir } = await fresh({
      beforeRename: () => {
        if (crash) throw new Error('power cut');
      },
    });
    const store = s.documentStore<{ n: number }>({ prefix: 'lib/' });
    await store.update('me.json', () => ({ n: 1 }));
    crash = true;
    await assert.rejects(store.update('me.json', () => ({ n: 2 })), /power cut/);
    crash = false;
    assert.deepEqual((await store.get('me.json'))?.value, { n: 1 });
    assert.deepEqual(await readdir(join(dir, 'docs/lib')), ['me.json']);
    assert.deepEqual(await store.update('me.json', (c) => ({ n: c!.n + 10 })), { n: 11 });
  });

  test('prefixes and names with .., //, capitals or a leading slash are refused', async () => {
    const { s } = await fresh();
    for (const [prefix, name] of [['../x', 'a'], ['a//b', 'a'], ['A', 'a'], ['ok', '../a'], ['ok', 'a/b'], ['ok', 'A.json'], ['ok', ''], ['', 'a']] as const) {
      const store = s.documentStore<number>({ prefix });
      await assert.rejects(store.get(name), /storage key/, `${prefix} ${name}`);
      await assert.rejects(store.update(name, () => 1), /storage key/, `${prefix} ${name}`);
    }
  });

  test('a document that is a link is not read', async () => {
    const { s, dir } = await fresh();
    const store = s.documentStore<{ n: number }>({ prefix: 'lnk/' });
    await store.update('real.json', () => ({ n: 1 }));
    await symlink(join(dir, 'docs/lnk/real.json'), join(dir, 'docs/lnk/via.json'));
    assert.equal(await store.get('via.json'), null);
  });
});
