import { StatusDot, Text, Tooltip } from '../kit.ts';
import { trpc } from '../trpc.ts';
import styles from './SpendingChip.module.css';

/**
 * The allowance in the top bar, in the words of App Studio's spending bar:
 * "Allowed today: $5.00. Spent: $1.20." or "This app cannot spend anything
 * right now." It only shows; the owner opens and closes the allowance in the
 * bar above this app on the home screen. In a narrow frame only the dot
 * shows; its words are the tooltip and the chip's name.
 */
export function SpendingChip() {
  const allowance = trpc.engine.allowance.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const a = allowance.data;
  if (!a) return <span className={styles.chip} data-state="reading" aria-hidden />;
  return (
    <Tooltip content={a.words}>
      <span className={styles.chip} data-state={a.open ? 'open' : 'closed'} role="status" tabIndex={0} aria-label={a.words}>
        <StatusDot variant={a.open ? 'success' : 'neutral'} label={a.open ? 'Spending allowed' : 'Spending closed'} />
        <span className={styles.words}>
          <Text type="supporting" color={a.open ? 'primary' : 'secondary'} hasTabularNumbers maxLines={1}>
            {a.words}
          </Text>
        </span>
      </span>
    </Tooltip>
  );
}
