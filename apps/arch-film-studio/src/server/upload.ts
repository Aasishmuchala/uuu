/**
 * `POST /api/upload?project=<id>`: one render, as raw bytes. The original is
 * kept exactly as sent, beside a working copy (longest side at most 2560,
 * JPEG 90, what the models see) and a thumbnail (at most 640, JPEG 80). The
 * picture gets the project's next code, IMG-001, IMG-002, and so on.
 *
 * The handler takes its collaborators, so the tests run it without sharp and
 * without a server. The file's name is kept in the project and never logged.
 */
import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';

import {
  defaultSettings,
  type ImageExtension,
  imageKeys,
  type Project,
  type ProjectImage,
} from '../shared/project.ts';
import type { Storage } from '../storage.ts';
import { PROJECT_ID_PATTERN } from './store.ts';
import { storedProjects, type ProjectsAccess } from './pipeline.ts';

export const NOT_A_PICTURE = 'That file is not a JPG, PNG or WebP picture.';
export const TOO_BIG = 'That picture is larger than 25 MB.';
export const TOO_LARGE_TO_OPEN = 'That picture is too large to open.';
export const PROJECT_FULL = 'A project holds at most 200 pictures.';

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGES = 200;
export const NAME_MAX = 120;
const MAX_INPUT_PIXELS = 100_000_000;

const TYPES: Record<string, ImageExtension> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** PNG, JPEG or WebP by the first bytes; null for anything else. */
export function sniffImage(b: Buffer): ImageExtension | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** The picture's upright size and its two copies. Throws `TooLargeToOpen` past 100 megapixels. */
export type Copies = (bytes: Buffer) => Promise<{ width: number; height: number; work: Buffer; thumb: Buffer }>;

export class TooLargeToOpen extends Error {}

/** The copies made with sharp, loaded only when first needed. */
export function sharpCopies(loadSharp: () => Promise<any> = async () => (await import('sharp')).default): Copies {
  return async (bytes) => {
    const sharp = await loadSharp();
    const open = () => sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    try {
      const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      if (!meta.width || !meta.height) throw new Error('no size');
      const turned = typeof meta.orientation === 'number' && meta.orientation >= 5;
      const width = turned ? meta.height : meta.width;
      const height = turned ? meta.width : meta.height;
      const copy = (side: number, quality: number) =>
        open()
          .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality })
          .toBuffer();
      return { width, height, work: await copy(2560, 90), thumb: await copy(640, 80) };
    } catch (err) {
      if (err instanceof Error && /pixel limit/i.test(err.message)) throw new TooLargeToOpen();
      throw err;
    }
  };
}

/** The name the page sent (percent-encoded), as kept: decoded, one line, at most 120 characters. */
export function fileName(raw: string | undefined): string {
  let name = raw ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // Kept as it came.
  }
  name = name.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...name].slice(0, NAME_MAX).join('') || 'Untitled';
}

export type UploadDeps = {
  store: Pick<Storage, 'putObject' | 'deleteObject'>;
  copies: Copies;
  projects?: Pick<ProjectsAccess, 'get' | 'update'>;
  now?: () => number;
  newId?: () => string;
};

export type UploadAnswer = { status: number; body: { image: ProjectImage } | { error: { message: string } } };

const no = (status: number, message: string): UploadAnswer => ({ status, body: { error: { message } } });

export async function acceptUpload(
  deps: UploadDeps,
  input: { projectId: string; type: string; name: string | undefined; body: AsyncIterable<Buffer | string> }
): Promise<UploadAnswer> {
  const projects = deps.projects ?? storedProjects;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const projectId = input.projectId;
  if (!PROJECT_ID_PATTERN.test(projectId)) return no(404, 'That project no longer exists. Pick another from the list.');

  const declared = TYPES[input.type.split(';')[0]!.trim().toLowerCase()];
  if (!declared) return no(400, NOT_A_PICTURE);

  let project: Project;
  try {
    project = await projects.get(projectId);
  } catch (err) {
    if (err instanceof TRPCError) return no(404, err.message);
    throw err;
  }
  if (project.images.length >= MAX_IMAGES) return no(400, PROJECT_FULL);

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of input.body) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > UPLOAD_MAX_BYTES) return no(400, TOO_BIG);
    chunks.push(buf);
  }
  const bytes = Buffer.concat(chunks);
  if (sniffImage(bytes) !== declared) return no(400, NOT_A_PICTURE);

  let made: Awaited<ReturnType<Copies>>;
  try {
    made = await deps.copies(bytes);
  } catch (err) {
    return no(400, err instanceof TooLargeToOpen ? TOO_LARGE_TO_OPEN : NOT_A_PICTURE);
  }

  const imageId = newId();
  const keys = imageKeys(projectId, imageId, declared);
  const remove = async () => {
    for (const key of Object.values(keys)) await deps.store.deleteObject(key).catch(() => {});
  };
  let image: ProjectImage | undefined;
  try {
    await deps.store.putObject(keys.originalKey, bytes, { contentType: input.type });
    await deps.store.putObject(keys.workKey, made.work, { contentType: 'image/jpeg' });
    await deps.store.putObject(keys.thumbKey, made.thumb, { contentType: 'image/jpeg' });
    await projects.update(projectId, (d) => {
      if (d.images.length >= MAX_IMAGES) return;
      const n = d.nextImageNumber ?? d.images.length + 1;
      image = {
        id: imageId,
        code: `IMG-${String(n).padStart(3, '0')}`,
        name: fileName(input.name),
        width: made.width,
        height: made.height,
        ...keys,
        uploadedAt: new Date(now()).toISOString(),
        settings: defaultSettings(),
        enhancements: [],
      };
      d.images.push(image);
      d.nextImageNumber = n + 1;
    });
  } catch (err) {
    await remove();
    if (err instanceof TRPCError) return no(404, err.message);
    throw err;
  }
  if (!image) {
    await remove();
    return no(400, PROJECT_FULL);
  }
  return { status: 200, body: { image } };
}
