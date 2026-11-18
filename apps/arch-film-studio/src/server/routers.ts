/**
 * The procedures, one router per stage. Inputs are checked here; the work is
 * the pipeline's (`pipeline.ts`), the money the door's (`local/door.ts`).
 */
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  FILM_FORMATS,
  imageSettingsSchema,
  type Project,
  TRANSITIONS,
} from '../shared/project.ts';
import { ENGINE_UNREACHABLE, NOT_LISTED } from '../local/door.ts';
import { publicProcedure, router } from '../trpc.ts';
import { door, pipeline } from './live.ts';
import { APP_MODELS, ENHANCE_MODELS, MODEL_INFO } from './models.ts';
import { createProject, getProject, listProjects, PROJECT_ID_PATTERN, updateProject } from './store.ts';

const id = z.string().regex(PROJECT_ID_PATTERN, 'That is not an id this app made.');
const ids = z.array(id).min(1).max(20);
const text = (max: number) => z.string().max(max);

export const projectRouter = router({
  list: publicProcedure.query(() => listProjects()),
  create: publicProcedure
    .input(z.object({ name: z.string().trim().min(1, 'Give the project a name.').max(80) }))
    .mutation(({ input }) => {
      const at = new Date().toISOString();
      const project: Project = {
        id: randomUUID(),
        name: input.name,
        createdAt: at,
        updatedAt: at,
        nextImageNumber: 1,
        images: [],
      };
      return createProject(project);
    }),
  rename: publicProcedure
    .input(z.object({ id, name: z.string().trim().min(1, 'Give the project a name.').max(80) }))
    .mutation(({ input }) =>
      updateProject(input.id, (d) => {
        d.name = input.name;
      })
    ),
  get: publicProcedure.input(z.object({ id })).query(async ({ input }) => {
    try {
      await pipeline.advance(input.id);
    } catch (err) {
      // The project is still answered as it is; a missing one is answered below.
      console.error('[pipeline] advance failed:', err instanceof Error ? err.name : 'error');
    }
    return getProject(input.id);
  }),
  cancelWaiting: publicProcedure
    .input(z.object({ id }))
    .mutation(({ input }) => pipeline.cancelWaiting(input.id)),
});

export const imageRouter = router({
  setSettings: publicProcedure
    .input(z.object({ projectId: id, imageId: id, settings: imageSettingsSchema }))
    .mutation(({ input }) => pipeline.setSettings(input.projectId, input.imageId, input.settings)),
  remove: publicProcedure
    .input(z.object({ projectId: id, imageId: id }))
    .mutation(({ input }) => pipeline.removeImage(input.projectId, input.imageId)),
  analyse: publicProcedure
    .input(z.object({ projectId: id, imageIds: ids }))
    .mutation(({ input }) => pipeline.analyse(input.projectId, input.imageIds)),
  enhance: publicProcedure
    .input(
      z
        .object({
          projectId: id,
          imageIds: ids,
          model: z.enum(ENHANCE_MODELS).optional(),
          revisionNote: text(400).optional(),
        })
        .refine((v) => v.revisionNote === undefined || v.imageIds.length === 1, {
          message: 'A revision is asked for one image at a time.',
        })
    )
    .mutation(({ input }) => pipeline.enhance(input.projectId, input.imageIds, input.model, input.revisionNote)),
  decide: publicProcedure
    .input(
      z.object({
        projectId: id,
        imageId: id,
        runId: id,
        decision: z.enum(['approved', 'rejected', 'revision']),
        note: text(400).optional(),
      })
    )
    .mutation(({ input }) => pipeline.decide(input.projectId, input.imageId, input.runId, input.decision, input.note)),
  master: publicProcedure
    .input(z.object({ projectId: id, imageIds: ids }))
    .mutation(({ input }) => pipeline.master(input.projectId, input.imageIds)),
});

export const storyboardRouter = router({
  create: publicProcedure
    .input(z.object({ projectId: id, brief: text(2000), format: z.enum(FILM_FORMATS) }))
    .mutation(({ input }) => pipeline.createStoryboard(input.projectId, input.brief, input.format)),
  updateShot: publicProcedure
    .input(
      z.object({
        projectId: id,
        shotId: id,
        shotType: text(80).optional(),
        creativeDirection: text(1000).optional(),
        cameraMovement: text(1000).optional(),
        speed: text(80).optional(),
        lighting: text(1000).optional(),
        humanActivity: text(1000).optional(),
        purpose: text(1000).optional(),
        videoPrompt: text(2000).optional(),
        durationSeconds: z.number().int().min(2).max(10).optional(),
        transition: z.enum(TRANSITIONS).optional(),
      })
    )
    .mutation(({ input }) => {
      const { projectId, shotId, ...edit } = input;
      return pipeline.updateShot(projectId, shotId, edit);
    }),
  removeShot: publicProcedure
    .input(z.object({ projectId: id, shotId: id }))
    .mutation(({ input }) => pipeline.removeShot(input.projectId, input.shotId)),
  moveShot: publicProcedure
    .input(z.object({ projectId: id, shotId: id, to: z.number().int().min(0).max(100) }))
    .mutation(({ input }) => pipeline.moveShot(input.projectId, input.shotId, input.to)),
});

export const shotRouter = router({
  generate: publicProcedure
    .input(z.object({ projectId: id, shotIds: ids }))
    .mutation(({ input }) => pipeline.generateShots(input.projectId, input.shotIds)),
  decide: publicProcedure
    .input(z.object({ projectId: id, shotId: id, decision: z.enum(['approved', 'rejected']) }))
    .mutation(({ input }) => pipeline.decideShot(input.projectId, input.shotId, input.decision)),
});

export const filmRouter = router({
  assemble: publicProcedure
    .input(z.object({ projectId: id, transition: z.enum(TRANSITIONS) }))
    .mutation(({ input }) => pipeline.assembleFilm(input.projectId, input.transition)),
});

export const moneyRouter = router({
  models: publicProcedure.query(async () => {
    const { list, why } = await door.models();
    return APP_MODELS.map((model) => {
      const info = MODEL_INFO[model];
      const row = list?.find((m) => m.id === model);
      const ready = row?.ready === true;
      return {
        id: model,
        words: typeof row?.words === 'string' && row.words ? row.words : info.words,
        role: info.role,
        ready,
        why: ready ? null : !list ? why || ENGINE_UNREACHABLE : !row ? NOT_LISTED : row.why || NOT_LISTED,
      };
    });
  }),
  quote: publicProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              model: z.enum(APP_MODELS),
              kind: z.enum(['image_to_video', 'still_variation', 'still_upscale']),
              seconds: z.number().int().min(2).max(10).optional(),
              resolution: z.enum(['1K', '2K', '4K']).optional(),
              scale: z.union([z.literal(2), z.literal(4)]).optional(),
            })
          )
          .min(1)
          .max(20),
      })
    )
    .query(({ input }) => door.quote(input.items)),
  allowance: publicProcedure.query(() => door.allowance()),
});
