/**
 * The pipeline: every stage's work on a project, and `advance`, which moves
 * the door's jobs along. All work on a project goes through `updateProject`.
 *
 * Money is never asked twice. A door job (an enhancement, a master, a clip) is
 * written `queued`; `advance` claims it in the project document (`running`,
 * `claimedAt`, `claimId`) before anything is sent, and saves the door's job id
 * right after the 202. A job found claimed with no id after 2 minutes is
 * failed and never sent again by itself.
 *
 * The thinking (analysis, storyboard) and the film run in this process after
 * the mutation answers; those in-flight promises are the only work that
 * outlives a request. Every collaborator is injected, so the tests use fakes.
 */
import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';

import {
  approvedEnhancement,
  type EnhancementRun,
  type FilmFormat,
  type ImageSettings,
  mediaUrl,
  type MasterRun,
  type Project,
  type ProjectImage,
  type QueuedJob,
  type Shot,
  type ShotVideo,
  type Transition,
} from '../shared/project.ts';
import {
  CANNOT_KEEP,
  type Door,
  ENGINE_UNREACHABLE,
  JOB_GONE,
  type JobBody,
  NOT_LISTED,
  NOT_STARTED,
  oneLine,
  OUTPUT_EXT,
  OUTPUT_MAX_BYTES,
  TOO_LARGE_TO_KEEP,
} from '../local/door.ts';
import type { ClaudeOptions, ClaudeResult } from '../local/claude.ts';
import type { MediaResult, ProbeInfo } from '../local/media-ops.ts';
import type { Pictures } from '../local/pictures.ts';
import type { Storage } from '../storage.ts';
import {
  ANALYSIS_SYSTEM,
  buildAnalysisPrompt,
  buildEnhancePrompt,
  buildShotPrompt,
  buildStoryboardPrompt,
  parseAnalysis,
  parseStoryboard,
  STORYBOARD_SYSTEM,
} from './prompts.ts';
import {
  DEFAULT_ENHANCE_MODEL,
  type EnhanceModel,
  enhanceSize,
  MASTER_MODEL,
  masterPlan,
  masterTarget,
  MODEL_INFO,
  type AppModel,
  nearestRatio,
  ratiosAt,
  SHOT_MODEL,
  SHOT_RATIOS,
} from './models.ts';
import { getProject, listProjects, updateProject } from './store.ts';

// ---------------------------------------------------------------------------
// Sentences

export const INTERRUPTED = 'This was interrupted. Ask again.';
export const INTERRUPTED_BEFORE_START =
  'This was interrupted before it started. Check the bar above for what was spent.';
export const STORYBOARD_EMPTY = 'The storyboard came back empty. Try again.';
export const LOCKED_MASTER = 'This image has a locked master.';
export const NEEDS_MASTER = 'Unlocks once at least one image is approved as a master.';
export const MUSIC_SENTENCE =
  "Music is not made on this Mac yet. The storyboard's music direction is kept as words.";
export const WAITED_TOO_LONG = 'This waited too long and was not sent. Ask again.';
export const CANCELLED = 'Cancelled before it was sent.';
export const VERSION_BUSY = 'A version of this image is already being made.';
export const NOT_KEPT = 'The result could not be kept on this Mac.';
export const NO_ANSWER = 'The engine gave no readable answer about this job.';

/** The model the app thinks with, for each kind of thinking. */
export const ANALYSIS_MODEL = 'claude-sonnet-5-5';
export const STORYBOARD_MODEL = 'claude-opus-5-5';

/** At most this many of this app's jobs are at the door at once. */
export const DOOR_SLOTS = 2;
export const ADVANCE_EVERY_MS = 3000;
export const CLAIM_STALE_MS = 2 * 60_000;
export const THINKING_STALE_MS = 6 * 60_000;
export const FILM_STALE_MS = 12 * 60_000;
/** A queued job asked this long ago, in a project nobody has watched for as long, is never sent. */
export const QUEUED_STALE_MS = 30 * 60_000;
/** A done job whose file could not be kept this many times running is failed. */
export const KEEP_TRIES = 5;
/** A job the door gave no readable answer about this many times running is failed. */
export const STATUS_TRIES = 20;
const MAX_SHOTS = 14;
const MAX_ATTACHED = 8;

// ---------------------------------------------------------------------------
// The door's jobs inside a project

/** What a door job keeps besides the shared fields, so it can be sent later as it was asked. */
export type DoorFields = {
  model?: string | undefined;
  ratio?: string | undefined;
  resolution?: string | undefined;
  scale?: number | undefined;
  seconds?: number | undefined;
  /** The kept picture sent as the job's one input. */
  inputKey?: string | undefined;
};
export type DoorJob = QueuedJob & DoorFields & { createdAt: string; prompt?: string };

