/**
 * Side-by-side compare: two to four stills (one zoom and pan for all), or exactly two clips
 * (one play, pause and scrub for both). Mixed picks and other counts say what to change.
 */
export const MAX_COMPARE = 4;

export type CompareCheck = { ok: true; kind: 'still' | 'clip' } | { ok: false; why: string };

export function canCompare(selection: ReadonlyArray<{ kind: 'still' | 'clip' }>): CompareCheck {
  const stills = selection.filter((s) => s.kind === 'still').length;
  const clips = selection.length - stills;
  if (selection.length === 0) return { ok: false, why: 'Tick two to four stills, or two videos, to compare them.' };
  if (stills > 0 && clips > 0) return { ok: false, why: 'Compare stills with stills, or videos with videos.' };
  if (clips > 0) {
    if (clips === 2) return { ok: true, kind: 'clip' };
    return { ok: false, why: clips < 2 ? 'Tick one more video to compare.' : 'Two videos can be compared at a time.' };
  }
  if (stills < 2) return { ok: false, why: 'Tick one more still to compare.' };
  if (stills > MAX_COMPARE) return { ok: false, why: `Up to ${MAX_COMPARE} stills can be compared at a time.` };
  return { ok: true, kind: 'still' };
}
