import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ownerKey, readLibrary, type Still, updateLibrary } from './library.ts';
import {
  ANGLE_IDS,
  type AngleId,
  buildCinematicPrompt,
  CROWD_IDS,
  CROWDS,
  type CrowdId,
  LOOK_IDS,
  LOOKS,
  type LookId,
} from './looks.ts';
import {
  defaultImageResolution,
  IMAGE_MODEL_IDS,
  type ImageModelId,
  imageModelPromptLimit,
  imageResolutions,
} from './models.ts';
import { submitStill } from './still-submit.ts';
import { documentStore } from './storage.ts';
import { MAX_STORYBOARD_IMAGES, STORYLINE_IDS, STORYLINES, type StorylineId } from './storyboard.ts';
import { logRejection, type RunwayCtx, snapError, toTrpcError } from './task-helpers.ts';
import { filesUrl, router, signedInProcedure } from './trpc.ts';

/**
 * The Director tab: upload a project's images, pick a storyline, and Claude
 * plans the film: the order of the frames, and for each one the light, the
 * camera move and the people that tell that part of the story. Every pick is
 * one of the Stills tab's own presets, so the person can change any of them
 * from the same lists. Each frame is then re-shot strictly from its image
 * (nothing added but the people asked for) and saved as a library still.
 *
 *   planning → planned        (or failed; "Plan again" starts a new one)
 *
 * Claude takes at most six images per call, so a larger set is planned in
 * batches of six; each answer places its frames on one 1–100 story arc, and
 * the frames are ordered by that.
 */

const PLANNER_MODEL = 'claude-sonnet-5-5';
const BATCH = 6;

export type FramePlan = {
  /** Index into the job's images. */
  image: number;
  /** Where it falls on the story arc, 1–100. */
  position: number;
  space: 'exterior' | 'interior';
  title: string;
  /** What this frame says in the story. */
  beat: string;
  look: LookId;
  lookWhy: string;
  angle: AngleId;
  angleWhy: string;
  crowd: CrowdId;
  /** Who the people are, in a few words (empty for no people). */
  people: string;
  crowdWhy: string;
};

/** What the person set for a frame, over the plan's picks. */
export type FrameChoice = {
  look?: LookId | undefined;
  angle?: AngleId | undefined;
  crowd?: CrowdId | undefined;
  note?: string | undefined;
  /** Chosen for the film: the Director's video step animates these. */
  selected?: boolean | undefined;
  /** The take used for this frame, when not its newest (a still id). */
  take?: string | undefined;
};

export type StoryboardShot = { image: number; stillId: string; createdAt: string };

/** A clip made from a chosen frame on the Director's film step. */
export type StoryboardClip = { image: number; clipId: string; createdAt: string };

export type StoryboardImage = { url: string; width: number; height: number; name: string };

export type StoryboardJob = {
  id: string;
  createdAt: string;
  updatedAt?: string | undefined;
  storyline: StorylineId;
  story: string;
  imageModel: ImageModelId;
  resolution: string;
  images: StoryboardImage[];
  status: 'planning' | 'planned' | 'failed';
  error?: string | undefined;
  planTaskIds: string[];
  /** One per image, ordered by `position`. */
  plan?: FramePlan[] | undefined;
  choices?: Record<string, FrameChoice> | undefined;
  /** Every take, newest first; a frame shows its newest. */
  shots?: StoryboardShot[] | undefined;
  /** Clips made from the chosen frames, newest first; a frame shows its newest. */
  clips?: StoryboardClip[] | undefined;
};

type StoryboardDoc = { jobs: StoryboardJob[] };

/** One document per person under `storyboards/`, beside their library. */
const store = documentStore<StoryboardDoc>({ prefix: 'storyboards/' });

async function readJobs(owner: string): Promise<StoryboardJob[]> {
  return (await store.get(`${owner}.json`))?.value.jobs ?? [];
}