export type JobRef =
  | { kind: 'enhance'; imageId: string; runId: string }
  | { kind: 'master'; imageId: string }
  | { kind: 'shot'; shotId: string };

/** Every door job of a project, in the document's order. */
export function doorJobs(p: Project): Array<{ ref: JobRef; job: DoorJob }> {
  const out: Array<{ ref: JobRef; job: DoorJob }> = [];
  for (const image of p.images) {
    for (const run of image.enhancements) {
      out.push({ ref: { kind: 'enhance', imageId: image.id, runId: run.id }, job: run as DoorJob });
    }
    if (image.master) out.push({ ref: { kind: 'master', imageId: image.id }, job: image.master as DoorJob });
  }
  for (const shot of p.storyboard?.shots ?? []) {
    if (shot.video) out.push({ ref: { kind: 'shot', shotId: shot.id }, job: shot.video as DoorJob });
  }
  return out;
}

export function locate(p: Project, ref: JobRef): DoorJob | undefined {
  if (ref.kind === 'shot') return p.storyboard?.shots.find((s) => s.id === ref.shotId)?.video as DoorJob | undefined;
  const image = p.images.find((i) => i.id === ref.imageId);
  if (!image) return undefined;
  if (ref.kind === 'master') return image.master as DoorJob | undefined;
  return image.enhancements.find((r) => r.id === ref.runId) as DoorJob | undefined;
}

const atDoor = (j: DoorJob) => j.state === 'running' && (!!j.taskId || !!j.claimedAt);
const busy = (j: { state: string } | undefined) => j?.state === 'queued' || j?.state === 'running';

function refuse(message: string, code: 'PRECONDITION_FAILED' | 'BAD_REQUEST' | 'NOT_FOUND' = 'PRECONDITION_FAILED'): never {
  throw new TRPCError({ code, message });
}

/**
 * End one door job as failed. A clip being made again gives the shot back
 * the kept clip it was to replace, with the sentence of why.
 */
function failJob(d: Project, ref: JobRef, j: DoorJob, why: string) {
  j.state = 'failed';
  j.error = why;
  if (ref.kind !== 'shot') return;
  const previous = (j as unknown as ShotVideo).previous;
  const shot = d.storyboard?.shots.find((s) => s.id === ref.shotId);
  if (shot && previous) shot.video = { ...previous, error: why };
}

function failure(err: unknown, fallback: string): string {
  return oneLine(err instanceof Error && err.message ? err.message : fallback);
}

// ---------------------------------------------------------------------------

export type ProjectsAccess = {
  get: (id: string) => Promise<Project>;
  update: (id: string, mutate: (draft: Project) => void | Promise<void>) => Promise<Project>;
  /** Every project, for counting this app's jobs at the door. */
  all: () => Promise<Project[]>;
};

export type PipelineDeps = {
  door: Door;
  store: Pick<Storage, 'getObject' | 'deleteObject' | 'objectPath'>;
  pictures: Pick<Pictures, 'size'>;
  claude: (options: ClaudeOptions) => Promise<ClaudeResult>;
  media: (op: Record<string, unknown>) => Promise<MediaResult>;
  probe: (key: string) => Promise<ProbeInfo>;
  projects?: ProjectsAccess;
  now?: () => number;
  newId?: () => string;
};

/** The project store of `store.ts`. */
export const storedProjects: ProjectsAccess = {
  get: getProject,
  update: updateProject,
  async all() {
    const list = await listProjects();
    const docs = await Promise.all(list.map((s) => getProject(s.id).catch(() => null)));
    return docs.filter((d): d is Project => d !== null);
  },
};

