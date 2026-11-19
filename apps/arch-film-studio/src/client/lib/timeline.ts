/**
 * The storyboard as time: where each shot starts and how wide its block is,
 * the running time, which place a dragged shot lands in, and where a moment of
 * the joined preview falls among the clips. Pure, for plain Node
 * (`timeline.test.ts`).
 */

export type Span = {
  /** Seconds from the start of the film. */
  start: number;
  seconds: number;
  /** The block's share of the whole width, 0 to 1. */
  share: number;
};

const secondsOf = (s: { durationSeconds: number }) =>
  Number.isFinite(s.durationSeconds) && s.durationSeconds > 0 ? s.durationSeconds : 0;

/** The running time of the shots, in seconds. */
export function totalSeconds(shots: ReadonlyArray<{ durationSeconds: number }>): number {
  return shots.reduce((sum, s) => sum + secondsOf(s), 0);
}

/** Each shot's start, length and share of the width, in order. */
export function shotSpans(shots: ReadonlyArray<{ durationSeconds: number }>): Span[] {
  const total = totalSeconds(shots);
  let start = 0;
  return shots.map((s) => {
    const seconds = secondsOf(s);
    const span = { start, seconds, share: total > 0 ? seconds / total : shots.length > 0 ? 1 / shots.length : 0 };
    start += seconds;
    return span;
  });
}

/**
 * The `to` that `storyboard.moveShot` takes to move the shot at `from` onto
 * the place of the shot at `overIndex`: the place it ends up in. Null when it
 * would not move.
 */
export function moveIndex(from: number, overIndex: number, count: number = Number.POSITIVE_INFINITY): number | null {
  if (!Number.isInteger(from) || !Number.isInteger(overIndex) || from < 0 || from >= count) return null;
  const to = Math.max(0, Math.min(count - 1, overIndex));
  return to === from ? null : to;
}

/**
 * The place a block dragged to `x` lands in, given the middle of every block
 * in order (the dragged one's own included): the number of other blocks whose
 * middle lies before `x`.
 */
export function overIndexAt(x: number, mids: readonly number[], from: number): number {
  let before = 0;
  mids.forEach((m, i) => {
    if (i !== from && m < x) before += 1;
  });
  return before;
}

/** "0:42", "1:05", "12:00". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const rest = s % 60;
  return `${Math.floor(s / 60)}:${rest < 10 ? '0' : ''}${rest}`;
}

/** Where `t` seconds into the joined clips falls: which clip, and how far into it. */
export function clipAt(durations: readonly number[], t: number): { index: number; local: number } {
  if (durations.length === 0) return { index: 0, local: 0 };
  let start = 0;
  const at = Math.max(0, t);
  for (let i = 0; i < durations.length; i++) {
    const d = Math.max(0, durations[i] ?? 0);
    if (at < start + d || i === durations.length - 1) return { index: i, local: Math.min(Math.max(0, at - start), d) };
    start += d;
  }
  return { index: durations.length - 1, local: 0 };
}

/** Where each clip starts in the joined clips, in seconds. */
export function clipStarts(durations: readonly number[]): number[] {
  let start = 0;
  return durations.map((d) => {
    const at = start;
    start += Math.max(0, d);
    return at;
  });
}
