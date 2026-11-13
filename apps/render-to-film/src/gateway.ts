/**
 * The gateway: the one place this app keeps Runway's task words.
 *
 * The server calls `ctx.runway.createTask(type, options)`, `getTask`,
 * `taskSnapshot`, `uploadAsset` and `getProfile` at about forty places, and
 * seventeen prompt and preset modules build those options. All of that stays
 * as it was; this module answers those five calls on this Mac. A picture or
 * clip task goes to the engine's generation door over the app's socket; a
 * `claude_api` task goes to the model relay; a `media_processing_v2` task runs
 * ffmpeg. Finished files are kept under `objects/media/` and served from
 * `/files/`. Nothing leaves the Mac except through the engine.
 *
 * Every collaborator is injected (`createGateway`), so the tests use fakes;
 * `gateway` is the one built from the real ones. Only erasable TypeScript and
 * `node:` imports here.
 */
import { randomUUID } from 'node:crypto';

import { engine as realEngine, EngineError, type Engine } from './local/engine.ts';
import { probe as realProbe, runMediaOp, type MediaResult, type ProbeInfo } from './local/media-ops.ts';
import { pictures as realPictures, type Pictures } from './local/pictures.ts';
import { PRECISION_MAX_SIDE, routing as realRouting, snapAspectRatio, type EngineBody, type ModelList, type Routing } from './local/routing.ts';
import { runClaude, type ClaudeOptions, type ClaudeResult } from './local/claude.ts';
import {
  createTaskStore,
  isFinished,
  type TaskDoc,
  type TaskOutput,
  type TaskRecord,
  type TaskState,
  type TaskStore,
} from './local/tasks.ts';
import { isKey, store as realStore, type Storage } from './storage.ts';

export { snapAspectRatio };

/** The longest side and the size of a picture sent to the door. */
export const INPUT_MAX_SIDE = 4096;
export const INPUT_MAX_BYTES = 3_200_000;
/** The largest upload from the browser, and the largest result kept. */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const OUTPUT_MAX_BYTES = 200 * 1024 * 1024;

const NOT_ON_THIS_MAC = 'This picture is not on this Mac.';
const JOB_RE = /^[A-Za-z0-9_-]{1,80}$/;
const OUTPUT_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};
/** The door's final states other than `done`. */
const DOOR_FAILED = new Set(['refused', 'failed', 'cancelled', 'stopped', 'bad_input', 'unknown']);
/** Task types that never go to the door, so they never need its model list. */
const LOCAL_TYPES = new Set(['claude_api', 'media_processing_v2', 'workflow_aleph_2']);

// The names the call sites know, kept so they compile. The credit, auth and
// broker classes are gone with the sign-in.

/** A task Runway-style refused or could not make; `message` is a plain sentence. */
export class RunwayTaskError extends Error {
  status: number;
  issues: Array<{ path: string[]; message: string }>;
  body: unknown;
  constructor(message: string, opts?: { status?: number; issues?: Array<{ path: string[]; message: string }>; body?: unknown }) {
    super(message);
    this.name = 'RunwayTaskError';
    this.status = opts?.status ?? 400;
    this.issues = opts?.issues ?? [];
    this.body = opts?.body ?? null;
  }
}

/** A call the engine answered with an error status. */
export class RunwayApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, opts?: { status?: number; body?: unknown }) {
    super(message);
    this.name = 'RunwayApiError';
    this.status = opts?.status ?? 500;
    this.body = opts?.body ?? null;
  }
}

export type TaskStatus = TaskState;

export type TaskSnapshot = {
  id: string;
  status: TaskStatus;
  done: boolean;
  progress: number;
  url?: string | undefined;
  filename?: string | undefined;
  error?: string | undefined;
  reason?: string | undefined;
  hint?: string | undefined;
  text?: string | undefined;
  truncated?: boolean | undefined;
};

export type TaskArtifact = {
  id: string;
  url: string;
  isDirectory: false;
  metadata: { duration?: number | undefined; frameRate?: number | undefined; size?: { width: number; height: number } | undefined };
};

export type RunwayTask = { id: string; status: TaskStatus; artifacts: TaskArtifact[] };

export type GatewayDeps = {
  engine: Engine;
  store: Storage;
  tasks: TaskStore;
  pictures: Pictures;
  routing: Routing;
  /** Runs one `claude_api` task's options to its text. */
  claude: (options: ClaudeOptions) => Promise<ClaudeResult>;
  /** Runs one `media_processing_v2` operation to the file(s) it made. */
  media: (options: Record<string, unknown>) => Promise<MediaResult>;
  /** Duration, frame rate and size of a kept video, by key. */
  probe: (key: string) => Promise<ProbeInfo>;
  now: () => number;
  /** Optional: waits, in milliseconds; tests make them short. */
  timing?: {
    snapshotMs?: number;
    busyRetryMs?: number;
    busyMaxMs?: number;
    modelsMs?: number;
    sleep?: (ms: number) => Promise<void>;
  };
};

