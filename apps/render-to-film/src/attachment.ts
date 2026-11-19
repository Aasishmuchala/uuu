/**
 * The name a download is saved under. `?download=<name>` on a `/files/`
 * address (src/api-routes.ts) asks for an attachment: the page links to the
 * file itself rather than to a `blob:` copy, which the Mac app's web view
 * would try to load in the frame instead of saving.
 *
 * The asked name keeps only letters, digits, spaces, `.`, `_` and `-` (so it
 * needs no quoting in the header), at most 80 of them, and always ends in the
 * stored file's own ending. Nothing usable falls back to the key's last part.
 *
 * Only erasable TypeScript, so the tests run on plain Node.
 */
export function attachmentName(asked: unknown, key: string): string {
  const fallback = key.slice(key.lastIndexOf('/') + 1);
  const dot = fallback.lastIndexOf('.');
  const ending = dot > 0 ? fallback.slice(dot) : '';
  const raw = Array.isArray(asked) ? asked[0] : asked;
  if (typeof raw !== 'string') return fallback;
  const stem = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[ ._-]+/, '')
    .slice(0, 80)
    .replace(/[ ._-]+$/, '');
  return stem ? `${stem}${ending}` : fallback;
}

/** The `Content-Disposition` for a `/files/` answer, or none when the page did not ask to save it. */
export function attachmentHeader(query: Record<string, unknown>, key: string): string | undefined {
  if (query['download'] === undefined) return undefined;
  return `attachment; filename="${attachmentName(query['download'], key)}"`;
}

/** `url` with `download=<filename>` added, for a link that saves the file instead of showing it. */
export function withDownload(url: string, filename: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(filename)}`;
}
