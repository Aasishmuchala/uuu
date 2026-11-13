import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { createGateway, keyOfFilesUrl, RunwayApiError, RunwayTaskError, snapAspectRatio, type GatewayDeps } from './gateway.ts';
import { engineJson, engineStream } from './local/engine.ts';
import type { Pictures } from './local/pictures.ts';
import { routing } from './local/routing.ts';
import { createTaskStore, type TaskDoc } from './local/tasks.ts';
import { createStorage } from './storage.ts';

type Call = { method: string; path: string; type: string | undefined; body: Buffer };
type Reply = { status: number; json?: unknown; raw?: Buffer; type?: string };

let dir: string;
let sock: string;
let server: Server;
let calls: Call[];
let door: (call: Call) => Reply;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(20)]);

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rtf-gw-'));
  sock = join(dir, 'e.sock');
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const call: Call = { method: req.method!, path: req.url!, type: req.headers['content-type'], body: Buffer.concat(chunks) };
      calls.push(call);
      const r = door(call);
      if (r.raw) {
        res.writeHead(r.status, { 'content-type': r.type ?? 'application/octet-stream', 'content-length': r.raw.length });
        res.end(r.raw);
      } else {
        const text = JSON.stringify(r.json ?? null);
        res.writeHead(r.status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
        res.end(text);
      }
    });
  });
  await new Promise<void>((r) => server.listen(sock, r));
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

const fakePictures: Pictures = {
  async toJpeg(bytes, limits) {
    assert.equal(limits.maxSide, 4096);
    assert.equal(limits.maxBytes, 3_200_000);
    return Buffer.concat([JPEG, Buffer.from(`from:${bytes.length}`)]);
  },
  async size() {
    return { width: 640, height: 360 };
  },
};

let clock = 1_000_000;
let sleeps: number[];
let n = 0;

async function make(over: Partial<GatewayDeps> = {}) {
  const data = await mkdtemp(join(dir, 'data-'));
  const store = createStorage({ root: data });
  const tasks = createTaskStore({ docs: store.documentStore<TaskDoc>({ prefix: 'tasks' }) });
  const deps: GatewayDeps = {
    engine: {
      json: (m, p, b, o) => engineJson(m, p, b, { socketPath: sock, ...o }),
      stream: (p, f, max) => engineStream(p, f, max, { socketPath: sock }),
    },
    store,
    tasks,
    pictures: fakePictures,
    routing,
    claude: async () => ({ text: 'unused', truncated: false }),
    media: async () => {
      throw new Error('unused');
    },
    probe: async () => ({ duration: 5, frameRate: 24, width: 1280, height: 720 }),
    now: () => clock,
    timing: { sleep: async (ms) => void sleeps.push(ms), snapshotMs: 3000 },
    ...over,
  };
  return { gw: createGateway(deps), store, tasks, data, deps };
}

const ok = (json: unknown, status = 200): Reply => ({ status, json });
const refuse = (code: string, message: string): Reply => ({ status: 403, json: { error: { message }, code } });
const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path);

const baseDoor = (c: Call): Reply => {
  if (c.path === '/gen/app/models') return ok({ models: [] });
  if (c.path === '/gen/app/inputs') return ok({ input: `in${++n}`, type: 'image/jpeg', width: 10, height: 10, bytes: 10 }, 201);
  if (c.path === '/gen/app/jobs') return ok({ job: 'job1', cents: 25 }, 202);
  if (c.path.startsWith('/gen/app/jobs/')) return ok({ job: 'job1', state: 'waiting', progress: null, credits: 25, reason: null, output: null });
  return { status: 404, json: { error: { message: 'nope' }, code: 'gen_not_found' } };
};
/** From now on, answers about jobs come from `fn`; the rest stays as it was. */
const jobs = (fn: (c: Call) => Reply) => {
  door = (c) => (c.method === 'GET' && c.path.startsWith('/gen/app/jobs/') ? fn(c) : baseDoor(c));
};

beforeEach(() => {
  calls = [];
  sleeps = [];
  clock += 100_000;
  n = 0;
  door = baseDoor;
});

const turbo = (url = '/files/renders/local/a.png') => ({
  name: 'render-to-film',
  route: 'i2v',
  text_prompt: 'a slow push in',
  init_image: url,
  seconds: 5,
  width: 1280,
  height: 720,
});

