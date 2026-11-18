import { publicProcedure, router } from './trpc.ts';
import {
  filmRouter,
  imageRouter,
  moneyRouter,
  projectRouter,
  shotRouter,
  storyboardRouter,
} from './server/routers.ts';

/**
 * The app's procedures: projects, the images' stages (analysis, enhance,
 * review, masters), the storyboard and its shots, the film, and the money
 * words. Uploads and stored files are raw routes (`api-routes.ts`).
 */
export const AppRouter = router({
  ping: publicProcedure.query(() => 'ok'),
  project: projectRouter,
  image: imageRouter,
  storyboard: storyboardRouter,
  shot: shotRouter,
  film: filmRouter,
  money: moneyRouter,
});

export type AppRouterType = typeof AppRouter;