export function createPipeline(deps: PipelineDeps) {
  const { door, store, pictures } = deps;
  const projects = deps.projects ?? storedProjects;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const iso = () => new Date(now()).toISOString();
  const age = (at: string | undefined) => (at ? now() - Date.parse(at) : Infinity);

  /** In-flight thinking and film work; `idle` waits for it (tests). */
  const background = new Set<Promise<unknown>>();
  /** Claims this process is sending right now: never failed as stale while they are. */
  const sending = new Set<string>();
  const lastAdvance = new Map<string, number>();
  const advancing = new Map<string, Promise<void>>();
  /** When each project was last advanced in this process: someone had it open then. */
  const watched = new Map<string, number>();
  /** Tries that came to nothing, by the door's job id, counted while they run on. */
  const keepTries = new Map<string, number>();
  const statusTries = new Map<string, number>();
  let sendChain: Promise<unknown> = Promise.resolve();

  function track(work: Promise<unknown>) {
    const p = work.catch((err) => {
      console.error('[pipeline] background work failed:', err instanceof Error ? err.name : 'error');
    });
    background.add(p);
    void p.finally(() => background.delete(p));
  }

  async function idle() {
    while (background.size > 0 || advancing.size > 0) {
      await Promise.allSettled([...background, ...advancing.values()]);
    }
  }

  // -------------------------------------------------------------------------
  // advance

  /**
   * Move the project's work along: follow the jobs at the door, end stale
   * claims and stale thinking, and send queued jobs while fewer than two of
   * this app's are at the door. At most once every 3 seconds a project; a
   * second caller meanwhile shares the first one's run.
   */
  function advance(projectId: string): Promise<void> {
    const running = advancing.get(projectId);
    if (running) return running;
    const last = lastAdvance.get(projectId);
    if (last !== undefined && now() - last < ADVANCE_EVERY_MS) return Promise.resolve();
    lastAdvance.set(projectId, now());
    const work = advanceNow(projectId).finally(() => advancing.delete(projectId));
    advancing.set(projectId, work);
    return work;
  }

  async function advanceNow(projectId: string) {
    // Every project's stale work is ended, so a claim left by an interrupted
    // send in a project nobody has open does not hold one of the two places.
    for (const p of await projects.all()) await endStale(p);
    watched.set(projectId, now());
    // Every project's jobs at the door are followed, so a finished job in a
    // project nobody has open does not hold one of the two places.
    const all = await projects.all();
    for (const p of all) {
      for (const { ref, job } of doorJobs(p)) {
        if (job.state === 'running' && job.taskId) await follow(p.id, ref, job.taskId);
      }
    }
    await pump(projectId);
  }

  /**
   * Stale claims, thinking and film of one project become failed, and so do
   * jobs that waited more than 30 minutes while nobody had the project open:
   * they are never sent later, from an allowance opened for something else.
   */
  async function endStale(p: Project) {
    const seen = watched.get(p.id);
    const unwatched = seen === undefined ? Infinity : now() - seen;
    const staleClaim = (job: DoorJob) =>
      job.state === 'running' && !job.taskId && !sending.has(job.claimId ?? '') && age(job.claimedAt) > CLAIM_STALE_MS;
    const staleWait = (job: DoorJob) =>
      job.state === 'queued' && age(job.createdAt) > QUEUED_STALE_MS && unwatched > QUEUED_STALE_MS;
    const stale =
      doorJobs(p).some(({ job }) => staleClaim(job) || staleWait(job)) ||
      p.images.some((i) => i.analysis?.state === 'running' && age(i.analysis.claimedAt) > THINKING_STALE_MS) ||
      (p.storyboard?.state === 'running' && age(p.storyboard.claimedAt) > THINKING_STALE_MS) ||
      (p.film?.state === 'running' && age(p.film.stitch.claimedAt) > FILM_STALE_MS);
    if (!stale) return;
    await projects.update(p.id, (d) => {
      for (const { ref, job } of doorJobs(d)) {
        if (staleClaim(job)) failJob(d, ref, job, INTERRUPTED_BEFORE_START);
        else if (staleWait(job)) failJob(d, ref, job, WAITED_TOO_LONG);
      }
      for (const i of d.images) {
        if (i.analysis?.state === 'running' && age(i.analysis.claimedAt) > THINKING_STALE_MS) {
          i.analysis.state = 'failed';
          i.analysis.error = INTERRUPTED;
        }
      }
      if (d.storyboard?.state === 'running' && age(d.storyboard.claimedAt) > THINKING_STALE_MS) {
        d.storyboard.state = 'failed';
        d.storyboard.error = INTERRUPTED;
      }
      if (d.film?.state === 'running' && age(d.film.stitch.claimedAt) > FILM_STALE_MS) {
        d.film.state = 'failed';
        d.film.error = INTERRUPTED;
        d.film.stitch.state = 'failed';
      }
    });
  }

  /** Change one door job, only while it is still the one asked about. */
  async function patchJob(projectId: string, ref: JobRef, still: (j: DoorJob) => boolean, patch: (j: DoorJob, d: Project) => void) {
    await projects.update(projectId, (d) => {
      const j = locate(d, ref);
      if (j && still(j)) patch(j, d);
    });
  }

  /** Ask the door about one job and, when it is done, keep its file. */
  async function follow(projectId: string, ref: JobRef, taskId: string) {
    const same = (j: DoorJob) => j.state === 'running' && j.taskId === taskId;
    const fail = (why: string) => {
      keepTries.delete(taskId);
      statusTries.delete(taskId);
      return patchJob(projectId, ref, same, (j, d) => failJob(d, ref, j, why));
    };
    /** One more try that came to nothing; true once it was the last one allowed. */
    const spent = (tries: Map<string, number>, most: number) => {
      const n = (tries.get(taskId) ?? 0) + 1;
      tries.set(taskId, n);
      return n >= most;
    };
    let st;
    try {
      st = await door.status(taskId);
    } catch {
      return; // the engine is away for now; ask again next time
    }
    if (!st) {
      // An answer that cannot be read: asked again, but not for ever.
      if (spent(statusTries, STATUS_TRIES)) return fail(NO_ANSWER);
      return;
    }
    statusTries.delete(taskId);
    if (st.gone) return fail(JOB_GONE);
    if (st.failed) return fail(st.reason ?? 'The generation failed.');
    if (st.state !== 'done') {
      const progress = st.progress;
      if (progress === null) return;
      return patchJob(projectId, ref, (j) => same(j) && j.progress !== progress, (j) => {
        j.progress = progress;
      });
    }
    const type = st.output?.type ?? '';
    const ext = Object.hasOwn(OUTPUT_EXT, type) ? OUTPUT_EXT[type]! : undefined;
    const wantsVideo = ref.kind === 'shot';
    if (!ext || (ext === 'mp4') !== wantsVideo) return fail(CANNOT_KEEP);
    if (!(Number(st.output?.bytes) <= OUTPUT_MAX_BYTES)) return fail(TOO_LARGE_TO_KEEP);
    const key = `media/${newId()}.${ext}`;
    let kept;
    try {
      kept = await door.keep(taskId, key);
    } catch {
      // The fetch broke part way, or the file could not be written: tried
      // again next time, a few times, then the job ends with a sentence.
      await store.deleteObject(key).catch(() => {});
      if (spent(keepTries, KEEP_TRIES)) return fail(NOT_KEPT);
      return;
    }
    if ('notReady' in kept) return;
    if ('failed' in kept) return fail(kept.failed);
    keepTries.delete(taskId);

    let size: { width: number; height: number } | undefined;
    let clip: ProbeInfo | undefined;
    try {
      if (wantsVideo) clip = await deps.probe(key);
      else {
        const bytes = await store.getObject(key);
        if (bytes) size = await pictures.size(bytes);
      }
    } catch {
      // The size stays unknown; the file is kept all the same.
    }
    let written = false;
    await patchJob(projectId, ref, same, (j) => {
      written = true;
      j.state = 'succeeded';
      j.progress = 1;
      j.error = undefined;
      if (ref.kind === 'shot') {
        const v = j as unknown as ShotVideo;
        v.storedKey = key;
        v.previous = undefined;
        if (clip) {
          v.width = clip.width;
          v.height = clip.height;
          v.durationSeconds = clip.duration;
        }
        return;
      }
      const r = j as unknown as EnhancementRun | MasterRun;
      r.storedKey = key;
      if (size) r.outputSize = size;
      if (ref.kind === 'master') (r as MasterRun).locked = true;
    });
    if (!written) await store.deleteObject(key).catch(() => {});
  }

  /** Send queued jobs of `projectId` while fewer than two of this app's are at the door. */
  function pump(projectId: string): Promise<void> {
    const run = sendChain.catch(() => {}).then(async () => {
      for (;;) {
        const all = await projects.all();
        const count = all.reduce((n, p) => n + doorJobs(p).filter(({ job }) => atDoor(job)).length, 0);
        if (count >= DOOR_SLOTS) return;
        const p = all.find((x) => x.id === projectId);
        if (!p) return;
        const queued = doorJobs(p)
          .filter(({ job }) => job.state === 'queued')
          .sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt));
        const next = queued[0];
        if (!next) return;
        const claimId = newId();
        let claimed = false;
        await patchJob(projectId, next.ref, (j) => j.state === 'queued', (j) => {
          j.state = 'running';
          j.claimedAt = iso();
          j.claimId = claimId;
          j.taskId = undefined;
          j.error = undefined;
          claimed = true;
        });
        if (!claimed) continue;
        sending.add(claimId);
        let outcome: 'next' | 'stop';
        try {
          outcome = await send(projectId, next.ref, claimId);
        } finally {
          sending.delete(claimId);
        }
        if (outcome === 'stop') return;
      }
    });
    sendChain = run;
    return run;
  }

  /** Send one claimed job: its picture, then the job. */
  async function send(projectId: string, ref: JobRef, claimId: string): Promise<'next' | 'stop'> {
    const mine = (j: DoorJob) => j.state === 'running' && j.claimId === claimId && !j.taskId;
    const fail = async (why: string) => {
      await patchJob(projectId, ref, mine, (j, d) => failJob(d, ref, j, why));
      return 'next' as const;
    };
    const release = async () => {
      await patchJob(projectId, ref, mine, (j) => {
        j.state = 'queued';
        j.claimedAt = undefined;
        j.claimId = undefined;
      });
      return 'stop' as const;
    };
    const p = await projects.get(projectId);
    const job = locate(p, ref);
    if (!job || !mine(job)) return 'next';
    const info = job.model ? MODEL_INFO[job.model as AppModel] : undefined;
    if (!info || !job.inputKey) return fail(NOT_STARTED);

    let input: string;
    try {
      const sent = await door.sendInput(job.inputKey);
      if ('refused' in sent) return fail(sent.refused);
      input = sent.input;
    } catch {
      // Nothing was asked for yet: the job waits for the next turn.
      return release();
    }
    const body: JobBody = {
      model: job.model!,
      kind: info.kind,
      inputs: [{ input, role: info.inputRole }],
      prompt: ref.kind === 'master' ? '' : (job.prompt ?? ''),
    };
    if (job.seconds !== undefined) body.seconds = job.seconds;
    if (job.ratio !== undefined) body.ratio = job.ratio;
    if (job.resolution !== undefined) body.resolution = job.resolution;
    if (job.scale !== undefined) body.scale = job.scale;

    let r;
    try {
      r = await door.submit(body);
    } catch {
      // The answer never came: the job may have started. It stays claimed
      // with no id, and the 2-minute rule ends it; it is never sent again.
      return 'stop';
    }
    if ('job' in r) {
      const taskId = r.job;
      const cents = r.cents;
      await patchJob(projectId, ref, (j) => j.claimId === claimId, (j, d) => {
        j.taskId = taskId;
        j.cents = cents;
        // Counted in the same write as the id, so a job is counted once.
        if (typeof cents === 'number' && Number.isFinite(cents) && cents > 0) {
          const spent = (d.spent ??= { enhanceCents: 0, masterCents: 0, clipCents: 0 });
          if (ref.kind === 'enhance') spent.enhanceCents += cents;
          else if (ref.kind === 'master') spent.masterCents += cents;
          else spent.clipCents += cents;
        }
      });
      return 'next';
    }
    if ('busy' in r) return release();
    return fail(r.refused);
  }

  // -------------------------------------------------------------------------
  // Images

  function imageOf(p: Project, imageId: string): ProjectImage {
    const image = p.images.find((i) => i.id === imageId);
    if (!image) refuse('That image is no longer in this project.', 'NOT_FOUND');
    return image;
  }

  async function setSettings(projectId: string, imageId: string, settings: ImageSettings) {
    return projects.update(projectId, (d) => {
      imageOf(d, imageId).settings = structuredClone(settings);
    });
  }

  async function removeImage(projectId: string, imageId: string) {
    let removed: ProjectImage | undefined;
    const p = await projects.update(projectId, (d) => {
      const image = imageOf(d, imageId);
      if (busy(image.analysis) || image.enhancements.some(busy) || busy(image.master)) {
        refuse("Wait for this image's work to finish first.");
      }
      d.images = d.images.filter((i) => i.id !== imageId);
      removed = image;
    });
    if (removed) {
      for (const key of [removed.originalKey, removed.workKey, removed.thumbKey]) await store.deleteObject(key).catch(() => {});
    }
    return p;
  }

  async function analyse(projectId: string, imageIds: string[]) {
    const started: Array<{ imageId: string; claimId: string }> = [];
    const p = await projects.update(projectId, (d) => {
      for (const id of imageIds) {
        const image = imageOf(d, id);
        if (image.analysis?.state === 'running') continue;
        const claimId = newId();
        image.analysis = { state: 'running', claimedAt: iso(), claimId };
        started.push({ imageId: id, claimId });
      }
    });
    for (const s of started) track(runAnalysis(projectId, s.imageId, s.claimId));
    return p;
  }

  async function runAnalysis(projectId: string, imageId: string, claimId: string) {
    let patch: { state: 'succeeded' | 'failed'; result?: ReturnType<typeof parseAnalysis>; error?: string };
    try {
      const image = imageOf(await projects.get(projectId), imageId);
      const res = await deps.claude({
        model: ANALYSIS_MODEL,
        system_prompt: ANALYSIS_SYSTEM,
        prompt: buildAnalysisPrompt(),
        images: [{ url: mediaUrl(image.workKey) }],
        max_output_tokens: 1500,
      });
      try {
        patch = { state: 'succeeded', result: parseAnalysis(res.text) };
      } catch {
        patch = { state: 'failed', error: 'The analysis came back unreadable. Ask again.' };
      }
    } catch (err) {
      patch = { state: 'failed', error: failure(err, 'The analysis failed. Ask again.') };
    }
    await projects.update(projectId, (d) => {
      const image = d.images.find((i) => i.id === imageId);
      if (!image?.analysis || image.analysis.claimId !== claimId || image.analysis.state !== 'running') return;
      image.analysis = { ...image.analysis, ...patch };
    });
  }

  async function enhance(projectId: string, imageIds: string[], model: EnhanceModel = DEFAULT_ENHANCE_MODEL, revisionNote?: string) {
    const { list, why } = await door.models();
    if (!list) refuse(why || ENGINE_UNREACHABLE);
    const row = list.find((m) => m.id === model);
    if (!row) refuse(NOT_LISTED);
    return projects.update(projectId, (d) => {
      let asked = 0;
      // One run an image at a time: a repeated id, or an image with a version
      // already waiting or being made, is not asked for again.
      for (const id of new Set(imageIds)) {
        const image = imageOf(d, id);
        if (image.master?.locked) refuse(LOCKED_MASTER);
        if (image.enhancements.some(busy)) continue;
        asked += 1;
        const settings = structuredClone(image.settings);
        const size = enhanceSize(settings, image);
        const ratio = nearestRatio(ratiosAt(row, size), image.width, image.height);
        if (Array.isArray(row.ratios) && !ratio) refuse('This model does not make this size.');
        const last = image.enhancements[image.enhancements.length - 1];
        const run: EnhancementRun & DoorFields = {
          id: newId(),
          version: (last?.version ?? 0) + 1,
          createdAt: iso(),
          settings,
          prompt: buildEnhancePrompt(image, settings, revisionNote),
          imageSize: size,
          state: 'queued',
          decision: 'pending',
          model,
          resolution: Array.isArray(row.resolutions) ? size : undefined,
          ratio: ratio ?? undefined,
          inputKey: image.workKey,
        };
        if (revisionNote?.trim()) run.revisionNote = revisionNote.trim();
        image.enhancements.push(run);
      }
      if (asked === 0) refuse(VERSION_BUSY);
    });
  }

  async function decide(
    projectId: string,
    imageId: string,
    runId: string,
    decision: 'approved' | 'rejected' | 'revision',
    note?: string
  ) {
    return projects.update(projectId, (d) => {
      const image = imageOf(d, imageId);
      if (image.master?.locked) refuse(LOCKED_MASTER);
      if (busy(image.master)) refuse("This image's master is being made.");
      const run = image.enhancements.find((r) => r.id === runId);
      if (!run) refuse('That version is no longer here.', 'NOT_FOUND');
      if (decision === 'approved') {
        if (run.state !== 'succeeded' || !run.storedKey) refuse('Only a finished version can be approved.');
        for (const other of image.enhancements) {
          if (other.id !== run.id && other.decision === 'approved') other.decision = 'rejected';
        }
        run.decisionNote = undefined;
      } else if (decision === 'revision') {
        run.decisionNote = note?.trim() || undefined;
      } else {
        run.decisionNote = undefined;
      }
      run.decision = decision;
    });
  }

  async function master(projectId: string, imageIds: string[]) {
    // The approved pictures' sizes, read before the write when the run never learned them.
    const before = await projects.get(projectId);
    const sizes = new Map<string, { width: number; height: number }>();
    for (const id of imageIds) {
      const run = approvedEnhancement(imageOf(before, id));
      if (!run?.storedKey) continue;
      if (run.outputSize) sizes.set(run.id, run.outputSize);
      else {
        try {
          const bytes = await store.getObject(run.storedKey);
          if (bytes) sizes.set(run.id, await pictures.size(bytes));
        } catch {
          // Unknown size: refused below.
        }
      }
    }
    return projects.update(projectId, (d) => {
      for (const id of imageIds) {
        const image = imageOf(d, id);
        if (image.master?.locked || busy(image.master)) continue;
        const run = approvedEnhancement(image);
        if (!run?.storedKey) refuse(`${image.code} has no approved version yet.`);
        const size = run.outputSize ?? sizes.get(run.id);
        if (!size) refuse(`The size of ${image.code}'s approved version could not be read.`);
        run.outputSize = size;
        const side = Math.max(size.width, size.height);
        const target = masterTarget(run.settings, image);
        const plan = masterPlan(side, target);
        if (plan.reuse) {
          image.master = {
            state: 'succeeded',
            sourceRunId: run.id,
            createdAt: iso(),
            targetLongEdge: target,
            locked: true,
            reusedEnhancement: true,
            storedKey: run.storedKey,
            outputSize: run.outputSize,
          };
        } else {
          const m: MasterRun & DoorFields = {
            state: 'queued',
            sourceRunId: run.id,
            createdAt: iso(),
            targetLongEdge: target,
            locked: false,
            model: MASTER_MODEL,
            scale: plan.scale,
            inputKey: run.storedKey,
          };
          image.master = m;
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Storyboard and shots

  const lockedMasters = (p: Project) => p.images.filter((i) => i.master?.locked && i.master.storedKey);

  async function createStoryboard(projectId: string, brief: string, format: FilmFormat) {
    const claimId = newId();
    const p = await projects.update(projectId, (d) => {
      if (lockedMasters(d).length === 0) refuse(NEEDS_MASTER);
      if (d.storyboard?.state === 'running') refuse('The storyboard is still being written.');
      if ((d.storyboard?.shots ?? []).some((s) => busy(s.video))) refuse('A clip is still being made. Wait for it to finish first.');
      const old = d.storyboard;
      // The old storyboard stays as it is until the new one has arrived.
      d.storyboard = {
        state: 'running',
        claimedAt: iso(),
        claimId,
        createdAt: old?.createdAt ?? iso(),
        brief,
        format,
        imageIds: old?.imageIds ?? [],
        title: old?.title ?? '',
        narrative: old?.narrative ?? '',
        grade: old?.grade ?? '',
        musicDirection: old?.musicDirection ?? '',
        shots: old?.shots ?? [],
      };
    });
    track(runStoryboard(projectId, claimId, brief, format));
    return p;
  }

  async function runStoryboard(projectId: string, claimId: string, brief: string, format: FilmFormat) {
    let result: { ok: true; masters: ProjectImage[]; parsed: ReturnType<typeof parseStoryboard> } | { ok: false; error: string };
    try {
      const masters = lockedMasters(await projects.get(projectId));
      const attached = masters.slice(0, MAX_ATTACHED);
      const res = await deps.claude({
        model: STORYBOARD_MODEL,
        system_prompt: STORYBOARD_SYSTEM,
        prompt: buildStoryboardPrompt(
          brief,
          format,
          masters.map((image, i) => ({ image, attached: i < MAX_ATTACHED }))
        ),
        images: attached.map((i) => ({ url: mediaUrl(i.master!.storedKey!) })),
        max_output_tokens: 8000,
      });
      try {
        result = { ok: true, masters, parsed: parseStoryboard(res.text) };
      } catch {
        result = { ok: false, error: STORYBOARD_EMPTY };
      }
    } catch (err) {
      result = { ok: false, error: failure(err, STORYBOARD_EMPTY) };
    }
    await projects.update(projectId, (d) => {
      const sb = d.storyboard;
      if (!sb || sb.claimId !== claimId || sb.state !== 'running') return;
      if (!result.ok) {
        sb.state = 'failed';
        sb.error = result.error;
        return;
      }
      const byCode = new Map(lockedMasters(d).map((i) => [i.code, i]));
      const shots: Shot[] = [];
      for (const s of result.parsed.shots) {
        const image = byCode.get(s.imageCode);
        if (!image) continue;
        if (shots.length >= MAX_SHOTS) break;
        const { imageCode: _code, ...fields } = s;
        shots.push({ ...fields, id: newId(), number: shots.length + 1, imageId: image.id });
      }
      if (shots.length === 0) {
        sb.state = 'failed';
        sb.error = STORYBOARD_EMPTY;
        return;
      }
      d.storyboard = {
        state: 'succeeded',
        claimedAt: sb.claimedAt,
        claimId,
        createdAt: iso(),
        brief: sb.brief,
        format: sb.format,
        imageIds: result.masters.map((m) => m.id),
        title: result.parsed.title,
        narrative: result.parsed.narrative,
        grade: result.parsed.grade,
        musicDirection: result.parsed.musicDirection,
        shots,
      };
    });
  }

  function shotOf(d: Project, shotId: string): Shot {
    const shot = d.storyboard?.shots.find((s) => s.id === shotId);
    if (!shot) refuse('That shot is no longer in the storyboard.', 'NOT_FOUND');
    return shot;
  }

  const renumber = (d: Project) => d.storyboard?.shots.forEach((s, i) => (s.number = i + 1));

  type ShotEdit = Partial<
    Pick<
      Shot,
      | 'shotType'
      | 'creativeDirection'
      | 'cameraMovement'
      | 'speed'
      | 'lighting'
      | 'humanActivity'
      | 'purpose'
      | 'videoPrompt'
      | 'durationSeconds'
      | 'transition'
    >
  >;

  async function updateShot(projectId: string, shotId: string, edit: ShotEdit) {
    return projects.update(projectId, (d) => {
      if (d.storyboard?.state === 'running') refuse('The storyboard is still being written.');
      const shot = shotOf(d, shotId);
      for (const [k, v] of Object.entries(edit)) {
        if (v !== undefined) (shot as unknown as Record<string, unknown>)[k] = v;
      }
    });
  }

  async function removeShot(projectId: string, shotId: string) {
    return projects.update(projectId, (d) => {
      if (d.storyboard?.state === 'running') refuse('The storyboard is still being written.');
      const shot = shotOf(d, shotId);
      if (busy(shot.video)) refuse("This shot's clip is still being made.");
      d.storyboard!.shots = d.storyboard!.shots.filter((s) => s.id !== shotId);
      renumber(d);
    });
  }

  async function moveShot(projectId: string, shotId: string, to: number) {
    return projects.update(projectId, (d) => {
      if (d.storyboard?.state === 'running') refuse('The storyboard is still being written.');
      const shot = shotOf(d, shotId);
      const shots = d.storyboard!.shots.filter((s) => s.id !== shotId);
      shots.splice(Math.max(0, Math.min(shots.length, to)), 0, shot);
      d.storyboard!.shots = shots;
      renumber(d);
    });
  }

  async function generateShots(projectId: string, shotIds: string[]) {
    return projects.update(projectId, (d) => {
      const sb = d.storyboard;
      if (!sb || sb.state === 'running') refuse('The storyboard is still being written.');
      for (const id of shotIds) {
        const shot = shotOf(d, id);
        if (busy(shot.video)) continue;
        const image = d.images.find((i) => i.id === shot.imageId);
        if (!image?.master?.locked || !image.master.storedKey) refuse("This shot's image has no master.");
        const video: ShotVideo & DoorFields = {
          state: 'queued',
          prompt: buildShotPrompt(shot),
          createdAt: iso(),
          decision: 'pending',
          durationSeconds: shot.durationSeconds,
          model: SHOT_MODEL,
          seconds: shot.durationSeconds,
          ratio: SHOT_RATIOS[sb.format],
          inputKey: image.master.storedKey,
        };
        // A kept clip stays with the new job until the new one is kept too,
        // and comes back if it fails or is cancelled.
        const old = shot.video;
        if (old?.state === 'succeeded' && old.storedKey) video.previous = { ...old, previous: undefined };
        shot.video = video;
      }
    });
  }

  /** Every job of the project still waiting to be sent ends here, before it is sent. */
  async function cancelWaiting(projectId: string) {
    return projects.update(projectId, (d) => {
      for (const { ref, job } of doorJobs(d)) {
        if (job.state === 'queued') failJob(d, ref, job, CANCELLED);
      }
    });
  }

  async function decideShot(projectId: string, shotId: string, decision: 'approved' | 'rejected') {
    return projects.update(projectId, (d) => {
      const shot = shotOf(d, shotId);
      if (!shot.video || shot.video.state !== 'succeeded' || !shot.video.storedKey) refuse('Only a finished clip can be decided.');
      shot.video.decision = decision;
    });
  }

  // -------------------------------------------------------------------------
  // Film

  async function assembleFilm(projectId: string, transition: Transition) {
    const claimId = newId();
    let keys: string[] = [];
    const p = await projects.update(projectId, (d) => {
      if (d.film?.state === 'running') refuse('The film is still being made.');
      const clips = (d.storyboard?.shots ?? []).filter(
        (s) => s.video?.decision === 'approved' && s.video.state === 'succeeded' && s.video.storedKey
      );
      if (clips.length === 0) refuse('Approve at least one clip first.');
      keys = clips.map((s) => s.video!.storedKey!);
      d.film = {
        state: 'running',
        createdAt: iso(),
        withMusic: false,
        musicPrompt: d.storyboard?.musicDirection ?? '',
        transition,
        shotIds: clips.map((s) => s.id),
        stitch: { state: 'running', claimedAt: iso(), claimId },
      };
    });
    track(runFilm(projectId, claimId, keys, transition));
    return p;
  }

  async function runFilm(projectId: string, claimId: string, keys: string[], transition: Transition) {
    let done: { key: string; duration?: number } | { error: string };
    try {
      const made = await deps.media({
        operation: 'stitch',
        input: keys,
        parameters: { transition: { duration: transition === 'fade' ? 0.5 : 0 } },
      });
      const out = Array.isArray(made) ? made[0] : made;
      if (!out) throw new Error('The video work made nothing.');
      let duration: number | undefined;
      try {
        duration = (await deps.probe(out.key)).duration;
      } catch {
        duration = undefined;
      }
      done = { key: out.key, duration };
    } catch (err) {
      done = { error: failure(err, 'The film could not be made.') };
    }
    await projects.update(projectId, (d) => {
      const film = d.film;
      if (!film || film.stitch.claimId !== claimId || film.state !== 'running') return;
      if ('error' in done) {
        film.state = 'failed';
        film.error = done.error;
        film.stitch.state = 'failed';
        film.stitch.error = done.error;
        return;
      }
      film.state = 'succeeded';
      film.finalStoredKey = done.key;
      film.stitch.state = 'succeeded';
      film.stitch.durationSeconds = done.duration;
    });
  }

  return {
    advance,
    idle,
    setSettings,
    removeImage,
    analyse,
    enhance,
    decide,
    master,
    createStoryboard,
    updateShot,
    removeShot,
    moveShot,
    generateShots,
    cancelWaiting,
    decideShot,
    assembleFilm,
  };
}

export type Pipeline = ReturnType<typeof createPipeline>;