describe('uploadAsset', () => {
  test('keeps a PNG, a JPEG and a WebP under uploads/ and answers a /files/ address', async () => {
    const { gw, store } = await make();
    for (const [bytes, ext] of [[PNG, 'png'], [JPEG, 'jpg'], [WEBP, 'webp']] as const) {
      const r = await gw.uploadAsset(bytes, { filename: `render.${ext}`, signal: AbortSignal.timeout(5000) });
      assert.match(r.url, new RegExp(`^/files/uploads/[0-9a-f-]{36}\\.${ext}$`));
      assert.equal(r.url, `/files/uploads/${r.id}.${ext}`);
      assert.deepEqual(await store.getObject(`uploads/${r.id}.${ext}`), bytes);
    }
    assert.equal(calls.length, 0, 'nothing went to the engine');
  });

  test('refuses a GIF, text, an empty body and 26 MB', async () => {
    const { gw } = await make();
    const gif = Buffer.from('GIF89a\u0001\u0000\u0001\u0000');
    await assert.rejects(gw.uploadAsset(gif), (e) => e instanceof RunwayTaskError && e.message === 'Upload a PNG, JPEG or WebP image.');
    await assert.rejects(gw.uploadAsset(Buffer.from('hello there, not a picture')), RunwayTaskError);
    await assert.rejects(gw.uploadAsset(Buffer.alloc(0)), /empty/);
    const big = Buffer.concat([PNG, Buffer.alloc(26 * 1024 * 1024)]);
    await assert.rejects(gw.uploadAsset(big), /over 25 MB/);
    const edge = Buffer.concat([PNG, Buffer.alloc(25 * 1024 * 1024 - PNG.length)]);
    assert.ok((await gw.uploadAsset(edge)).id);
  });

  test('an aborted call writes nothing', async () => {
    const { gw, data } = await make();
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(gw.uploadAsset(PNG, { signal: ac.signal }));
    await assert.rejects(readFile(join(data, 'objects')), /ENOENT|EISDIR/);
  });
});

