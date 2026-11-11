// Honest states: a notice, an error with "Try again", not connected, loading placeholders, state words.
import { html } from "../vendor/preact-htm.js";
import { splitCommand } from "../lib/format.js";

// Shows "Run: engine start" with the command set apart, any other sentence as it is.
export function NextStep({ text }) {
  if (!text) return null;
  const cmd = splitCommand(text);
  if (!cmd) return html`<p class="notice-next">${text}</p>`;
  return html`<p class="notice-next">${cmd.lead} <code class="command">${cmd.command}</code></p>`;
}

// tone: "info" | "warn" | "bad"
export function Notice({ tone = "info", title, children, role }) {
  return html`
    <div class=${`notice notice--${tone}`} role=${role || null}>
      ${title ? html`<p class="notice-title">${title}</p>` : null}
      ${children}
    </div>`;
}

export function ErrorNotice({ error, onRetry }) {
  if (!error) return null;
  return html`
    <${Notice} tone=${error.offline ? "warn" : "bad"} title=${error.message} role="alert">
      <${NextStep} text=${error.next} />
      ${onRetry ? html`<div class="notice-actions"><button type="button" class="btn" onClick=${onRetry}>Try again</button></div>` : null}
    <//>`;
}

export function NotConnected({ reason, next, title }) {
  return html`
    <${Notice} tone="info" title=${title || reason}>
      ${title && reason ? html`<p>${reason}</p>` : null}
      <${NextStep} text=${next} />
    <//>`;
}

// Quiet placeholder lines while something loads.
export function Loading({ lines = 3, label = "Loading" }) {
  const widths = ["92%", "74%", "86%", "60%", "80%", "68%"];
  return html`
    <div class="loading" aria-busy="true">
      <span class="visually-hidden">${label}…</span>
      ${Array.from({ length: lines }, (_, i) => html`<span class="loading-line" style=${`width:${widths[i % widths.length]}`}></span>`)}
    </div>`;
}

// A state shown as a word with a small mark. tone: good | active | wait | warn | bad
export function StateWord({ tone = "wait", children }) {
  return html`<span class=${`state state--${tone}`}><span class="state-mark" aria-hidden="true"></span>${children}</span>`;
}
