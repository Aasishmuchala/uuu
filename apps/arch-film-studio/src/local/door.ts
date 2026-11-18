/**
 * The generation door, spoken directly: this app's five models, their prices,
 * the owner's allowance, pictures sent as inputs, jobs sent and followed, and
 * a finished job's file kept on this Mac. Every call goes through the injected
 * `Engine` (the app's socket), so the tests use a fake.
 *
 * The door decides about money. Nothing here refuses a job for its price or
 * for the allowance; a refusal is the door's own sentence, passed on as it
 * came.
 *
 * Only `node:` imports and erasable TypeScript, so the tests run on plain Node.
 */
import { EngineError, type Engine } from './engine.ts';
import type { Pictures } from './pictures.ts';
import type { Storage } from '../storage.ts';

// ---------------------------------------------------------------------------
// The words (K23)

export const PRICE_UNKNOWN = 'Price unknown';
export const ALLOW_SENTENCE = 'Allow spending in the bar above.';
export const NO_SPENDING = 'This app cannot spend anything right now.';
export const ENGINE_UNREACHABLE = 'The engine could not be reached.';
export const NOT_LISTED = 'This model is not available right now.';
export const NOT_STARTED = 'The engine did not start this.';
export const JOB_GONE = 'The engine no longer has this job.';
export const CANNOT_KEEP = 'The engine made a file this app cannot keep.';
export const TOO_LARGE_TO_KEEP = 'The result is larger than this app keeps.';

/** The longest side and the size of a picture sent to the door. */
export const INPUT_MAX_SIDE = 4096;
export const INPUT_MAX_BYTES = 3_200_000;
/** The largest result kept. */
export const OUTPUT_MAX_BYTES = 200 * 1024 * 1024;
const MODELS_CACHE_MS = 30_000;

const JOB_RE = /^[A-Za-z0-9_-]{1,64}$/;
const INPUT_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The files this app keeps, by the type the door names. */
export const OUTPUT_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

/** The door's final states other than `done`. */
const DOOR_FAILED = new Set(['refused', 'failed', 'cancelled', 'stopped', 'bad_input', 'unknown']);

