import { existsSync, unlinkSync } from 'node:fs';

import Koa from 'koa';

import { mountApi, mountStaticFallback } from './api-routes.ts';
import { mountStatic, mountTrpc } from './routes.ts';

const app = new Koa();

// The host's liveness probe, answered before anything else. There is no
// sign-in, no gateway header and no consent: this app runs on this Mac and
// is reached only through the home screen's frame.
app.use(async (ctx, next) => {
  if (ctx.path === '/healthz') {
    ctx.status = 200;
    ctx.body = 'ok';
    return;
  }
  await next();
});

mountTrpc(app);
mountApi(app);

// Mounts the static middleware, and tells the /api gate which responses came
// out of it — so the SPA shell answering an API path is rewritten as JSON
// while a real handler's answer (HTML included) is left alone.
mountStaticFallback(app, mountStatic);

// The app listens on one unix socket the App Studio host made for it, never
// on a port. A socket left by an earlier run is removed first.
const socketPath = process.env['APP_SOCKET'];
if (!socketPath) {
  console.error('APP_SOCKET is not set, so this app has nowhere to listen.');
  process.exit(1);
}
if (existsSync(socketPath)) unlinkSync(socketPath);
const server = app.listen(socketPath, () => {
  console.log('Listening on the app socket');
});

server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

// Stop accepting connections, let in-flight requests finish, and exit; the
// timer caps a long-lived stream.
process.once('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
