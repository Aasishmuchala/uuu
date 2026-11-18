/**
 * The app's thinking: a `claude_api` task, run in this process against the
 * model relay (through the engine socket's `/v1/messages`). K24.7.
 *
 * Pictures come only from this app's own kept files (`/files/<key>`), are
 * shrunk to a JPEG and sent as base64. Erasable TypeScript only.
 */
import { isKey } from '../storage.ts';
import type { Engine } from './engine.ts';
import type { Pictures } from './pictures.ts';
import type { Storage } from '../storage.ts';

export type ClaudeDeps = { engine: Engine; store: Storage; pictures: Pictures };
export type ClaudeResult = { text: string; truncated: boolean };

/** The `claude_api` options as the four call sites pass them. */
export type ClaudeOptions = {
  model?: string;
  system_prompt?: string;
  prompt?: string;
  images?: Array<{ url: string }>;
  temperature?: number;
  max_output_tokens?: number;
};

export const CLAUDE_TIMEOUT_MS = 5 * 60_000;
export const CLAUDE_MAX_IMAGES = 8;
export const CLAUDE_IMAGE_SIDE = 1568;
export const CLAUDE_IMAGE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOKENS = 4096;

/** K23's sentence for a relay that will not answer. */
export const THINKING_REFUSED = "This app's thinking needs the model provider. Check Settings, Models.";

function keyOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith('/files/')) return null;
  let key: string;
  try {
    key = decodeURIComponent(url.slice('/files/'.length).split(/[?#]/)[0]!);
  } catch {
    return null;
  }
  return isKey(key) ? key : null;
}

export async function runClaude(deps: ClaudeDeps, options: ClaudeOptions): Promise<ClaudeResult> {
  const model = typeof options.model === 'string' ? options.model.trim() : '';
  if (!model) throw new Error('No model was named for this thinking.');
  const text = typeof options.prompt === 'string' ? options.prompt : '';
  const images = options.images ?? [];
  if (!Array.isArray(images) || images.length > CLAUDE_MAX_IMAGES) {
    throw new Error(`Thinking takes at most ${CLAUDE_MAX_IMAGES} pictures at a time.`);
  }
  // Check every address before any file is read.
  const keys = images.map((i) => keyOf(i?.url));
  if (keys.some((k) => k === null)) throw new Error('This picture is not on this Mac.');

  const content: Array<Record<string, unknown>> = [];
  for (const key of keys as string[]) {
    const bytes = await deps.store.getObject(key);
    if (!bytes) throw new Error('This picture is no longer on this Mac.');
    const jpeg = await deps.pictures.toJpeg(bytes, { maxSide: CLAUDE_IMAGE_SIDE, maxBytes: CLAUDE_IMAGE_BYTES });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } });
  }
  content.push({ type: 'text', text });

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content }],
    max_tokens: Number.isInteger(options.max_output_tokens) && options.max_output_tokens! > 0 ? options.max_output_tokens : DEFAULT_MAX_TOKENS,
  };
  if (options.system_prompt) body['system'] = options.system_prompt;
  if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) body['temperature'] = options.temperature;

  const reply = await deps.engine.json('POST', '/v1/messages', body, { timeoutMs: CLAUDE_TIMEOUT_MS });
  if (reply.status === 429) throw new Error('The model provider is busy. Try again in a little while.');
  if (reply.status !== 200 || !reply.json || !Array.isArray(reply.json.content)) throw new Error(THINKING_REFUSED);
  const out = (reply.json.content as Array<{ type?: unknown; text?: unknown }>)
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
  return { text: out, truncated: reply.json.stop_reason === 'max_tokens' };
}
