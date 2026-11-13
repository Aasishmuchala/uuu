/**
 * Storage on this Mac's own disk, under `$APP_DATA`.
 *
 * Objects (pictures, clips, masks, copies) are files under `objects/<key>`;
 * documents (the library, the edit, the task list) are JSON files under
 * `docs/<prefix>/<name>.json`. Nothing here talks to a network.
 *
 * Keys are `^[a-z0-9][a-z0-9/_.-]{0,199}$`, with no `..` and no `//`, and are
 * resolved inside the root. Files are 0600 and folders 0700. A write goes to
 * a temp file in the same folder, is synced, then renamed over the real name,
 * so a crash leaves the old file or the new one, never half of one.
 *
 * `presignGet(key)` is `/files/<key>`: the server's `GET /files/*` route
 * (src/api-routes.ts) serves it through `openForServing` below.
 *
 * Only erasable TypeScript and `node:` imports, so the tests run on plain Node.
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsc } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,199}$/;
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,99}$/;
const PREFIX_RE = /^[a-z0-9][a-z0-9/_.-]{0,99}$/;

/** What a served file is called, by its ending. Anything else is not served. */
export const FILE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  json: 'application/json',
};

export function isKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    KEY_RE.test(key) &&
    !key.includes('..') &&
    !key.includes('//') &&
    !key.endsWith('/')
  );
}

