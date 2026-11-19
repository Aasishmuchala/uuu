/**
 * Every direction the owner has written, read from the `library` query (no new procedure,
 * PLAN-APPS-ASTRYX T4). The same direction sent again with the same settings folds into one
 * entry with a count, so the list reads as ideas, not as takes.
 */
import type { Library } from '../../api.ts';
import { stillThumbUrl } from './urls.ts';

export type HistoryEntry = {
  kind: 'still' | 'clip';
  /** The newest take made with this direction and these settings. */
  id: string;
  createdAt: string;
  direction: string;
  /** A still's look id (unset for clips and for stills lit from a reference). */
  look?: string | undefined;
  /** The image or video model's id. */
  model: string;
  /** A clip's camera move id. */
  motion?: string | undefined;
  /** The picture it made (a clip: the still it started on). */
  thumb: string;
  /** How many takes used it. */
  count: number;
};

function foldKey(e: Pick<HistoryEntry, 'kind' | 'direction' | 'look' | 'model' | 'motion'>): string {
  return JSON.stringify([e.kind, e.direction.trim().toLowerCase(), e.look ?? '', e.model, e.motion ?? '']);
}

/** Entries newest first; empty directions left out; equal direction and settings folded with a count. */
export function promptHistory(library: Library | undefined): HistoryEntry[] {
  if (!library) return [];
  const raw: HistoryEntry[] = [];
  for (const s of library.stills) {
    if (s.status === 'failed' || !s.direction.trim()) continue;
    const reference = Boolean(s.lightRefUrl || s.lightFromStillId);
    raw.push({
      kind: 'still',
      id: s.id,
      createdAt: s.createdAt,
      direction: s.direction.trim(),
      look: reference ? undefined : s.look,
      model: s.imageModel,
      thumb: stillThumbUrl(s.id),
      count: 1,
    });
  }
  for (const c of library.clips) {
    if (c.status === 'failed' || !c.direction.trim()) continue;
    raw.push({
      kind: 'clip',
      id: c.id,
      createdAt: c.createdAt,
      direction: c.direction.trim(),
      model: c.videoModel,
      motion: c.motion,
      thumb: stillThumbUrl(c.stillId),
      count: 1,
    });
  }
  raw.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const out: HistoryEntry[] = [];
  const seen = new Map<string, HistoryEntry>();
  for (const e of raw) {
    const key = foldKey(e);
    const first = seen.get(key);
    if (first) first.count += 1;
    else {
      seen.set(key, e);
      out.push(e);
    }
  }
  return out;
}

/** The local calendar day of a time, as "2026-11-19". */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1);
  const day = String(d.getDate());
  return `${d.getFullYear()}-${m.length < 2 ? `0${m}` : m}-${day.length < 2 ? `0${day}` : day}`;
}

/** Entries by local day, newest day first, each day named "Today", "Yesterday" or its date. */
export function groupByDay(
  entries: readonly HistoryEntry[],
  now: Date = new Date()
): Array<{ day: string; label: string; entries: HistoryEntry[] }> {
  const today = dayKey(now.toISOString());
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString());
  const groups: Array<{ day: string; label: string; entries: HistoryEntry[] }> = [];
  for (const e of entries) {
    const day = dayKey(e.createdAt);
    let g = groups.find((x) => x.day === day);
    if (!g) {
      const label =
        day === today
          ? 'Today'
          : day === yesterday
            ? 'Yesterday'
            : new Date(e.createdAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
      groups.push((g = { day, label, entries: [] }));
    }
    g.entries.push(e);
  }
  return groups.sort((a, b) => b.day.localeCompare(a.day));
}

/** The entries whose direction (or the names given) hold every word of the search. */
export function search(
  entries: readonly HistoryEntry[],
  text: string,
  names: (e: HistoryEntry) => string = () => ''
): HistoryEntry[] {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => {
    const hay = `${e.direction} ${names(e)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
