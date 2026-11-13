/** The readable message of a tRPC error or raw-route body. */
export function errorMessage(e: unknown): string | undefined {
  if (!e) return undefined;
  if (typeof e === 'object' && e !== null) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
    const err = (e as { error?: unknown }).error;
    if (typeof err === 'string' && err) return err;
  }
  return 'Something blocked this request. Try again in a moment.';
}

/**
 * Sorts a failed call into the words to show. There is no account or credit
 * prompt on this Mac: the engine's own sentence is the message.
 * `unavailable` and `planBlocked` stay (always false) so the pages that
 * disable a button on them keep compiling.
 */
export function classifyRunwayError(e: unknown) {
  return {
    message: errorMessage(e),
    unavailable: false,
    planBlocked: false,
  };
}
