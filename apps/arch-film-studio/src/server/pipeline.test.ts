import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { createDoor } from '../local/door.ts';
import type { Engine, EngineReply } from '../local/engine.ts';
import { defaultSettings, imageKeys, type EnhancementRun, type Project, type ProjectImage } from '../shared/project.ts';
import { store } from '../storage.ts';
import {
  CANCELLED,
  createPipeline,
  type DoorJob,
  INTERRUPTED_BEFORE_START,
  KEEP_TRIES,
  LOCKED_MASTER,
  NO_ANSWER,
  NOT_KEPT,
  STATUS_TRIES,
  STORYBOARD_EMPTY,
  VERSION_BUSY,
  WAITED_TOO_LONG,
} from './pipeline.ts';
import { createProject, getProject, updateProject } from './store.ts';

const PRO_RATIOS = (
  '1344:768,768:1344,1024:1024,1184:864,864:1184,1536:672,832:1248,1248:832,896:1152,1152:896,' +
  '2048:2048,1696:2528,2528:1696,1792:2400,2400:1792,1856:2304,2304:1856,1536:2752,2752:1536,3168:1344,' +
  '4096:4096,3392:5056,5056:3392,3584:4800,4800:3584,3712:4608,4608:3712,3072:5504,5504:3072,6336:2688'
).split(',');
const MODELS = [
  { id: 'gemini_image3_pro', words: 'Nano Banana Pro on Runway', ratios: PRO_RATIOS, resolutions: ['1K', '2K', '4K'], ready: true, why: null },
  { id: 'magnific_precision_upscaler_v2', ratios: null, resolutions: null, ready: true, why: null },
  { id: 'gen4.5', ratios: ['1280:720', '720:1280', '960:960'], resolutions: null, ready: true, why: null },
];

type Call = { method: string; path: string; body: unknown };

/**
 * The fake engine: the door's app routes, with `onJob` deciding each
 * `POST /gen/app/jobs`, `jobs` the state of each job it gave out, and
 * `outputs` what each finished job streams.
 */
function fakeEngine() {
  const calls: Call[] = [];
  let n = 0;
  const jobs = new Map<string, Record<string, unknown>>();
  const outputs = new Map<string, string>();
  /** The file cannot be written (a full disk): every fetch of an output throws. */
  const broken = { stream: false, status: false };
  let onJob: (body: any) => EngineReply | Promise<EngineReply> = () => {
    const job = `job_${++n}`;
    jobs.set(job, { state: 'waiting' });
    return { status: 202, json: { job, cents: 40 } };
  };
  const engine: Engine = {
    async json(method, path, body) {
      calls.push({ method, path, body });
      if (path === '/gen/app/models') return { status: 200, json: { models: MODELS } };
      if (path === '/gen/app/inputs') return { status: 201, json: { input: `in_${calls.length}` } };
      if (path === '/gen/app/jobs') return onJob(body);
      const m = /^\/gen\/app\/jobs\/([A-Za-z0-9_-]+)$/.exec(path);
      if (m && broken.status) return { status: 500, json: null };
      if (m) {
        const j = jobs.get(m[1]!);
        return j ? { status: 200, json: { job: m[1], ...j } } : { status: 404, json: { code: 'gen_no_job' } };
      }
      return { status: 404, json: null };
    },
    async stream(path, toFile) {
      if (broken.stream) throw new Error('ENOSPC: no space left on device');
      const m = /^\/gen\/app\/jobs\/([A-Za-z0-9_-]+)\/output$/.exec(path)!;
      const content = outputs.get(m[1]!) ?? 'SIZE:2048x1365';
      await writeFile(toFile, content);
      return { status: 200, type: 'image/png', bytes: content.length, json: null };
    },
  };
  return {
    engine,
    calls,
    jobs,
    outputs,
    broken,
    setOnJob(f: typeof onJob) {
      onJob = f;
    },
    sends: () => calls.filter((c) => c.path === '/gen/app/jobs'),
  };
}

