import { Check, Play } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

import { Skeleton, StatusDot, Text } from '../kit.ts';
import styles from './MediaGrid.module.css';

export type GridItem = {
  id: string;
  kind: 'still' | 'clip';
  /** The picture (a clip: the still it starts on). */
  thumb?: string | undefined;
  title: string;
  detail?: string | undefined;
  /** Width over height of the picture. */
  ratio: number;
  /** Still being made: no picture yet. */
  pending?: boolean | undefined;
};

export type MediaGridProps = {
  label: string;
  items: readonly GridItem[];
  density?: 'large' | 'small' | undefined;
  /** The item open in the inspector (or picked), outlined. */
  active?: string | null | undefined;
  /** A click on the picture. */
  onActivate: (id: string, e: MouseEvent) => void;
  /** A double click, or Enter on a focused picture: open it large. */
  onOpen?: ((id: string) => void) | undefined;
  /** Ticks for a batch; leave out for a plain picker. */
  selected?: ReadonlySet<string> | undefined;
  onTick?: ((id: string, e: MouseEvent) => void) | undefined;
  /** Corner content for each item (the star). */
  corner?: ((item: GridItem) => ReactNode) | undefined;
};

/**
 * A contact sheet: even gutters, every picture whole at its own shape inside one frame size,
 * a quiet caption under each, state as a dot with a word on hover.
 */
export function MediaGrid({
  label,
  items,
  density = 'large',
  active,
  onActivate,
  onOpen,
  selected,
  onTick,
  corner,
}: MediaGridProps) {
  const ticking = (selected?.size ?? 0) > 0;
  return (
    <ul className={styles.grid} data-density={density} aria-label={label}>
      {items.map((it) => {
        const isTicked = selected?.has(it.id) ?? false;
        return (
          <li key={it.id} className={styles.cell} data-ticked={isTicked || undefined} data-ticking={ticking || undefined}>
            <button
              type="button"
              className={styles.frame}
              aria-pressed={active === it.id}
              aria-label={it.title}
              onClick={(e) => onActivate(it.id, e)}
              onDoubleClick={() => onOpen?.(it.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && onOpen) {
                  e.preventDefault();
                  onOpen(it.id);
                }
              }}
            >
              {it.pending ? (
                <Skeleton radius={1} />
              ) : (
                it.thumb && (
                  <img src={it.thumb} alt="" loading="lazy" decoding="async" />
                )
              )}
              {it.kind === 'clip' && !it.pending && (
                <span className={styles.play} aria-hidden>
                  <Play size={12} />
                </span>
              )}
            </button>
            {onTick && !it.pending && (
              <button
                type="button"
                className={styles.tick}
                aria-pressed={isTicked}
                aria-label={`Select ${it.title}`}
                onClick={(e) => onTick(it.id, e)}
              >
                {isTicked && <Check size={12} aria-hidden />}
              </button>
            )}
            {corner && !it.pending && <span className={styles.corner}>{corner(it)}</span>}
            <div className={styles.caption}>
              {it.pending && (
                <StatusDot variant="accent" label="Being made" tooltip="Being made" isPulsing />
              )}
              <span className={styles.captionText}>
                <Text type="label" maxLines={1} size="sm">
                  {it.title}
                </Text>
                {it.detail && density === 'large' && (
                  <Text type="supporting" maxLines={1}>
                    {it.detail}
                  </Text>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The grid's loading shape: frames and captions where the pictures will be. */
export function MediaGridSkeleton({ count = 8, density = 'large' }: { count?: number; density?: 'large' | 'small' }) {
  return (
    <ul className={styles.grid} data-density={density} aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={styles.cell}>
          <div className={styles.frame} data-skeleton>
            <Skeleton radius={1} index={i} />
          </div>
          <div className={styles.caption}>
            <Skeleton height={12} width="60%" index={i} />
          </div>
        </li>
      ))}
    </ul>
  );
}
