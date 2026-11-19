/** The stable app URL of a library still or clip, or an Edit tab copy or export (src/api-routes.ts). */
export function libraryUrl(kind: 'still' | 'clip' | 'edit', id: string): string {
  return `/api/library/${kind}/${encodeURIComponent(id)}`;
}

/** A small copy of a library still, for grids and pickers (src/thumbs.ts). */
export function stillThumbUrl(id: string): string {
  return `${libraryUrl('still', id)}?thumb`;
}

/**
 * A full-resolution copy of a library still kept in the app's storage, for
 * the big screen, compare and zoom views (src/thumbs.ts). Downloads use
 * `libraryUrl`, the original file.
 */
export function stillViewUrl(id: string): string {
  return `${libraryUrl('still', id)}?view`;
}
