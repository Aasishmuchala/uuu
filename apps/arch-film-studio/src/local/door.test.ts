import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ALLOW_SENTENCE,
  createDoor,
  dollars,
  NO_SPENDING,
  PRICE_UNKNOWN,
  priceWords,
  readAllowance,
  TOO_LARGE_TO_KEEP,
} from './door.ts';
import { EngineError, type Engine, type EngineReply } from './engine.ts';

type Call = { method: string; path: string; body: unknown };

/** A fake engine: `answer` decides each JSON reply; every call is recorded. */
function fakeEngine(answer: (c: Call) => EngineReply | Promise<EngineReply>, stream?: Engine['stream']) {
  const calls: Call[] = [];
  const engine: Engine = {
    async json(method, path, body) {
      const c = { method, path, body };
      calls.push(c);
      return answer(c);
    },
    stream:
      stream ??
      (async () => {
        throw new Error('no stream in this test');
      }),
  };
  return { engine, calls };
}

const store = {
  async getObject(key: string) {
    return key === 'missing.jpg' ? null : Buffer.from('picture');
  },
  async objectPath(key: string) {
    return `/nowhere/${key}`;
  },
};
const pictures = { async toJpeg(b: Buffer) { return Buffer.concat([Buffer.from('jpeg:'), b]); } };

describe('price words', () => {
  test('cents become dollars', () => {
    assert.equal(priceWords(1), 'About $0.01');
    assert.equal(priceWords(40), 'About $0.40');
    assert.equal(priceWords(1999), 'About $19.99');
    assert.equal(priceWords(null), PRICE_UNKNOWN);
    assert.equal(PRICE_UNKNOWN, 'Price unknown');
    assert.equal(dollars(0), '$0.00');
  });
});

describe('the allowance', () => {
  test('open', () => {
    const a = readAllowance({ open: true, budget: 500, spent: 40, left: 460, expiresAt: '2026-11-19T00:00:00Z' });
    assert.deepEqual(a, {
      open: true,
      budget: 500,
      spent: 40,
      left: 460,
      expiresAt: '2026-11-19T00:00:00Z',
      words: 'Allowed today: $5.00. Spent: $0.40.',
      needs: null,
    });
  });
  test('closed, and anything unreadable is closed', async () => {
    const closed = readAllowance({ open: false, budget: 0, spent: 0, left: 0, expiresAt: null });
    assert.equal(closed.open, false);
    assert.equal(closed.words, NO_SPENDING);
    assert.equal(closed.needs, ALLOW_SENTENCE);
    assert.equal(readAllowance(null).open, false);
    const { engine } = fakeEngine(() => {
      throw new EngineError('The engine could not be reached.');
    });
    const a = await createDoor({ engine, store, pictures }).allowance();
    assert.equal(a.open, false);
    assert.equal(a.needs, 'Allow spending in the bar above.');
  });
});

describe('models', () => {
  test('kept 30 seconds, and the engine away says so', async () => {
    let t = 0;
    const { engine, calls } = fakeEngine(() => ({ status: 200, json: { models: [{ id: 'gen4.5', ready: true }] } }));
    const door = createDoor({ engine, store, pictures, now: () => t });
    assert.equal((await door.models()).list?.[0]?.id, 'gen4.5');
    t = 29_000;
    await door.models();
    assert.equal(calls.length, 1);
    t = 31_000;
    await door.models();
    assert.equal(calls.length, 2);

    const away = fakeEngine(() => {
      throw new EngineError('x');
    });
    const m = await createDoor({ engine: away.engine, store, pictures }).models();
    assert.equal(m.list, null);
    assert.equal(m.why, 'The engine could not be reached.');
  });
});

describe('quote', () => {
  test('prices each item and sums them', async () => {
    const { engine, calls } = fakeEngine(() => ({ status: 200, json: { items: [{ cents: 40 }, { cents: 120 }], total: 160 } }));
    const q = await createDoor({ engine, store, pictures }).quote([
      { model: 'gemini_image3_pro', kind: 'still_variation', resolution: '4K' },
      { model: 'gen4.5', kind: 'image_to_video', seconds: 10 },
    ]);
    assert.deepEqual(calls[0]!.body, {
      items: [
        { model: 'gemini_image3_pro', kind: 'still_variation', resolution: '4K' },
        { model: 'gen4.5', kind: 'image_to_video', seconds: 10 },
      ],
    });
    assert.deepEqual(q.items.map((i) => i.words), ['About $0.40', 'About $1.20']);
    assert.equal(q.total, 160);
    assert.equal(q.words, 'About $1.60');
  });
  test('a missing price makes the total unknown; a refusal makes all unknown', async () => {
    const one = fakeEngine(() => ({ status: 200, json: { items: [{ cents: 40 }, { cents: null }] } }));
    const q = await createDoor({ engine: one.engine, store, pictures }).quote([
      { model: 'a', kind: 'still_variation' },
      { model: 'b', kind: 'still_variation' },
    ]);
    assert.equal(q.items[1]!.words, 'Price unknown');
    assert.equal(q.total, null);
    assert.equal(q.words, 'Price unknown');
    const no = fakeEngine(() => ({ status: 400, json: { error: { message: 'no' }, code: 'gen_bad_request' } }));
    const q2 = await createDoor({ engine: no.engine, store, pictures }).quote([{ model: 'a', kind: 'still_variation' }]);
    assert.equal(q2.items[0]!.cents, null);
  });
});

