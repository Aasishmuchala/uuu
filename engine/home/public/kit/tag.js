// A Tag is a small word with a tone (FYI, Passed); a Chip is a quiet pill with an icon (the schedule, the size).
import { html } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { cx } from "./util.js";

const TONES = ["neutral", "ok", "warn", "bad"];

export function Tag({ tone = "neutral", children }) {
  const t = TONES.includes(tone) ? tone : "neutral";
  return html`<span class=${cx("k-tag", `k-tag--${t}`)}>${children}</span>`;
}

// `icon` is an icon name (a string) or anything renderable.
export function Chip({ icon, children }) {
  return html`<span class="k-chip">
    ${typeof icon === "string" ? html`<${Icon} name=${icon} size=${12} />` : icon || null}
    <span class="k-chip__text">${children}</span>
  </span>`;
}
