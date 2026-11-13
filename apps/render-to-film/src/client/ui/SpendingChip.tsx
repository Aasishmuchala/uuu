import { trpc } from '../trpc.ts';
import styles from './SpendingChip.module.css';

/**
 * The allowance in the header, in the words of App Studio's spending bar:
 * "Allowed today: $5.00. Spent: $1.20." or "This app cannot spend anything
 * right now." It only shows; the owner opens and closes the allowance in the
 * bar above this app on the home screen.
 */
export function SpendingChip() {
  const allowance = trpc.engine.allowance.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const a = allowance.data;
  if (!a) return <span className={styles.chip} data-state="reading" aria-hidden />;
  return (
    <span className={styles.chip} data-state={a.open ? 'open' : 'closed'} title={a.words} role="status">
      <span className={styles.dot} aria-hidden />
      <span className={styles.words}>{a.words}</span>
    </span>
  );
}