describe('createTask for a generation', () => {
  test('gen4_turbo with a /files/ first frame: one input, then one job with the mapped body', async () => {
    const { gw, store } = await make();
    await store.putObject('renders/local/a.png', PNG);
    const { id } = await gw.createTask('gen4_turbo', turbo());
    assert.match(id, /^[0-9a-f-]{36}$/);
    const ins = posts('/gen/app/inputs');
    const jobs = posts('/gen/app/jobs');
    assert.equal(ins.length, 1);
    assert.equal(jobs.length, 1);
    assert.ok(calls.indexOf(ins[0]!) < calls.indexOf(jobs[0]!), 'the input first');
    assert.equal(ins[0]!.type, 'image/jpeg');
    assert.equal(ins[0]!.body.toString('latin1', 0, 3), '\xff\xd8\xff');
    assert.deepEqual(JSON.parse(jobs[0]!.body.toString()), {
      model: 'gen4_turbo',
      kind: 'image_to_video',
      inputs: [{ input: 'in1', role: 'first' }],
      prompt: 'a slow push in',
      seconds: 5,
      ratio: '1280:720',
    });
    const snap = await gw.taskSnapshot(id);
    assert.equal(snap.done, false);
    assert.equal(snap.status, 'PENDING');
  });

  test('ref_image_to_image sends up to three references to gen4_image', async () => {
    const { gw, store } = await make();
    for (const k of ['a', 'b', 'c', 'd']) await store.putObject(`renders/local/${k}.png`, PNG);
    await gw.createTask('ref_image_to_image', {
      text_prompt: 'a still',
      reference_images: ['a', 'b', 'c', 'd'].map((k) => ({ tag: k, url: `/files/renders/local/${k}.png` })),
      width: 1280,
      height: 720,
    });
    const body = JSON.parse(posts('/gen/app/jobs')[0]!.body.toString());
    assert.equal(body.model, 'gen4_image');
    assert.equal(body.kind, 'still_variation');
    assert.deepEqual(body.inputs, [{ input: 'in1', role: 'ref' }, { input: 'in2', role: 'ref' }, { input: 'in3', role: 'ref' }]);
    assert.equal(posts('/gen/app/inputs').length, 3);
  });

  test('a URL that is not /files/ is "This picture is not on this Mac." and nothing is sent', async () => {
    const { gw, store } = await make();
    await store.putObject('renders/local/a.png', PNG);
    for (const url of ['https://example.com/a.png', 'http://localhost:3171/files/renders/local/a.png', '/files/../etc/passwd', '/files/renders/local/missing.png', '/files/Renders/A.png', '', 'file:///etc/passwd']) {
      await assert.rejects(gw.createTask('gen4_turbo', turbo(url)), (e) => e instanceof RunwayTaskError && e.message === 'This picture is not on this Mac.', url);
    }
    assert.equal(posts('/gen/app/inputs').length, 0);
    assert.equal(posts('/gen/app/jobs').length, 0);
  });

  test('a task type that is not routed is refused with the routing sentence', async () => {
    const { gw } = await make();
    await assert.rejects(gw.createTask('no_such_type', {}), (e) => e instanceof RunwayTaskError && e.message === 'This kind of job is not available on this Mac yet.');
  });

  test('gen_no_allowance is a RunwayTaskError with the door\'s sentence, and no task is kept', async () => {
    const { gw, store, tasks } = await make();
    await store.putObject('renders/local/a.png', PNG);
    const sentence = 'This app may not spend anything right now. The owner can allow it in App Studio.';
    door = (c) => (c.path === '/gen/app/jobs' ? refuse('gen_no_allowance', sentence) : c.path === '/gen/app/inputs' ? ok({ input: 'in1' }, 201) : ok({ models: [] }));
    await assert.rejects(gw.createTask('gen4_turbo', turbo()), (e) => e instanceof RunwayTaskError && e.message === sentence);
    assert.equal(await tasks.count(), 0);
  });

  test('a refused input is reported with the door\'s words', async () => {
    const { gw, store } = await make();
    await store.putObject('renders/local/a.png', PNG);
    door = (c) => (c.path === '/gen/app/inputs' ? { status: 400, json: { error: { message: 'Send one picture.' }, code: 'gen_bad_input' } } : ok({ models: [] }));
    await assert.rejects(gw.createTask('gen4_turbo', turbo()), /Send one picture\./);
  });

  test('an engine that is not there is a plain sentence', async () => {
    const { gw, store, deps } = await make();
    await store.putObject('renders/local/a.png', PNG);
    const lonely = createGateway({ ...deps, engine: { json: (m, p, b, o) => engineJson(m, p, b, { socketPath: join(dir, 'gone.sock'), ...o }), stream: deps.engine.stream } });
    await assert.rejects(lonely.createTask('gen4_turbo', turbo()), (e) => e instanceof RunwayTaskError && /could not be reached/.test(e.message));
    void gw;
  });

  test('gen_busy keeps the task PENDING, asks again every 10 seconds, then it is accepted', async () => {
    const { gw, store } = await make();
    await store.putObject('renders/local/a.png', PNG);
    let tries = 0;
    door = (c) => {
      if (c.path === '/gen/app/models') return ok({ models: [] });
      if (c.path === '/gen/app/inputs') return ok({ input: `in${++n}` }, 201);
      if (c.path === '/gen/app/jobs') return ++tries <= 3 ? refuse('gen_busy', 'Two jobs are already running.') : ok({ job: 'job7', cents: 25 }, 202);
      return { status: 404, json: { code: 'gen_not_found' } };
    };
    const { id } = await gw.createTask('gen4_turbo', turbo());
    const first = await gw.taskSnapshot(id);
    assert.equal(first.status, 'PENDING');
    assert.equal(first.done, false);
    await gw.idle();
    assert.deepEqual(sleeps, [10_000, 10_000, 10_000]);
    assert.equal(posts('/gen/app/inputs').length, 1, 'the picture was sent once');
    assert.equal(posts('/gen/app/jobs').length, 4);
    jobs((c) => (c.path === '/gen/app/jobs/job7' ? ok({ state: 'working', progress: 0.3 }) : { status: 404, json: {} }));
    const snap = await gw.taskSnapshot(id);
    assert.deepEqual({ status: snap.status, progress: snap.progress }, { status: 'RUNNING', progress: 0.3 });
    assert.equal(calls.filter((c) => c.path === '/gen/app/jobs/job7').length, 1);
  });

  test('gen_busy for 20 minutes ends the task as FAILED', async () => {
    let t = 5_000_000;
    const { gw, store } = await make({ now: () => t, timing: { sleep: async (ms) => void (t += ms), snapshotMs: 3000 } });
    await store.putObject('renders/local/a.png', PNG);
    door = (c) => (c.path === '/gen/app/jobs' ? refuse('gen_busy', 'busy') : c.path === '/gen/app/inputs' ? ok({ input: 'in1' }, 201) : ok({ models: [] }));
    const { id } = await gw.createTask('gen4_turbo', turbo());
    await gw.idle();
    const snap = await gw.taskSnapshot(id);
    assert.equal(snap.status, 'FAILED');
    assert.match(snap.error!, /busy for too long/);
    assert.ok(posts('/gen/app/jobs').length >= 100 && posts('/gen/app/jobs').length <= 130);
  });

  test('a later refusal while waiting for room ends the task with the door\'s sentence', async () => {
    const { gw, store } = await make();
    await store.putObject('renders/local/a.png', PNG);
    let tries = 0;
    door = (c) => {
      if (c.path === '/gen/app/jobs') return ++tries === 1 ? refuse('gen_busy', 'busy') : refuse('gen_over_daily', "Today's spending limit is reached.");
      return c.path === '/gen/app/inputs' ? ok({ input: 'in1' }, 201) : ok({ models: [] });
    };
    const { id } = await gw.createTask('gen4_turbo', turbo());
    await gw.idle();
    const snap = await gw.taskSnapshot(id);
    assert.deepEqual({ status: snap.status, done: snap.done, error: snap.error }, { status: 'FAILED', done: true, error: "Today's spending limit is reached." });
  });
});

