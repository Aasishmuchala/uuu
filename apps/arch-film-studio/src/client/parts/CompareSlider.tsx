import { useState } from 'react';

import styles from './CompareSlider.module.css';

export type CompareSliderProps = {
  before: string;
  after: string;
  beforeAlt: string;
  afterAlt: string;
  beforeLabel?: string;
  afterLabel?: string;
  /** The picture's size in pixels: the frame keeps its ratio. */
  width: number;
  height: number;
  /** The tallest the frame may be (a CSS length): it fits whole in the window. */
  maxHeight?: string;
  /** Show the render alone (Space held). */
  showBefore?: boolean | undefined;
};

/**
 * Before and after: the made picture over its render, revealed up to a
 * divider that is dragged or moved with the arrow keys (a native range input
 * under the frame). Both pictures at their true ratio, never cropped.
 */
export function CompareSlider({
  before,
  after,
  beforeAlt,
  afterAlt,
  beforeLabel = 'Render',
  afterLabel = 'Enhanced',
  width,
  height,
  maxHeight = '70vh',
  showBefore,
}: CompareSliderProps) {
  const [pos, setPos] = useState(50);
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  const shown = showBefore ? 100 : pos;
  return (
    <div
      className={styles.frame}
      data-before={showBefore || undefined}
      style={{ ['--ar' as string]: String(ratio), ['--max-h' as string]: maxHeight, ['--pos' as string]: `${shown}%` }}
    >
      <img className={styles.image} src={before} alt={beforeAlt} draggable={false} />
      <img className={`${styles.image} ${styles.after}`} src={after} alt={afterAlt} draggable={false} />
      {!showBefore && <div className={styles.divider} aria-hidden />}
      <span className={`${styles.tag} ${styles.tagLeft}`} aria-hidden>
        {beforeLabel}
      </span>
      {!showBefore && (
        <span className={`${styles.tag} ${styles.tagRight}`} aria-hidden>
          {afterLabel}
        </span>
      )}
      <input
        className={styles.range}
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label={`Compare the render with ${afterLabel}`}
      />
    </div>
  );
}
