/**
 * Director's "Shoot all": which frames the loop may still send. The loop walks
 * the frames that were unshot at the click; by the time it reaches one, that
 * frame may have been shot by its own button. A frame is sent only when no shoot
 * of it is on its way, none was sent since the click, and it holds no take that
 * is being made or made (a failed take may be shot again). So no frame is paid
 * for twice. REVIEW-APPS-ASTRYX finding 3.
 */
export function shootInLoop(
  image: number,
  state: { inFlight: ReadonlySet<number>; sent: ReadonlySet<number>; take?: { status: string } | undefined }
): boolean {
  if (state.inFlight.has(image) || state.sent.has(image)) return false;
  return !state.take || state.take.status === 'failed';
}
