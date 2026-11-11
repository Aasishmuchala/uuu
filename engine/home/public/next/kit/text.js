// Small pieces of text: a time, an identifier, a key.
import { html } from "../vendor/preact-htm.js";
import { fullWhen, when } from "../lib/format.js";

// "today 14:05", with the full date on hover and in `datetime`. Nothing for a missing or broken time.
export function Time({ at, prefix }) {
  const text = when(at);
  if (!text) return null;
  return html`<time class="k-time" datetime=${new Date(at).toISOString()} title=${fullWhen(at)}>${prefix ? `${prefix} ` : ""}${text}</time>`;
}

// Identifiers such as STH-12.
export function Mono({ children }) {
  return html`<code class="k-mono">${children}</code>`;
}

export function Kbd({ children }) {
  return html`<kbd class="k-kbd">${children}</kbd>`;
}
