import { useEffect, useRef } from 'react';

/** One shortcut: `key` as `KeyboardEvent.key` (lower case for letters), with Cmd or Ctrl when `mod`. */
export type KeyBinding = {
  key: string;
  mod?: boolean | undefined;
  onKey: (e: KeyboardEvent) => void;
  disabled?: boolean | undefined;
};

/** A text field, a list box or anything editable has the keys to itself. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'range', 'submit', 'reset', 'file'].includes(type);
  }
  return target.closest('[role="combobox"],[role="listbox"],[role="menu"],[role="textbox"]') !== null;
}

/**
 * The screen's shortcuts, on one window listener. Never while a text field has focus, never
 * while a dialog is open over the page (its own keys win), never with Alt, and never twice
 * for a held key. None of the app's shortcuts spends money: a spending action always needs a
 * click or Enter on its own focused button.
 */
export function useKeys(bindings: readonly KeyBinding[], enabled = true) {
  const live = useRef(bindings);
  live.current = bindings;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      for (const b of live.current) {
        if (b.disabled || Boolean(b.mod) !== mod) continue;
        if (e.key.toLowerCase() !== b.key.toLowerCase()) continue;
        if (!b.mod && (isTyping(e.target) || e.repeat)) return;
        if (!b.mod && document.querySelector('dialog[open]')) return;
        e.preventDefault();
        b.onKey(e);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
