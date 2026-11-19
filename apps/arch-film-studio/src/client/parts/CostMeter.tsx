import { type Project, projectSpentCents } from '../../shared/project.ts';
import { DEFAULT_ENHANCE_MODEL } from '../../server/models.ts';
import { Heading } from '../kit.ts';
import { remainingAsks } from '../lib/spend.ts';
import { dollars, leftToFinishWords, SENT_CAPTION, SENT_LABEL, sentWords } from '../lib/words.ts';
import { useQuoteReading } from '../money.tsx';
import styles from './CostMeter.module.css';

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "3 enhancements, 1 master and 2 clips", leaving out what is none. */
function leftList(left: { enhance: unknown[]; masters: unknown[]; clips: unknown[] }): string {
  const parts = [
    left.enhance.length > 0 ? n(left.enhance.length, 'enhancement', 'enhancements') : '',
    left.masters.length > 0 ? n(left.masters.length, 'master', 'masters') : '',
    left.clips.length > 0 ? n(left.clips.length, 'clip', 'clips') : '',
  ].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
}

/**
 * What this project has cost and about what is left to finish it: a reading
 * only. "Sent to be made" is the door's price when it took each job for this
 * project (`project.spent`), never corrected after, so it reads "About";
 * "to finish" asks the door's price of every enhancement, master and clip
 * still to be made (enhancements at the default model). It enables nothing.
 */
export function CostMeter({ project, variant = 'block' }: { project: Project; variant?: 'block' | 'compact' }) {
  const left = remainingAsks(project, DEFAULT_ENHANCE_MODEL);
  const all = [...left.enhance, ...left.masters, ...left.clips];
  const reading = useQuoteReading(all);
  const spent = projectSpentCents(project);
  const s = project.spent;
  const leftWords = leftToFinishWords(project.images.length, all.length, reading);

  if (variant === 'compact') {
    return (
      <div className={styles.compact} aria-label="Cost of this project">
        <span className={styles.compactLine}>
          <span>{SENT_LABEL}</span>
          <span className="num">{sentWords(spent)}</span>
        </span>
        <span className={`${styles.compactLeft} num`}>{leftWords}</span>
      </div>
    );
  }

  return (
    <section className={styles.block} aria-label="Cost">
      <Heading level={4} accessibilityLevel={2}>
        Cost
      </Heading>
      <div className={styles.total}>
        <span className={`${styles.amount} num`}>{sentWords(spent)}</span>
        <span className={styles.caption}>{SENT_CAPTION}</span>
      </div>
      <dl className={styles.kinds}>
        <div>
          <dt>Enhancing</dt>
          <dd className="num">{dollars(s?.enhanceCents ?? 0)}</dd>
        </div>
        <div>
          <dt>Masters</dt>
          <dd className="num">{dollars(s?.masterCents ?? 0)}</dd>
        </div>
        <div>
          <dt>Clips</dt>
          <dd className="num">{dollars(s?.clipCents ?? 0)}</dd>
        </div>
      </dl>
      <p className={`${styles.left} num`}>{leftWords}</p>
      <p className={styles.note}>
        {all.length > 0 ? `Still to make: ${leftList(left)}. ` : ''}
        Analysis, the storyboard and the film cost nothing.
      </p>
    </section>
  );
}