describe('taskSnapshot and getTask for a generation', () => {
  const start = async (over: Partial<GatewayDeps> = {}) => {
    const g = await make(over);
    await g.store.putObject('renders/local/a.png', PNG);
    const { id } = await g.gw.createTask('gen4_turbo', turbo());
    return { ...g, id };
  };
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(2000, 3)]);
  const jobPath = '/gen/app/jobs/job1';

  test('pending, then working, then done: the output is fetched once and kept under /files/media/', async () => {
    const { gw, id, store } = await start();
    let state = 'waiting';
    jobs((c) => {
      if (c.path === jobPath) return ok({ job: 'job1', state, progress: state === 'working' ? 0.5 : null, credits: 25, reason: null, output: state === 'done' ? { type: 'video/mp4', bytes: mp4.length } : null });
      if (c.path === `${jobPath}/output`) return { status: 200, raw: mp4, type: 'video/mp4' };
      return { status: 404, json: {} };
    });
    let s = await gw.taskSnapshot(id);
    assert.deepEqual({ status: s.status, done: s.done, progress: s.progress, url: s.url }, { status: 'PENDING', done: false, progress: 0, url: undefined });
    clock += 4000;
    state = 'working';
    s = await gw.taskSnapshot(id);
    assert.deepEqual({ status: s.status, done: s.done, progress: s.progress }, { status: 'RUNNING', done: false, progress: 0.5 });
    clock += 4000;
    state = 'done';
    s = await gw.taskSnapshot(id);
    assert.deepEqual({ status: s.status, done: s.done, progress: s.progress, url: s.url, filename: s.filename }, { status: 'SUCCEEDED', done: true, progress: 1, url: `/files/media/${id}.mp4`, filename: `${id}.mp4` });
    assert.deepEqual(await store.getObject(`media/${id}.mp4`), mp4);
    const outputs = () => calls.filter((c) => c.path === `${jobPath}/output`).length;
    assert.equal(outputs(), 1);
    const polls = calls.filter((c) => c.path === jobPath).length;
    clock += 10_000;
    s = await gw.taskSnapshot(id);
    assert.equal(s.url, `/files/media/${id}.mp4`);
    assert.equal(outputs(), 1, 'asked again, no second fetch');
    assert.equal(calls.filter((c) => c.path === jobPath).length, polls, 'a finished task is not asked about again');
  });

  test('the door is asked at most once every 3 seconds', async () => {
    const { gw, id } = await start();
    jobs((c) => (c.path === jobPath ? ok({ job: 'job1', state: 'working', progress: 0.1, output: null }) : { status: 404, json: {} }));
    await gw.taskSnapshot(id);
    await gw.taskSnapshot(id);
    clock += 2000;
    await gw.taskSnapshot(id);
    assert.equal(calls.filter((c) => c.path === jobPath).length, 1);
    clock += 1500;
    await gw.taskSnapshot(id);
    assert.equal(calls.filter((c) => c.path === jobPath).length, 2);
  });

  test('polls at the same moment fetch the output once', async () => {
    const { gw, id } = await start();
    jobs((c) => {
      if (c.path === jobPath) return ok({ state: 'done', output: { type: 'video/mp4', bytes: mp4.length } });
      if (c.path === `${jobPath}/output`) return { status: 200, raw: mp4, type: 'video/mp4' };
      return { status: 404, json: {} };
    });
    const all = await Promise.all([gw.taskSnapshot(id), gw.taskSnapshot(id), gw.taskSnapshot(id)]);
    assert.ok(all.every((s) => s.status === 'SUCCEEDED'));
    assert.equal(calls.filter((c) => c.path === `${jobPath}/output`).length, 1);
  });

  test('a failed or refused job is FAILED with the door\'s reason', async () => {
    for (const state of ['failed', 'refused']) {
      const { gw, id } = await start();
      jobs((c) => (c.path === jobPath ? ok({ job: 'job1', state, reason: 'Runway said no to this picture.', output: null }) : { status: 404, json: {} }));
      const s = await gw.taskSnapshot(id);
      assert.deepEqual({ status: s.status, done: s.done, error: s.error }, { status: 'FAILED', done: true, error: 'Runway said no to this picture.' });
      const t = await gw.getTask(id);
      assert.deepEqual(t, { id, status: 'FAILED', artifacts: [] });
    }
  });

  test('a job the door no longer knows is FAILED; an engine that is away leaves the task as it was', async () => {
    const a = await start();
    jobs(() => ({ status: 404, json: { error: { message: 'x' }, code: 'gen_not_found' } }));
    assert.equal((await a.gw.taskSnapshot(a.id)).status, 'FAILED');
    const b = await start();
    const away = createGateway({ ...b.deps, tasks: b.tasks, engine: { json: (m, p, x, o) => engineJson(m, p, x, { socketPath: join(dir, 'gone.sock'), ...o }), stream: b.deps.engine.stream } });
    const s = await away.taskSnapshot(b.id);
    assert.deepEqual({ status: s.status, done: s.done }, { status: 'PENDING', done: false });
  });

  test('an output of a kind this app cannot keep, or one that is too big, is FAILED', async () => {
    const a = await start();
    jobs((c) => (c.path === jobPath ? ok({ state: 'done', output: { type: 'text/html', bytes: 10 } }) : { status: 404, json: {} }));
    assert.equal((await a.gw.taskSnapshot(a.id)).status, 'FAILED');
    const b = await start();
    jobs((c) => (c.path === jobPath ? ok({ state: 'done', output: { type: 'video/mp4', bytes: 300 * 1024 * 1024 } }) : { status: 404, json: {} }));
    const s = await b.gw.taskSnapshot(b.id);
    assert.equal(s.status, 'FAILED');
    assert.match(s.error!, /larger than this app keeps/);
    assert.equal(calls.filter((c) => c.path.endsWith('/output')).length, 0);
  });

  test('getTask: the artifact has the task id, the local address and the clip\'s metadata', async () => {
    const { gw, id } = await start();
    jobs((c) => {
      if (c.path === jobPath) return ok({ state: 'done', output: { type: 'video/mp4', bytes: mp4.length } });
      if (c.path === `${jobPath}/output`) return { status: 200, raw: mp4, type: 'video/mp4' };
      return { status: 404, json: {} };
    });
    const t = await gw.getTask(id);
    assert.equal(t.status, 'SUCCEEDED');
    assert.deepEqual(t.artifacts, [{ id, url: `/files/media/${id}.mp4`, isDirectory: false, metadata: { duration: 5, frameRate: 24, size: { width: 1280, height: 720 } } }]);
  });

  test('getTask: a picture takes its size from the pictures module, and it is remembered', async () => {
    const { gw, store } = await make();
    await store.putObject('renders/local/a.png', PNG);
    await store.putObject('renders/local/b.png', PNG);
    let sized = 0;
    const counting = await make({ pictures: { ...fakePictures, size: async () => (sized++, { width: 640, height: 360 }) } });
    await counting.store.putObject('renders/local/a.png', PNG);
    const { id } = await counting.gw.createTask('ref_image_to_image', { text_prompt: 'x', reference_images: [{ tag: 'a', url: '/files/renders/local/a.png' }], width: 1280, height: 720 });
    jobs((c) => {
      if (c.path === '/gen/app/jobs/job1') return ok({ state: 'done', output: { type: 'image/png', bytes: PNG.length } });
      if (c.path === '/gen/app/jobs/job1/output') return { status: 200, raw: PNG, type: 'image/png' };
      return { status: 404, json: {} };
    });
    const t = await counting.gw.getTask(id);
    assert.deepEqual(t.artifacts[0]!.metadata, { size: { width: 640, height: 360 } });
    await counting.gw.getTask(id);
    assert.equal(sized, 1);
    void gw;
  });

  test('a task that does not exist is a RunwayApiError 404', async () => {
    const { gw } = await make();
    await assert.rejects(gw.taskSnapshot('nope'), (e) => e instanceof RunwayApiError && e.status === 404);
    await assert.rejects(gw.getTask('nope'), RunwayApiError);
  });

  test('a task kept before a restart is still known by a new gateway', async () => {
    const a = await start();
    const b = createGateway({ ...a.deps, tasks: a.tasks });
    jobs((c) => (c.path === jobPath ? ok({ state: 'working', progress: 0.2 }) : { status: 404, json: {} }));
    const s = await b.taskSnapshot(a.id);
    assert.deepEqual({ status: s.status, progress: s.progress }, { status: 'RUNNING', progress: 0.2 });
  });
});

