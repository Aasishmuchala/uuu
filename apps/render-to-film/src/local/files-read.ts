/**
 * Reading a picture by its `/files/<key>` address from this app's own storage.
 * `imaging.ts` uses it so thumbnails, composites and views never fetch a
 * relative address over HTTP. Only `node:` imports and erasable TypeScript, so
 * the tests run on plain Node.
 */
import { getObject, isKey } from '../storage.ts';

/**
 * The key of a relative `/files/<key>` address (what `presignGet` and the
 * gateway give out), or null for anything else. A query or fragment is ignored.
 */
export function localKeyOf(url: string): string | null {
  if (typeof url !== 'string' || !url.startsWith('/files/')) return null;
  let key: string;
  try {
    key = decodeURIComponent(url.slice('/files/'.length).split(/[?#]/)[0]!);
  } catch {
    return null;
  }
  return isKey(key) ? key : null;
}

/** Whether an address is relative to this app (and so is never fetched). */
export function isLocalAddress(url: string): boolean {
  return typeof url === 'string' && url.startsWith('/');
}

/**
 * The bytes behind a `/files/` address. An address that is not a kept file, a
 * missing file and a file over `maxBytes` each throw a plain sentence.
 */
export async function readLocal(
  url: string,
  what: string,
  maxBytes: number,
  get: (key: string) => Promise<Uint8Array | null> = getObject
): Promise<Buffer> {
  const key = localKeyOf(url);
  const bytes = key ? await get(key) : null;
  if (!bytes) throw new Error(`Could not load the ${what}: it is no longer on this Mac.`);
  if (bytes.byteLength > maxBytes) throw new Error(`The ${what} is too large to process.`);
  return Buffer.from(bytes);
}
