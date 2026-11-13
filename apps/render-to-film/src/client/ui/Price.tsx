import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { gateOf, groupItems, type PriceItem, totalOf } from '../lib/spend.ts';
import { trpc } from '../trpc.ts';
import styles from './Price.module.css';

export type { PriceItem } from '../lib/spend.ts';

/** How long the options sit still before the price is asked again. */
const DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * The price of `items` (the engine's table, nothing is spent to ask) and
 * whether their button may be pressed. A page calls this for `blocked`;
 * `<Price>` and `<SpendNote>` call it with the same items and share the
 * answers through react-query.
 */
export function useSpend(items: readonly PriceItem[]) {
  const groups = useMemo(() => groupItems(items), [JSON.stringify(items)]);
  const wanted = JSON.stringify(groups.map((g) => g.ask));
  const settled = useDebounced(wanted, DEBOUNCE_MS);
  const asks = useMemo(() => JSON.parse(settled) as ReturnType<typeof groupItems>[number]['ask'][], [settled]);

  const prices = trpc.engine.prices.useQuery(
    { items: asks },
    { enabled: asks.length > 0, staleTime: 30_000, placeholderData: (previous) => previous }
  );
  const allowance = trpc.engine.allowance.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const models = trpc.engine.models.useQuery(undefined, { staleTime: 30_000 });

  // The answers match the settled asks; while the options are still moving the
  // total is shown unknown rather than mixed up with the last ones.
  const current = settled === wanted;
  const total = totalOf(groups, current ? prices.data : undefined);
  const gate = gateOf(
    groups.map((g) => g.ask.preset),
    allowance.data,
    models.data
  );
  return {
    words: total.words,
    cents: total.cents,
    loading: groups.length > 0 && (!current || prices.isLoading),
    blocked: gate.blocked,
    why: gate.why,
  };
}

export type PriceProps = {
  items: readonly PriceItem[];
  className?: string | undefined;
};

/** "About $0.40" beside a spending button. */
export function Price({ items, className }: PriceProps) {
  const spend = useSpend(items);
  return (
    <span
      className={[styles.price, spend.loading ? styles.loading : '', className].filter(Boolean).join(' ')}
      aria-live="polite"
    >
      {spend.loading && spend.cents === null ? '' : spend.words}
    </span>
  );
}

/** Why the button beside the price is held, in one sentence; nothing while it is free to press. */
export function SpendNote({ items }: { items: readonly PriceItem[] }) {
  const { blocked, why } = useSpend(items);
  if (!blocked || !why) return null;
  return (
    <p className={styles.note} role="status">
      {why}
    </p>
  );
}

/**
 * A spending button with its price at its right edge and, under it, why it is
 * held while it is. Wrap the `<Button>`; give the same `items` to `useSpend`
 * for the button's `disabled`.
 */
export function Buy({
  items,
  note = true,
  children,
}: {
  items: readonly PriceItem[];
  /** Show the reason under the button (set false to place a `<SpendNote>` yourself). */
  note?: boolean;
  children: ReactNode;
}) {
  const spend = useSpend(items);
  return (
    <>
      <div className={styles.buy}>
        {children}
        <span
          className={[styles.price, spend.loading ? styles.loading : ''].filter(Boolean).join(' ')}
          aria-live="polite"
        >
          {spend.loading && spend.cents === null ? '' : spend.words}
        </span>
      </div>
      {note && spend.blocked && spend.why && (
        <p className={styles.note} role="status">
          {spend.why}
        </p>
      )}
    </>
  );
}
