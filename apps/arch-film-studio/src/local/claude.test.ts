import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createStorage } from '../storage.ts';
import { runClaude, THINKING_REFUSED, type ClaudeOptions } from './claude.ts';
import type { Engine } from './engine.ts';
import type { Pictures } from './pictures.ts';

let root: string;
let store: ReturnType<typeof createStorage>;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'rtf-claude-'));
  store = createStorage({ root });
  await store.putObject('uploads/a.png', Buffer.from('AAA'));
  await store.putObject('media/b.jpg', Buffer.from('BBB'));
});
after(() => rm(root, { recursive: true, force: true }));

type Call = { method: string; path: string; body: any; opts: any };
function fake(reply: { status: number; json: any }) {
  const calls: Call[] = [];
  const engine: Engine = {
    json: async (method, path, body, opts) => {
      calls.push({ method, path, body, opts });
      return reply;
    },
    stream: async () => {
      throw new Error('not used');
    },
  };
  const shrunk: Array<{ bytes: string; limits: unknown }> = [];
  const pictures: Pictures = {
    toJpeg: async (bytes, limits) => {
      shrunk.push({ bytes: bytes.toString(), limits });
      return Buffer.from(`jpeg:${bytes.toString()}`);
    },
    size: async () => ({ width: 1, height: 1 }),
  };
  return { calls, shrunk, deps: { engine, store, pictures } };
}
const ok = (content: unknown[], stop = 'end_turn') => ({ status: 200, json: { content, stop_reason: stop } });

// Option shapes as the four call sites pass them (api.ts, edit-api.ts, closeups-api.ts, storyboard-api.ts).
const peopleCheck: ClaudeOptions = {
  model: 'claude-opus-5-5',
  system_prompt: 'check system',
  prompt: 'check prompt',
  images: [{ url: '/files/uploads/a.png' }, { url: '/files/media/b.jpg' }],
  temperature: 0.2,
  max_output_tokens: 10000,
};
const closeupFinder: ClaudeOptions = {
  model: 'claude-opus-5-5',
  system_prompt: 'finder system',
  prompt: 'finder prompt',
  images: [{ url: '/files/media/b.jpg' }],
  temperature: 0.4,
  max_output_tokens: 10000,
};
const storyboard: ClaudeOptions = { ...closeupFinder, system_prompt: 'planner system', prompt: 'planner prompt' };
const editor: ClaudeOptions = {
  model: 'claude-sonnet-5-5',
  system_prompt: 'editor system',
  prompt: 'editor prompt',
  temperature: 0.3,
  max_output_tokens: 6000,
};

describe('runClaude: the Messages body of each call site', () => {
  test('people check: two pictures then the text', async () => {
    const f = fake(ok([{ type: 'text', text: 'fine' }]));
    const r = await runClaude(f.deps, peopleCheck);
    assert.deepEqual(r, { text: 'fine', truncated: false });
    const c = f.calls[0]!;
    assert.equal(c.method, 'POST');
    assert.equal(c.path, '/v1/messages');
    assert.equal(c.opts.timeoutMs, 300000);
    assert.deepEqual(c.body, {
      model: 'claude-opus-5-5',
      system: 'check system',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('jpeg:AAA').toString('base64') } },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('jpeg:BBB').toString('base64') } },
            { type: 'text', text: 'check prompt' },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 10000,
    });
  });

  test('pictures are shrunk to 1568 and 4 MB', async () => {
    const f = fake(ok([{ type: 'text', text: 'x' }]));
    await runClaude(f.deps, closeupFinder);
    assert.deepEqual(f.shrunk, [{ bytes: 'BBB', limits: { maxSide: 1568, maxBytes: 4 * 1024 * 1024 } }]);
  });

  test('close-up finder and storyboard planner', async () => {
    for (const [o, system, prompt] of [
      [closeupFinder, 'finder system', 'finder prompt'],
      [storyboard, 'planner system', 'planner prompt'],
    ] as const) {
      const f = fake(ok([{ type: 'text', text: 'x' }]));
      await runClaude(f.deps, o);
      const b = f.calls[0]!.body;
      assert.equal(b.system, system);
      assert.equal(b.temperature, 0.4);
      assert.equal(b.max_tokens, 10000);
      assert.equal(b.messages[0].content.length, 2);
      assert.deepEqual(b.messages[0].content[1], { type: 'text', text: prompt });
    }
  });

  test('AI editor: no pictures, text only', async () => {
    const f = fake(ok([{ type: 'text', text: 'x' }]));
    await runClaude(f.deps, editor);
    assert.deepEqual(f.calls[0]!.body, {
      model: 'claude-sonnet-5-5',
      system: 'editor system',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'editor prompt' }] }],
      temperature: 0.3,
      max_tokens: 6000,
    });
    assert.deepEqual(f.shrunk, []);
  });

  test('missing system, temperature and max tokens are left out or defaulted', async () => {
    const f = fake(ok([{ type: 'text', text: 'x' }]));
    await runClaude(f.deps, { model: 'm', prompt: 'p' });
    const b = f.calls[0]!.body;
    assert.equal('system' in b, false);
    assert.equal('temperature' in b, false);
    assert.equal(b.max_tokens, 4096);
  });
});

