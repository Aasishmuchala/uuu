import type { ReactNode } from 'react';

import { Heading, ResizeHandle, Text, useResizable } from '../kit.ts';
import styles from './Workbench.module.css';

export type WorkbenchProps = {
  /** Names the controls panel for assistive technology ("Still settings"). */
  label: string;
  /** The choices in order, as `BenchGroup`s. */
  controls: ReactNode;
  /** The sticky foot of the controls: the price and the one button. */
  foot: ReactNode;
  /** The picture or the clip, as large as the window allows. */
  stage: ReactNode;
  /** The takes of this session along the bottom. */
  strip?: ReactNode | undefined;
  /** A panel beside the stage (the people check, upscale), or nothing. */
  side?: ReactNode | undefined;
  /** Remembers the panel's width under this name. */
  saveId: string;
};

/**
 * The Make screens' three zones (PLAN-APPS-ASTRYX, "The workbench pattern"): the controls on
 * the left, resizable; the stage in the middle on the darkest surface; the take strip below.
 */
export function Workbench({ label, controls, foot, stage, strip, side, saveId }: WorkbenchProps) {
  const panel = useResizable({ defaultSize: 360, minSize: 300, maxSize: 520, autoSaveId: `render-to-film:${saveId}` });
  return (
    <div className={styles.bench}>
      <aside className={styles.controls} style={{ width: panel.size }} aria-label={label}>
        <div className={styles.scroll}>{controls}</div>
        <div className={styles.foot}>{foot}</div>
      </aside>
      <ResizeHandle resizable={panel} direction="horizontal" label={`Resize ${label.toLowerCase()}`} hasDivider />
      <div className={styles.main}>
        <div className={styles.stageRow}>
          <div className={styles.stage}>{stage}</div>
          {side && <aside className={styles.side}>{side}</aside>}
        </div>
        {strip && <div className={styles.strip}>{strip}</div>}
      </div>
    </div>
  );
}

/** One group of choices in the controls panel: a plain heading, a line on what it does, the fields. */
export function BenchGroup({
  title,
  description,
  children,
  end,
}: {
  title: string;
  description?: ReactNode | undefined;
  children: ReactNode;
  /** A small control at the heading's end (a switch, a link). */
  end?: ReactNode | undefined;
}) {
  return (
    <section className={styles.group}>
      <div className={styles.groupHead}>
        <Heading level={4}>{title}</Heading>
        {end}
      </div>
      {description && (
        <Text type="supporting" as="p">
          {description}
        </Text>
      )}
      <div className={styles.fields}>{children}</div>
    </section>
  );
}

/** A quiet sentence under a field: what the choice does, or why it is held. */
export function Note({ children, tone }: { children: ReactNode; tone?: 'warning' | undefined }) {
  return (
    <Text type="supporting" as="p" color={tone === 'warning' ? 'secondary' : undefined}>
      {children}
    </Text>
  );
}