function updateJobs(owner: string, mutate: (jobs: StoryboardJob[]) => StoryboardJob[]) {
  return store.update(`${owner}.json`, (current) => ({ jobs: mutate(current?.jobs ?? []).slice(0, 10) }));
}

/** Apply `patch` only while the stored job still passes `still`; returns the stored job. */
async function transition(
  owner: string,
  id: string,
  still: (j: StoryboardJob) => boolean,
  patch: (j: StoryboardJob) => Partial<StoryboardJob>
): Promise<StoryboardJob | null> {
  let stored: StoryboardJob | null = null;
  await updateJobs(owner, (jobs) => {
    stored = null;
    return jobs.map((j) => {
      if (j.id !== id) return j;
      stored = still(j) ? { ...j, ...patch(j), updatedAt: new Date().toISOString() } : j;
      return stored;
    });
  });
  return stored;
}

function notFound(): TRPCError {
  return new TRPCError({ code: 'NOT_FOUND', message: 'That storyboard is no longer saved. Plan a new one.' });
}

const PLANNER_SYSTEM =
  'You are the director and director of photography of a cinematic architectural film. You are given images of one architecture or landscape project and a storyline, and you plan how each image is re-shot as a photoreal film still so the set tells that story. You only ever choose from the presets you are given, and you never ask for anything that is not already in the images.';

function presetList<T extends { id: string; name: string; hint: string }>(list: readonly T[]): string {
  return list.map((x) => `- "${x.id}": ${x.name} (${x.hint})`).join('\n');
}

function plannerPrompt(job: StoryboardJob, from: number, count: number): string {
  const storyline = STORYLINES.find((s) => s.id === job.storyline) ?? STORYLINES[0];
  const total = job.images.length;
  return [
    total > count
      ? `These ${count} images are images ${from + 1} to ${from + count} of ${total} views of the same project. Image 1 here is image ${from + 1} of the set.`
      : `These ${count} images are views of the same project. Image 1 is the first.`,
    `The storyline is "${storyline.name}": ${storyline.narrative}`,
    job.story ? `The director's own story for this film, which comes first: ${job.story}` : '',
    'For every image, decide what part of the story it tells and how to shoot it. Look carefully at each image first: whether it is an exterior or an interior, what time of day and weather it shows now, what is in it, and where people could naturally be.',
    'Rules:',
    '- Every image gets a frame; never drop or merge images.',
    '- "position" places the frame on the whole story arc from 1 (the very first shot) to 100 (the last), so frames from different batches can be cut in order. Give different frames different positions.',
    '- Choose the light from the lighting presets. Use the interior presets ("interior-lit", "interior-luxury") only for interiors, and choose a light the image can plausibly be photographed in. Follow the storyline’s time of day and mood across the set.',
    '- The camera never moves: every frame is shot from exactly the image’s own viewpoint, so do not plan a camera.',
    '- Choose the people from the people presets, matching the storyline and the space. Choose "none" where people would crowd the architecture, where the image has no believable place for them, or where the storyline wants the place empty. In "people", say in a few words who they are and what they are doing, ordinary and believable for that place (e.g. "a couple reading on the terrace loungers"). Leave it empty for "none".',
    '- Nothing new may be added to an image except those people: never suggest new objects, furniture, plants, buildings, vehicles, animals or light sources, and never describe the beat in terms of things that are not visible.',
    '',
    'Lighting presets:',
    presetList(LOOKS),
    '',
    'People presets:',
    presetList(CROWDS),
    '',
    'For each image give: "image" (its number here), "space" ("exterior" or "interior"), "position", "title" (two to five words, e.g. "Arrival at the gate"), "beat" (one sentence: what this frame says in the story), "look", "look_why", "crowd", "people", "crowd_why" (each why is one short sentence).',
    'Answer with one JSON object and nothing else, in exactly this shape:',
    '{"frames":[{"image":1,"space":"exterior","position":10,"title":"...","beat":"...","look":"golden-hour","look_why":"...","crowd":"few","people":"...","crowd_why":"..."}]}',
  ]
    .filter(Boolean)
    .join('\n');
}

