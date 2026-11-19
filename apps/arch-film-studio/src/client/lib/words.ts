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
export const NO_COST_AT_SIZE = 'No charge: already full size';
export const NO_CHARGE_ON_MAC = 'No charge. Made on this Mac.';
export const CHECKING_PRICE = 'Checking the price…';

/** US cents as dollars: 40 -> "$0.40", 1999 -> "$19.99". */
export function dollars(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  return `$${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

/**
 * The project's spent total as what it is: the door's price for each job when
 * it took the job, never corrected when the door later charges less (a failed
 * job can cost nothing). So it is always "About", and "sent to be made", never
 * an exact "spent". REVIEW-APPS-ASTRYX finding 1.
 */
export const SENT_CAPTION = 'sent to be made for this project';
export const SENT_LABEL = 'Sent to be made';
export function sentWords(cents: number): string {
  return `About ${dollars(cents)}`;
}

/** The cost meter's "what is left" line. A project with no renders yet has nothing to price. */
export const LEFT_UNKNOWN = 'Price unknown for some of what is left';
export function leftToFinishWords(images: number, asks: number, reading: { cents: number | null } | undefined): string {
  if (images === 0) return 'Add renders to see what finishing costs';
  if (asks === 0) return 'Nothing left to pay for';
  if (reading === undefined) return 'Working out what is left…';
  if (reading.cents === null) return LEFT_UNKNOWN;
  return `${priceWords(reading.cents)} to finish`;
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
