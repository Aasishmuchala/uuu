import { Wallet } from 'lucide-react';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

import { type AppModel } from '../server/models.ts';
import { groupAsks, MAX_ASKS, type ModelRead, type QuoteAsk, spendState, totalOf } from './lib/spend.ts';
import { ALLOWANCE_MS } from './lib/stages.ts';
import { PRICE_UNKNOWN, readable } from './lib/words.ts';
import { trpc } from './trpc.ts';
import { Button, type ButtonProps } from './ui/Button.tsx';
import styles from './Stages.module.css';

type Money = {
  allowance: { open: boolean; needs: string | null; words: string } | undefined;
  models: Array<ModelRead & { words: string; role: string }> | undefined;
};

const MoneyContext = createContext<Money>({ allowance: undefined, models: undefined });

/** The allowance (asked every 15 seconds) and the five models, for every spending button below. */
export function MoneyProvider({ children }: { children: ReactNode }) {
  const allowance = trpc.money.allowance.useQuery(undefined, { refetchInterval: ALLOWANCE_MS });
  const models = trpc.money.models.useQuery(undefined, { staleTime: 30_000, refetchInterval: 60_000 });
  const value = useMemo<Money>(
    () => ({ allowance: allowance.data, models: models.data }),
    [allowance.data, models.data]
  );
  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>;
}

export function useMoney(): Money {
  return useContext(MoneyContext);
}

/** The header's chip: the allowance in the door's words. */
export function AllowanceChip() {
  const { allowance } = useMoney();
  return (
    <span className={styles.chip} data-open={allowance?.open || undefined} role="status" aria-live="polite">
      <Wallet size={14} aria-hidden />
      {allowance ? allowance.words : 'Reading the allowance…'}
    </span>
  );
}

/** The door's price for these buys, summed; undefined while it is being asked. */
export function useQuote(asks: readonly QuoteAsk[]): { cents: number | null; words: string } | undefined {
  const groups = useMemo(() => groupAsks(asks), [asks]);
  const tooMany = groups.length > MAX_ASKS;
  const q = trpc.money.quote.useQuery(
    { items: groups.map((g) => g.ask) },
    { enabled: groups.length > 0 && !tooMany, staleTime: 60_000 }
  );
  if (groups.length === 0) return totalOf([], []);
  if (tooMany) return { cents: null, words: PRICE_UNKNOWN };
  if (q.isError) return { cents: null, words: PRICE_UNKNOWN };
  if (!q.data) return undefined;
  return totalOf(groups, q.data.items);
}

export type SpendButtonProps = {
  label: string;
  asks: readonly QuoteAsk[];
  onPress: () => void;
  loading?: boolean | undefined;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  icon?: ReactNode;
  /** A refusal of the last press (the server's or the door's sentence). */
  error?: string | null | undefined;
  /** Held for a reason of the page's own (a job already running). */
  holdWhy?: string | null | undefined;
};

/**
 * A button that spends: its price first, then the button. Disabled with
 * "Allow spending in the bar above." while the allowance is closed, with the
 * model's reason while it is not ready, and with "Price unknown" when there
 * is no price.
 */
export function SpendButton({ label, asks, onPress, loading, variant = 'primary', size = 'md', icon, error, holdWhy }: SpendButtonProps) {
  const { allowance, models } = useMoney();
  const quote = useQuote(asks);
  const used = useMemo(() => [...new Set(asks.map((a) => a.model))] as AppModel[], [asks]);
  const state = spendState({ models: used, allowance, modelRows: models, quote, count: asks.length });
  const why = holdWhy ?? state.why;
  return (
    <div className={styles.spend}>
      <span className={styles.price}>{state.price}</span>
      <Button
        variant={variant}
        size={size}
        icon={icon}
        loading={loading}
        disabled={state.disabled || !!holdWhy}
        onPress={onPress}
        aria-label={`${label}, ${state.price}`}
      >
        {label}
      </Button>
      {why && <span className={styles.why}>{why}</span>}
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** A button that spends nothing, with the words that say so. */
export function FreeButton({
  label,
  note,
  onPress,
  loading,
  disabled,
  variant = 'default',
  size = 'md',
  icon,
  error,
  why,
}: {
  label: string;
  note: string;
  onPress: () => void;
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  icon?: ReactNode;
  error?: string | null | undefined;
  why?: string | null | undefined;
}) {
  return (
    <div className={styles.spend}>
      <span className={styles.price}>{note}</span>
      <Button variant={variant} size={size} icon={icon} loading={loading} disabled={disabled} onPress={onPress}>
        {label}
      </Button>
      {why && <span className={styles.why}>{why}</span>}
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** The message of a failed mutation, as one sentence. */
export function errorText(err: unknown): string | null {
  if (!err) return null;
  return readable(err instanceof Error ? err.message : null);
}
