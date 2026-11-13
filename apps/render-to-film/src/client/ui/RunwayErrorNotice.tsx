import { classifyRunwayError } from '../lib/runwayErrors.ts';
import { Alert } from './Alert.tsx';

export type RunwayErrorNoticeProps = {
  error: unknown;
  /** The model the failed call used (kept so call sites read the same; the sentence says the rest). */
  modelName: string;
  /** Kept for call sites that offer a retry; nothing here needs it. */
  onRetry?: (() => void) | undefined;
};

/** The one notice a failed call shows: the error's own plain sentence. */
export function RunwayErrorNotice({ error }: RunwayErrorNoticeProps) {
  if (!error) return null;
  const { message } = classifyRunwayError(error);
  if (!message) return null;
  return <Alert tone="error" title={message} />;
}