describe('thinking and video work', () => {
  const via = (r: unknown) => ({ ...routing, routeTask: () => r }) as unknown as GatewayDeps['routing'];

  test('a claude task runs in the process; its text comes with includeText only', async () => {
    let seen: unknown;
    const { gw } = await make({
      routing: via({ claude: { prompt: 'hi' } }),
      claude: async (o) => ((seen = o), { text: '{"ok":true}', truncated: true }),
    });
    const { id } = await gw.createTask('claude_api', { prompt: 'hi' }, { internal: true } as never);
    await gw.idle();
    assert.deepEqual(seen, { prompt: 'hi' });
    const bare = await gw.taskSnapshot(id);
    assert.deepEqual({ status: bare.status, done: bare.done, text: bare.text }, { status: 'SUCCEEDED', done: true, text: undefined });
    const full = await gw.taskSnapshot(id, { includeText: true });
    assert.deepEqual({ text: full.text, truncated: full.truncated }, { text: '{"ok":true}', truncated: true });
    assert.equal(calls.length, 0, 'no models call for a local task type');
  });

  test('a claude task that throws is FAILED with the message', async () => {
    const { gw } = await make({ routing: via({ claude: {} }), claude: async () => { throw new Error('Not built yet.'); } });
    const { id } = await gw.createTask('claude_api', {});
    await gw.idle();
    const s = await gw.taskSnapshot(id, { includeText: true });
    assert.deepEqual({ status: s.status, error: s.error, text: s.text }, { status: 'FAILED', error: 'Not built yet.', text: undefined });
  });

  test('a media task keeps its file and getTask reads the probe', async () => {
    const { gw } = await make({
      routing: via({ media: { operation: 'trim' } }),
      media: async () => ({ key: 'media/x.mp4', type: 'video/mp4', width: null, height: null, duration: null, fps: null }),
    });
    const { id } = await gw.createTask('media_processing_v2', { operation: 'trim' });
    await gw.idle();
    assert.equal((await gw.taskSnapshot(id)).url, '/files/media/x.mp4');
    const t = await gw.getTask(id);
    assert.deepEqual(t.artifacts[0]!.metadata, { duration: 5, frameRate: 24, size: { width: 1280, height: 720 } });
  });

  test('a media task with several files has several artifacts', async () => {
    const out = (k: string) => ({ key: `media/${k}.png`, type: 'image/png', width: 100, height: 50, duration: null, fps: null });
    const { gw } = await make({ routing: via({ media: {} }), media: async () => [out('f1'), out('f2'), out('f3')] });
    const { id } = await gw.createTask('media_processing_v2', {});
    await gw.idle();
    const t = await gw.getTask(id);
    assert.deepEqual(t.artifacts.map((a) => a.url), ['/files/media/f1.png', '/files/media/f2.png', '/files/media/f3.png']);
    assert.equal(t.artifacts[0]!.id, id);
  });

  test('a task that was working when the app stopped is FAILED, not pending forever', async () => {
    const a = await make({ routing: via({ claude: {} }), claude: () => new Promise(() => {}) });
    const { id } = await a.gw.createTask('claude_api', {});
    assert.equal((await a.gw.taskSnapshot(id)).status, 'PENDING');
    const restarted = createGateway({ ...a.deps, tasks: a.tasks });
    const s = await restarted.taskSnapshot(id);
    assert.deepEqual({ status: s.status, done: s.done }, { status: 'FAILED', done: true });
    assert.match(s.error!, /interrupted/);
  });
});