/** Pictures by their bytes: "SIZE:<w>x<h>". */
const pictures = {
  async size(b: Buffer) {
    const m = /^SIZE:(\d+)x(\d+)/.exec(b.toString());
    if (!m) throw new Error('not a picture');
    return { width: Number(m[1]), height: Number(m[2]) };
  },
  async toJpeg(b: Buffer) {
    return b;
  },
};

let dir: string;
let t: number;
let fake: ReturnType<typeof fakeEngine>;
let claude: (o: any) => Promise<{ text: string; truncated: boolean }>;
let pipeline: ReturnType<typeof createPipeline>;
const tick = (ms = 3001) => (t += ms);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'afs-pipe-'));
  process.env['APP_DATA'] = dir;
  t = Date.parse('2026-11-19T10:00:00Z');
  fake = fakeEngine();
  claude = async () => ({ text: '{}', truncated: false });
  const door = createDoor({ engine: fake.engine, store, pictures, now: () => t });
  pipeline = createPipeline({
    door,
    store,
    pictures,
    claude: (o) => claude(o),
    media: async () => ({ key: 'media/film.mp4', type: 'video/mp4', width: null, height: null, duration: null, fps: null }),
    probe: async () => ({ duration: 6, frameRate: 24, width: 1280, height: 720 }),
    now: () => t,
  });
});

afterEach(async () => {
  await pipeline.idle();
  await rm(dir, { recursive: true, force: true });
});

async function newProject(images: number, size = { width: 3000, height: 2000 }): Promise<Project> {
  const id = randomUUID();
  const at = new Date(t).toISOString();
  await createProject({ id, name: 'Test', createdAt: at, updatedAt: at, nextImageNumber: 1, images: [] });
  for (let i = 0; i < images; i++) {
    const imageId = randomUUID();
    const keys = imageKeys(id, imageId, 'jpg');
    await store.putObject(keys.workKey, Buffer.from(`SIZE:${size.width}x${size.height}`));
    await updateProject(id, (d) => {
      const image: ProjectImage = {
        id: imageId,
        code: `IMG-${String(d.nextImageNumber).padStart(3, '0')}`,
        name: `render ${i}`,
        ...size,
        ...keys,
        uploadedAt: at,
        settings: defaultSettings(),
        enhancements: [],
      };
      d.images.push(image);
      d.nextImageNumber += 1;
    });
  }
  return getProject(id);
}

/** A finished, kept enhancement of `side` on its long edge. */
async function finishedRun(p: Project, imageIndex: number, width: number, height: number): Promise<EnhancementRun> {
  const key = `media/${randomUUID()}.png`;
  await store.putObject(key, Buffer.from(`SIZE:${width}x${height}`));
  const run: EnhancementRun = {
    id: randomUUID(),
    version: p.images[imageIndex]!.enhancements.length + 1,
    createdAt: new Date(t).toISOString(),
    settings: defaultSettings(),
    prompt: 'x',
    imageSize: '4K',
    state: 'succeeded',
    decision: 'pending',
    storedKey: key,
    outputSize: { width, height },
  };
  await updateProject(p.id, (d) => {
    d.images[imageIndex]!.enhancements.push(run);
  });
  return run;
}

const runsOf = async (id: string, i = 0) => (await getProject(id)).images[i]!.enhancements as DoorJob[];

