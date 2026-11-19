import { useState } from 'react';

import styles from './CompareSlider.module.css';

export type CompareSliderProps = {
  before: string;
  after: string;
  beforeAlt: string;
  afterAlt: string;
  beforeLabel?: string | undefined;
  afterLabel?: string | undefined;
  /** Shown instead of `after` if it can't load (a smaller copy). */
  afterFallback?: string | undefined;
};

/**
 * Before and after in one frame: the take over the render, revealed up to a divider the owner
 * drags. The divider is a native range input, so the arrow keys move it too. Fills its parent
 * frame, which keeps the true ratio.
 */
export function CompareSlider({
  before,
  after,
  beforeAlt,
  afterAlt,
  beforeLabel = 'Render',
  afterLabel = 'Film still',
  afterFallback,
}: CompareSliderProps) {
  const [pos, setPos] = useState(50);
  const [failed, setFailed] = useState<string | null>(null);
  const afterSrc = failed === after && afterFallback ? afterFallback : after;
  return (
    <div className={styles.compare} style={{ ['--pos' as string]: `${pos}%` }}>
      <img className={styles.image} src={before} alt={beforeAlt} draggable={false} />
      <img
        className={`${styles.image} ${styles.after}`}
        src={afterSrc}
        alt={afterAlt}
        draggable={false}
        onError={() => setFailed(after)}
      />
      <div className={styles.divider} aria-hidden>
        <span className={styles.grip} />
      </div>
      <span className={`${styles.tag} ${styles.left}`} aria-hidden>
        {beforeLabel}
      </span>
      <span className={`${styles.tag} ${styles.right}`} aria-hidden>
        {afterLabel}
      </span>
      <input
        className={styles.range}
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label={`Compare ${beforeLabel.toLowerCase()} and ${afterLabel.toLowerCase()}`}
      />
    </div>
  );
}
