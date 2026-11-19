/**
 * `GET /files/<key>`: a file this app keeps on this Mac (an upload, its
 * copies, a made picture, a clip, the film), by the key `mediaUrl` gives out.
 * Only keys `isKey` accepts, only a regular file inside the objects folder
 * (never a link), only the types its ending allows; a single byte range for
 * seeking in a clip. `?download` asks the browser to save it, under the
 * readable name `?download=<name>` gives (`attachmentName`).
 */
import type Koa from 'koa';

import { openForServing as realOpen, type Storage } from '../storage.ts';

/**
 * The name a download is saved under: the asked name (the film's or the
 * project's, from the page) with only letters, digits, spaces, `.`, `_` and
 * `-` (so it needs no quoting in the header), at most 80 of them, ending in
 * the stored file's own ending. Nothing usable falls back to the key's last
 * part.
 */
export function attachmentName(asked: unknown, key: string): string {
  const fallback = key.slice(key.lastIndexOf('/') + 1);
  const dot = fallback.lastIndexOf('.');
  const ending = dot > 0 ? fallback.slice(dot) : '';
  const raw = Array.isArray(asked) ? asked[0] : asked;
  if (typeof raw !== 'string') return fallback;
  const stem = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[ ._-]+/, '')
    .slice(0, 80)
    .replace(/[ ._-]+$/, '');
  return stem ? `${stem}${ending}` : fallback;
}

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
      // attachmentName keeps only [A-Za-z0-9 ._-], so it needs no quoting.
      ctx.set('Content-Disposition', `attachment; filename="${attachmentName(ctx.query['download'], key)}"`);
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
