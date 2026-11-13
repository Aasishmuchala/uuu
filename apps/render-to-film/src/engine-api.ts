import { z } from 'zod';

import { engine } from './local/engine.ts';
import { createPrices } from './local/prices.ts';
import { publicProcedure, router } from './trpc.ts';

/**
 * Money on the screens (K24.11): a thin router over `src/local/prices.ts`.
 *
 * - `engine.models`: every preset the pickers offer, as `{ preset, model,
 *   ready, why }`. `ready` false carries the door's own reason ("Needs a
 *   Runway key. Add it in Settings on the home screen."). Cached 30 seconds.
 * - `engine.prices`: `{ items: [ { preset, seconds?, resolution?, scale? } ] }`
 *   to `[ { preset, cents, words } ]`; `words` is "About $0.40", or "Price
 *   unknown" with `cents` null. From the door's table only; nothing is spent.
 * - `engine.allowance`: what the owner allowed this app today, in cents and in
 *   the bar's words; `needs` is the sentence for a disabled spending button.
 */
const prices = createPrices({ engine });

export const engineRouter = router({
  models: publicProcedure.query(() => prices.models()),

  prices: publicProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              preset: z.string().min(1).max(80),
              seconds: z.number().min(1).max(60).optional(),
              resolution: z.string().max(16).optional(),
              scale: z.number().int().min(2).max(4).optional(),
            })
          )
          .min(1)
          .max(60),
      })
    )
    .query(({ input }) => prices.prices(input.items)),

  allowance: publicProcedure.query(() => prices.allowance()),
});
