import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createStorage } from '../storage.ts';
import { probe, runMediaOp, type MediaDeps } from './media-ops.ts';
import type { TaskOutput } from './tasks.ts';

const FFMPEG = process.env['FFMPEG'] || '/opt/homebrew/bin/ffmpeg';
const FFPROBE = process.env['FFPROBE'] || '/opt/homebrew/bin/ffprobe';
const have = existsSync(FFMPEG) && existsSync(FFPROBE);
const skip = have ? false : `ffmpeg is not at ${FFMPEG}`;

let root: string;
let store: ReturnType<typeof createStorage>;
let deps: MediaDeps;

function makeClip(file: string, seconds: number, size: string, rate: number) {
  const r = spawnSync(
    FFMPEG,
    ['-nostdin', '-hide_banner', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=${size}:rate=${rate}`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', file],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'rtf-media-'));
  store = createStorage({ root });
  deps = { store, ffmpeg: FFMPEG, ffprobe: FFPROBE };
  if (!have) return;
  makeClip(await store.objectPath('media/a.mp4'), 2, '640x360', 25);
  makeClip(await store.objectPath('media/b.mp4'), 2, '640x360', 25);
  makeClip(await store.objectPath('media/small.mp4'), 2, '320x240', 30);
});
after(() => rm(root, { recursive: true, force: true }));

const one = (r: TaskOutput | TaskOutput[]): TaskOutput => {
  assert.ok(!Array.isArray(r));
  return r as TaskOutput;
};

describe('probe', { skip }, () => {
  test('duration, frame rate and size', async () => {
    const p = await probe('media/a.mp4', deps);
    assert.equal(p.width, 640);
    assert.equal(p.height, 360);
    assert.equal(p.frameRate, 25);
    assert.ok(Math.abs(p.duration - 2) < 0.1, String(p.duration));
  });

  test('a /files/ address works too', async () => {
    assert.equal((await probe('/files/media/small.mp4', deps)).frameRate, 30);
  });

  test('a file that is not a video is refused', async () => {
    await store.putObject('media/notvideo.mp4', Buffer.from('not a video at all'));
    await assert.rejects(probe('media/notvideo.mp4', deps), /could not be read/);
  });

  test('keys with .. , a missing file and a link are refused', async () => {
    await assert.rejects(probe('media/../a.mp4', deps), /not a file this Mac keeps/);
    await assert.rejects(probe('/etc/passwd', deps), /not a file this Mac keeps/);
    await assert.rejects(probe('media/none.mp4', deps), /no longer on this Mac/);
    await symlink(await store.objectPath('media/a.mp4'), join(root, 'objects/media/link.mp4'));
    await assert.rejects(probe('media/link.mp4', deps), /not a file this Mac keeps/);
  });
});

describe('capture_frames', { skip }, () => {
  test('three times make three PNG files', async () => {
    const r = await runMediaOp({ operation: 'capture_frames', input: ['media/a.mp4'], parameters: { times: [0.2, 1, 1.8] } }, deps);
    assert.ok(Array.isArray(r));
    assert.equal(r.length, 3);
    for (const o of r) {
      assert.equal(o.type, 'image/png');
      assert.match(o.key, /^media\/[0-9a-f-]{36}\.png$/);
      const bytes = await readFile(await store.objectPath(o.key));
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.equal((await lstat(await store.objectPath(o.key))).mode & 0o777, 0o600);
    }
    assert.equal(new Set(r.map((o) => o.key)).size, 3);
  });

  test('bad times are refused', async () => {
    for (const times of [[], [-1], ['1'], [NaN], Array.from({ length: 25 }, () => 1), undefined]) {
      await assert.rejects(runMediaOp({ operation: 'capture_frames', input: ['media/a.mp4'], parameters: { times } }, deps), /frame times/);
    }
  });
});

describe('trim', { skip }, () => {
  test('0.5 to 1.5 is about one second', async () => {
    const o = one(await runMediaOp({ operation: 'trim', input: ['media/a.mp4'], parameters: { start: 0.5, end: 1.5 } }, deps));
    assert.equal(o.type, 'video/mp4');
    const p = await probe(o.key, deps);
    assert.ok(Math.abs(p.duration - 1) < 0.15, String(p.duration));
    assert.equal(p.width, 640);
  });

  test('a cut that ends before it starts is refused', async () => {
    await assert.rejects(runMediaOp({ operation: 'trim', input: ['media/a.mp4'], parameters: { start: 1, end: 1 } }, deps), /cut is not usable/);
  });

  test('ffmpeg failing leaves no output behind', async () => {
    const before = (await readdir(join(root, 'objects/media'))).length;
    await assert.rejects(runMediaOp({ operation: 'trim', input: ['media/notvideo.mp4'], parameters: { start: 0, end: 1 } }, deps), /ffmpeg could not/);
    assert.equal((await readdir(join(root, 'objects/media'))).length, before);
  });
});

describe('stitch', { skip }, () => {
  test('two 2-second clips with a 0.5-second fade run about 3.5 seconds', async () => {
    const o = one(
      await runMediaOp({ operation: 'stitch', input: ['media/a.mp4', 'media/b.mp4'], parameters: { transition: { type: 'fade', duration: 0.5 } } }, deps)
    );
    const p = await probe(o.key, deps);
    assert.ok(Math.abs(p.duration - 3.5) < 0.15, String(p.duration));
    assert.equal(p.width, 640);
  });

  test('three pieces chain the fades', async () => {
    const o = one(
      await runMediaOp({ operation: 'stitch', input: ['media/a.mp4', 'media/b.mp4', 'media/a.mp4'], parameters: { transition: { type: 'fade', duration: 0.5 } } }, deps)
    );
    const p = await probe(o.key, deps);
    assert.ok(Math.abs(p.duration - 5) < 0.2, String(p.duration));
  });

  test('a piece of another size is fitted to the first', async () => {
    const o = one(
      await runMediaOp({ operation: 'stitch', input: ['media/a.mp4', 'media/small.mp4'], parameters: { transition: { type: 'fade', duration: 0.5 } } }, deps)
    );
    const p = await probe(o.key, deps);
    assert.equal(p.width, 640);
    assert.equal(p.height, 360);
  });

  test('a fade longer than half the shortest piece is shortened', async () => {
    const o = one(
      await runMediaOp({ operation: 'stitch', input: ['media/a.mp4', 'media/b.mp4'], parameters: { transition: { type: 'fade', duration: 4.9 } } }, deps)
    );
    const p = await probe(o.key, deps);
    assert.ok(Math.abs(p.duration - 3) < 0.15, String(p.duration));
  });
});

describe('timeline_export', { skip }, () => {
  test('1280 x 720 at 25 fps, each piece trimmed and fitted', async () => {
    const clips = [
      { assetId: 'media/a.mp4', track: 0, start: 0, duration: 1, contentType: 'video', sourceStart: 0.5, availableDuration: 2 },
      { assetId: 'media/small.mp4', track: 0, start: 1, duration: 1.5, contentType: 'video', sourceStart: 0, availableDuration: 2 },
    ];
    const o = one(
      await runMediaOp(
        { operation: 'timeline_export', input: ['media/a.mp4', 'media/small.mp4'], parameters: { version: 1, clips, width: 1280, height: 720, fps: 25 } },
        deps
      )
    );
    const p = await probe(o.key, deps);
    assert.equal(p.width, 1280);
    assert.equal(p.height, 720);
    assert.equal(p.frameRate, 25);
    assert.ok(Math.abs(p.duration - 2.5) < 0.15, String(p.duration));
  });

  test('a clip naming a file that is not an input, an odd size and a bad rate are refused', async () => {
    const clip = { assetId: 'media/b.mp4', track: 0, start: 0, duration: 1, contentType: 'video', sourceStart: 0, availableDuration: 2 };
    const base = { version: 1, clips: [clip], width: 640, height: 360, fps: 25 };
    await assert.rejects(runMediaOp({ operation: 'timeline_export', input: ['media/a.mp4'], parameters: base }, deps), /clips on the timeline/);
    await assert.rejects(runMediaOp({ operation: 'timeline_export', input: ['media/b.mp4'], parameters: { ...base, width: 641 } }, deps), /film size/);
    await assert.rejects(runMediaOp({ operation: 'timeline_export', input: ['media/b.mp4'], parameters: { ...base, fps: 0 } }, deps), /frame rate/);
    await assert.rejects(runMediaOp({ operation: 'timeline_export', input: ['media/b.mp4'], parameters: { ...base, clips: [] } }, deps), /nothing on the timeline/);
  });
});

describe('refusals and the stop', () => {
  test('an input key with .. is refused for every operation', { skip }, async () => {
    for (const op of [
      { operation: 'capture_frames', input: ['media/../media/a.mp4'], parameters: { times: [1] } },
      { operation: 'trim', input: ['../a.mp4'], parameters: { start: 0, end: 1 } },
      { operation: 'stitch', input: ['media/a.mp4', 'media//b.mp4'], parameters: { transition: { type: 'fade', duration: 0.5 } } },
      { operation: 'timeline_export', input: ['media/../a.mp4'], parameters: { clips: [], width: 640, height: 360, fps: 25 } },
    ]) {
      await assert.rejects(runMediaOp(op, deps), /not a file this Mac keeps/);
    }
  });

  test('an unknown operation and no input are refused', async () => {
    await assert.rejects(runMediaOp({ operation: 'delete_everything' }, deps), /cannot do that/);
    await assert.rejects(runMediaOp({ operation: 'trim', input: [], parameters: { start: 0, end: 1 } }, deps), /Pick a video/);
  });

  test('no ffmpeg path is refused', async () => {
    const saved = process.env['FFMPEG'];
    delete process.env['FFMPEG'];
    try {
      await store.putObject('media/stub.mp4', Buffer.from('x'));
      await assert.rejects(runMediaOp({ operation: 'trim', input: ['media/stub.mp4'], parameters: { start: 0, end: 1 } }, { store }), /has not said where/);
    } finally {
      if (saved !== undefined) process.env['FFMPEG'] = saved;
    }
  });

  test('a 1-second stop ends the whole process group, a grandchild too', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rtf-fake-'));
    try {
      const pidFile = join(dir, 'pid');
      const fake = join(dir, 'ffmpeg');
      await writeFile(fake, `#!/bin/sh\nsleep 60 &\necho $! > "${pidFile}"\nwait\n`);
      await chmod(fake, 0o755);
      await store.putObject('media/slow.mp4', Buffer.from('x'));
      const started = Date.now();
      await assert.rejects(
        runMediaOp({ operation: 'trim', input: ['media/slow.mp4'], parameters: { start: 0, end: 1 } }, { store, ffmpeg: fake, stopMs: 1000 }),
        /took too long/
      );
      assert.ok(Date.now() - started < 8000, 'ended near the stop');
      const pid = Number((await readFile(pidFile, 'utf8')).trim());
      assert.ok(pid > 1);
      await new Promise((r) => setTimeout(r, 200));
      assert.throws(() => process.kill(pid, 0), /ESRCH/);
      const left = (await readdir(join(root, 'objects/media'))).filter((n) => n.startsWith('~'));
      assert.deepEqual(left, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