describe('enhance and the pump', () => {
  test('an enhancement is sent as the door takes it', async () => {
    const p = await newProject(1);
    await pipeline.enhance(p.id, [p.images[0]!.id]);
    const [run] = await runsOf(p.id);
    assert.equal(run!.state, 'queued');
    assert.equal((run as unknown as EnhancementRun).version, 1);
    await pipeline.advance(p.id);
    const [send] = fake.sends();
    const body = send!.body as Record<string, any>;
    assert.equal(body['model'], 'gemini_image3_pro');
    assert.equal(body['kind'], 'still_variation');
    assert.equal(body['resolution'], '4K');
    assert.equal(body['ratio'], '5056:3392');
    assert.deepEqual(body['inputs'], [{ input: body['inputs'][0].input, role: 'ref' }]);
    assert.match(body['prompt'], /the reference image "ref1"/);
    const [after] = await runsOf(p.id);
    assert.equal(after!.state, 'running');
    assert.equal(after!.taskId, 'job_1');
    assert.equal(after!.cents, 40);
  });

  test('two queued jobs go out and the third waits', async () => {
    const p = await newProject(3);
    await pipeline.enhance(p.id, p.images.map((i) => i.id));
    await pipeline.advance(p.id);
    assert.equal(fake.sends().length, 2);
    const doc = await getProject(p.id);
    const states = doc.images.map((i) => (i.enhancements[0] as DoorJob).taskId ?? i.enhancements[0]!.state);
    assert.deepEqual(states, ['job_1', 'job_2', 'queued']);
    // Still working at the door: the third keeps waiting.
    tick();
    await pipeline.advance(p.id);
    assert.equal(fake.sends().length, 2);
    // One finishes: the third goes.
    fake.jobs.set('job_1', { state: 'done', output: { type: 'image/png', bytes: 14 } });
    tick();
    await pipeline.advance(p.id);
    assert.equal(fake.sends().length, 3);
  });

  test('gen_busy puts a job back to queued', async () => {
    const p = await newProject(1);
    fake.setOnJob(() => ({ status: 403, json: { error: { message: 'Two jobs are already running.' }, code: 'gen_busy' } }));
    await pipeline.enhance(p.id, [p.images[0]!.id]);
    await pipeline.advance(p.id);
    const [run] = await runsOf(p.id);
    assert.equal(run!.state, 'queued');
    assert.equal(run!.claimId, undefined);
    assert.equal(run!.claimedAt, undefined);
  });

  test("a refusal carries the door's sentence", async () => {
    const p = await newProject(1);
    fake.setOnJob(() => ({
      status: 403,
      json: { error: { message: "The owner's allowance for this app has ended." }, code: 'gen_no_allowance' },
    }));
    await pipeline.enhance(p.id, [p.images[0]!.id]);
    await pipeline.advance(p.id);
    const [run] = await runsOf(p.id);
    assert.equal(run!.state, 'failed');
    assert.equal(run!.error, "The owner's allowance for this app has ended.");
  });

  test('the claim is written before the send', async () => {
    const p = await newProject(1);
    let seen: DoorJob | undefined;
    fake.setOnJob(async () => {
      seen = (await runsOf(p.id))[0];
      return { status: 202, json: { job: 'job_9', cents: 40 } };
    });
    await pipeline.enhance(p.id, [p.images[0]!.id]);
    await pipeline.advance(p.id);
    assert.equal(seen?.state, 'running');
    assert.ok(seen?.claimId);
    assert.equal(seen?.claimedAt, new Date(t).toISOString());
    assert.equal(seen?.taskId, undefined);
  });

  test('a claim with no id after 2 minutes fails and is never sent again', async () => {
    const p = await newProject(1);
    await pipeline.enhance(p.id, [p.images[0]!.id]);
    // A crash between the claim and the 202: claimed, no id.
    await updateProject(p.id, (d) => {
      const r = d.images[0]!.enhancements[0]!;
      r.state = 'running';
      r.claimedAt = new Date(t).toISOString();
      r.claimId = 'gone-process';
    });
    tick(60_000);
    await pipeline.advance(p.id);
    assert.equal((await runsOf(p.id))[0]!.state, 'running');
    tick(61_000);
    await pipeline.advance(p.id);
    const [run] = await runsOf(p.id);
    assert.equal(run!.state, 'failed');
    assert.equal(run!.error, INTERRUPTED_BEFORE_START);
    tick();
    await pipeline.advance(p.id);
    assert.equal(fake.sends().length, 0);
  });

  test("a done job's file lands under media/ with its size", async () => {
    const p = await newProject(1);
    await pipeline.enhance(p.id, [p.images[0]!.id]);
    await pipeline.advance(p.id);
    fake.jobs.set('job_1', { state: 'done', output: { type: 'image/png', bytes: 14 } });
    fake.outputs.set('job_1', 'SIZE:5056x3392');
    tick();
    await pipeline.advance(p.id);
    const run = (await runsOf(p.id))[0] as unknown as EnhancementRun;
    assert.equal(run.state, 'succeeded');
    assert.match(run.storedKey!, /^media\/[0-9a-f-]{36}\.png$/);
    assert.deepEqual(run.outputSize, { width: 5056, height: 3392 });
    assert.equal((await store.getObject(run.storedKey!))!.toString(), 'SIZE:5056x3392');
  });

  test('an output type the app does not keep fails', async () => {
    const p = await newProject(1);
    await pipeline.enhance(p.id, [p.images[0]!.id]);
    await pipeline.advance(p.id);
    fake.jobs.set('job_1', { state: 'done', output: { type: 'image/gif', bytes: 10 } });
    tick();
    await pipeline.advance(p.id);
    const [run] = await runsOf(p.id);
    assert.equal(run!.state, 'failed');
    assert.equal(run!.error, 'The engine made a file this app cannot keep.');
    assert.equal((run as unknown as EnhancementRun).storedKey, undefined);
  });

  test("a failed job carries the door's reason; a job the door lost says so", async () => {
    const p = await newProject(2);
    await pipeline.enhance(p.id, p.images.map((i) => i.id));
    await pipeline.advance(p.id);
    fake.jobs.set('job_1', { state: 'failed', reason: 'Runway refused  this\npicture.' });
    fake.jobs.delete('job_2');
    tick();
    await pipeline.advance(p.id);
    assert.equal((await runsOf(p.id, 0))[0]!.error, 'Runway refused this picture.');
    assert.equal((await runsOf(p.id, 1))[0]!.error, 'The engine no longer has this job.');
  });
});

