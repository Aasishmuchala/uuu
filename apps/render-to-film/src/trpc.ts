import { randomUUID } from 'node:crypto';

import { initTRPC, TRPCError } from '@trpc/server';
import {
  type TRPC_ERROR_CODE_KEY,
  TRPC_ERROR_CODES_BY_KEY,
} from '@trpc/server/rpc';
import { z } from 'zod';

import { gateway } from './gateway.ts';
import type { CreateTrpcKoaContextOptions } from './vendor/trpc-koa-adapter.ts';

/**
 * The one owner of everything this app keeps. There is no sign-in: the app
 * runs on this Mac, reachable only through the home screen's frame.
 */
export const LOCAL_OWNER = 'local';

/**
 * An address of a picture this app keeps: `/files/<key>`, as `POST
 * /api/upload` and the gateway give them out. A full web address is refused;
 * the server never fetches one.
 */
export const filesUrl = z
  .string()
  .max(400)
  .regex(/^\/files\/[a-z0-9][a-z0-9/_.-]{0,199}$/, 'That picture is not on this Mac.')
  .refine((u) => !u.includes('..') && !u.includes('//'), 'That picture is not on this Mac.');

export function createContext({ req, res }: CreateTrpcKoaContextOptions) {
  return {
    req,
    res,
    // The gateway answers `ctx.runway.createTask`, `getTask`, `taskSnapshot`,
    // `uploadAsset` and `getProfile` on this Mac (src/gateway.ts).
    runway: gateway,
    owner: LOCAL_OWNER,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

/**
 * The tRPC code for each 4xx a user-facing error may carry (`expose: true`
 * and a `status`, by Koa's and `http-errors`' convention).
 */
const EXPOSED_CODE_BY_STATUS: Readonly<Record<number, TRPC_ERROR_CODE_KEY>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_CONTENT',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * The first user-facing error on a `cause` chain (at most 8 links, loop-safe):
 * a procedure often wraps the error it caught — `new TRPCError({ code:
 * 'INTERNAL_SERVER_ERROR', cause })` — before tRPC sees it. An error that
 * explicitly sets `expose: false` ends the search: the app classified it as
 * internal.
 */
function exposedCause(
  cause: unknown
): { code: TRPC_ERROR_CODE_KEY; status: number; message: string } | undefined {
  const seen = new Set<unknown>();
  let current = cause;
  for (let depth = 0; depth < 8; depth++) {
    if (!(current instanceof Error) || seen.has(current)) return undefined;
    seen.add(current);
    const { expose, status } = current as Error & {
      expose?: unknown;
      status?: unknown;
    };
    if (expose === false) return undefined;
    const code =
      expose === true && typeof status === 'number'
        ? EXPOSED_CODE_BY_STATUS[status]
        : undefined;
    if (code && typeof status === 'number') {
      return { code, status, message: current.message };
    }
    current = current.cause;
  }
  return undefined;
}

/** An error's stack (or name and message), or any other value as a string. */
function describeError(value: unknown): string {
  return value instanceof Error
    ? (value.stack ?? `${value.name}: ${value.message}`)
    : String(value);
}

/**
 * tRPC's error shape, with an INTERNAL_SERVER_ERROR whose `cause` chain
 * carries a user-facing 4xx answered with that status instead, any other 5xx
 * answered with a fixed sentence and a reference (also `data.correlationId`,
 * logged with the error's stack and cause) instead of its own message (a
 * database error or an upstream body a visitor must not read),
 * and `data.stack` removed, both unless `NODE_ENV` is `development`.
 * tRPC includes the stack whenever `NODE_ENV` isn't `production`, so this
 * fails closed rather than trusting it.
 */
function bayErrorShape<
  TShape extends {
    message: string;
    code: number;
    data: {
      code: string;
      httpStatus: number;
      stack?: string | undefined;
      correlationId?: string | undefined;
    };
  },
>({ shape, error }: { shape: TShape; error: TRPCError }): TShape {
  const exposed =
    error.code === 'INTERNAL_SERVER_ERROR'
      ? exposedCause(error.cause)
      : undefined;
  let next = shape;
  if (exposed) {
    next = {
      ...next,
      message: exposed.message,
      code: TRPC_ERROR_CODES_BY_KEY[exposed.code],
      data: { ...next.data, code: exposed.code, httpStatus: exposed.status },
    };
  }
  const localDev = process.env.NODE_ENV === 'development';
  if (next.data.httpStatus >= 500 && !localDev) {
    const ref = randomUUID();
    console.error(`[trpc] internal error ${ref}: ${next.message}`, {
      code: next.data.code,
      stack: error.stack ?? next.data.stack,
      ...(error.cause === undefined
        ? {}
        : { cause: describeError(error.cause) }),
    });
    next = {
      ...next,
      message: `Something went wrong on our side. If it keeps happening, share reference ${ref}.`,
      data: { ...next.data, correlationId: ref },
    };
  }
  if (next.data.stack !== undefined && !localDev) {
    const { stack: _stack, ...data } = next.data;
    next = { ...next, data };
  }
  return next;
}

const t = initTRPC.context<Context>().create({
  // `bayErrorShape` keeps a user-facing 4xx as it is (also when a procedure
  // wrapped it in its own INTERNAL_SERVER_ERROR), gives any other 5xx a fixed
  // sentence and a reference, and drops the stack trace. Never return
  // `opts.shape` directly.
  errorFormatter(opts) {
    return bayErrorShape(opts);
  },
});

export const router = t.router;

/** A procedure any caller can use. */
export const publicProcedure = t.procedure;

/**
 * Kept under its old name so the ~60 procedures built on it stay as they
 * were. There is no sign-in on this Mac, so it is the same as `publicProcedure`.
 */
export const signedInProcedure = t.procedure;