describe('the rest', () => {
  test('getProfile', async () => {
    const { gw } = await make();
    assert.deepEqual(await gw.getProfile(), { id: 'local', name: 'You', email: null, picture: null });
  });

  test('snapAspectRatio is exported and snaps to the nearest listed ratio', async () => {
    const { gw } = await make();
    assert.equal(gw.snapAspectRatio, snapAspectRatio);
    assert.equal(snapAspectRatio(1920, 1080, 'x'), '16:9');
    assert.equal(snapAspectRatio(1080, 1920, 'x'), '9:16');
    assert.equal(snapAspectRatio(1000, 1000, 'x'), '1:1');
    assert.equal(snapAspectRatio(0, 10, 'x'), undefined);
  });

  test('keyOfFilesUrl', () => {
    assert.equal(keyOfFilesUrl('/files/a/b.png'), 'a/b.png');
    assert.equal(keyOfFilesUrl('/files/a/b.png?x=1'), 'a/b.png');
    assert.equal(keyOfFilesUrl('/files/a%2Fb.png'), 'a/b.png');
    for (const bad of ['/files/', '/files/../a.png', '/files/a//b.png', 'files/a.png', '//files/a.png', 'http://h/files/a.png', '/files/%zz', 42, null]) {
      assert.equal(keyOfFilesUrl(bad), null, String(bad));
    }
  });

  test('the error classes keep their names and fields', () => {
    const e = new RunwayTaskError('No.', { status: 403 });
    assert.equal(e.name, 'RunwayTaskError');
    assert.deepEqual({ status: e.status, issues: e.issues, body: e.body }, { status: 403, issues: [], body: null });
    assert.ok(e instanceof Error);
    assert.equal(new RunwayApiError('x', { status: 404 }).status, 404);
  });
});

