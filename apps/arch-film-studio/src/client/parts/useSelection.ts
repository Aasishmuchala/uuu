import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isTyping } from '../lib/reviewKeys.ts';
import { inOrder, rangeTo, selectAll, toggle } from '../lib/selection.ts';

export type ClickKeys = { shiftKey: boolean; metaKey?: boolean; ctrlKey?: boolean };

export type Selection = {
  /** The picked ids, in the order on screen. */
  ids: string[];
  has: (id: string) => boolean;
  /**
   * A click on a picture: picks only it (or lets go, when it was the only one);
   * with Cmd or Ctrl, or on its tick, adds or takes it away; with Shift, adds
   * the run from the last click.
   */
  click: (id: string, e: ClickKeys, viaTick?: boolean) => void;
  set: (ids: string[]) => void;
  clear: () => void;
};

/**
 * Selection on one contact sheet. Cmd+A takes every picture in view and
 * Escape lets go of them, never while a text field has focus.
 */
export function useSelection(order: readonly string[], { keys = true }: { keys?: boolean } = {}): Selection {
  const [raw, setRaw] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const orderKey = order.join(',');
  const ids = useMemo(() => inOrder(raw, orderRef.current), [raw, orderKey]);

  const click = useCallback((id: string, e: ClickKeys, viaTick = false) => {
    setRaw((cur) => {
      if (e.shiftKey) return rangeTo(cur, orderRef.current, anchor.current, id);
      if (viaTick || e.metaKey || e.ctrlKey) return toggle(cur, id);
      return cur.length === 1 && cur[0] === id ? [] : [id];
    });
    anchor.current = id;
  }, []);
  const clear = useCallback(() => {
    setRaw([]);
    anchor.current = null;
  }, []);
  const set = useCallback((next: string[]) => setRaw(next), []);

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setRaw(selectAll(orderRef.current));
      } else if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !document.querySelector('dialog[open]')) {
        setRaw((cur) => (cur.length > 0 ? [] : cur));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys]);

  const has = useCallback((id: string) => ids.includes(id), [ids]);
  return { ids, has, click, set, clear };
}
