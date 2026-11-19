import type { CSSProperties, ReactNode } from 'react';

import { ProgressBar, Text } from '../kit.ts';
import { Elapsed } from './Elapsed.tsx';
import styles from './Stage.module.css';

export type StageProps = {
  /** What is on the stage, in words, at the toolbar's start. */
  title?: ReactNode | undefined;
  /** How it was made, in one quiet line under the title. */
  caption?: ReactNode | undefined;
  /** The stage's own actions at the toolbar's end: compare, full size, star, download, animate. */
  actions?: ReactNode | undefined;
  /** The frame (`StageFrame`) or anything else the stage shows. */
  children: ReactNode;
  /** A line under the picture: an error, a note. */
  below?: ReactNode | undefined;
};

/** The centre of a Make screen: the darkest surface, the picture as large as it fits. */
export function Stage({ title, caption, actions, children, below }: StageProps) {
  return (
    <section className={styles.stage} aria-label="Stage">
      {(title || actions) && (
        <header className={styles.toolbar}>
          <div className={styles.titles}>
            {title && (
              <Text type="label" maxLines={1}>
                {title}
              </Text>
            )}
            {caption && (
              <Text type="supporting" maxLines={1}>
                {caption}
              </Text>
            )}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={styles.canvas}>{children}</div>
      {below && <div className={styles.below}>{below}</div>}
    </section>
  );
}

/**
 * A frame at the picture's true ratio (width over height), as large as the stage allows,
 * never cropped. Its children fill it.
 */
export function StageFrame({ ratio, children, dim = false }: { ratio: number; children: ReactNode; dim?: boolean }) {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9;
  return (
    <div className={styles.frame} style={{ '--r': r } as CSSProperties} data-dim={dim || undefined}>
      {children}
    </div>
  );
}

/** Work on the picture's own frame: a sentence, the clock and progress, over a scrim at its foot. */
export function StageWorking({
  label,
  progress,
  runKey,
  since,
}: {
  label: string;
  progress?: number | undefined;
  runKey?: string | undefined;
  since?: number | undefined;
}) {
  const known = progress !== undefined && progress > 0;
  return (
    <div className={styles.working}>
      <div className={styles.workingText}>
        <span role="status" aria-live="polite">
          <Text type="label" color="inherit">
            {label}
          </Text>
        </span>
        <span className={`${styles.clock} num`} aria-hidden>
          {known ? `${Math.round((progress ?? 0) * 100)}%, ` : ''}
          <Elapsed runKey={runKey} since={since} />
        </span>
      </div>
      <ProgressBar
        label={label}
        isLabelHidden
        value={known ? Math.round((progress ?? 0) * 100) : 0}
        isIndeterminate={!known}
      />
    </div>
  );
}

/** The empty stage: one sentence and, when there is one, the one action. */
export function StageEmpty({ title, hint, action }: { title: string; hint?: string | undefined; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <Text type="large" weight="medium" as="p">
        {title}
      </Text>
      {hint && (
        <Text type="supporting" as="p">
          {hint}
        </Text>
      )}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}
