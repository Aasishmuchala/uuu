import { Wallet } from 'lucide-react';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

import { type AppModel } from '../server/models.ts';
import { Button, Text } from './kit.ts';
import { chunk, groupAsks, MAX_ASKS, type ModelRead, type QuoteAsk, spendState, totalOf } from './lib/spend.ts';
import { ALLOWANCE_MS } from './lib/stages.ts';
import { CHECKING_PRICE, PRICE_UNKNOWN, readable } from './lib/words.ts';
import { trpc } from './trpc.ts';
import styles from './money.module.css';

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

/** The top bar's chip: the allowance in the door's words. */
export function AllowanceChip() {
  const { allowance } = useMoney();
  return (
    <span className={styles.chip} data-open={allowance?.open || undefined} role="status" aria-live="polite" title={allowance?.words}>
      <Wallet size={14} aria-hidden />
      <span className={styles.chipText}>{allowance ? allowance.words : 'Reading the allowance…'}</span>
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

/**
 * A reading of many buys at once (more than one press could send): the asks
 * grouped, the groups asked in runs of at most 20, the answers summed. Any run
 * without a price makes the whole `null`. Undefined while being asked. It
 * enables and disables nothing.
 */
export function useQuoteReading(asks: readonly QuoteAsk[]): { cents: number | null } | undefined {
  const runs = useMemo(() => chunk(groupAsks(asks)), [asks]);
  const answers = trpc.useQueries((t) =>
    runs.map((run) => t.money.quote({ items: run.map((g) => g.ask) }, { staleTime: 60_000 }))
  );
  if (runs.length === 0) return { cents: 0 };
  let sum = 0;
  for (let i = 0; i < runs.length; i++) {
    const a = answers[i];
    if (!a || a.isError) return { cents: null };
    if (!a.data) return undefined;
    const t = totalOf(runs[i]!, a.data.items);
    if (t.cents === null) return { cents: null };
    sum += t.cents;
  }
  return { cents: sum };
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export type SpendButtonProps = {
  label: string;
  asks: readonly QuoteAsk[];
  onPress: () => void;
  loading?: boolean | undefined;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
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
 * is no price. Held while its call is in flight.
 */
export function SpendButton({ label, asks, onPress, loading, variant = 'primary', size = 'md', icon, error, holdWhy }: SpendButtonProps) {
  const { allowance, models } = useMoney();
  const quote = useQuote(asks);
  const used = useMemo(() => [...new Set(asks.map((a) => a.model))] as AppModel[], [asks]);
  const state = spendState({ models: used, allowance, modelRows: models, quote, count: asks.length });
  const why = holdWhy ?? state.why;
  const disabled = state.disabled || !!holdWhy;
  return (
    <div className={styles.spend}>
      <div className={styles.row}>
        <span className={`${styles.price} num`} data-size={size}>
          {state.price}
        </span>
        <Button
          label={label}
          variant={variant}
          size={size}
          icon={icon}
          isLoading={!!loading}
          isDisabled={disabled}
          aria-label={`${label}, ${state.price}`}
          onClick={() => {
            // The kit's disabled button is only aria-disabled: the press is refused here as well.
            if (disabled || loading) return;
            onPress();
          }}
        />
      </div>
      {why && (
        <Text type="supporting" color="secondary" as="p">
          {why}
        </Text>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
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
  variant = 'secondary',
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
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  error?: string | null | undefined;
  why?: string | null | undefined;
}) {
  return (
    <div className={styles.spend}>
      <div className={styles.row}>
        <span className={styles.price} data-size={size}>
          {note}
        </span>
        <Button
          label={label}
          variant={variant}
          size={size}
          icon={icon}
          isLoading={!!loading}
          isDisabled={!!disabled}
          onClick={() => {
            if (disabled || loading) return;
            onPress();
          }}
        />
      </div>
      {why && (
        <Text type="supporting" color="secondary" as="p">
          {why}
        </Text>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A price as a reading beside something that is not a button: "About $5.60". */
export function PriceReading({ asks }: { asks: readonly QuoteAsk[] }) {
  const quote = useQuote(asks);
  return <span className="num">{quote ? quote.words : CHECKING_PRICE}</span>;
}

/** The message of a failed mutation, as one sentence. */
export function errorText(err: unknown): string | null {
  if (!err) return null;
  return readable(err instanceof Error ? err.message : null);
}
