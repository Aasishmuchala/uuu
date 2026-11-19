/**
 * Review's keys (PLAN-APPS-ASTRYX, "Review keys"): which key does what in the
 * focus view and the grid view. Never while a text field has focus, never with
 * Cmd, Ctrl or Alt held, and no key for anything that spends: "Make revised
 * version" has no key. Pure, for plain Node (`reviewKeys.test.ts`).
 */

export type ReviewAction =
  | { type: 'approve' }
  | { type: 'reject' }
  | { type: 'note' }
  | { type: 'prev' }
  | { type: 'next' }
  | { type: 'version'; index: number }
  | { type: 'showRender' }
  | { type: 'fullSize' }
  | { type: 'grid' }
  | { type: 'nextUndecided' }
  | { type: 'shortcuts' }
  | { type: 'close' };

/** The parts of a keyboard event the keys read; a DOM KeyboardEvent has them all. */
export type KeyLike = {
  key: string;
  metaKey?: boolean | undefined;
  ctrlKey?: boolean | undefined;
  altKey?: boolean | undefined;
  repeat?: boolean | undefined;
  target?: unknown;
};

export type ReviewView = 'focus' | 'grid';

type TargetLike = { tagName?: unknown; isContentEditable?: unknown; getAttribute?: unknown };

function tagOf(target: unknown): string {
  const t = target as TargetLike | null;
  return t && typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
}

function roleOf(target: unknown): string {
  const t = target as TargetLike | null;
  if (!t || typeof t.getAttribute !== 'function') return '';
  const role = (t.getAttribute as (n: string) => unknown).call(t, 'role');
  return typeof role === 'string' ? role : '';
}

/** The type of an input ("text", "range"), lower case; "" for anything else. */
function inputType(target: unknown): string {
  const t = target as { type?: unknown } | null;
  return tagOf(target) === 'INPUT' && t && typeof t.type === 'string' ? t.type.toLowerCase() : '';
}

/** Inputs that take no typing: their own keys are arrows and Space at most. */
const NOT_TYPED = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);

/** True when the key is for a field: an input, a text area, a select or editable text. */
export function isTyping(target: unknown): boolean {
  const tag = tagOf(target);
  if (tag === 'INPUT') return !NOT_TYPED.has(inputType(target));
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  const t = target as TargetLike | null;
  if (t && t.isContentEditable === true) return true;
  const role = roleOf(target);
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

/** True when Space would press the focused control itself (a button, a link, a box to tick). */
function pressesControl(target: unknown): boolean {
  const tag = tagOf(target);
  if (tag === 'BUTTON' || tag === 'A') return true;
  if (tag === 'INPUT' && inputType(target) !== 'range') return true;
  const role = roleOf(target);
  return role === 'button' || role === 'link' || role === 'option' || role === 'radio' || role === 'checkbox' || role === 'switch';
}

/** The action of one key press, or null when the key is not Review's here. */
export function keyAction(event: KeyLike, ctx: { view: ReviewView }): ReviewAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key;
  // Escape leaves the note field too (its words are kept), so the keys work again at once;
  // before, the field kept the focus and every key after it was typed into the note.
  if (key === 'Escape') return { type: 'close' };
  if (isTyping(event.target)) return null;
  if (key === '?') return { type: 'shortcuts' };
  if (key === 'g' || key === 'G') return { type: 'grid' };
  if (ctx.view !== 'focus') return null;
  // A focused control keeps its own arrows: the compare divider, a choice of options.
  if (key.startsWith('Arrow') && (tagOf(event.target) === 'INPUT' || roleOf(event.target) === 'radio' || roleOf(event.target) === 'slider')) return null;
  switch (key) {
    case 'a':
    case 'A':
      // A held down sends one decision, not one a repeat.
      return event.repeat ? null : { type: 'approve' };
    case 'r':
    case 'R':
      return event.repeat ? null : { type: 'reject' };
    case 'v':
    case 'V':
      return event.repeat ? null : { type: 'note' };
    case 'ArrowLeft':
    case 'j':
    case 'J':
      return { type: 'prev' };
    case 'ArrowRight':
    case 'k':
    case 'K':
      return { type: 'next' };
    case 'u':
    case 'U':
      return { type: 'nextUndecided' };
    case 'f':
    case 'F':
      return event.repeat ? null : { type: 'fullSize' };
    case ' ':
    case 'Spacebar':
      return pressesControl(event.target) ? null : { type: 'showRender' };
    default:
      if (/^[1-9]$/.test(key)) return { type: 'version', index: Number(key) - 1 };
      return null;
  }
}
