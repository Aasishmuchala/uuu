import { TRPCError } from '@trpc/server';

import { compositeError, compositeUrl, ensureComposite } from './composite.ts';
import { RunwayApiError, RunwayTaskError, type TaskSnapshot } from './gateway.ts';
import { readLibrary, type TaskState } from './library.ts';
import type { Context } from './trpc.ts';

/** Shared by every tRPC router: task polling and the mapping of a refused job. */

type Runway = NonNullable<Context['runway']>;
export type RunwayCtx = { runway: Runway };

/**
 * The finished image of a task. Pass `owner` for a still: a marked edit's
 * image is its composite (src/composite.ts), never the raw result.
 */
export async function finishedUrl(ctx: RunwayCtx, taskId: string, owner?: string): Promise<string> {
  const snap = await ctx.runway.taskSnapshot(taskId);
  if (owner && snap.url) {
    const still = (await readLibrary(owner)).stills.find((s) => s.id === taskId);
    if (!still) {
      // Fail closed: without its record the still might be a marked edit.
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'That still is no longer in your library. Pick another one.',
      });
    }
    if (still.maskKey) {
      try {
        return await compositeUrl(await ensureComposite(owner, still, snap.url));
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: compositeError(err), cause: err });
      }
    }
  }
  if (snap.url) return snap.url;
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: snap.done
      ? 'That still did not finish, so there is nothing to use. Pick another one.'
      : 'That still is still rendering. Try again once it has finished.',
  });
}

export function settled(snap: TaskSnapshot): { status: TaskState; error?: string } {
  if (!snap.done) return { status: 'pending' };
  if (snap.status === 'SUCCEEDED') return { status: 'succeeded' };
  return { status: 'failed', error: snapError(snap) ?? 'The generation failed.' };
}

export function snapError(snap: TaskSnapshot): string | undefined {
  return snap.error
    ? [snap.error, snap.hint].filter(Boolean).join(' ')
    : undefined;
}

/**
 * Map a failure onto the tRPC codes the client branches on.
 *
 * - `RunwayTaskError` (the gateway's refusal, carrying the door's own plain
 *   sentence: a limit, the allowance, a missing key, a dropped model) →
 *   BAD_REQUEST with that sentence, unchanged.
 * - `RunwayApiError` (the engine answered badly) → INTERNAL_SERVER_ERROR with
 *   a plain sentence and the error as `cause`.
 * - Anything else is passed on as `cause`, never replaced.
 *
 * There are no credit, sign-in or consent branches: this app has none.
 */
export function toTrpcError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;
  if (err instanceof RunwayTaskError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  }
  if (err instanceof RunwayApiError) {
    return new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The engine could not do that just now. Try again in a moment.',
      cause: err,
    });
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: err instanceof Error && err.message ? err.message : 'Something went wrong on this Mac.',
    cause: err,
  });
}

export function logRejection(where: string, model: string, err: unknown) {
  if (err instanceof RunwayTaskError) {
    console.warn(`[${where}] ${model} refused`, err.status, err.message);
  } else if (err instanceof RunwayApiError) {
    console.warn(`[${where}] ${model} api`, err.status, err.message);
  } else {
    console.warn(`[${where}] ${model}`, err);
  }
}