describe('the Precision upscale guard (result at most 4096 px)', () => {
  const up = (factor: number) => ({ name: 'u', prompt: '', image: { url: '/files/renders/local/a.png', tag: 'still' }, scaleFactor: factor, flavor: 'photo' });
  const sized = (width: number, height: number) => ({ pictures: { ...fakePictures, size: async () => ({ width, height }) } });
  const sentScale = () => JSON.parse(posts('/gen/app/jobs')[0]!.body.toString()).scale;

  test('a picture that fits at the asked factor goes as asked', async () => {
    const { gw, store } = await make(sized(1000, 700));
    await store.putObject('renders/local/a.png', PNG);
    await gw.createTask('magnific_precision_upscaler_v2', up(4));
    assert.equal(sentScale(), 4);
  });

  test('4x of a 2000 px picture is lowered to 2x', async () => {
    const { gw, store } = await make(sized(2000, 1200));
    await store.putObject('renders/local/a.png', PNG);
    await gw.createTask('magnific_precision_upscaler_v2', up(4));
    assert.equal(sentScale(), 2);
  });

  test('a picture too large for even 2x is refused and nothing is sent', async () => {
    const { gw, store } = await make(sized(3000, 2000));
    await store.putObject('renders/local/a.png', PNG);
    await assert.rejects(
      gw.createTask('magnific_precision_upscaler_v2', up(2)),
      (e) => e instanceof RunwayTaskError && e.message === 'This picture is already as large as the upscaler goes here.'
    );
    assert.equal(posts('/gen/app/jobs').length, 0);
    assert.equal(posts('/gen/app/inputs').length, 0);
  });
});
