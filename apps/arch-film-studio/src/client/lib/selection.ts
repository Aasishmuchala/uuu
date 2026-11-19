/**
 * Picking several pictures at once on a contact sheet: click to add or take
 * away one, Shift-click for the run between the last click and this one in
 * the order on screen, Cmd+A for every picture in view. A spending batch takes
 * at most 20, in the order on screen. Pure, for plain Node (`selection.test.ts`).
 */
import { MAX_ASKS } from './spend.ts';

/** The selection with `id` added, or taken away when it was there. */
export function toggle(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

/**
 * The selection with every id from `anchor` to `id` in `order` added
 * (both ends counted). With no anchor in view, only `id` is added.
 */
export function rangeTo(selected: readonly string[], order: readonly string[], anchor: string | null, id: string): string[] {
  const to = order.indexOf(id);
  if (to < 0) return [...selected];
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const run = from < 0 ? [id] : order.slice(Math.min(from, to), Math.max(from, to) + 1);
  const out = [...selected];
  for (const r of run) if (!out.includes(r)) out.push(r);
  return out;
}

/** Every id in view. */
export function selectAll(order: readonly string[]): string[] {
  return [...new Set(order)];
}

/** The selection in the order on screen, ids no longer in view left out. */
export function inOrder(selected: readonly string[], order: readonly string[]): string[] {
  const set = new Set(selected);
  return order.filter((id) => set.has(id));
}

/** What one spending press sends: the first `max` ids, in the order given. */
export function capForSpend(ids: readonly string[], max: number = MAX_ASKS): string[] {
  return [...new Set(ids)].slice(0, Math.max(0, max));
}

/** The sentence the batch bar shows when more are picked than one press sends. */
export function overCapWords(count: number, max: number = MAX_ASKS): string | null {
  return count > max ? `Up to ${max} at a time. The first ${max} are sent.` : null;
}
