/**
 * The kit's command palette highlights nothing until an arrow key is pressed,
 * so typing a name and pressing Enter did nothing. With this, Enter on typed
 * words takes the first result, as in Linear's palette: the arrow is pressed
 * for the owner, then Enter goes through the palette's own choice. It only
 * moves the page to a screen or a picture; nothing is started or spent.
 */
export type EnterState = {
  key: string;
  isComposing: boolean;
  /** The focused field's role: the palette's own field is a combobox. */
  role: string | null;
  inOpenDialog: boolean;
  /** The result the palette has highlighted, if any. */
  activeDescendant: string | null;
  hasResult: boolean;
};

export function shouldTakeFirst(s: EnterState): boolean {
  return s.key === 'Enter' && !s.isComposing && s.role === 'combobox' && s.inOpenDialog && !s.activeDescendant && s.hasResult;
}

/** Window keydown listener (capture) for while the palette is open. */
export function enterTakesFirst(e: KeyboardEvent): void {
  const field = e.target instanceof HTMLElement ? e.target : null;
  const dialog = field?.closest('dialog[open]') ?? null;
  const state: EnterState = {
    key: e.key,
    isComposing: e.isComposing,
    role: field?.getAttribute('role') ?? null,
    inOpenDialog: dialog !== null,
    activeDescendant: field?.getAttribute('aria-activedescendant') || null,
    hasResult: !!dialog?.querySelector('[role="option"]'),
  };
  if (!field || !shouldTakeFirst(state)) return;
  e.preventDefault();
  e.stopPropagation();
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
  requestAnimationFrame(() => {
    if (field.getAttribute('aria-activedescendant')) field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  });
}
