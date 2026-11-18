import Router from '@koa/router';
import type Koa from 'koa';

import { filesRoute } from './server/files.ts';
import { uploadDeps } from './server/live.ts';
import { acceptUpload } from './server/upload.ts';

/**
 * The one boundary literal for raw routes. `mountApi`'s router prefix, the
 * `isApiPath` predicate below and the JSON gate all read it, so renaming the
 * prefix (or pointing it at `/v1`) moves the guard with it instead of leaving
 * a predicate that silently stops matching.
 */
export const API_PREFIX = '/api';

// Raw (non-tRPC) Koa routes live here, under `/api` — that prefix is already
// proxied by the dev server (see `vite.config.ts`), so a route added here
// works under `bay dev` and Studio preview with no extra config. `index.ts`
// must mount this before the static fallback (`mountStaticFallback` below),
// whose production catch-all answers anything that reaches it. They sit in
// their own module rather than in `routes.ts` because `bay add webapp-runway-api` keeps an app's existing
// `routes.ts` as-is, and the rewritten `index.ts` has to import `mountApi`
// from a file the template always owns.
//
// There is no body-parsing middleware: the tRPC adapter reads `ctx.req`
// itself, so a global parser would leave it nothing to read. Use
// `readJsonBody(ctx)` from `./api-body.ts` instead.

export function isApiPath(path: string): boolean {
  // Normalize the way the router does before comparing. `@koa/router` matches
  // case-insensitively and treats a trailing slash as optional, so a literal
  // comparison would miss `/API/echo` and `/api/echo/` — requests the router
  // still answers, and whose unmatched siblings would otherwise slip past the
  // gate and come back as the SPA shell with a 200.
  const normalized = path.toLowerCase().replace(/\/+$/, '');
  const prefix = API_PREFIX.toLowerCase();
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

/**
 * Whether some handler already owns the response. An explicit status is an
 * answer even with no body (a 204 delete, a 202 accepted); only an untouched
 * Koa 404 is an unanswered request.
 *
 * Exported so `mountStatic`'s catch-all in `routes.ts` shares this one
 * definition of the middleware contract instead of inlining its own copy.
 */
export function isAnswered(ctx: Koa.Context): boolean {
  return ctx.body != null || ctx.status !== 404;
}

/** Requests the static middleware answered — see `mountStaticFallback`. */
const staticAnswers = new WeakSet<Koa.Context>();

/**
 * Mounts the static middleware with a provenance marker wrapped around it:
 * whatever it answers (a file out of `dist/`, or the SPA shell from its
 * catch-all) is recorded, which is what lets the gate below tell the SPA
 * fallback apart from a real handler's answer without reaching into
 * `routes.ts` — a file `bay add webapp-runway-api` preserves as the app wrote
 * it.
 *
 * It takes the mount as an argument rather than being a separate `app.use`
 * line on purpose: a bare marker records everything mounted below it, so a
 * router slipped between the marker and `mountStatic` would have its own HTML
 * answers (an OAuth consent page, a rendered preview) mistaken for the shell
 * and rewritten into a JSON 404. Here the two are inseparable, and "mount
 * your router before the static fallback" is again one line to be above.
 */
export function mountStaticFallback(app: Koa, mount: (app: Koa) => void) {
  // `mount` registers its middleware with `app.use`, so collect those calls
  // instead of letting them reach the real app: they have to go on after the
  // marker, and nothing else may.
  const staticMiddleware: Koa.Middleware[] = [];
  const collector = {
    use(middleware: Koa.Middleware) {
      staticMiddleware.push(middleware);
      return collector;
    },
  };
  mount(collector as unknown as Koa);

  app.use(async (ctx, next) => {
    const answeredBefore = isAnswered(ctx);
    await next();
    if (!answeredBefore && isAnswered(ctx)) staticAnswers.add(ctx);
  });
  for (const middleware of staticMiddleware) app.use(middleware);
}

export function mountApi(app: Koa) {
  const api = new Router({ prefix: API_PREFIX });

  // `GET /files/<key>`: a file this app keeps (src/server/files.ts).
  app.use(filesRoute());

  // One render, as raw bytes, into a project (src/server/upload.ts). Refusals
  // are 400 with `{ error: { message } }`, answered here so the gate keeps them.
  api.post('/upload', async (ctx) => {
    const answer = await acceptUpload(uploadDeps, {
      projectId: typeof ctx.query['project'] === 'string' ? ctx.query['project'] : '',
      type: ctx.get('content-type'),
      name: ctx.get('x-file-name') || undefined,
      body: ctx.req,
    });
    ctx.status = answer.status;
    ctx.body = answer.body;
  });

  // The gate wraps `await next()` rather than terminating, so middleware you
  // mount after `mountApi(app)` (an upload mount, an SSE handler, `bay add
  // agent`'s router) still sees `/api` requests — and its answer is final.
  app.use(apiJsonGate(api));
  app.use(api.routes());
}

/**
 * Keeps `/api` JSON-only: an unmatched or wrong-method API request comes back
 * as a JSON 404/405 instead of the SPA shell with a 200 (which makes a
 * caller's `res.json()` choke on `<!doctype html>` and an uptime check report
 * a healthy route that does not exist).
 *
 * It lives here, not in `mountStatic`, because `bay add webapp-runway-api`
 * preserves an app's existing `src/routes.ts` — a guard there would be absent
 * from every app scaffolded before it was written, while this file is always
 * the template's own.
 *
 * It decides 405-vs-404 from `api`'s own route table only, and only once
 * nothing else has answered, so a downstream handler's own status is never
 * second-guessed (unlike the router's own `allowedMethods` middleware, which
 * rewrites a deliberate 404 into a 405 and an unusual-method probe into a
 * `501 Not Implemented`).
 *
 * A thrown error is the chain's other exit, and Koa's default handler answers
 * it as `text/plain` — so the gate catches it too: `readJsonBody`'s own
 * 415/413/400 and an unexpected 500 alike come back as JSON, or a caller that
 * always calls `res.json()` still chokes on exactly the class of response
 * this gate exists to eliminate.
 */
function apiJsonGate(api: Router): Koa.Middleware {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      if (!isApiPath(ctx.path) || ctx.headerSent || !ctx.writable) throw err;
      answerErrorAsJson(ctx, err);
      return;
    }
    if (!isApiPath(ctx.path)) return;
    // Same exit as the catch branch: once the response has started, every
    // answer below is unwritable — `clearResponseHeaders` calls
    // `res.removeHeader()` on flushed headers and throws
    // ERR_HTTP_HEADERS_SENT. A handler that streamed raw bytes with
    // `ctx.res.write()` without setting `ctx.status` looks unanswered here.
    if (ctx.headerSent || !ctx.writable) return;

    // Exactly two responses get rewritten: a request nothing answered, and the
    // SPA shell answering an API path. The shell is recognised by provenance
    // (`mountStaticFallback` records what the static middleware produced), not
    // by "HTML from a path this router doesn't own" — otherwise a later /api
    // mount that deliberately answers HTML (an OAuth consent page, a rendered
    // preview) would be clobbered into a JSON 404.
    const spaFallback = staticAnswers.has(ctx) && ctx.response.is('html');
    if (isAnswered(ctx) && !spaFallback) return;

    const matched = api.match(ctx.path, ctx.method);
    const allowed = [
      ...new Set(matched.path.flatMap((layer) => layer.methods)),
    ];
    if (allowed.length > 0 && matched.pathAndMethod.length === 0) {
      // Strip first, then re-set `Allow`: the header belongs to the answer the
      // gate is writing, not to the handler it is replacing.
      clearResponseHeaders(ctx);
      ctx.set('Allow', allowed.join(', '));
      if (ctx.method === 'OPTIONS') {
        ctx.status = 200;
        ctx.body = '';
        return;
      }
      ctx.status = 405;
      ctx.body = { error: 'Method Not Allowed' };
      return;
    }

    clearResponseHeaders(ctx);
    ctx.status = 404;
    ctx.body = { error: 'Not Found' };
  };
}