// Lenient: a null, a number or an over-long answer for one field never
// throws away the whole batch of frames.
const text = (max: number) =>
  z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, max));

const planSchema = z.object({
  frames: z.array(
    z.object({
      image: z.coerce.number().int(),
      space: z.enum(['exterior', 'interior']).catch('exterior'),
      position: z.coerce.number().catch(50),
      title: text(80),
      beat: text(300),
      look: z.enum(LOOK_IDS).catch('none'),
      look_why: text(300),
      crowd: z.enum(CROWD_IDS).catch('none'),
      people: text(200),
      crowd_why: text(300),
    })
  ),
});

/** Pull one batch's frames out of the planner's answer, tolerating a code fence. */
function parseBatch(answer: string, from: number, count: number): FramePlan[] | null {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = planSchema.safeParse(JSON.parse(answer.slice(start, end + 1)));
    if (!parsed.success) return null;
    const out: FramePlan[] = [];
    for (const f of parsed.data.frames) {
      const image = from + f.image - 1;
      if (f.image < 1 || f.image > count || out.some((o) => o.image === image)) continue;
      // An interior light preset never lands on an exterior.
      const look = f.space === 'exterior' && f.look.startsWith('interior') ? 'golden-hour' : f.look;
      out.push({
        image,
        position: Math.min(100, Math.max(1, f.position)),
        space: f.space,
        title: f.title || `Frame ${image + 1}`,
        beat: f.beat,
        look,
        lookWhy: f.look_why,
        // Like Stills, a frame keeps the image's own camera unless the
        // person picks a move for it.
        angle: 'as-rendered',
        angleWhy: '',
        crowd: f.crowd,
        people: f.crowd === 'none' ? '' : f.people,
        crowdWhy: f.crowd_why,
      });
    }
    // An image the answer skipped still gets a frame, as rendered.
    for (let i = 0; i < count; i++) {
      if (out.some((o) => o.image === from + i)) continue;
      out.push({
        image: from + i,
        position: 50,
        space: 'exterior',
        title: `Frame ${from + i + 1}`,
        beat: '',
        look: 'none',
        lookWhy: '',
        angle: 'as-rendered',
        angleWhy: '',
        crowd: 'none',
        people: '',
        crowdWhy: '',
      });
    }
    return out;
  } catch {
    return null;
  }
}

async function submitPlanner(ctx: RunwayCtx, job: StoryboardJob, from: number): Promise<string> {
  const batch = job.images.slice(from, from + BATCH);
  try {
    const { id } = await ctx.runway.createTask(
      'claude_api',
      {
        name: 'render-to-film storyboard',
        model: PLANNER_MODEL,
        system_prompt: PLANNER_SYSTEM,
        prompt: plannerPrompt(job, from, batch.length),
        images: batch.map((img) => ({ url: img.url })),
        temperature: 0.4,
        max_output_tokens: 10000,
      },
      { internal: true }
    );
    return id;
  } catch (err) {
    logRejection('storyboard', 'claude_api', err);
    throw err;
  }
}

/** Record the planner's answers once every batch is in; never submits anything. */
async function advance(ctx: RunwayCtx, owner: string, job: StoryboardJob): Promise<StoryboardJob> {
  if (job.status !== 'planning') return job;
  const plan: FramePlan[] = [];
  let failure: string | null = null;
  for (const [i, taskId] of job.planTaskIds.entries()) {
    const snap = await ctx.runway.taskSnapshot(taskId, { includeText: true });
    if (!snap.done) return job;
    const from = i * BATCH;
    const count = Math.min(BATCH, job.images.length - from);
    const frames =
      snap.status === 'SUCCEEDED' && snap.text && !snap.truncated ? parseBatch(snap.text, from, count) : null;
    if (!frames) {
      failure ??=
        snapError(snap) ??
        (snap.truncated
          ? 'The plan ran out of room before it finished. Plan again, or use fewer images.'
          : 'The plan came back in a form the app could not read. Plan again.');
      continue;
    }
    plan.push(...frames);
  }
  plan.sort((a, b) => a.position - b.position || a.image - b.image);
  const ids = job.planTaskIds.join();
  return (
    (await transition(
      owner,
      job.id,
      (j) => j.status === 'planning' && j.planTaskIds.join() === ids,
      () => (failure ? { status: 'failed', error: failure } : { status: 'planned', plan })
    )) ?? job
  );
}

