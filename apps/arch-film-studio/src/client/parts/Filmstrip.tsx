import { useEffect, useRef } from 'react';

import { StatusDot } from '../kit.ts';
import type { PictureState } from '../lib/progress.ts';
import styles from './Filmstrip.module.css';

export type StripItem = {
  id: string;
  src?: string | undefined;
  alt: string;
  width: number;
  height: number;
  code: string;
  state: PictureState;
};

/** Every picture along the foot of the focus view, at its own ratio, with its decision dot. */
export function Filmstrip({ items, activeId, onPick, label }: { items: StripItem[]; activeId: string | null; onPick: (id: string) => void; label: string }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[data-active]');
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: still ? 'auto' : 'smooth' });
  }, [activeId]);
  return (
    <ol ref={list} className={styles.strip} aria-label={label}>
      {items.map((item) => (
        <li key={item.id} className={styles.item} data-active={item.id === activeId || undefined}>
          <button
            type="button"
            className={styles.hit}
            aria-current={item.id === activeId ? 'true' : undefined}
            aria-label={`${item.code}, ${item.state.words}`}
            title={`${item.code}, ${item.state.words}`}
            onClick={() => onPick(item.id)}
            style={{ ['--ar' as string]: String(item.width > 0 && item.height > 0 ? item.width / item.height : 16 / 9) }}
          >
            {item.src && <img className={styles.img} src={item.src} alt="" loading="lazy" draggable={false} />}
          </button>
          <span className={styles.dot}>
            <StatusDot variant={item.state.dot} label={item.state.words} isPulsing={item.state.working} />
          </span>
        </li>
      ))}
    </ol>
  );
}