describe('review', () => {
  test('approving a second run rejects the first', async () => {
    const p = await newProject(1);
    const a = await finishedRun(p, 0, 2048, 1365);
    const b = await finishedRun(await getProject(p.id), 0, 2048, 1365);
    const imageId = p.images[0]!.id;
    await pipeline.decide(p.id, imageId, a.id, 'approved');
    await pipeline.decide(p.id, imageId, b.id, 'approved');
    const runs = (await getProject(p.id)).images[0]!.enhancements;
    assert.deepEqual(runs.map((r) => r.decision), ['rejected', 'approved']);
  });

  test('a revision keeps its note; an unfinished run cannot be approved', async () => {
    const p = await newProject(1);
    const a = await finishedRun(p, 0, 2048, 1365);
    await pipeline.decide(p.id, p.images[0]!.id, a.id, 'revision', '  lift the shadows ');
    const r = (await getProject(p.id)).images[0]!.enhancements[0]!;
    assert.equal(r.decision, 'revision');
    assert.equal(r.decisionNote, 'lift the shadows');
    await pipeline.enhance(p.id, [p.images[0]!.id], undefined, 'lift the shadows');
    const queued = (await getProject(p.id)).images[0]!.enhancements[1]!;
    assert.equal(queued.revisionNote, 'lift the shadows');
    assert.match(queued.prompt, /Revision requested by the reviewer, applied within these rules: lift the shadows$/);
    await assert.rejects(pipeline.decide(p.id, p.images[0]!.id, queued.id, 'approved'), /Only a finished version/);
  });

  test('a locked master refuses a decision', async () => {
    const p = await newProject(1);
    const a = await finishedRun(p, 0, 5056, 3392);
    await pipeline.decide(p.id, p.images[0]!.id, a.id, 'approved');
    await pipeline.master(p.id, [p.images[0]!.id]);
    const m = (await getProject(p.id)).images[0]!.master!;
    assert.equal(m.locked, true);
    assert.equal(m.reusedEnhancement, true);
    assert.equal(m.storedKey, a.storedKey);
    await assert.rejects(pipeline.decide(p.id, p.images[0]!.id, a.id, 'rejected'), { message: LOCKED_MASTER });
    await assert.rejects(pipeline.enhance(p.id, [p.images[0]!.id]), { message: LOCKED_MASTER });
  });
});