describe('sending', () => {
  test('a picture goes as a JPEG and its input id comes back', async () => {
    const { engine, calls } = fakeEngine(() => ({ status: 201, json: { input: 'in_1' } }));
    const r = await createDoor({ engine, store, pictures }).sendInput('p/x/work.jpg');
    assert.deepEqual(r, { input: 'in_1' });
    assert.equal(calls[0]!.path, '/gen/app/inputs');
    assert.ok(Buffer.isBuffer(calls[0]!.body));
    assert.equal((calls[0]!.body as Buffer).toString(), 'jpeg:picture');
  });
  test('a job: 202, busy, refused, and an answer that never came', async () => {
    let reply: EngineReply | null = { status: 202, json: { job: 'job_1', cents: 40 } };
    const { engine, calls } = fakeEngine(() => {
      if (!reply) throw new EngineError('The engine took too long to answer.');
      return reply;
    });
    const door = createDoor({ engine, store, pictures });
    const body = { model: 'gen4.5', kind: 'image_to_video', inputs: [{ input: 'in_1', role: 'first' }], prompt: 'p', seconds: 5, ratio: '1280:720' };
    assert.deepEqual(await door.submit(body), { job: 'job_1', cents: 40 });
    assert.deepEqual(calls[0]!.body, body);
    reply = { status: 403, json: { error: { message: 'Two jobs are already running.' }, code: 'gen_busy' } };
    assert.deepEqual(await door.submit(body), { busy: true });
    reply = { status: 403, json: { error: { message: "The owner's allowance for this app has ended." }, code: 'gen_no_allowance' } };
    assert.deepEqual(await door.submit(body), { refused: "The owner's allowance for this app has ended." });
    reply = { status: 500, json: null };
    assert.deepEqual(await door.submit(body), { refused: 'The engine did not start this.' });
    reply = null;
    await assert.rejects(door.submit(body), EngineError);
  });
  test('status: gone, failed with its reason, working', async () => {
    let reply: EngineReply = { status: 404, json: { code: 'gen_no_job' } };
    const { engine } = fakeEngine(() => reply);
    const door = createDoor({ engine, store, pictures });
    assert.deepEqual(await door.status('job_1'), { gone: true });
    reply = { status: 200, json: { state: 'failed', reason: 'Runway  said\nno.', output: null } };
    const st = await door.status('job_1');
    assert.ok(st && !st.gone && st.failed && st.reason === 'Runway said no.');
    reply = { status: 200, json: { state: 'working', progress: 0.5 } };
    const w = await door.status('job_1');
    assert.ok(w && !w.gone && !w.failed && w.progress === 0.5);
  });
  test('keep: streamed to the key, not ready, too large', async () => {
    let mode = 'ok';
    const written: string[] = [];
    const { engine } = fakeEngine(
      () => ({ status: 200, json: null }),
      async (path, toFile) => {
        if (mode === 'big') throw new EngineError('The result is larger than this app keeps.', { tooLarge: true });
        if (mode === 'wait') return { status: 409, type: 'application/json', bytes: 0, json: { code: 'gen_not_ready' } };
        written.push(`${path} -> ${toFile}`);
        return { status: 200, type: 'image/png', bytes: 3, json: null };
      }
    );
    const door = createDoor({ engine, store, pictures });
    assert.deepEqual(await door.keep('job_1', 'media/a.png'), { kept: { key: 'media/a.png', bytes: 3 } });
    assert.deepEqual(written, ['/gen/app/jobs/job_1/output -> /nowhere/media/a.png']);
    mode = 'wait';
    assert.deepEqual(await door.keep('job_1', 'media/a.png'), { notReady: true });
    mode = 'big';
    assert.deepEqual(await door.keep('job_1', 'media/a.png'), { failed: TOO_LARGE_TO_KEEP });
  });
});
