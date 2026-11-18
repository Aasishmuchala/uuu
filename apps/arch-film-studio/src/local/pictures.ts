/**
 * Pictures for the gateway: shrinking a picture to a JPEG that fits the
 * engine's limits, and reading a picture's size. This is the only file in
 * `src/local/` that touches `sharp`, and it loads it only when it is first
 * needed, so everything else (and every test, which injects a fake) runs
 * without the package.
 */

export type JpegLimits = { maxSide: number; maxBytes: number };
export type Pictures = {
  toJpeg(bytes: Buffer, limits: JpegLimits): Promise<Buffer>;
  size(bytes: Buffer): Promise<{ width: number; height: number }>;
};

/** What the gateway needs of one `sharp` pipeline; the real one has more. */
export interface SharpInstance {
  rotate(): SharpInstance;
  resize(options: Record<string, unknown>): SharpInstance;
  flatten(options: Record<string, unknown>): SharpInstance;
  jpeg(options: Record<string, unknown>): SharpInstance;
  toBuffer(): Promise<Buffer>;
  metadata(): Promise<{ width?: number | undefined; height?: number | undefined }>;
}
export type SharpLike = (input: Buffer, options?: Record<string, unknown>) => SharpInstance;

/** The quality steps, best first. */
export const JPEG_QUALITIES = [90, 80, 70, 60] as const;
const MAX_INPUT_PIXELS = 100_000_000;

export function createPictures(
  loadSharp: () => Promise<SharpLike> = async () => (await import('sharp')).default as unknown as SharpLike
): Pictures {
  return {
    async toJpeg(bytes, { maxSide, maxBytes }) {
      const sharp = await loadSharp();
      for (const quality of JPEG_QUALITIES) {
        const out = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate()
          .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality })
          .toBuffer();
        if (out.length <= maxBytes) return out;
      }
      throw new Error('This picture is too large to send, even after it is shrunk.');
    },
    async size(bytes) {
      const sharp = await loadSharp();
      const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      if (!meta.width || !meta.height) throw new Error('That is not a picture this app can read.');
      return { width: meta.width, height: meta.height };
    },
  };
}

export const pictures: Pictures = createPictures();
