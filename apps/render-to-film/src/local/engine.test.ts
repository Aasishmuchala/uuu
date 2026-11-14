import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { duplexPair } from 'node:stream';
import { after, before, describe, test } from 'node:test';

import { engineJson, engineStream, EngineError } from './engine.ts';

let dir: string;
let sock: string;
let server: Server;
// The app fence's test mode opens no unix socket, so each request reaches the
// server through an in-process stream (`sock` is never bound).
// The client side also gets the socket's setTimeout, which the request calls.
const connect = () => {
  const [ours, theirs] = duplexPair();
  let timer: ReturnType<typeof setTimeout> | undefined;
  Object.assign(ours, {
    setTimeout(ms: number, onTimeout?: () => void) {
      clearTimeout(timer);
      if (onTimeout) ours.once('timeout', onTimeout);
      if (ms > 0) timer = setTimeout(() => ours.emit('timeout'), ms);
      return ours;
    },
  });
  // A side destroyed, as a socket cut short, ends the other side too.
  ours.once('close', () => {
    clearTimeout(timer);
    theirs.destroy();
  });
  theirs.once('close', () => ours.destroy());
  server.emit('connection', theirs);
  return ours;
};
let handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rtf-eng-'));
  sock = join(dir, 'e.sock');
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handler(req, res, Buffer.concat(chunks)));
  });
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

const json = (res: ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
};

describe('engineJson', () => {
  test('sends JSON and reads JSON, over the socket only', async () => {
    let seen: { method?: string; url?: string; type?: string; body?: string } = {};
    handler = (req, res, body) => {
      seen = { method: req.method, url: req.url, type: req.headers['content-type'], body: body.toString() };
      json(res, 202, { job: 'j1' });
    };
    const r = await engineJson('POST', '/gen/app/jobs', { model: 'm' }, { socketPath: sock, connect });
    assert.deepEqual(r, { status: 202, json: { job: 'j1' } });
    assert.deepEqual(seen, { method: 'POST', url: '/gen/app/jobs', type: 'application/json', body: '{"model":"m"}' });
  });

  test('a Buffer body goes raw with its content type', async () => {
    let seen: { type?: string; body?: Buffer } = {};
    handler = (req, res, body) => {
      seen = { type: req.headers['content-type'], body };
      json(res, 201, { input: 'i1' });
    };
    await engineJson('POST', '/gen/app/inputs', Buffer.from([1, 2, 3]), { socketPath: sock, connect, contentType: 'image/jpeg' });
    assert.equal(seen.type, 'image/jpeg');
    assert.deepEqual([...seen.body!], [1, 2, 3]);
  });

  test('an error status comes back as a reply, not a throw', async () => {
    handler = (_req, res) => json(res, 403, { error: { message: 'No.' }, code: 'gen_busy' });
    const r = await engineJson('GET', '/x', undefined, { socketPath: sock, connect });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'gen_busy');
  });

  test('an empty answer is null; a non-JSON answer throws', async () => {
    handler = (_req, res) => { res.writeHead(204); res.end(); };
    assert.deepEqual(await engineJson('GET', '/x', undefined, { socketPath: sock, connect }), { status: 204, json: null });
    handler = (_req, res) => { res.writeHead(200); res.end('<html>'); };
    await assert.rejects(engineJson('GET', '/x', undefined, { socketPath: sock, connect }), /not JSON/);
  });

  test('an answer over 2 MB is refused', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(`"${'a'.repeat(2 * 1024 * 1024 + 10)}"`); };
    await assert.rejects(engineJson('GET', '/x', undefined, { socketPath: sock, connect }), /too much/);
  });

  test('a slow engine times out', async () => {
    handler = () => {};
    await assert.rejects(engineJson('GET', '/x', undefined, { socketPath: sock, connect, timeoutMs: 50 }), /too long/);
  });

  test('no socket, or a socket nobody listens on, is EngineError', async () => {
    await assert.rejects(engineJson('GET', '/x', undefined, { socketPath: join(dir, 'none.sock') }), (e) => e instanceof EngineError && /could not be reached/.test(e.message));
    const was = process.env['ENGINE_SOCKET'];
    delete process.env['ENGINE_SOCKET'];
    await assert.rejects(engineJson('GET', '/x'), /socket is not set/);
    if (was !== undefined) process.env['ENGINE_SOCKET'] = was;
  });

  test('the socket comes from ENGINE_SOCKET when not given', async () => {
    // A path nobody listens on: "could not be reached", not "is not set".
    process.env['ENGINE_SOCKET'] = join(dir, 'from-env.sock');
    try {
      await assert.rejects(engineJson('GET', '/healthz'), (e) => e instanceof EngineError && /could not be reached/.test(e.message));
    } finally {
      delete process.env['ENGINE_SOCKET'];
    }
  });
});

describe('engineStream', () => {
  test('streams to a file, which appears only when complete', async () => {
    const payload = Buffer.alloc(300_000, 7);
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': payload.length }); res.end(payload); };
    const to = join(dir, 'out.mp4');
    const r = await engineStream('/gen/app/jobs/j/output', to, 1_000_000, { socketPath: sock, connect });
    assert.deepEqual({ status: r.status, type: r.type, bytes: r.bytes }, { status: 200, type: 'video/mp4', bytes: 300_000 });
    assert.equal((await readFile(to)).length, 300_000);
    assert.equal((await stat(to)).mode & 0o777, 0o600);
  });

  test('over the limit: refused, nothing left behind', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'video/mp4' }); res.write(Buffer.alloc(5000)); res.write(Buffer.alloc(5000)); res.end(); };
    const to = join(dir, 'big.mp4');
    await assert.rejects(engineStream('/o', to, 6000, { socketPath: sock, connect }), (e) => e instanceof EngineError && e.tooLarge);
    assert.equal((await readdir(dir)).some((f) => f.startsWith('big.mp4')), false);
  });

  test('a declared length over the limit is refused before any byte is kept', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': 999_999 }); res.write(Buffer.alloc(10)); };
    await assert.rejects(engineStream('/o', join(dir, 'decl.mp4'), 1000, { socketPath: sock, connect }), (e) => e instanceof EngineError && e.tooLarge);
  });

  test('a non-200 answer writes nothing and returns its JSON', async () => {
    handler = (_req, res) => json(res, 403, { code: 'gen_not_ready' });
    const to = join(dir, 'none.png');
    const r = await engineStream('/o', to, 1000, { socketPath: sock, connect });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'gen_not_ready');
    assert.equal((await readdir(dir)).includes('none.png'), false);
  });

  test('a cut-short answer leaves no file', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'image/png', 'content-length': 100 }); res.write(Buffer.alloc(10)); setTimeout(() => res.destroy(), 20); };
    const to = join(dir, 'cut.png');
    await assert.rejects(engineStream('/o', to, 1000, { socketPath: sock, connect }), EngineError);
    assert.equal((await readdir(dir)).some((f) => f.startsWith('cut.png')), false);
  });
});