/**
 * A take deleted from the library leaves its storyboard too, so the board
 * doesn't put it back; the frame falls back to its previous take.
 */
export async function forgetTake(owner: string, jobId: string, stillId: string): Promise<void> {
  await updateJobs(owner, (jobs) =>
    jobs.map((j) => {
      if (j.id !== jobId || !j.shots?.some((s) => s.stillId === stillId)) return j;
      const choices = Object.fromEntries(
        Object.entries(j.choices ?? {}).map(([k, c]) => [k, c.take === stillId ? { ...c, take: undefined } : c])
      );
      return { ...j, shots: j.shots.filter((s) => s.stillId !== stillId), choices };
    })
  );
}

/** Real people, said once more for every storyboard frame that has any. */
const PHOTOREAL_PEOPLE =
  'they are real people photographed on location, never CG, 3D or illustrated: true skin texture, natural proportions and true scale, relaxed unposed bodies';

/**
 * Each frame's newest take, put back in the library when it has fallen out
 * (the library once kept only the newest 300 items, so a busy project lost
 * older storyboard frames). Restored as pending, so the library's own poll
 * fetches the finished image from Runway again.
 */
async function restoreTakes(owner: string, job: StoryboardJob): Promise<void> {
  if (job.status !== 'planned' || !job.shots?.length) return;
  // The take each frame uses: the one picked for it, else its newest.
  const used = new Map<number, StoryboardShot>();
  for (const shot of job.shots) {
    const picked = job.choices?.[shot.image]?.take;
    if (picked ? shot.stillId === picked : !used.has(shot.image)) used.set(shot.image, shot);
  }
  const lib = await readLibrary(owner);
  const have = new Set(lib.stills.map((s) => s.id));
  const lost = [...used.values()].filter((shot) => !have.has(shot.stillId));
  if (lost.length === 0) return;
  const restored = lost.flatMap((shot): Still[] => {
    const plan = job.plan?.find((p) => p.image === shot.image);
    const img = job.images[shot.image];
    if (!plan || !img) return [];
    const choice = job.choices?.[shot.image] ?? {};
    const crowd = choice.crowd ?? plan.crowd;
    return [
      {
        id: shot.stillId,
        createdAt: shot.createdAt,
        status: 'pending',
        imageModel: job.imageModel,
        look: choice.look ?? plan.look,
        angle: choice.angle ?? 'as-rendered',
        crowd,
        people: crowd === 'none' || crowd !== plan.crowd ? '' : plan.people,
        direction: choice.note?.trim() ?? '',
        width: img.width,
        height: img.height,
        sourceUrl: img.url,
        resolution: job.resolution,
        storyboard: {
          jobId: job.id,
          order: (job.plan?.findIndex((p) => p.image === shot.image) ?? 0) + 1,
          title: plan.title,
        },
      },
    ];
  });
  if (restored.length === 0) return;
  await updateLibrary(owner, (l) => {
    const ids = new Set(l.stills.map((s) => s.id));
    const add = restored.filter((s) => !ids.has(s.id));
    if (add.length === 0) return l;
    // At the front, so the cap trims something else rather than these again.
    return { ...l, stills: [...add, ...l.stills] };
  });
}

const frameInput = z.object({
  id: z.string().min(1).max(200),
  image: z.number().int().min(0).max(MAX_STORYBOARD_IMAGES - 1),
});

