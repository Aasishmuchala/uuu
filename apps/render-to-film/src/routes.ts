import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type Koa from 'koa';
import serve from 'koa-static';

import { AppRouter } from './api.ts';
import { isAnswered, isApiPath } from './api-routes.ts';
import { createContext } from './trpc.ts';
import { createKoaMiddleware } from './vendor/trpc-koa-adapter.ts';

export function mountTrpc(app: Koa) {
  app.use(
    createKoaMiddleware({
      router: AppRouter,
      createContext,
      prefix: '/trpc',
      // Queries arrive as GET; this also accepts the POST the client falls
      // back to for a query input too large for the URL. Mutations are POST
      // either way: tRPC refuses a mutation sent as GET.
      allowMethodOverride: true,
    })
  );
}

export function mountStatic(app: Koa) {
  if (process.env['NODE_ENV'] !== 'production') return;

  const distDir = path.resolve(import.meta.dirname, '..', 'dist');
  if (!existsSync(path.join(distDir, 'index.html'))) {
    console.warn(
      '[app] dist/index.html not found — skipping static file serving. Run your build step first.'
    );
    return;
  }

  // A bookmarked `/index.html` must get the same finished shell as `/`:
  // koa-static would serve the raw file (stale title, no favicon), so the
  // path is folded into the fallback below before static can answer it.
  app.use(async (ctx, next) => {
    if (ctx.path === '/index.html' && ['GET', 'HEAD'].includes(ctx.method)) {
      ctx.path = '/';
    }
    await next();
  });

  // Vite content-hashes everything under assets/, so those get a long
  // immutable cache; index.html and everything else must stay no-cache or a
  // deploy never reaches a client that already has the shell cached.
  app.use(
    serve(distDir, {
      index: false,
      maxage: 1000 * 60 * 60 * 24 * 365,
      immutable: true,
      setHeaders: (res, filePath) => {
        if (!path.relative(distDir, filePath).startsWith(`assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  // The JSON gate in `api-routes.ts` runs outside this middleware and owns
  // `/api` end to end, including the shell an older app's own `routes.ts`
  // serves there (`mountStaticFallback`, which wraps this mount, is what
  // tells the gate the answer came from here), so that invariant survives in
  // an app whose `routes.ts` predates it.
  app.use(async (ctx) => {
    // An earlier handler already owns the response — don't answer over it.
    // `isAnswered` is the one definition of that (a status set with no body
    // counts: a 204 delete, a 202 accepted), shared with the /api gate so the
    // two can't drift apart.
    if (isAnswered(ctx)) return;
    // Leave `/api` to the gate: the empty 404 below counts as an answer, so
    // writing it here would silence the gate and hand an API client an empty
    // `text/plain` body instead of its JSON error.
    if (isApiPath(ctx.path)) return;
    if (
      ['GET', 'HEAD'].includes(ctx.method) &&
      ctx.accepts('html') &&
      !ctx.url.includes('.')
    ) {
      ctx.status = 200;
      ctx.type = 'text/html';
      ctx.set('Cache-Control', 'no-cache');
      ctx.body = await fs.readFile(path.join(distDir, 'index.html'), 'utf-8');
      return;
    }
    // Empty body (not null, which Koa turns into a 204) so the gateway
    // renders its branded 404 page instead of Koa's own `Not Found` text.
    ctx.status = 404;
    ctx.body = '';
  });
}
