import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';

import { StatusDot } from '../kit.ts';
import { clock, moveIndex, overIndexAt, shotSpans, totalSeconds } from '../lib/timeline.ts';
import styles from './ShotTimeline.module.css';

export type TimelineShot = {
  id: string;
  number: number;
  durationSeconds: number;
  shotType: string;
  thumb?: string | undefined;
  thumbRatio: number;
  alt: string;
  state: { words: string; dot: 'success' | 'warning' | 'error' | 'accent' | 'neutral'; working: boolean };
};

/** How far a press must travel before it is a drag, in pixels. */
const DRAG_FROM = 4;

/**
 * The storyboard as a strip of blocks, each as wide as its seconds, with the
 * running time at the end. Drag a block (or Alt+Left, Alt+Right on a focused
 * block) to move it; both call `onMove` with the place it ends up in, the `to`
 * of `storyboard.moveShot`. Moving is off while `lockedWhy` says why.
 */
export function ShotTimeline({
  shots,
  selectedId,
  onSelect,
  onMove,
  lockedWhy,
}: {
  shots: TimelineShot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, to: number) => void;
  lockedWhy: string | null;
}) {
  const strip = useRef<HTMLOListElement>(null);
  const drag = useRef<{ id: string; from: number; startX: number; mids: number[]; width: number; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<{ id: string; to: number; dx: number } | null>(null);
  const spans = shotSpans(shots);
  const total = totalSeconds(shots);

  // A shot's own focus follows the selection, so Alt+arrow keeps the block in hand.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (!refocus.current) return;
    strip.current?.querySelector<HTMLElement>(`[data-shot="${refocus.current}"]`)?.focus();
    refocus.current = null;
  });

  const blocks = (): HTMLElement[] => Array.from(strip.current?.querySelectorAll<HTMLElement>('[data-shot]') ?? []);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, id: string, index: number) => {
    if (e.button !== 0) return;
    const rects = blocks().map((b) => b.getBoundingClientRect());
    drag.current = { id, from: index, startX: e.clientX, mids: rects.map((r) => r.left + r.width / 2), width: rects[index]?.width ?? 0, moved: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || lockedWhy) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < DRAG_FROM) return;
    if (!d.moved) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const centre = (d.mids[d.from] ?? 0) + dx;
    setPreview({ id: d.id, to: overIndexAt(centre, d.mids, d.from), dx });
  };

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d.moved) {
      onSelect(d.id);
      return;
    }
    const to = preview && preview.id === d.id ? moveIndex(d.from, preview.to, shots.length) : null;
    setPreview(null);
    if (to !== null) onMove(d.id, to);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, id: string, index: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    if (e.altKey) {
      if (lockedWhy) return;
      const to = moveIndex(index, index + step, shots.length);
      if (to !== null) {
        refocus.current = id;
        onMove(id, to);
      }
      return;
    }
    const next = shots[index + step];
    if (next) {
      refocus.current = next.id;
      onSelect(next.id);
    }
  };

  // While dragging, the other blocks make room where the dragged one would land.
  const shiftOf = (index: number): number => {
    if (!preview || !drag.current) return 0;
    const { from, width } = drag.current;
    if (index === from) return preview.dx;
    if (from < preview.to && index > from && index <= preview.to) return -width - 4;
    if (from > preview.to && index < from && index >= preview.to) return width + 4;
    return 0;
  };

  return (
    <div className={styles.wrap}>
      <ol ref={strip} className={styles.strip} aria-label={`Shots, ${clock(total)} in all`}>
        {shots.map((shot, i) => (
          <li
            key={shot.id}
            className={styles.slot}
            style={{ flexGrow: Math.max(1, spans[i]?.seconds ?? 1), ['--shift' as string]: `${shiftOf(i)}px` }}
            data-dragging={preview?.id === shot.id || undefined}
          >
            <button
              type="button"
              data-shot={shot.id}
              className={styles.block}
              aria-pressed={shot.id === selectedId}
              aria-label={`Shot ${shot.number}, ${shot.shotType}, ${shot.durationSeconds} seconds, ${shot.state.words}`}
              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
              onPointerDown={(e) => onPointerDown(e, shot.id, i)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                drag.current = null;
                setPreview(null);
              }}
              onKeyDown={(e) => onKeyDown(e, shot.id, i)}
              onClick={(e) => {
                // Pointer presses select on release; this is the keyboard's Enter and Space.
                if (e.detail === 0) onSelect(shot.id);
              }}
            >
              <span className={styles.thumb} style={{ ['--ar' as string]: String(shot.thumbRatio) }}>
                {shot.thumb && <img src={shot.thumb} alt="" draggable={false} loading="lazy" />}
              </span>
              <span className={styles.text}>
                <span className={styles.title}>
                  <span className="num">Shot {shot.number}</span>
                  <StatusDot variant={shot.state.dot} label={shot.state.words} isPulsing={shot.state.working} />
                </span>
                <span className={`${styles.meta} num`}>{shot.durationSeconds} s</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.total}>
        <span className={`${styles.totalTime} num`}>{clock(total)}</span>
        <span className={styles.totalWords}>running time</span>
      </div>
    </div>
  );
}
