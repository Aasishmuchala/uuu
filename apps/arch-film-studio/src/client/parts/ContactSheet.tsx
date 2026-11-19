import { Check, Lock } from 'lucide-react';
import type { ReactNode } from 'react';

import { AspectRatio, Skeleton, StatusDot } from '../kit.ts';
import type { PictureState } from '../lib/progress.ts';
import { Picture, type Working } from './Picture.tsx';
import type { ClickKeys, Selection } from './useSelection.ts';
import styles from './ContactSheet.module.css';

export type SheetItem = {
  id: string;
  src?: string | undefined;
  alt: string;
  width: number;
  height: number;
  code: string;
  name: string;
  state: PictureState;
  working?: Working | null | undefined;
  error?: string | null | undefined;
  /** A quiet line under the name ("3840 × 2160 px"). */
  meta?: string | undefined;
  locked?: boolean | undefined;
  /** Small controls at the caption's end (a download link). */
  end?: ReactNode;
};

/** The shape of every cell: each picture sits whole inside it, at its own ratio. */
const WELL = 3 / 2;

/**
 * A contact sheet: tight, even cells, a quiet caption under each (code and
 * name), the state as a dot with its word on hover. With a selection, each
 * cell has a tick; `clickMode` decides what a click on the picture does.
 */
export function ContactSheet({
  items,
  label,
  selection,
  clickMode = 'select',
  onOpen,
  activeId,
  size = 'md',
}: {
  items: SheetItem[];
  label: string;
  selection?: Selection | undefined;
  clickMode?: 'select' | 'open';
  onOpen?: ((id: string) => void) | undefined;
  activeId?: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <ul className={styles.sheet} data-size={size} aria-label={label}>
      {items.map((item) => {
        const selected = selection?.has(item.id) ?? false;
        const press = (e: ClickKeys) => {
          if (clickMode === 'select' && selection) selection.click(item.id, e);
          else onOpen?.(item.id);
        };
        return (
          <li key={item.id} className={styles.cell} data-selected={selected || undefined} data-active={item.id === activeId || undefined}>
            <button
              type="button"
              className={styles.hit}
              aria-pressed={clickMode === 'select' && selection ? selected : undefined}
              aria-label={clickMode === 'select' && selection ? `${item.code} ${item.name}, ${selected ? 'selected' : 'not selected'}` : `Open ${item.code} ${item.name}`}
              onClick={(e) => press(e)}
              onDoubleClick={() => clickMode === 'select' && onOpen?.(item.id)}
            >
              <Picture src={item.src} alt={item.alt} width={item.width} height={item.height} working={item.working} error={item.error} well={WELL} />
            </button>
            {selection && (
              <button
                type="button"
                className={styles.tick}
                role="checkbox"
                aria-checked={selected}
                aria-label={`Select ${item.code}`}
                onClick={(e) => selection.click(item.id, e, true)}
              >
                {selected && <Check size={12} strokeWidth={3} aria-hidden />}
              </button>
            )}
            <div className={styles.caption}>
              <div className={styles.names}>
                <span className={styles.code}>
                  {item.code}
                  {item.locked && <Lock size={12} aria-label="locked master" className={styles.lock} />}
                </span>
                <span className={styles.name} title={item.name}>
                  {item.name}
                </span>
                {item.meta && <span className={`${styles.meta} num`}>{item.meta}</span>}
              </div>
              <div className={styles.end}>
                {item.end}
                <StatusDot variant={item.state.dot} label={item.state.words} tooltip={item.state.words} isPulsing={item.state.working} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The sheet's shape while it loads: grey cells of the same size. */
export function ContactSheetSkeleton({ count = 8, size = 'md' }: { count?: number; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <ul className={styles.sheet} data-size={size} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={styles.cell}>
          <AspectRatio ratio={WELL}>
            <Skeleton index={i} radius={2} />
          </AspectRatio>
          <div className={styles.caption}>
            <Skeleton index={i} height={12} width="55%" />
          </div>
        </li>
      ))}
    </ul>
  );
}
