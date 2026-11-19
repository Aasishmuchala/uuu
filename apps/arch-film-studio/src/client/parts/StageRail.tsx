import { Lock } from 'lucide-react';

import { ProgressBar } from '../kit.ts';
import { progressWords, type StageProgress } from '../lib/progress.ts';
import { SCREEN_LABELS } from '../lib/route.ts';
import styles from './StageRail.module.css';

/** The six stages side by side: each with its name, "9 of 14" and a fill; a click goes there. */
export function StageRail({ stages, hrefOf }: { stages: StageProgress[]; hrefOf: (s: StageProgress['screen']) => string }) {
  return (
    <ol className={styles.rail} aria-label="Stages">
      {stages.map((s) => {
        const words = progressWords(s);
        const value = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
        const complete = s.total > 0 && s.done >= s.total;
        return (
          <li key={s.screen} className={styles.stage}>
            <a className={styles.link} href={hrefOf(s.screen)} data-locked={s.locked || undefined} title={s.lockWhy ?? undefined}>
              <span className={styles.head}>
                <span className={styles.name}>{SCREEN_LABELS[s.screen]}</span>
                {s.locked ? (
                  <Lock size={13} aria-label={s.lockWhy ?? 'Locked'} className={styles.lock} />
                ) : (
                  <span className={`${styles.count} num`}>{words}</span>
                )}
              </span>
              <ProgressBar
                label={`${SCREEN_LABELS[s.screen]}: ${s.locked ? s.lockWhy : words || 'nothing yet'}`}
                isLabelHidden
                value={s.locked ? 0 : s.screen === 'renders' ? (s.total > 0 ? 100 : 0) : value}
                max={100}
                variant={complete || (s.screen === 'renders' && s.total > 0) ? 'success' : 'accent'}
                isDisabled={s.locked}
              />
            </a>
          </li>
        );
      })}
    </ol>
  );
}
