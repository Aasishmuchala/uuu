// A small progress ring with the count inside, such as how many of the nine basics are filled.
import { html } from "../vendor/preact-htm.js";
import { cx } from "./util.js";

// How much of the ring is drawn, from 0 to 1. Pure: a missing, broken or negative figure gives 0.
export function ringShare(value, total) {
  const v = Number(value);
  const t = Number(total);
  if (!Number.isFinite(v) || !Number.isFinite(t) || t <= 0 || v <= 0) return 0;
  return Math.min(v / t, 1);
}

export function Ring({ value, total, size = 40, label }) {
  const n = Number(size) >= 16 && Number(size) <= 160 ? Math.round(Number(size)) : 40;
  const share = ringShare(value, total);
  const v = Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
  const t = Number.isFinite(Number(total)) ? Math.max(0, Math.round(Number(total))) : 0;
  const words = typeof label === "string" && label.trim() ? label.trim().slice(0, 120) : `${v} of ${t}`;
  // Drawn on a 40 unit box; the stroke stays 3 units at any size.
  const r = 17;
  const round = 2 * Math.PI * r;
  return html`<span class=${cx("k-ring", share >= 1 && "k-ring--full")} role="img" aria-label=${words} style=${`--k-ring-size: ${n}px;`}>
    <svg class="k-ring__svg" width=${n} height=${n} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle class="k-ring__track" cx="20" cy="20" r=${r} fill="none" stroke-width="3" />
      ${share > 0
        ? html`<circle class="k-ring__value" cx="20" cy="20" r=${r} fill="none" stroke-width="3" stroke-linecap="round"
            stroke-dasharray=${`${(round * share).toFixed(2)} ${round.toFixed(2)}`} transform="rotate(-90 20 20)" />`
        : null}
    </svg>
    <span class="k-ring__count" aria-hidden="true">${v}</span>
  </span>`;
}
