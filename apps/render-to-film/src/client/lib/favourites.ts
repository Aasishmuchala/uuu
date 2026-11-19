/**
 * Favourites are a stored tag, `favourite`, saved through the existing `setTags` (no new
 * procedure, PLAN-APPS-ASTRYX T4). The tag editor never shows it: the star does.
 */
import { MAX_TAGS } from '../../tags.ts';

export const FAVOURITE_TAG = 'favourite';

/** The sentence the star shows when an item has no room for one more tag. */
export const FAVOURITE_FULL = `This has ${MAX_TAGS} tags. Remove one to add it to favourites.`;

export function isFavourite(item: { tags?: readonly string[] | undefined }): boolean {
  return (item.tags ?? []).includes(FAVOURITE_TAG);
}

/**
 * The item's tags with the star set or cleared, in the order they were. `{ full: true }`
 * when adding would pass `MAX_TAGS`: nothing is sent then, and the star says why.
 */
export function withFavourite(tags: readonly string[], on: boolean): string[] | { full: true } {
  const has = tags.includes(FAVOURITE_TAG);
  if (!on) return has ? tags.filter((t) => t !== FAVOURITE_TAG) : [...tags];
  if (has) return [...tags];
  if (tags.length >= MAX_TAGS) return { full: true };
  return [...tags, FAVOURITE_TAG];
}

/** The tags the tag editor shows: all but the star's. */
export function visibleTags(tags: readonly string[] | undefined): string[] {
  return (tags ?? []).filter((t) => t !== FAVOURITE_TAG);
}
