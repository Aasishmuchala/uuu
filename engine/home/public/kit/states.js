// Every data state has a design: a notice, an error with Retry, not connected, empty, loading, being built.
import { html } from "../vendor/preact-htm.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { cx } from "./util.js";

const TONES = ["info", "ok", "warn", "bad"];
const TONE_ICONS = { info: null, ok: "check", warn: "alert", bad: "alert" };

export function Notice({ tone = "info", title, children }) {
  const t = TONES.includes(tone) ? tone : "info";
  return html`<div class=${cx("k-notice", `k-notice--${t}`)}>
    ${TONE_ICONS[t] ? html`<${Icon} name=${TONE_ICONS[t]} size=${16} class="k-notice__icon" />` : null}
    <div class="k-notice__body">
      ${title ? html`<p class="k-notice__title">${title}</p>` : null}
      ${children ? html`<div class="k-notice__text">${children}</div>` : null}
    </div>
  </div>`;
}

const message = (error) =>
  typeof error === "string" ? error : error && error.message ? String(error.message) : "Something went wrong.";

export function ErrorNotice({ error, onRetry }) {
  return html`<div class="k-notice k-notice--bad" role="alert">
    <${Icon} name="alert" size=${16} class="k-notice__icon" />
    <div class="k-notice__body">
      <p class="k-notice__title">This could not be loaded.</p>
      <div class="k-notice__text">${message(error)}</div>
    </div>
    ${onRetry ? html`<div class="k-notice__actions"><${Button} size="sm" onClick=${onRetry}>Retry<//></div>` : null}
  </div>`;
}

// Sets a "Run: <command>" apart, so the owner can see exactly what to type.
export function NextStep({ text }) {
  const m = /^(.*?\bRun:)\s+(.+)$/s.exec(String(text ?? ""));
  if (!m) return html`<p class="k-next">${text}</p>`;
  return html`<p class="k-next">${m[1]} <code class="k-next__command">${m[2]}</code></p>`;
}

export function NotConnected({ reason, next, title = "Not connected yet" }) {
  return html`<div class="k-notice k-notice--warn k-notice--block">
    <${Icon} name="alert" size=${16} class="k-notice__icon" />
    <div class="k-notice__body">
      <p class="k-notice__title">${title}</p>
      ${reason ? html`<div class="k-notice__text">${reason}</div>` : null}
      ${next ? html`<${NextStep} text=${next} />` : null}
    </div>
  </div>`;
}

export function Empty({ title, text, children }) {
  return html`<div class="k-empty">
    ${title ? html`<p class="k-empty__title">${title}</p>` : null}
    ${text ? html`<p class="k-empty__text">${text}</p>` : null}
    ${children ? html`<div class="k-empty__actions">${children}</div>` : null}
  </div>`;
}

export function Loading({ lines = 3, label }) {
  const n = Math.min(Math.max(Math.round(Number(lines)) || 3, 1), 12);
  return html`<div class="k-loading" role="status" aria-busy="true">
    <span class="k-sr">${label || "Loading"}</span>
    ${Array.from({ length: n }, (_, i) => html`<span key=${i} class="k-loading__line" aria-hidden="true"></span>`)}
  </div>`;
}

export function BeingBuilt({ title }) {
  return html`<div class="k-empty k-empty--building">
    <${Icon} name="layers" size=${24} class="k-empty__icon" />
    ${title ? html`<p class="k-empty__title">${title}</p>` : null}
    <p class="k-empty__text">This page is being built.</p>
  </div>`;
}
