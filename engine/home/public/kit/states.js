// Every data state has a design: a notice, an error with Try again (C3 25), not connected, empty, loading, being built.
// A notice (fix round R5): warn and bad are a 3 px rule at the left in their tone on the surface they stand on (no
// fill, no box), inset in the column, a 14 px icon in the tone and the body in the second ink; info and ok are a plain sentence whose icon carries the tone.
// `action` is its one way on, drawn at the right as the caller's small ghost button.
import { html } from "../vendor/preact-htm.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { cx } from "./util.js";

const TONES = ["info", "ok", "warn", "bad"];
const TONE_ICONS = { info: "info", ok: "check", warn: "alert", bad: "alert" };

export function Notice({ tone = "info", title, action, children }) {
  const t = TONES.includes(tone) ? tone : "info";
  return html`<div class=${cx("k-notice", `k-notice--${t}`)}>
    <${Icon} name=${TONE_ICONS[t]} size=${14} class="k-notice__icon" />
    <div class="k-notice__body">
      ${title ? html`<p class="k-notice__title">${title}</p>` : null}
      ${children ? html`<div class="k-notice__text">${children}</div>` : null}
    </div>
    ${action ? html`<div class="k-notice__actions">${action}</div>` : null}
  </div>`;
}

const message = (error) =>
  typeof error === "string" ? error : error && error.message ? String(error.message) : "Something went wrong.";

// Draws nothing when there is no error, so a page may always place it.
export function ErrorNotice({ error, onRetry }) {
  if (error === null || error === undefined || error === false || error === "") return null;
  return html`<div class="k-notice k-notice--bad" role="alert">
    <${Icon} name="alert" size=${14} class="k-notice__icon" />
    <div class="k-notice__body">
      <p class="k-notice__title">This could not be loaded.</p>
      <div class="k-notice__text">${message(error)}</div>
    </div>
    ${onRetry ? html`<div class="k-notice__actions"><${Button} variant="ghost" size="sm" onClick=${onRetry}>Try again<//></div>` : null}
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
    <${Icon} name="alert" size=${14} class="k-notice__icon" />
    <div class="k-notice__body">
      <p class="k-notice__title">${title}</p>
      ${reason ? html`<div class="k-notice__text">${reason}</div>` : null}
      ${next ? html`<${NextStep} text=${next} />` : null}
    </div>
  </div>`;
}

// A 16 px icon, one sentence, one line under it and the way on (one button); no illustration. `inline`: the compact
// form for a section inside a page that has nothing yet: one left-aligned line (the icon, the sentence at 14 px, its
// line after it in grey, then an optional link), with no padding of its own.
export function Empty({ title, text, icon = "inbox", inline, children }) {
  return html`<div class=${cx("k-empty", inline && "k-empty--inline")}>
    ${icon ? html`<${Icon} name=${icon} size=${16} class="k-empty__icon" />` : null}
    ${title ? html`<p class="k-empty__title">${title}</p>` : null}
    ${text ? html`<p class="k-empty__text">${text}</p>` : null}
    ${children ? html`<div class="k-empty__actions">${children}</div>` : null}
  </div>`;
}

// Rows parted by hairlines, each with a bar that breathes in opacity for a while, then rests.
export function Loading({ lines = 3, label }) {
  const n = Math.min(Math.max(Math.round(Number(lines)) || 3, 1), 12);
  return html`<div class="k-loading" role="status" aria-busy="true">
    <span class="k-sr">${label || "Loading"}</span>
    ${Array.from({ length: n }, (_, i) => html`<span key=${i} class="k-loading__line" aria-hidden="true"></span>`)}
  </div>`;
}

export function BeingBuilt({ title }) {
  return html`<div class="k-empty k-empty--building">
    <${Icon} name="layers" size=${16} class="k-empty__icon" />
    ${title ? html`<p class="k-empty__title">${title}</p>` : null}
    <p class="k-empty__text">This page is being built.</p>
  </div>`;
}