describe('masters', () => {
  test('an approved 1920 picture is upscaled 2x with no prompt, and locked once kept', async () => {
    const p = await newProject(1);
    const a = await finishedRun(p, 0, 1920, 1080);
    await pipeline.decide(p.id, p.images[0]!.id, a.id, 'approved');
    await pipeline.master(p.id, [p.images[0]!.id]);
    await pipeline.advance(p.id);
    const body = fake.sends()[0]!.body as Record<string, any>;
    assert.equal(body['model'], 'magnific_precision_upscaler_v2');
    assert.equal(body['kind'], 'still_upscale');
    assert.equal(body['prompt'], '');
    assert.equal(body['scale'], 2);
    assert.equal(body['inputs'][0].role, 'image');
    assert.equal(body['ratio'], undefined);
    assert.equal(body['resolution'], undefined);
    fake.jobs.set('job_1', { state: 'done', output: { type: 'image/png', bytes: 14 } });
    fake.outputs.set('job_1', 'SIZE:3840x2160');
    tick();
    await pipeline.advance(p.id);
    const m = (await getProject(p.id)).images[0]!.master!;
    assert.equal(m.state, 'succeeded');
    assert.equal(m.locked, true);
    assert.deepEqual(m.outputSize, { width: 3840, height: 2160 });
  });

  test('2528 stays at its approved size', async () => {
    const p = await newProject(1);
    const a = await finishedRun(p, 0, 2528, 1696);
    await pipeline.decide(p.id, p.images[0]!.id, a.id, 'approved');
    await pipeline.master(p.id, [p.images[0]!.id]);
    const m = (await getProject(p.id)).images[0]!.master!;
    assert.equal(m.reusedEnhancement, true);
    assert.equal(m.locked, true);
    assert.equal(m.error, undefined);
    assert.equal(fake.sends().length, 0);
  });
});

describe('storyboard, shots and film', () => {
  async function withMasters(): Promise<Project> {
    const p = await newProject(2);
    for (const i of [0, 1]) {
      const r = await finishedRun(await getProject(p.id), i, 5056, 3392);
      await pipeline.decide(p.id, p.images[i]!.id, r.id, 'approved');
    }
    // Only IMG-001 gets a master.
    await pipeline.master(p.id, [p.images[0]!.id]);
    return getProject(p.id);
  }

  test('needs a master first', async () => {
    const p = await newProject(1);
    await assert.rejects(pipeline.createStoryboard(p.id, '', '16:9'), {
      message: 'Unlocks once at least one image is approved as a master.',
    });
  });

  test('a shot naming an unknown IMG- code is dropped', async () => {
    const p = await withMasters();
    let asked: any;
    claude = async (o) => {
      asked = o;
      return {
        text:
          '```json\n' +
          JSON.stringify({
            title: 'Villa',
            narrative: 'n',
            grade: 'g',
            musicDirection: 'piano',
            shots: [
              { imageCode: 'IMG-001', videoPrompt: 'Slow dolly-in.', durationSeconds: 5, transition: 'fade' },
              { imageCode: 'IMG-002', videoPrompt: 'No master here.' },
              { imageCode: 'IMG-404', videoPrompt: 'Nowhere.' },
            ],
          }) +
          '\n```',
        truncated: false,
      };
    };
    await pipeline.createStoryboard(p.id, 'A calm film.', '16:9');
    await pipeline.idle();
    const sb = (await getProject(p.id)).storyboard!;
    assert.equal(sb.state, 'succeeded');
    assert.equal(sb.title, 'Villa');
    assert.equal(sb.shots.length, 1);
    assert.equal(sb.shots[0]!.imageId, p.images[0]!.id);
    assert.equal(sb.shots[0]!.number, 1);
    assert.equal(asked.images.length, 1);
    assert.equal(asked.max_output_tokens, 8000);

    // The shot's clip: gen4.5, its frame, its seconds.
    await pipeline.generateShots(p.id, [sb.shots[0]!.id]);
    await pipeline.advance(p.id);
    const body = fake.sends()[0]!.body as Record<string, any>;
    assert.equal(body['model'], 'gen4.5');
    assert.equal(body['kind'], 'image_to_video');
    assert.equal(body['ratio'], '1280:720');
    assert.equal(body['seconds'], 5);
    assert.equal(body['inputs'][0].role, 'first');
    assert.match(body['prompt'], /^Slow dolly-in\. Photorealistic architectural cinematography/);

    // Kept, approved, and stitched into a film.
    fake.jobs.set('job_1', { state: 'done', output: { type: 'video/mp4', bytes: 10 } });
    tick();
    await pipeline.advance(p.id);
    const shot = (await getProject(p.id)).storyboard!.shots[0]!;
    assert.equal(shot.video!.state, 'succeeded');
    assert.match(shot.video!.storedKey!, /^media\/.+\.mp4$/);
    await pipeline.decideShot(p.id, shot.id, 'approved');
    await pipeline.assembleFilm(p.id, 'fade');
    await pipeline.idle();
    const film = (await getProject(p.id)).film!;
    assert.equal(film.state, 'succeeded');
    assert.equal(film.finalStoredKey, 'media/film.mp4');
    assert.equal(film.withMusic, false);
  });

  test('an empty storyboard fails', async () => {
    const p = await withMasters();
    claude = async () => ({ text: JSON.stringify({ title: 'x', shots: [{ imageCode: 'IMG-404' }] }), truncated: false });
    await pipeline.createStoryboard(p.id, '', '9:16');
    await pipeline.idle();
    const sb = (await getProject(p.id)).storyboard!;
    assert.equal(sb.state, 'failed');
    assert.equal(sb.error, STORYBOARD_EMPTY);
  });
});

