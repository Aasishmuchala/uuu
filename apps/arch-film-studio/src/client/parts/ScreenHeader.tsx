import type { ReactNode } from 'react';

import { Heading, Text } from '../kit.ts';
import styles from './ScreenHeader.module.css';

/** A screen's title, one sentence on what it is for, and its tools at the right. */
export function ScreenHeader({ title, sentence, children }: { title: string; sentence?: ReactNode; children?: ReactNode }) {
  return (
    <header className={styles.header}>
      <div className={styles.titles}>
        <Heading level={1}>{title}</Heading>
        {sentence && (
          <Text type="body" color="secondary" as="p">
            {sentence}
          </Text>
        )}
      </div>
      {children && <div className={styles.tools}>{children}</div>}
    </header>
  );
}