const choiceInput = frameInput.extend({
  look: z.enum(LOOK_IDS).optional(),
  angle: z.enum(ANGLE_IDS).optional(),
  crowd: z.enum(CROWD_IDS).optional(),
  note: z.string().max(400, 'The direction is over 400 characters. Shorten it and try again.').optional(),
  selected: z.boolean().optional(),
  take: z.string().max(200).optional(),
});

export const storyboardRouter = router({
  /** Start planning: Claude looks at the images (in batches of six) against the storyline. */
  plan: signedInProcedure
    .input(
      z.object({
        images: z
          .array(
            z.object({
              url: filesUrl,
              width: z.number().int().min(16).max(16384),
              height: z.number().int().min(16).max(16384),
              name: z.string().max(200).default(''),
            })
          )
          .min(1, 'Add at least one image.')
          .max(MAX_STORYBOARD_IMAGES, `A storyboard takes up to ${MAX_STORYBOARD_IMAGES} images.`),
        storyline: z.enum(STORYLINE_IDS),
        story: z.string().max(1500, 'Your story is over 1,500 characters. Shorten it and try again.').default(''),
        imageModel: z.enum(IMAGE_MODEL_IDS),
        resolution: z.string().max(20).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const resolution =
        input.resolution && imageResolutions(input.imageModel).some((r) => r.id === input.resolution)
          ? input.resolution
          : defaultImageResolution(input.imageModel);
      const job: StoryboardJob = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        storyline: input.storyline,
        story: input.story.trim(),
        imageModel: input.imageModel,
        resolution,
        images: input.images,
        status: 'planning',
        planTaskIds: [],
      };
      try {
        for (let from = 0; from < job.images.length; from += BATCH) {
          job.planTaskIds.push(await submitPlanner(ctx, job, from));
        }
      } catch (err) {
        // A batch that did start is paid for; keep the job so its id isn't lost.
        if (job.planTaskIds.length === 0) throw toTrpcError(err);
        job.status = 'failed';
        job.error = toTrpcError(err).message;
      }
      await updateJobs(owner, (jobs) => [job, ...jobs.filter((j) => j.id !== job.id)]);
      return { id: job.id };
    }),

  /** One poll of a storyboard (the newest when no id is given); `null` when there is none. */
  job: signedInProcedure
    .input(z.object({ id: z.string().min(1).max(200).optional() }))
    .query(async ({ ctx, input }): Promise<StoryboardJob | null> => {
      const owner = await ownerKey(ctx.req);
      const jobs = await readJobs(owner);
      const job = input.id ? jobs.find((j) => j.id === input.id) : jobs[0];
      if (!job) return null;
      let out: StoryboardJob;
      try {
        out = await advance(ctx, owner, job);
      } catch (err) {
        throw toTrpcError(err);
      }
      await restoreTakes(owner, out).catch((err: unknown) => console.warn('[storyboard] restore', err));
      return out;
    }),

  /** Remember a clip made from one of the chosen frames, so a reload still shows it. */
  recordClip: signedInProcedure
    .input(frameInput.extend({ clipId: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const stored = await transition(
        owner,
        input.id,
        (j) => input.image < j.images.length,
        (j) => ({
          clips: [
            { image: input.image, clipId: input.clipId, createdAt: new Date().toISOString() },
            ...(j.clips ?? []).filter((c) => c.clipId !== input.clipId),
          ].slice(0, 200),
        })
      );
      if (!stored || input.image >= stored.images.length) throw notFound();
      return { saved: true };
    }),

  /** Save a frame's light, camera, people or note as the person changes them. */
  choose: signedInProcedure
    .input(choiceInput)
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const { id, image, ...choice } = input;
      const stored = await transition(
        owner,
        id,
        (j) => image < j.images.length,
        (j) => ({ choices: { ...j.choices, [image]: { ...j.choices?.[image], ...choice } } })
      );
      // `transition` hands back the unchanged job when the check fails.
      if (!stored || image >= stored.images.length) throw notFound();
      return { saved: true };
    }),

  /** The frames chosen for the film: exactly `images`, every other frame unchosen. */
  pick: signedInProcedure
    .input(frameInput.omit({ image: true }).extend({ images: z.array(z.number().int().min(0).max(MAX_STORYBOARD_IMAGES - 1)).max(MAX_STORYBOARD_IMAGES) }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const chosen = new Set(input.images);
      const stored = await transition(
        owner,
        input.id,
        () => true,
        (j) => ({
          choices: Object.fromEntries(
            j.images.map((_, i) => [i, { ...j.choices?.[i], selected: chosen.has(i) }])
          ),
        })
      );
      if (!stored) throw notFound();
      return { saved: true };
    }),

  /**
   * Shoot one frame from its image with the chosen light, camera and people.
   * The page sends its current choices too, so a change made a moment before
   * the click is never lost to a save still on its way.
   */
  shoot: signedInProcedure.input(choiceInput).mutation(async ({ ctx, input }) => {
    const owner = await ownerKey(ctx.req);
    const { id: jobId, image: frameImage, ...latest } = input;
    const job = await transition(
      owner,
      jobId,
      (j) => frameImage < j.images.length,
      (j) => ({ choices: { ...j.choices, [frameImage]: { ...j.choices?.[frameImage], ...latest } } })
    );
    if (!job || frameImage >= job.images.length) throw notFound();
    const plan = job.plan?.find((p) => p.image === input.image);
    const img = job.images[input.image];
    if (job.status !== 'planned' || !plan || !img) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This storyboard is not planned yet.' });
    }
    const choice = job.choices?.[input.image] ?? {};
    const look = choice.look ?? plan.look;
    // The image's own camera, as Stills shoots by default; older plans' camera
    // picks are no longer applied.
    const angle = choice.angle ?? 'as-rendered';
    const crowd = choice.crowd ?? plan.crowd;
    const note = choice.note?.trim() ?? '';
    // The planner's "who" only fits the crowd it chose it for.
    const who = crowd === 'none' ? '' : [crowd === plan.crowd ? plan.people : '', PHOTOREAL_PEOPLE].filter(Boolean).join('; ');
    const prompt = buildCinematicPrompt(look, note, crowd, who, angle, '', {
      strict: true,
      maxLength: imageModelPromptLimit(job.imageModel) ?? 4000,
    });
    let id: string;
    try {
      ({ id } = await submitStill(
        ctx,
        {
          imageModel: job.imageModel,
          imageUrl: img.url,
          width: img.width,
          height: img.height,
          frame: { width: img.width, height: img.height },
          resolution: job.resolution,
        },
        prompt
      ));
    } catch (err) {
      logRejection('storyboard', job.imageModel, err);
      throw toTrpcError(err);
    }
    const order = (job.plan?.findIndex((p) => p.image === input.image) ?? 0) + 1;
    const still: Still = {
      id,
      createdAt: new Date().toISOString(),
      status: 'pending',
      imageModel: job.imageModel,
      look,
      angle,
      crowd,
      people: crowd === 'none' || crowd !== plan.crowd ? '' : plan.people,
      direction: note,
      width: img.width,
      height: img.height,
      sourceUrl: img.url,
      resolution: job.resolution,
      storyboard: { jobId: job.id, order, title: plan.title },
    };
    try {
      await updateLibrary(owner, (lib) => ({ ...lib, stills: [still, ...lib.stills.filter((s) => s.id !== id)] }));
      await transition(
        owner,
        job.id,
        () => true,
        (j) => ({
          shots: [{ image: input.image, stillId: id, createdAt: still.createdAt }, ...(j.shots ?? [])].slice(0, 200),
          // A new take is the one the frame uses.
          choices: { ...j.choices, [input.image]: { ...j.choices?.[input.image], take: undefined } },
        })
      );
    } catch (err) {
      console.warn('[storyboard] could not save', id, err);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message:
          'This frame started on Runway, but your library could not save it, so this page cannot follow it. Look for it in your Runway account, and try again in a moment.',
        cause: err,
      });
    }
    return { id };
  }),
});