describe('analysis', () => {
  test('runs after the mutation and keeps its result', async () => {
    const p = await newProject(1);
    let asked: any;
    claude = async (o) => {
      asked = o;
      return { text: JSON.stringify({ subject: 'a villa', materials: ['oak', 3], peoplePresent: 'yes' }), truncated: false };
    };
    const during = await pipeline.analyse(p.id, [p.images[0]!.id]);
    assert.equal(during.images[0]!.analysis!.state, 'running');
    await pipeline.idle();
    const a = (await getProject(p.id)).images[0]!.analysis!;
    assert.equal(a.state, 'succeeded');
    assert.deepEqual(a.result!.materials, ['oak']);
    assert.equal(asked.max_output_tokens, 1500);
    assert.equal(asked.images[0].url, `/files/${p.images[0]!.workKey}`);
  });
});

describe('REVIEW-AFS: money held to what was asked', () => {
  test('finding 1: a repeated id asks once, and an image with a version on its way is not asked again', async () => {
    const p = await newProject(2);
    const [a, b] = p.images.map((i) => i.id) as [string, string];
    await pipeline.enhance(p.id, [a, a, a]);
    assert.equal((await runsOf(p.id, 0)).length, 1);
    // "Enhance all" pressed while the first image's run still waits: only the second is asked for.
    await pipeline.enhance(p.id, [a, b, b]);
    assert.equal((await runsOf(p.id, 0)).length, 1);
    assert.equal((await runsOf(p.id, 1)).length, 1);
    // "Enhance" on one card, pressed again: refused, with the sentence.
    await assert.rejects(pipeline.enhance(p.id, [a]), { message: VERSION_BUSY });
    // Still refused while it is at the door.
    await pipeline.advance(p.id);
    assert.equal((await runsOf(p.id, 0))[0]!.state, 'running');
    await assert.rejects(pipeline.enhance(p.id, [a, b]), { message: VERSION_BUSY });
    assert.equal(fake.sends().length, 2);
    // Once it has finished, a new version can be asked for.
    fake.jobs.set('job_1', { state: 'done', output: { type: 'image/png', bytes: 14 } });
    tick();
    await pipeline.advance(p.id);
    await pipeline.enhance(p.id, [a]);
    const runs = await runsOf(p.id, 0);
    assert.deepEqual(runs.map((r) => r.state), ['succeeded', 'queued']);
    assert.equal((runs[1] as unknown as EnhancementRun).version, 2);
  });

  test('finding 2: a job left waiting 30 minutes while nobody had the project open is never sent', async () => {
    const p = await newProject(1);
    await pipeline.enhance(p.id, [p.images[0]!.id]);
    // The tab was closed before the first send; a week later the project is opened.
    tick(31 * 60_000);
    await pipeline.advance(p.id);
    const [run] = await runsOf(p.id);
    assert.equal(run!.state, 'failed');
    assert.equal(run!.error, WAITED_TOO_LONG);
    assert.equal(run!.error, 'This waited too long and was not sent. Ask again.');
    tick();
    await pipeline.advance(p.id);
    assert.equal(fake.sends().length, 0);
  });

  test('finding 2: a job waiting while the project is open keeps its place, however long', async () => {
    const p = await newProject(3);
    await pipeline.enhance(p.id, p.images.map((i) => i.id));
    await pipeline.advance(p.id);
    assert.equal(fake.sends().length, 2);
    for (let i = 0; i < 3; i++) {
      tick(20 * 60_000);
      await pipeline.advance(p.id);
    }
    assert.equal((await runsOf(p.id, 2))[0]!.state, 'queued');
    fake.jobs.set('job_1', { state: 'done', output: { type: 'image/png', bytes: 14 } });
    tick();
    await pipeline.advance(p.id);
    assert.equal(fake.sends().length, 3);
  });

  test('finding 2: "Cancel waiting" ends every waiting job and leaves those at the door', async () => {
    const p = await newProject(3);
    await pipeline.enhance(p.id, p.images.map((i) => i.id));
    await pipeline.advance(p.id);
    const after = await pipeline.cancelWaiting(p.id);
    const states = after.images.map((i) => [i.enhancements[0]!.state, i.enhancements[0]!.error]);
    assert.deepEqual(states, [
      ['running', undefined],
      ['running', undefined],
      ['failed', CANCELLED],
    ]);
    fake.jobs.set('job_1', { state: 'done', output: { type: 'image/png', bytes: 14 } });
    tick();
    await pipeline.advance(p.id);
    assert.equal(fake.sends().length, 2);
  });

  test("finding 5: an interrupted send in a project nobody has open does not hold a place", async () => {
    const a = await newProject(2);
    await pipeline.enhance(a.id, a.images.map((i) => i.id));
    // The app went off while both of A's jobs were claimed, with no id yet.
    await updateProject(a.id, (d) => {
      for (const image of d.images) {
        const r = image.enhancements[0]!;
        r.state = 'running';
        r.claimedAt = new Date(t).toISOString();
        r.claimId = 'gone-process';
      }
    });
    tick(3 * 60_000);
    const b = await newProject(1);
    await pipeline.enhance(b.id, [b.images[0]!.id]);
    await pipeline.advance(b.id);
    assert.equal(fake.sends().length, 1);
    assert.equal((await runsOf(b.id))[0]!.taskId, 'job_1');
    for (const i of [0, 1]) {
      const [r] = await runsOf(a.id, i);
      assert.equal(r!.state, 'failed');
      assert.equal(r!.error, INTERRUPTED_BEFORE_START);
    }
  });

  test('finding 6: a result that cannot be written is tried a few times, then fails with a sentence', async () => {
    const p = await newProject(1);
    await pipeline.enhance(p.id, [p.images[0]!.id]);
    await pipeline.advance(p.id);
    fake.jobs.set('job_1', { state: 'done', output: { type: 'image/png', bytes: 14 } });
    fake.broken.stream = true;
    for (let i = 1; i < KEEP_TRIES; i++) {
      tick();
      await pipeline.advance(p.id);
      assert.equal((await runsOf(p.id))[0]!.state, 'running', `try ${i}`);
    }
    tick();
    await pipeline.advance(p.id);
    const [run] = await runsOf(p.id);
    assert.equal(run!.state, 'failed');
    assert.equal(run!.error, NOT_KEPT);
    assert.equal(run!.error, 'The result could not be kept on this Mac.');
    // No longer at the door: it holds no place and is not fetched again.
    const streams = fake.calls.length;
    tick();
    await pipeline.advance(p.id);
    assert.equal(fake.calls.length, streams);
  });

  test('finding 6: a job the door keeps giving no readable answer about ends too', async () => {
    const p = await newProject(1);
    await pipeline.enhance(p.id, [p.images[0]!.id]);
    await pipeline.advance(p.id);
    fake.broken.status = true;
    for (let i = 1; i < STATUS_TRIES; i++) {
      tick();
      await pipeline.advance(p.id);
    }
    assert.equal((await runsOf(p.id))[0]!.state, 'running');
    tick();
    await pipeline.advance(p.id);
    const [run] = await runsOf(p.id);
    assert.equal(run!.state, 'failed');
    assert.equal(run!.error, NO_ANSWER);
  });

  describe('finding 3: making a clip again', () => {
    async function keptClip() {
      const p = await newProject(1);
      const r = await finishedRun(p, 0, 5056, 3392);
      await pipeline.decide(p.id, p.images[0]!.id, r.id, 'approved');
      await pipeline.master(p.id, [p.images[0]!.id]);
      claude = async () => ({
        text: JSON.stringify({ title: 'Villa', shots: [{ imageCode: 'IMG-001', videoPrompt: 'Slow dolly-in.', durationSeconds: 5 }] }),
        truncated: false,
      });
      await pipeline.createStoryboard(p.id, '', '16:9');
      await pipeline.idle();
      const shotId = (await getProject(p.id)).storyboard!.shots[0]!.id;
      await pipeline.generateShots(p.id, [shotId]);
      await pipeline.advance(p.id);
      fake.jobs.set('job_1', { state: 'done', output: { type: 'video/mp4', bytes: 10 } });
      tick();
      await pipeline.advance(p.id);
      await pipeline.decideShot(p.id, shotId, 'approved');
      const shot = async () => (await getProject(p.id)).storyboard!.shots[0]!;
      return { p, shotId, shot, first: (await shot()).video! };
    }

    test('a refused new clip puts the kept, approved clip back, with why', async () => {
      const { p, shotId, shot, first } = await keptClip();
      assert.equal(first.decision, 'approved');
      await pipeline.generateShots(p.id, [shotId]);
      const waiting = (await shot()).video!;
      assert.equal(waiting.state, 'queued');
      assert.equal(waiting.previous!.storedKey, first.storedKey);
      fake.setOnJob(() => ({
        status: 403,
        json: { error: { message: "The owner's allowance for this app has ended." }, code: 'gen_no_allowance' },
      }));
      tick();
      await pipeline.advance(p.id);
      const back = (await shot()).video!;
      assert.equal(back.state, 'succeeded');
      assert.equal(back.storedKey, first.storedKey);
      assert.equal(back.decision, 'approved');
      assert.equal(back.previous, undefined);
      assert.equal(back.error, "The owner's allowance for this app has ended.");
      // The film can still be made with it.
      await pipeline.assembleFilm(p.id, 'cut');
      await pipeline.idle();
      assert.equal((await getProject(p.id)).film!.state, 'succeeded');
    });

    test('a failed or cancelled new clip puts it back too; a kept new clip replaces it', async () => {
      const { p, shotId, shot, first } = await keptClip();
      await pipeline.generateShots(p.id, [shotId]);
      await pipeline.cancelWaiting(p.id);
      assert.equal((await shot()).video!.storedKey, first.storedKey);
      assert.equal((await shot()).video!.error, CANCELLED);

      await pipeline.generateShots(p.id, [shotId]);
      tick();
      await pipeline.advance(p.id);
      fake.jobs.set('job_2', { state: 'failed', reason: 'Runway refused this prompt.' });
      tick();
      await pipeline.advance(p.id);
      assert.equal((await shot()).video!.storedKey, first.storedKey);
      assert.equal((await shot()).video!.error, 'Runway refused this prompt.');

      await pipeline.generateShots(p.id, [shotId]);
      tick();
      await pipeline.advance(p.id);
      fake.jobs.set('job_3', { state: 'done', output: { type: 'video/mp4', bytes: 10 } });
      tick();
      await pipeline.advance(p.id);
      const made = (await shot()).video!;
      assert.equal(made.state, 'succeeded');
      assert.notEqual(made.storedKey, first.storedKey);
      assert.equal(made.decision, 'pending');
      assert.equal(made.previous, undefined);
      assert.equal(made.error, undefined);
    });
  });
});
