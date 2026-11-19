/**
 * Sending renders to `POST /api/upload`: the raw picture as the body, sent
 * with `fetch` (never a form), three at a time. Pure apart from the injected
 * `fetch`, so plain Node tests it (`upload.test.ts`).
 */
import type { ProjectImage } from '../../shared/project.ts';

export const UPLOAD_AT_ONCE = 3;
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const NAME_MAX = 120;
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const NOT_A_PICTURE = 'That file is not a JPG, PNG or WebP picture.';
export const TOO_BIG = 'That picture is larger than 25 MB.';
export const UNREACHABLE = 'Could not reach the app. Check it is still on, then try again.';

export type UploadFile = { name: string; type: string; size: number };
export type UploadResult = { ok: true; image: ProjectImage } | { ok: false; message: string };

/** The refusal the server would give without sending the bytes, or null. */
export function refuseEarly(file: UploadFile): string | null {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) return NOT_A_PICTURE;
  if (file.size > UPLOAD_MAX_BYTES) return TOO_BIG;
  return null;
}

/** The `x-file-name` header: at most 120 characters, percent-encoded. */
export function fileNameHeader(name: string): string {
  return encodeURIComponent([...name].slice(0, NAME_MAX).join(''));
}

/** Send one picture. Never throws: a refusal or a broken connection is a sentence. */
export async function uploadOne(
  projectId: string,
  file: UploadFile & Blob,
  fetchFn: typeof fetch = fetch
): Promise<UploadResult> {
  const early = refuseEarly(file);
  if (early) return { ok: false, message: early };
  let res: Response;
  try {
    res = await fetchFn(`/api/upload?project=${encodeURIComponent(projectId)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type, 'x-file-name': fileNameHeader(file.name) },
      body: file,
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.ok && json && typeof json.image === 'object' && json.image) return { ok: true, image: json.image as ProjectImage };
  const message = typeof json?.error?.message === 'string' && json.error.message ? json.error.message : null;
  if (message) return { ok: false, message };
  if (res.status === 413) return { ok: false, message: TOO_BIG };
  return { ok: false, message: `The picture was not taken (status ${res.status}). Try again.` };
}

/** Run `work` on each item, at most `limit` at once, in order of start. */
export async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      await work(items[i]!, i);
    }
  });
  await Promise.all(lanes);
}
