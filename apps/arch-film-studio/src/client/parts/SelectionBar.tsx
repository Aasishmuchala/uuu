import type { ReactNode } from 'react';

import { Button, Text } from '../kit.ts';
import { overCapWords } from '../lib/selection.ts';
import styles from './SelectionBar.module.css';

/**
 * The bar at the foot of a contact sheet while something is picked: how many,
 * a way to let go, the choices for the batch and its one priced button.
 */
export function SelectionBar({
  count,
  noun = ['picture', 'pictures'],
  onClear,
  children,
  action,
  note,
  sticky = true,
}: {
  count: number;
  noun?: [string, string];
  onClear?: (() => void) | undefined;
  /** Choices for the batch (the model). */
  children?: ReactNode;
  /** The one button: a SpendButton or FreeButton. */
  action: ReactNode;
  /** A sentence about the batch, beside the count. */
  note?: string | null | undefined;
  /** Stick to the foot of the work area (contact sheets); off where fields sit below it. */
  sticky?: boolean;
}) {
  const over = overCapWords(count);
  return (
    <div className={styles.bar} data-sticky={sticky || undefined} role="region" aria-label="Selection">
      <div className={styles.start}>
        <span className={`${styles.count} num`}>
          {count} {count === 1 ? noun[0] : noun[1]}
        </span>
        {onClear && <Button label="Clear" variant="ghost" size="sm" onClick={onClear} />}
        {(over || note) && (
          <Text type="supporting" color="secondary">
            {over ?? note}
          </Text>
        )}
      </div>
      <div className={styles.end}>
        {children}
        {action}
      </div>
    </div>
  );
}