function sentence(json: any, fallback: string): string {
  const e = json?.error;
  const m = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : '';
  return (m || fallback).replace(/\s+/g, ' ').trim().slice(0, 400);
}

function failure(err: unknown): string {
  const m = err instanceof Error && err.message ? err.message : 'The task failed.';
  return m.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** The key behind a `/files/<key>` address, or null for anything else. */
export function keyOfFilesUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith('/files/')) return null;
  const path = url.slice('/files/'.length).split(/[?#]/)[0]!;
  let key: string;
  try {
    key = decodeURIComponent(path);
  } catch {
    return null;
  }
  return isKey(key) ? key : null;
}

/** PNG, JPEG or WebP by the first bytes; null for anything else. */
export function sniffImage(b: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function createGateway(deps: GatewayDeps) {
  const { engine, store, tasks, pictures, routing, now } = deps;
  const timing = {
    snapshotMs: deps.timing?.snapshotMs ?? 3000,
    busyRetryMs: deps.timing?.busyRetryMs ?? 10_000,
    busyMaxMs: deps.timing?.busyMaxMs ?? 20 * 60_000,
    modelsMs: deps.timing?.modelsMs ?? 30_000,
    sleep: deps.timing?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  };

  /** Tasks being worked on by this process (a busy wait, a thought, a video job). */
  const active = new Set<string>();
  const background = new Set<Promise<unknown>>();
  const inflight = new Map<string, Promise<TaskRecord>>();
  const polled = new Map<string, { at: number; rec: TaskRecord; progress: number }>();
  const progressOf = new Map<string, number>();
  let modelsCache: { at: number; list: ModelList } | null = null;

  function track(id: string, work: Promise<unknown>) {
    active.add(id);
    const p = work.finally(() => active.delete(id));
    background.add(p);
    p.then(
      () => background.delete(p),
      () => background.delete(p)
    );
  }

  async function loadModels(): Promise<ModelList> {
    if (modelsCache && now() - modelsCache.at < timing.modelsMs) return modelsCache.list;
    let list: ModelList = null;
    try {
      const r = await engine.json('GET', '/gen/app/models');
      if (r.status === 200 && Array.isArray(r.json?.models)) list = r.json.models;
    } catch {
      list = null;
    }
    modelsCache = { at: now(), list };
    return list;
  }

  /** Send each `/files/` picture of a job to the door and give back its body. */
  async function uploadInputs(inputs: Array<{ url: string; role: string }>): Promise<Array<{ input: string; role: string }>> {
    const out: Array<{ input: string; role: string }> = [];
    for (const item of inputs) {
      const key = keyOfFilesUrl(item.url);
      if (!key) throw new RunwayTaskError(NOT_ON_THIS_MAC);
      const bytes = await store.getObject(key);
      if (!bytes) throw new RunwayTaskError(NOT_ON_THIS_MAC);
      let jpeg: Buffer;
      try {
        jpeg = await pictures.toJpeg(bytes, { maxSide: INPUT_MAX_SIDE, maxBytes: INPUT_MAX_BYTES });
      } catch (err) {
        throw new RunwayTaskError(failure(err));
      }
      const r = await callEngine('POST', '/gen/app/inputs', jpeg, { contentType: 'image/jpeg' });
      if (r.status < 200 || r.status >= 300 || typeof r.json?.input !== 'string') {
        throw new RunwayTaskError(sentence(r.json, 'The engine did not take this picture.'), { status: r.status, body: r.json });
      }
      out.push({ input: r.json.input, role: item.role });
    }
    return out;
  }

  async function callEngine(method: string, path: string, body?: unknown, opts?: { contentType?: string }) {
    try {
      return await engine.json(method, path, body, opts);
    } catch (err) {
      if (err instanceof EngineError) throw new RunwayTaskError(err.message, { status: 502 });
      throw err;
    }
  }

  function jobBody(b: { model: string; kind: string; prompt: string; seconds?: number | undefined; ratio?: string | undefined; resolution?: string | undefined; scale?: number | undefined }, inputs: Array<{ input: string; role: string }>) {
    const body: Record<string, unknown> = { model: b.model, kind: b.kind, inputs, prompt: b.prompt };
    if (b.seconds !== undefined && b.seconds !== null) body['seconds'] = b.seconds;
    if (b.ratio) body['ratio'] = b.ratio;
    if (b.resolution) body['resolution'] = b.resolution;
    if (b.scale !== undefined && b.scale !== null) body['scale'] = b.scale;
    return body;
  }

  function newRecord(id: string, type: string, route: TaskRecord['route'], engineJob: string | null): TaskRecord {
    return {
      id,
      type,
      route,
      engineJob,
      state: 'PENDING',
      createdAt: new Date(now()).toISOString(),
      output: null,
      error: null,
      text: null,
    };
  }

  async function finish(id: string, patch: Partial<TaskRecord>) {
    await tasks.update(id, patch);
    polled.delete(id);
  }

  /** Ask again every few seconds while the door says its limit is full. */
  async function submitWhenFree(id: string, body: Record<string, unknown>) {
    const deadline = now() + timing.busyMaxMs;
    try {
      for (;;) {
        await timing.sleep(timing.busyRetryMs);
        let r;
        try {
          r = await engine.json('POST', '/gen/app/jobs', body);
        } catch (err) {
          await finish(id, { state: 'FAILED', error: failure(err) });
          return;
        }
        if (r.status === 202 && typeof r.json?.job === 'string' && JOB_RE.test(r.json.job)) {
          await finish(id, { engineJob: r.json.job, state: 'PENDING' });
          return;
        }
        if (r.json?.code === 'gen_busy') {
          if (now() >= deadline) {
            await finish(id, { state: 'FAILED', error: 'The engine stayed busy for too long, so this was not started. Nothing was spent.' });
            return;
          }
          continue;
        }
        await finish(id, { state: 'FAILED', error: sentence(r.json, 'The engine did not start this.') });
        return;
      }
    } catch (err) {
      await finish(id, { state: 'FAILED', error: failure(err) }).catch(() => {});
    }
  }

  /**
   * Precision's price jumps from 25 to 150 credits past a 4096 px result, and
   * only here is the picture's real size known. The factor is lowered until the
   * result fits; a picture too large for even 2x is refused before anything is
   * sent. Returns the body to send.
   */
  async function guardUpscale(body: EngineBody): Promise<EngineBody> {
    if (body.kind !== 'still_upscale' || !body.scale || !body.model.startsWith('magnific_precision')) return body;
    const key = keyOfFilesUrl(body.inputs[0]?.url);
    const bytes = key ? await store.getObject(key) : null;
    if (!bytes) throw new RunwayTaskError(NOT_ON_THIS_MAC);
    let side: number;
    try {
      const { width, height } = await pictures.size(bytes);
      side = Math.max(width, height);
    } catch (err) {
      throw new RunwayTaskError(failure(err));
    }
    const scale = [4, 2].find((f) => f <= body.scale! && side * f <= PRECISION_MAX_SIDE);
    if (scale === undefined) throw new RunwayTaskError('This picture is already as large as the upscaler goes here.');
    return scale === body.scale ? body : { ...body, scale };
  }

  async function createEngineTask(id: string, type: string, asked: EngineBody) {
    const body = await guardUpscale(asked);
    const inputs = await uploadInputs(body.inputs);
    const wire = jobBody(body, inputs);
    const r = await callEngine('POST', '/gen/app/jobs', wire);
    if (r.status === 202 && typeof r.json?.job === 'string' && JOB_RE.test(r.json.job)) {
      await tasks.insert(newRecord(id, type, 'engine', r.json.job));
      return;
    }
    if (r.json?.code === 'gen_busy') {
      await tasks.insert(newRecord(id, type, 'engine', null));
      track(id, submitWhenFree(id, wire));
      return;
    }
    throw new RunwayTaskError(sentence(r.json, 'The engine did not start this.'), { status: r.status, body: r.json });
  }

  async function createTask(type: string, options: Record<string, unknown>, _opts?: { internal?: boolean }): Promise<{ id: string }> {
    const models = LOCAL_TYPES.has(type) ? null : await loadModels();
    const routed = routing.routeTask(type, options, models);
    const id = randomUUID();
    if ('dropped' in routed) throw new RunwayTaskError(routed.dropped);
    if ('engine' in routed) {
      await createEngineTask(id, type, routed.engine);
      return { id };
    }
    if ('claude' in routed) {
      await tasks.insert(newRecord(id, type, 'claude', null));
      track(
        id,
        deps.claude(routed.claude as ClaudeOptions).then(
          (res) => finish(id, { state: 'SUCCEEDED', text: res.text, truncated: res.truncated }),
          (err) => finish(id, { state: 'FAILED', error: failure(err) })
        )
      );
      return { id };
    }
    await tasks.insert(newRecord(id, type, 'media', null));
    track(
      id,
      deps.media(routed.media).then(
        (res) => {
          const list = Array.isArray(res) ? res : [res];
          return finish(id, { state: 'SUCCEEDED', output: list[0] ?? null, outputs: list.length > 1 ? list : undefined });
        },
        (err) => finish(id, { state: 'FAILED', error: failure(err) })
      )
    );
    return { id };
  }

  /** Ask the door about one job and, when it is done, keep its output. */
  async function pollEngine(rec: TaskRecord): Promise<TaskRecord> {
    const job = rec.engineJob!;
    if (!JOB_RE.test(job)) {
      await finish(rec.id, { state: 'FAILED', error: 'The engine gave this task a job it cannot follow.' });
      return (await tasks.get(rec.id)) ?? rec;
    }
    let r;
    try {
      r = await engine.json('GET', `/gen/app/jobs/${job}`);
    } catch {
      return rec; // the engine is away for now; ask again next time
    }
    if (r.status === 404) {
      await finish(rec.id, { state: 'FAILED', error: 'The engine no longer has this job.' });
      return (await tasks.get(rec.id)) ?? rec;
    }
    if (r.status !== 200 || !r.json) return rec;
    const state = String(r.json.state ?? '');
    if (typeof r.json.progress === 'number' && Number.isFinite(r.json.progress)) progressOf.set(rec.id, r.json.progress);
    if (DOOR_FAILED.has(state)) {
      const why = typeof r.json.reason === 'string' && r.json.reason ? r.json.reason : 'The generation failed.';
      await finish(rec.id, { state: 'FAILED', error: why.replace(/\s+/g, ' ').trim().slice(0, 300) });
      return (await tasks.get(rec.id)) ?? rec;
    }
    if (state !== 'done') {
      const next: TaskState = state === 'working' ? 'RUNNING' : 'PENDING';
      return next === rec.state ? rec : ((await tasks.update(rec.id, { state: next })) ?? rec);
    }
    const type = String(r.json.output?.type ?? '');
    const ext = Object.hasOwn(OUTPUT_EXT, type) ? OUTPUT_EXT[type] : undefined;
    const bytes = Number(r.json.output?.bytes);
    if (!ext) {
      await finish(rec.id, { state: 'FAILED', error: 'The engine made a file this app cannot keep.' });
      return (await tasks.get(rec.id)) ?? rec;
    }
    if (!(bytes <= OUTPUT_MAX_BYTES)) {
      await finish(rec.id, { state: 'FAILED', error: 'The result is larger than this app keeps.' });
      return (await tasks.get(rec.id)) ?? rec;
    }
    const key = `media/${rec.id}.${ext}`;
    try {
      const file = await store.objectPath(key);
      const got = await engine.stream(`/gen/app/jobs/${job}/output`, file, OUTPUT_MAX_BYTES);
      if (got.status !== 200) {
        if (got.json?.code === 'gen_not_ready') return rec;
        await finish(rec.id, { state: 'FAILED', error: sentence(got.json, 'The result could not be fetched.') });
        return (await tasks.get(rec.id)) ?? rec;
      }
    } catch (err) {
      if (err instanceof EngineError && err.tooLarge) {
        await finish(rec.id, { state: 'FAILED', error: err.message });
        return (await tasks.get(rec.id)) ?? rec;
      }
      return rec; // try the fetch again on the next poll
    }
    const output: TaskOutput = { key, type, width: null, height: null, duration: null, fps: null };
    progressOf.set(rec.id, 1);
    return (await tasks.update(rec.id, { state: 'SUCCEEDED', output })) ?? rec;
  }

  /** The task as it is now: asks the door at most once in `snapshotMs`. */
  async function refresh(id: string): Promise<TaskRecord> {
    const rec = await tasks.get(id);
    if (!rec) throw new RunwayApiError('That task does not exist.', { status: 404 });
    if (isFinished(rec)) return rec;
    if (rec.route !== 'engine' || !rec.engineJob) {
      if (active.has(id)) return rec;
      await finish(id, { state: 'FAILED', error: 'This was interrupted when the app restarted. Make it again.' });
      return (await tasks.get(id)) ?? rec;
    }
    const last = polled.get(id);
    if (last && now() - last.at < timing.snapshotMs) return last.rec;
    const running = inflight.get(id);
    if (running) return running;
    const work = pollEngine(rec)
      .then((next) => {
        if (!isFinished(next)) polled.set(id, { at: now(), rec: next, progress: progressOf.get(id) ?? 0 });
        return next;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, work);
    return work;
  }

  async function taskSnapshot(id: string, opts?: { includeText?: boolean }): Promise<TaskSnapshot> {
    const rec = await refresh(id);
    const done = isFinished(rec);
    const snap: TaskSnapshot = {
      id: rec.id,
      status: rec.state,
      done,
      progress: rec.state === 'SUCCEEDED' ? 1 : (progressOf.get(id) ?? 0),
    };
    if (rec.output) {
      snap.url = `/files/${rec.output.key}`;
      snap.filename = rec.output.key.slice(rec.output.key.lastIndexOf('/') + 1);
    }
    if (rec.state === 'FAILED') snap.error = rec.error ?? 'The task failed.';
    if (opts?.includeText && rec.text !== null) {
      snap.text = rec.text;
      snap.truncated = rec.truncated === true;
    }
    return snap;
  }

  async function withSizes(rec: TaskRecord): Promise<TaskOutput[]> {
    const list = rec.outputs && rec.outputs.length > 0 ? rec.outputs : rec.output ? [rec.output] : [];
    let changed = false;
    const filled: TaskOutput[] = [];
    for (const o of list) {
      if (o.width !== null && o.height !== null) {
        filled.push(o);
        continue;
      }
      try {
        if (o.type.startsWith('video/')) {
          const p = await deps.probe(o.key);
          filled.push({ ...o, width: p.width, height: p.height, duration: p.duration, fps: p.frameRate });
        } else {
          const bytes = await store.getObject(o.key);
          const s = bytes ? await pictures.size(bytes) : null;
          filled.push(s ? { ...o, width: s.width, height: s.height } : o);
        }
        changed = true;
      } catch {
        filled.push(o);
      }
    }
    if (changed) {
      await tasks.update(rec.id, { output: filled[0] ?? null, outputs: rec.outputs ? filled : undefined });
    }
    return filled;
  }

  async function getTask(id: string): Promise<RunwayTask> {
    const rec = await refresh(id);
    if (rec.state !== 'SUCCEEDED') return { id: rec.id, status: rec.state, artifacts: [] };
    const outputs = await withSizes(rec);
    const artifacts = outputs.map((o, i): TaskArtifact => {
      const metadata: TaskArtifact['metadata'] = {};
      if (o.duration !== null) metadata.duration = o.duration;
      if (o.fps !== null) metadata.frameRate = o.fps;
      if (o.width !== null && o.height !== null) metadata.size = { width: o.width, height: o.height };
      return { id: i === 0 ? rec.id : `${rec.id}.${i}`, url: `/files/${o.key}`, isDirectory: false, metadata };
    });
    return { id: rec.id, status: rec.state, artifacts };
  }

  async function uploadAsset(bytes: Buffer | Uint8Array, opts?: { filename?: string; signal?: AbortSignal }): Promise<{ url: string; id: string }> {
    const buf = Buffer.from(bytes);
    if (buf.length === 0) throw new RunwayTaskError('The upload was empty.');
    if (buf.length > UPLOAD_MAX_BYTES) throw new RunwayTaskError('That image is over 25 MB.');
    const ext = sniffImage(buf);
    if (!ext) throw new RunwayTaskError('Upload a PNG, JPEG or WebP image.');
    opts?.signal?.throwIfAborted();
    const id = randomUUID();
    await store.putObject(`uploads/${id}.${ext}`, buf, { contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` });
    return { url: `/files/uploads/${id}.${ext}`, id };
  }

  async function getProfile() {
    return { id: 'local', name: 'You', email: null as string | null, picture: null as string | null };
  }

  /** Wait for every background piece of work (a thought, a busy wait) to end; for tests. */
  async function idle() {
    while (background.size > 0) await Promise.allSettled([...background]);
  }

  return { createTask, getTask, taskSnapshot, uploadAsset, getProfile, snapAspectRatio, idle };
}

export type Gateway = ReturnType<typeof createGateway>;

/** The gateway built from the real collaborators. */
export const gateway: Gateway = createGateway({
  engine: realEngine,
  store: realStore,
  tasks: createTaskStore({ docs: realStore.documentStore<TaskDoc>({ prefix: 'tasks' }) }),
  pictures: realPictures,
  routing: realRouting,
  claude: (options) => runClaude({ engine: realEngine, store: realStore, pictures: realPictures }, options),
  media: (options) => runMediaOp(options, { store: realStore }),
  probe: (key) => realProbe(key, { store: realStore }),
  now: () => Date.now(),
});
