/**
 * The Library's items and its filter bar, kept free of React so plain Node tests them.
 * Search keeps the old Library's behaviour: words match the title, details, direction and
 * tags; a word starting with `@` matches a tag (own or automatic) by its start.
 */
import type { Clip, Library, Still } from '../../api.ts';
import { litFromReference } from '../../looks.ts';
import { imageModelName, videoModelName } from '../../models.ts';
import { clipAutoTags, normalizeTag, stillAutoTags } from '../../tags.ts';
import { FAVOURITE_TAG, isFavourite, visibleTags } from './favourites.ts';
import { clipTitle, formatDate, stillTitle } from './titles.ts';

export type ItemKind = 'still' | 'clip';

type Common = {
  id: string;
  createdAt: string;
  pending: boolean;
  /** The image or video model's id, for the model filter. */
  model: string;
  /** The look id of the still (a clip: of its still), or null when it has none to filter by. */
  look: string | null;
  /** The owner's own tags, stored (the star's tag included). */
  tags: string[];
  /** The tags every item gets from how it was made (src/tags.ts). */
  auto: string[];
  title: string;
  /** "Nano Banana Pro, 14 Nov 2026". */
  detail: string;
  /** Everything the search box reads, in lower case. */
  text: string;
  /** Width over height of the picture, for a true-ratio frame. */
  ratio: number;
};

export type LibraryItem =
  | (Common & { kind: 'still'; still: Still; clip?: undefined })
  | (Common & { kind: 'clip'; clip: Clip; still: Still | undefined });

export type LibraryFilter = {
  kind: 'all' | ItemKind;
  /** A model id, or '' for every model. */
  model: string;
  /** A look id, or '' for every look. */
  look: string;
  /** Every one of these tags (own or automatic) must be on the item. */
  tags: readonly string[];
  favouritesOnly: boolean;
  text: string;
};

export const NO_FILTER: LibraryFilter = { kind: 'all', model: '', look: '', tags: [], favouritesOnly: false, text: '' };

/** A still's own look, or null when its look says nothing (a place, or lit from a reference). */
function lookOf(s: Still | undefined): string | null {
  if (!s || s.location || s.surroundings || litFromReference(s)) return null;
  return s.look;
}

function ratioOf(s: Still | undefined): number {
  return s && s.width > 0 && s.height > 0 ? s.width / s.height : 16 / 9;
}

/** Every still and clip that did not fail, newest first. */
export function libraryItems(library: Library | undefined): LibraryItem[] {
  if (!library) return [];
  const byId = new Map(library.stills.map((s) => [s.id, s]));
  const stills: LibraryItem[] = library.stills
    .filter((s) => s.status !== 'failed')
    .map((s) => {
      const tags = s.tags ?? [];
      const auto = stillAutoTags(s);
      const title = stillTitle(s);
      const detail = `${imageModelName(s.imageModel)}, ${formatDate(s.createdAt)}`;
      return {
        kind: 'still',
        id: s.id,
        createdAt: s.createdAt,
        pending: s.status === 'pending',
        model: s.imageModel,
        look: lookOf(s),
        still: s,
        tags,
        auto,
        title,
        detail,
        text: [title, detail, s.direction, s.people, ...auto, ...visibleTags(tags)].join(' ').toLowerCase(),
        ratio: ratioOf(s),
      };
    });
  const clips: LibraryItem[] = library.clips
    .filter((c) => c.status !== 'failed')
    .map((c) => {
      const still = byId.get(c.stillId);
      const tags = c.tags ?? [];
      const auto = clipAutoTags(c, still);
      const title = clipTitle(c, still);
      const detail = `${videoModelName(c.videoModel)}, ${formatDate(c.createdAt)}`;
      return {
        kind: 'clip',
        id: c.id,
        createdAt: c.createdAt,
        pending: c.status === 'pending',
        model: c.videoModel,
        look: lookOf(still),
        clip: c,
        still,
        tags,
        auto,
        title,
        detail,
        text: [title, detail, c.direction, ...auto, ...visibleTags(tags)].join(' ').toLowerCase(),
        ratio: ratioOf(still),
      };
    });
  return [...stills, ...clips].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The items the filter bar lets through, in their order. */
export function filterItems(items: readonly LibraryItem[], f: LibraryFilter): LibraryItem[] {
  const words = f.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tagWords = words
    .filter((w) => w.startsWith('@'))
    .map((w) => normalizeTag(w))
    .filter((t): t is string => !!t);
  const textWords = words.filter((w) => !w.startsWith('@'));
  return items.filter((it) => {
    if (f.kind !== 'all' && it.kind !== f.kind) return false;
    if (f.model && it.model !== f.model) return false;
    if (f.look && it.look !== f.look) return false;
    if (f.favouritesOnly && !isFavourite(it)) return false;
    const all = [...visibleTags(it.tags), ...it.auto];
    if (!f.tags.every((t) => all.includes(t))) return false;
    if (!tagWords.every((t) => all.some((x) => x.startsWith(t)))) return false;
    return textWords.every((w) => it.text.includes(w));
  });
}

/** Whether anything narrows the list, so the screen can offer "Clear filters". */
export function isFiltering(f: LibraryFilter): boolean {
  return f.kind !== 'all' || !!f.model || !!f.look || f.tags.length > 0 || f.favouritesOnly || f.text.trim() !== '';
}

/** Every tag in use with its count: the owner's own first, then the automatic ones, each by use. */
export function tagCounts(items: readonly LibraryItem[]): Array<{ tag: string; count: number; own: boolean }> {
  const counts = new Map<string, number>();
  const own = new Set<string>();
  for (const it of items) {
    const mine = visibleTags(it.tags);
    for (const t of mine) own.add(t);
    for (const t of new Set([...mine, ...it.auto])) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  counts.delete(FAVOURITE_TAG);
  return [...counts]
    .map(([tag, count]) => ({ tag, count, own: own.has(tag) }))
    .sort((a, b) => Number(b.own) - Number(a.own) || b.count - a.count || a.tag.localeCompare(b.tag));
}

/** The models and looks the items use, for the filter bar's choices (first seen first). */
export function facets(items: readonly LibraryItem[]): { models: string[]; looks: string[] } {
  const models: string[] = [];
  const looks: string[] = [];
  for (const it of items) {
    if (!models.includes(it.model)) models.push(it.model);
    if (it.look && !looks.includes(it.look)) looks.push(it.look);
  }
  return { models, looks };
}