export function typeOfKey(key: string): string | undefined {
  const dot = key.lastIndexOf('.');
  if (dot < 0) return undefined;
  const ext = key.slice(dot + 1);
  return Object.hasOwn(FILE_TYPES, ext) ? FILE_TYPES[ext] : undefined;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export type PutOptions = { contentType?: string | undefined; test?: boolean | undefined };
export type DocumentStore<T> = {
  get(name: string): Promise<{ value: T; etag: string } | null>;
  update(name: string, mutate: (current: T | undefined) => T | Promise<T>): Promise<T>;
};
export type Served = { handle: FileHandle; size: number; type: string };

/** Test seams: called inside a write, so a test can crash it. */
export type StorageHooks = { beforeRename?: (path: string) => void | Promise<void> };

function badKey(key: unknown): never {
  throw new StorageError(`Not a valid storage key: ${String(key).slice(0, 60)}`);
}

export function createStorage(options: { root: string | (() => string); hooks?: StorageHooks }) {
  const rootOf = typeof options.root === 'function' ? options.root : () => options.root as string;
  const hooks = options.hooks ?? {};
  const locks = new Map<string, Promise<unknown>>();

  const base = () => {
    const root = rootOf();
    if (!root || !root.startsWith('/')) throw new StorageError('The data folder is not set.');
    return resolve(root);
  };

  function inside(root: string, path: string): string {
    const full = resolve(path);
    if (full !== root && !full.startsWith(root + sep)) badKey(path);
    return full;
  }

  const objectFile = (key: string) => {
    if (!isKey(key)) badKey(key);
    const root = join(base(), 'objects');
    return inside(root, join(root, key));
  };

  function docFile(prefix: string, name: string): string {
    const p = prefix.replace(/^\/+|\/+$/g, '');
    const n = name.endsWith('.json') ? name.slice(0, -5) : name;
    if (!PREFIX_RE.test(p) || p.includes('..') || p.includes('//') || !NAME_RE.test(n) || n.includes('..')) {
      badKey(`${prefix}${name}`);
    }
    const root = join(base(), 'docs');
    return inside(root, join(root, p, `${n}.json`));
  }

  async function ensureDir(dir: string) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }

  /** Write `data` to `file` through a synced temp file and a rename. */
  async function writeAtomic(file: string, data: Buffer | string) {
    await ensureDir(dirname(file));
    // `~` is not a key character, so a temp file can never be a served key.
    const tmp = `${file}~${randomUUID()}.tmp`;
    const fh = await open(tmp, 'wx', 0o600);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } catch (err) {
      await fh.close().catch(() => {});
      await unlink(tmp).catch(() => {});
      throw err;
    }
    await fh.close();
    try {
      await hooks.beforeRename?.(file);
      await rename(tmp, file);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
    try {
      const dh = await open(dirname(file), 'r');
      await dh.sync().catch(() => {});
      await dh.close();
    } catch {
      // A folder that cannot be synced is no reason to fail a write that landed.
    }
  }

  /** Read a regular file without following a link; null when it is not one. */
  async function readRegular(file: string): Promise<Buffer | null> {
    let fh: FileHandle | undefined;
    try {
      fh = await open(file, fsc.O_RDONLY | fsc.O_NOFOLLOW);
      const st = await fh.stat();
      if (!st.isFile()) return null;
      return await fh.readFile();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR' || code === 'EISDIR') return null;
      throw err;
    } finally {
      await fh?.close().catch(() => {});
    }
  }

  async function putObject(key: string, body: Buffer | Uint8Array | string, _opts?: PutOptions): Promise<void> {
    const file = objectFile(key);
    await writeAtomic(file, typeof body === 'string' ? body : Buffer.from(body));
  }

  async function getObject(key: string): Promise<Buffer | null> {
    return readRegular(objectFile(key));
  }

  async function deleteObject(key: string): Promise<void> {
    try {
      await unlink(objectFile(key));
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
    }
  }

  async function headObject(key: string): Promise<{ size: number } | null> {
    try {
      const st = await lstat(objectFile(key));
      return st.isFile() ? { size: st.size } : null;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      throw err;
    }
  }

  async function presignGet(key: string, _opts?: { expiresIn?: number; contentType?: string }): Promise<string> {
    if (!isKey(key)) badKey(key);
    return `/files/${key}`;
  }

  /** The absolute path an object would have, its folder made; for a streamed download. */
  async function objectPath(key: string): Promise<string> {
    const file = objectFile(key);
    await ensureDir(dirname(file));
    return file;
  }

  /**
   * Open a stored file for the `/files/` route: a regular file (no link, none
   * of its folders a link out of the root) with a type its ending allows.
   */
  async function openForServing(key: string): Promise<Served | null> {
    if (!isKey(key)) return null;
    const type = typeOfKey(key);
    if (!type) return null;
    const file = objectFile(key);
    let fh: FileHandle | undefined;
    try {
      const st = await lstat(file);
      if (!st.isFile()) return null;
      const realRoot = await realpath(join(base(), 'objects'));
      const realDir = await realpath(dirname(file));
      if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) return null;
      fh = await open(file, fsc.O_RDONLY | fsc.O_NOFOLLOW);
      const fst = await fh.stat();
      if (!fst.isFile()) {
        await fh.close();
        return null;
      }
      return { handle: fh, size: fst.size, type };
    } catch (err) {
      await fh?.close().catch(() => {});
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR' || code === 'EACCES') return null;
      throw err;
    }
  }

  function documentStore<T>(opts: { prefix: string }): DocumentStore<T> {
    return {
      async get(name) {
        const buf = await readRegular(docFile(opts.prefix, name));
        if (!buf) return null;
        const text = buf.toString('utf8');
        return { value: JSON.parse(text) as T, etag: createHash('sha1').update(buf).digest('hex') };
      },
      async update(name, mutate) {
        const file = docFile(opts.prefix, name);
        const prior = locks.get(file) ?? Promise.resolve();
        const run = prior
          .catch(() => {})
          .then(async () => {
            const buf = await readRegular(file);
            const current = buf ? (JSON.parse(buf.toString('utf8')) as T) : undefined;
            const next = await mutate(current);
            await writeAtomic(file, JSON.stringify(next));
            return next;
          });
        locks.set(file, run);
        try {
          return await run;
        } finally {
          if (locks.get(file) === run) locks.delete(file);
        }
      },
    };
  }

  return { putObject, getObject, deleteObject, headObject, presignGet, documentStore, objectPath, openForServing };
}

export type Storage = ReturnType<typeof createStorage>;

/** The real storage: rooted at `$APP_DATA`, read each time so a test can change it. */
export const store: Storage = createStorage({ root: () => process.env['APP_DATA'] ?? '' });

export const putObject: Storage['putObject'] = (...a) => store.putObject(...a);
export const getObject: Storage['getObject'] = (...a) => store.getObject(...a);
export const deleteObject: Storage['deleteObject'] = (...a) => store.deleteObject(...a);
export const headObject: Storage['headObject'] = (...a) => store.headObject(...a);
export const presignGet: Storage['presignGet'] = (...a) => store.presignGet(...a);
export const openForServing: Storage['openForServing'] = (...a) => store.openForServing(...a);
export function documentStore<T>(opts: { prefix: string }): DocumentStore<T> {
  return store.documentStore<T>(opts);
}
