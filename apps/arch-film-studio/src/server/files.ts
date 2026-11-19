/**
 * `GET /files/<key>`: a file this app keeps on this Mac (an upload, its
 * copies, a made picture, a clip, the film), by the key `mediaUrl` gives out.
 * Only keys `isKey` accepts, only a regular file inside the objects folder
 * (never a link), only the types its ending allows; a single byte range for
 * seeking in a clip. `?download` asks the browser to save it.
 */
import type Koa from 'koa';

import { openForServing as realOpen, type Storage } from '../storage.ts';

export function filesRoute(open: Storage['openForServing'] = realOpen): Koa.Middleware {
  return async (ctx, next) => {
    if (!ctx.path.startsWith('/files/')) return next();
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      ctx.status = 405;
      ctx.set('Allow', 'GET, HEAD');
      return;
    }
    let key: string;
    try {
      key = decodeURIComponent(ctx.path.slice('/files/'.length));
    } catch {
      key = '';
    }
    const file = key ? await open(key) : null;
    if (!file) {
      ctx.status = 404;
      ctx.body = { error: 'That file is not available.' };
      return;
    }
    let start = 0;
    let end = file.size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(ctx.get('range'));
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
      } else {
        start = Math.max(0, file.size - Number(range[2]));
      }
      if (!(start <= end) || start >= file.size) {
        await file.handle.close();
        ctx.status = 416;
        ctx.set('Content-Range', `bytes */${file.size}`);
        return;
      }
      ctx.status = 206;
      ctx.set('Content-Range', `bytes ${start}-${end}/${file.size}`);
    }
    ctx.set('Content-Type', file.type);
    ctx.set('Content-Length', String(file.size === 0 ? 0 : end - start + 1));
    ctx.set('Accept-Ranges', 'bytes');
    ctx.set('Cache-Control', 'private, max-age=3600');
    ctx.set('X-Content-Type-Options', 'nosniff');
    if (ctx.query['download'] !== undefined) {
      // The key's last part is only [a-z0-9_.-], so it needs no quoting.
      ctx.set('Content-Disposition', `attachment; filename="${key.slice(key.lastIndexOf('/') + 1)}"`);
    }
    if (ctx.method === 'HEAD') {
      await file.handle.close();
      ctx.status = ctx.status === 206 ? 206 : 200;
      return;
    }
    if (file.size === 0) {
      await file.handle.close();
      ctx.body = Buffer.alloc(0);
      return;
    }
    ctx.body = file.handle.createReadStream({ start, end, autoClose: true });
  };
}
