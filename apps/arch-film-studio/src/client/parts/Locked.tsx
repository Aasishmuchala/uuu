import { Lock } from 'lucide-react';

import { Button, EmptyState } from '../kit.ts';
import styles from './Locked.module.css';

/** A screen that has nothing to work on yet: what must happen first, and a way to that screen. */
export function Locked({ screen, why, goLabel, goHref }: { screen: string; why: string; goLabel: string; goHref: string }) {
  return (
    <div className={styles.locked}>
      <EmptyState
        icon={<Lock size={22} aria-hidden />}
        title={why}
        description={why.startsWith('Unlocks') ? undefined : `${screen} opens once that is done.`}
        actions={<Button label={goLabel} variant="secondary" href={goHref} />}
      />
    </div>
  );
}
