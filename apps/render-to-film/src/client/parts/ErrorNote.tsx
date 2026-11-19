import type { ReactNode } from 'react';

import { Banner } from '../kit.ts';
import { classifyRunwayError } from '../lib/runwayErrors.ts';

/**
 * A failed call, beside the thing that failed: the engine's own plain sentence, and the next
 * step when there is one. Nothing when there is no error.
 */
export function ErrorNote({ error, action }: { error: unknown; action?: ReactNode }) {
  if (!error) return null;
  const { message } = classifyRunwayError(error);
  if (!message) return null;
  return <Banner status="error" title={message} endContent={action} />;
}
