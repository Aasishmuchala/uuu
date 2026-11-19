/**
 * The engine client: how this app asks the engine for anything. One unix
 * socket (`$ENGINE_SOCKET`, made by the App Studio host for this app alone),
 * JSON in and out, 60 seconds, answers of at most 2 MB, no retries. An output
 * (a picture or a clip) is streamed to a file instead of read into memory.
 *
 * Only `node:` imports and erasable TypeScript, so the tests run on plain Node.
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { request, type RequestOptions } from 'node:http';
import type { Duplex } from 'node:stream';

export const ENGINE_TIMEOUT_MS = 60_000;
export const ENGINE_ANSWER_MAX = 2 * 1024 * 1024;

/** The engine could not be reached, answered badly, or answered too much. */
export class EngineError extends Error {
  /** True when a result was refused for its size: asking again will not help. */
  tooLarge: boolean;
  constructor(message: string, opts?: { tooLarge?: boolean }) {
    super(message);
    this.name = 'EngineError';
    this.tooLarge = opts?.tooLarge === true;
  }
}

/** A JSON answer: the status and the parsed body (null when empty). */
export type EngineReply = { status: number; json: any };
export type EngineStreamed = { status: number; type: string; bytes: number; json: any };
/**
 * `connect`, for tests only, hands the request a ready stream instead of the
 * socket: the app fence's test mode lets no test open a unix socket.
 */
export type EngineOptions = { socketPath?: string; timeoutMs?: number; connect?: () => Duplex };
export type JsonOptions = EngineOptions & { contentType?: string };

function socketOf(opts: EngineOptions | undefined): string {
  const path = opts?.socketPath ?? process.env['ENGINE_SOCKET'];
  if (!path) throw new EngineError('The engine socket is not set.');
  return path;
}

function connection(opts: EngineOptions | undefined) {
  const connect = opts?.connect;
  return connect ? { createConnection: connect as unknown as NonNullable<RequestOptions['createConnection']> } : {};
}

function unreachable(err: unknown): EngineError {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ENOENT' || code === 'ECONNREFUSED') return new EngineError('The engine could not be reached.');
  return new EngineError('The engine did not answer.');
}

/**
 * One JSON call. `body` is sent as JSON, or as it is when it is a Buffer
 * (then `contentType` says what it is: the door takes pictures raw).
 */
export function engineJson(
  method: string,
  path: string,
  body?: unknown,
  opts?: JsonOptions
): Promise<EngineReply> {
  return new Promise<EngineReply>((resolve, reject) => {
    let socketPath: string;
    try {
      socketPath = socketOf(opts);
    } catch (err) {
      reject(err);
      return;
    }
    const raw = Buffer.isBuffer(body);
    const payload = body === undefined ? undefined : raw ? (body as Buffer) : Buffer.from(JSON.stringify(body));
    const headers: Record<string, string | number> = { accept: 'application/json' };
    if (payload) {
      headers['content-type'] = raw ? (opts?.contentType ?? 'application/octet-stream') : 'application/json';
      headers['content-length'] = payload.length;
    }
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(err);
    };
    const req = request({ socketPath, ...connection(opts), method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > ENGINE_ANSWER_MAX) {
          fail(new EngineError('The engine answered with too much.'));
          return;
        }
        chunks.push(c);
      });
      res.on('error', () => fail(new EngineError('The engine did not answer.')));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        const text = Buffer.concat(chunks).toString('utf8');
        if (text.trim() === '') {
          resolve({ status: res.statusCode ?? 0, json: null });
          return;
        }
        try {
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) });
        } catch {
          reject(new EngineError('The engine answered with something that is not JSON.'));
        }
      });
    });
    req.setTimeout(opts?.timeoutMs ?? ENGINE_TIMEOUT_MS, () => fail(new EngineError('The engine took too long to answer.')));
    req.on('error', (err) => fail(unreachable(err)));
    req.end(payload);
  });
}

/**
 * Stream an answer to `toFile` (at most `maxBytes`). The file appears only
 * when all of it has arrived. A non-200 answer writes nothing and comes back
 * with its JSON in `json`.
 */
export function engineStream(
  path: string,
  toFile: string,
  maxBytes: number,
  opts?: EngineOptions
): Promise<EngineStreamed> {
  return new Promise<EngineStreamed>((resolve, reject) => {
    let socketPath: string;
    try {
      socketPath = socketOf(opts);
    } catch (err) {
      reject(err);
      return;
    }
    const tmp = `${toFile}~${randomUUID()}.part`;
    let settled = false;
    let out: ReturnType<typeof createWriteStream> | undefined;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      req.destroy();
      // The partial file goes before the caller hears of the failure.
      const cleanup = () => void unlink(tmp).catch(() => {}).then(() => reject(err));
      if (!out || out.closed) cleanup();
      else {
        out.once('close', cleanup);
        out.destroy();
      }
    };
    const req = request({ socketPath, ...connection(opts), method: 'GET', path, headers: { accept: '*/*' } }, (res) => {
      const status = res.statusCode ?? 0;
      const type = String(res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (status !== 200) {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total <= ENGINE_ANSWER_MAX) chunks.push(c);
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          let json: any = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            json = null;
          }
          resolve({ status, type, bytes: 0, json });
        });
        res.on('error', () => fail(new EngineError('The engine did not answer.')));
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        fail(new EngineError('The result is larger than this app keeps.', { tooLarge: true }));
        return;
      }
      out = createWriteStream(tmp, { flags: 'wx', mode: 0o600 });
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > maxBytes) {
          fail(new EngineError('The result is larger than this app keeps.', { tooLarge: true }));
          return;
        }
        if (!out!.write(c)) {
          res.pause();
          out!.once('drain', () => res.resume());
        }
      });
      res.on('error', () => fail(new EngineError('The engine did not answer.')));
      res.on('aborted', () => fail(new EngineError('The engine stopped part way.')));
      res.on('end', () => {
        if (settled) return;
        out!.end(() => {
          if (settled) return;
          if (Number.isFinite(declared) && declared !== total) {
            fail(new EngineError('The engine stopped part way.'));
            return;
          }
          rename(tmp, toFile).then(
            () => {
              if (settled) return;
              settled = true;
              resolve({ status, type, bytes: total, json: null });
            },
            () => fail(new EngineError('The result could not be kept on this Mac.'))
          );
        });
      });
      out.on('error', () => fail(new EngineError('The result could not be kept on this Mac.')));
    });
    req.setTimeout(opts?.timeoutMs ?? 5 * 60_000, () => fail(new EngineError('The engine took too long to answer.')));
    req.on('error', (err) => fail(unreachable(err)));
    req.end();
  });
}

export type Engine = {
  json: (method: string, path: string, body?: unknown, opts?: JsonOptions) => Promise<EngineReply>;
  stream: (path: string, toFile: string, maxBytes: number, opts?: EngineOptions) => Promise<EngineStreamed>;
};

/** The real client, over `$ENGINE_SOCKET` (read at each call). */
export const engine: Engine = { json: engineJson, stream: engineStream };
