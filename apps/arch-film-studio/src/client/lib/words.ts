/**
 * The sentences the screens say, the same as the server's. They are copies,
 * not imports: the server's files (`local/door.ts`, `server/pipeline.ts`,
 * `local/claude.ts`) reach Node's own modules, which the page cannot load.
 * `words.test.ts` holds each copy to the server's.
 */

export const PRICE_UNKNOWN = 'Price unknown';
export const ALLOW_SENTENCE = 'Allow spending in the bar above.';
export const NO_SPENDING = 'This app cannot spend anything right now.';
export const ENGINE_UNREACHABLE = 'The engine could not be reached.';
export const NOT_LISTED = 'This model is not available right now.';
export const THINKING_REFUSED = "This app's thinking needs the model provider. Check Settings, Models.";
export const MUSIC_SENTENCE =
  "Music is not made on this Mac yet. The storyboard's music direction is kept as words.";
export const NEEDS_MASTER = 'Unlocks once at least one image is approved as a master.';
export const LOCKED_MASTER = 'This image has a locked master.';
export const UPSCALE_CAPPED = 'The upscaler here stops at 4096 px, so this master stays at its approved size.';

/** Beside the free buttons. */
export const FREE_THINKING = "Free: uses the app's thinking.";
export const FREE_ON_MAC = 'Free: made on this Mac.';
export const NO_COST_AT_SIZE = 'No cost: already at size';
export const CHECKING_PRICE = 'Checking the price…';

/** US cents as dollars: 40 -> "$0.40", 1999 -> "$19.99". */
export function dollars(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  return `$${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

/** The words beside a button: "About $0.40", or "Price unknown" when there is no price. */
export function priceWords(cents: number | null | undefined): string {
  return typeof cents === 'number' && Number.isFinite(cents) && cents >= 0 ? `About ${dollars(cents)}` : PRICE_UNKNOWN;
}

/**
 * An error's message as one sentence. A refused input comes back as zod's
 * list of issues in JSON; the first issue's own words are shown.
 */
export function readable(message: string | undefined | null): string {
  const m = (message ?? '').trim();
  if (!m) return 'That did not go through. Try again.';
  if (m.startsWith('[')) {
    try {
      const issues = JSON.parse(m);
      const first = Array.isArray(issues) ? issues[0] : null;
      if (first && typeof first.message === 'string' && first.message) return first.message;
    } catch {
      // Not JSON after all: shown as it is.
    }
  }
  return m;
}