/**
 * Discards every response header already set, the way Koa's `ctx.onerror`
 * does before it writes an error. Every answer the gate synthesizes over a
 * partially-run request goes through this first: a middleware under `/api`
 * that set `Cache-Control: public, max-age=3600` or a `Content-Disposition`
 * attachment filename and then delegated would otherwise have a CDN cache the
 * gate's JSON 404, or a browser save the JSON error as `report.csv`.
 */
function clearResponseHeaders(ctx: Koa.Context): void {
  for (const name of ctx.res.getHeaderNames()) ctx.res.removeHeader(name);
}

/**
 * Mirrors Koa's own error handling, in JSON: keep the error's status, use its
 * message only when it is meant to be public (`http-errors` sets `expose` on
 * the 4xx that `ctx.throw` mints), and fall back to the status' standard
 * reason phrase otherwise. Server errors still reach the app's `error`
 * listeners so they keep being logged.
 *
 * Like Koa's `ctx.onerror`, it discards every response header the failed
 * handler already set before writing the error — otherwise a route that set
 * `Cache-Control: public, max-age=3600` or a `Content-Disposition` attachment
 * filename and then threw would hand a CDN a cacheable 500, or a browser a
 * JSON error saved as `report.csv`. The error's own `headers` (a 405's
 * `Allow`, a 401's `WWW-Authenticate`) are then reapplied, again as Koa does.
 */
function answerErrorAsJson(ctx: Koa.Context, err: unknown): void {
  const e = err as {
    status?: unknown;
    expose?: unknown;
    message?: unknown;
    headers?: unknown;
  };
  const status =
    typeof e.status === 'number' &&
    Number.isInteger(e.status) &&
    e.status >= 400 &&
    e.status <= 599
      ? e.status
      : 500;
  if (status >= 500) ctx.app.emit('error', err, ctx);
  clearResponseHeaders(ctx);
  if (e.headers !== null && typeof e.headers === 'object') {
    ctx.set(e.headers as Record<string, string>);
  }
  ctx.status = status;
  ctx.body = {
    // `ctx.message` is the standard reason phrase for the status just set.
    error:
      e.expose === true && typeof e.message === 'string' && e.message !== ''
        ? e.message
        : ctx.message,
  };
}