describe('runClaude: the answer', () => {
  test('text blocks are joined; other blocks are skipped', async () => {
    const f = fake(ok([{ type: 'text', text: 'one ' }, { type: 'thinking', thinking: 'no' }, { type: 'text', text: 'two' }]));
    assert.deepEqual(await runClaude(f.deps, editor), { text: 'one two', truncated: false });
  });

  test('stop_reason max_tokens means truncated', async () => {
    const f = fake(ok([{ type: 'text', text: 'cut off' }], 'max_tokens'));
    assert.deepEqual(await runClaude(f.deps, editor), { text: 'cut off', truncated: true });
  });
});

describe('runClaude: refusals', () => {
  test('a relay refusal gives the thinking sentence', async () => {
    for (const status of [401, 403, 404, 500, 502]) {
      const f = fake({ status, json: { error: { message: 'secret detail' } } });
      await assert.rejects(runClaude(f.deps, editor), (e: Error) => e.message === THINKING_REFUSED);
    }
    assert.equal(THINKING_REFUSED, "This app's thinking needs the model provider. Check Settings, Models.");
  });

  test('an answer with no content list is a refusal too', async () => {
    const f = fake({ status: 200, json: { nope: true } });
    await assert.rejects(runClaude(f.deps, editor), (e: Error) => e.message === THINKING_REFUSED);
  });

  test('429 says the provider is busy', async () => {
    const f = fake({ status: 429, json: {} });
    await assert.rejects(runClaude(f.deps, editor), /busy/);
  });

  test('a picture that is not a /files/ key is refused before anything is sent', async () => {
    for (const url of ['https://example.com/a.png', 'file:///etc/passwd', '/files/../x.png', '/files/uploads/%2e%2e/a.png', '/other/a.png', '']) {
      const f = fake(ok([{ type: 'text', text: 'x' }]));
      await assert.rejects(runClaude(f.deps, { ...editor, images: [{ url }] }), /not on this Mac/);
      assert.equal(f.calls.length, 0);
    }
  });

  test('a /files/ key with no file is refused', async () => {
    const f = fake(ok([{ type: 'text', text: 'x' }]));
    await assert.rejects(runClaude(f.deps, { ...editor, images: [{ url: '/files/uploads/none.png' }] }), /no longer on this Mac/);
    assert.equal(f.calls.length, 0);
  });

  test('more than eight pictures are refused', async () => {
    const f = fake(ok([{ type: 'text', text: 'x' }]));
    const images = Array.from({ length: 9 }, () => ({ url: '/files/media/b.jpg' }));
    await assert.rejects(runClaude(f.deps, { ...editor, images }), /at most 8/);
    assert.equal(f.calls.length, 0);
  });

  test('no model is refused', async () => {
    const f = fake(ok([]));
    await assert.rejects(runClaude(f.deps, { prompt: 'p' }), /No model/);
  });
});
