/**
 * Director's left panel after a reload: the planned board's own images, so the
 * panel shows what the board was made from and "Plan again" can use them,
 * instead of "Add project images first" beside a board that exists (round-1
 * critics). Each image keeps the address the board was planned with; nothing
 * is uploaded again.
 */
export type BoardImage = { url: string; width: number; height: number; name: string };
export type BoardUpload = { key: string; src: string; name: string; width: number; height: number; hostedUrl: string };

/** Only the app's own stored files are taken back into the form. */
const OWN_FILE = /^\/files\/[A-Za-z0-9._~%/-]+$/;

export function boardUploads(images: readonly BoardImage[] | undefined): BoardUpload[] {
  return (images ?? [])
    .filter((img) => OWN_FILE.test(img.url) && img.width > 0 && img.height > 0)
    .map((img, i) => ({ key: `board-${i}-${img.url}`, src: img.url, name: img.name, width: img.width, height: img.height, hostedUrl: img.url }));
}