/** US cents as dollars: 40 -> "$0.40", 1999 -> "$19.99". */
export function dollars(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  return `$${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

/** The words beside a button: "About $0.40", or "Price unknown" when there is no price. */
export function priceWords(cents: number | null | undefined): string {
  return typeof cents === 'number' && Number.isFinite(cents) && cents >= 0 ? `About ${dollars(cents)}` : PRICE_UNKNOWN;
}

/** The allowance, as the bar and the header chip say it. */
export type Allowance = {
  open: boolean;
  /** Cents. */
  budget: number;
  spent: number;
  left: number;
  expiresAt: string | null;
  words: string;
  /** What a disabled spending button says while the allowance is closed. */
  needs: string | null;
};

export function allowanceWords(a: { open: boolean; budget: number; spent: number }): string {
  return a.open ? `Allowed today: ${dollars(a.budget)}. Spent: ${dollars(a.spent)}.` : NO_SPENDING;
}

const nonNeg = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** The door's `GET /gen/app/allowance` answer as the screens read it; anything unreadable is closed. */
export function readAllowance(json: any): Allowance {
  const open = json?.open === true;
  const budget = nonNeg(json?.budget);
  const spent = nonNeg(json?.spent);
  const left = open ? (typeof json?.left === 'number' ? nonNeg(json.left) : Math.max(0, budget - spent)) : 0;
  const expiresAt = open && typeof json?.expiresAt === 'string' ? json.expiresAt : null;
  return {
    open,
    budget: open ? budget : 0,
    spent: open ? spent : 0,
    left,
    expiresAt,
    words: allowanceWords({ open, budget, spent }),
    needs: open ? null : ALLOW_SENTENCE,
  };
}

/** The door's sentence in an answer, one line, at most 300 characters. */
export function doorSentence(json: any, fallback: string): string {
  const e = json?.error;
  const m = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : '';
  return oneLine(m || fallback);
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

// ---------------------------------------------------------------------------
// Shapes

/** One row of `GET /gen/app/models`, as far as this app reads it. */
export type DoorModel = {
  id: string;
  words?: string;
  kinds?: string[];
  ratios?: string[] | null;
  resolutions?: string[] | null;
  /** Not in the door's answer today; read when it is. */
  ratiosBy?: Record<string, string[]> | null;
  ready?: boolean;
  why?: string | null;
};

export type ModelList = { list: DoorModel[] | null; why: string };

/** What `/gen/app/estimate` takes for one buy. */
export type QuoteItem = {
  model: string;
  kind: string;
  seconds?: number | undefined;
  resolution?: string | undefined;
  scale?: number | undefined;
};

export type Quote = {
  items: Array<{ model: string; cents: number | null; words: string }>;
  total: number | null;
  words: string;
};

/** A job as `POST /gen/app/jobs` takes it (the door's `parseAppJob`). */
export type JobBody = {
  model: string;
  kind: string;
  inputs: Array<{ input: string; role: string }>;
  prompt: string;
  seconds?: number | undefined;
  ratio?: string | undefined;
  resolution?: string | undefined;
  scale?: number | undefined;
};

export type Submitted = { job: string; cents: number | null } | { busy: true } | { refused: string };

/** A job as the door tells it, or `gone` when the door does not know it. */
export type JobStatus =
  | { gone: true }
  | {
      gone?: false;
      state: string;
      /** True for a final state other than `done`. */
      failed: boolean;
      progress: number | null;
      reason: string | null;
      output: { type: string; bytes: number } | null;
    };

export type Kept = { kept: { key: string; bytes: number } } | { notReady: true } | { failed: string };

export type DoorDeps = {
  engine: Pick<Engine, 'json' | 'stream'>;
  store: Pick<Storage, 'getObject' | 'objectPath'>;
  pictures: Pick<Pictures, 'toJpeg'>;
  now?: () => number;
};

// ---------------------------------------------------------------------------

export function createDoor(deps: DoorDeps) {
  const { engine, store, pictures } = deps;
  const now = deps.now ?? Date.now;
  let cache: { at: number; value: ModelList } | null = null;

  /** The door's list of models (kept 30 seconds), or null with the reason. */
  async function models(): Promise<ModelList> {
    if (cache && now() - cache.at < MODELS_CACHE_MS) return cache.value;
    let value: ModelList = { list: null, why: ENGINE_UNREACHABLE };
    try {
      const r = await engine.json('GET', '/gen/app/models');
      if (r.status === 200 && Array.isArray(r.json?.models)) {
        const list = (r.json.models as unknown[]).filter(
          (m): m is DoorModel => !!m && typeof m === 'object' && typeof (m as DoorModel).id === 'string'
        );
        value = { list, why: '' };
      } else {
        value = { list: null, why: doorSentence(r.json, ENGINE_UNREACHABLE) };
      }
    } catch {
      // The engine is away: the answer says so, and is asked again next time.
      return value;
    }
    cache = { at: now(), value };
    return value;
  }

  /** Prices for up to 20 buys. A refusal or an unreadable answer is "Price unknown" throughout. */
  async function quote(items: QuoteItem[]): Promise<Quote> {
    const unknown = (): Quote => ({
      items: items.map((i) => ({ model: i.model, cents: null, words: PRICE_UNKNOWN })),
      total: null,
      words: PRICE_UNKNOWN,
    });
    if (items.length === 0) return { items: [], total: 0, words: priceWords(0) };
    const wire = items.map((i) => {
      const item: QuoteItem = { model: i.model, kind: i.kind };
      if (i.seconds !== undefined) item.seconds = i.seconds;
      if (i.resolution !== undefined) item.resolution = i.resolution;
      if (i.scale !== undefined) item.scale = i.scale;
      return item;
    });
    let r;
    try {
      r = await engine.json('POST', '/gen/app/estimate', { items: wire });
    } catch {
      return unknown();
    }
    const answered = r.status === 200 && Array.isArray(r.json?.items) ? (r.json.items as any[]) : null;
    if (!answered || answered.length !== items.length) return unknown();
    const out = items.map((i, k) => {
      const c = answered[k]?.cents;
      const cents = typeof c === 'number' && Number.isFinite(c) && c >= 0 ? Math.round(c) : null;
      return { model: i.model, cents, words: priceWords(cents) };
    });
    const total = out.some((o) => o.cents === null) ? null : out.reduce((s, o) => s + (o.cents as number), 0);
    return { items: out, total, words: priceWords(total) };
  }

  async function allowance(): Promise<Allowance> {
    try {
      const r = await engine.json('GET', '/gen/app/allowance');
      return readAllowance(r.status === 200 ? r.json : null);
    } catch {
      return readAllowance(null);
    }
  }

  /**
   * Send one kept picture to the door as a JPEG within its limits. Throws an
   * `EngineError` when the engine is away (nothing was taken).
   */
  async function sendInput(key: string): Promise<{ input: string } | { refused: string }> {
    const bytes = await store.getObject(key);
    if (!bytes) return { refused: 'This picture is no longer on this Mac.' };
    let jpeg: Buffer;
    try {
      jpeg = await pictures.toJpeg(bytes, { maxSide: INPUT_MAX_SIDE, maxBytes: INPUT_MAX_BYTES });
    } catch (err) {
      return { refused: oneLine(err instanceof Error && err.message ? err.message : 'This picture could not be sent.') };
    }
    const r = await engine.json('POST', '/gen/app/inputs', jpeg, { contentType: 'image/jpeg' });
    if (r.status >= 200 && r.status < 300 && typeof r.json?.input === 'string' && INPUT_RE.test(r.json.input)) {
      return { input: r.json.input };
    }
    return { refused: doorSentence(r.json, 'The engine did not take this picture.') };
  }

  /**
   * Send one job. Throws an `EngineError` when the answer never came: the job
   * may or may not have started, so the caller must not send it again.
   */
  async function submit(body: JobBody): Promise<Submitted> {
    const wire: Record<string, unknown> = { model: body.model, kind: body.kind, inputs: body.inputs, prompt: body.prompt };
    if (body.seconds !== undefined) wire['seconds'] = body.seconds;
    if (body.ratio !== undefined) wire['ratio'] = body.ratio;
    if (body.resolution !== undefined) wire['resolution'] = body.resolution;
    if (body.scale !== undefined) wire['scale'] = body.scale;
    const r = await engine.json('POST', '/gen/app/jobs', wire);
    if (r.status === 202 && typeof r.json?.job === 'string' && JOB_RE.test(r.json.job)) {
      const c = r.json.cents;
      return { job: r.json.job, cents: typeof c === 'number' && Number.isFinite(c) && c >= 0 ? Math.round(c) : null };
    }
    if (r.json?.code === 'gen_busy') return { busy: true };
    return { refused: doorSentence(r.json, NOT_STARTED) };
  }

  /** One job as the door tells it; null when it gave no usable answer (ask again later). */
  async function status(job: string): Promise<JobStatus | null> {
    if (!JOB_RE.test(job)) return { gone: true };
    const r = await engine.json('GET', `/gen/app/jobs/${job}`);
    if (r.status === 404) return { gone: true };
    if (r.status !== 200 || !r.json) return null;
    const state = String(r.json.state ?? '');
    const p = r.json.progress;
    const o = r.json.output;
    return {
      state,
      failed: DOOR_FAILED.has(state),
      progress: typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : null,
      reason: typeof r.json.reason === 'string' && r.json.reason ? oneLine(r.json.reason) : null,
      output:
        o && typeof o === 'object' && typeof o.type === 'string'
          ? { type: o.type.split(';')[0]!.trim().toLowerCase(), bytes: Number(o.bytes) }
          : null,
    };
  }

  /**
   * Stream a done job's file to `key` (under `objects/`). Throws when the
   * fetch broke part way and is worth trying again.
   */
  async function keep(job: string, key: string): Promise<Kept> {
    if (!JOB_RE.test(job)) return { failed: JOB_GONE };
    const file = await store.objectPath(key);
    try {
      const got = await engine.stream(`/gen/app/jobs/${job}/output`, file, OUTPUT_MAX_BYTES);
      if (got.status === 200) return { kept: { key, bytes: got.bytes } };
      if (got.json?.code === 'gen_not_ready') return { notReady: true };
      if (got.status === 404) return { failed: JOB_GONE };
      return { failed: doorSentence(got.json, 'The result could not be fetched.') };
    } catch (err) {
      if (err instanceof EngineError && err.tooLarge) return { failed: TOO_LARGE_TO_KEEP };
      throw err;
    }
  }

  return { models, quote, allowance, sendInput, submit, status, keep };
}

export type Door = ReturnType<typeof createDoor>;
