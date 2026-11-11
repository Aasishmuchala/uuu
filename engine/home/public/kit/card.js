// A soft rounded card with a hairline edge. With `href` it is one link, with `onClick` one button.
import { html } from "../vendor/preact-htm.js";
import { cx, safeHref } from "./util.js";

const TONES = ["plain", "warm", "sunken"];
const PADDINGS = ["none", "sm", "md", "lg"];

// Other attributes (aria-label, id) pass through; `class` is added to the kit's.
export function Card({ tone = "plain", href, onClick, padding = "md", children, class: extra, ...rest }) {
  const t = TONES.includes(tone) ? tone : "plain";
  const p = PADDINGS.includes(padding) ? padding : "md";
  const base = cx("k-card", `k-card--${t}`, `k-card--pad-${p}`, extra);
  const link = safeHref(href);
  if (link) return html`<a ...${rest} class=${cx(base, "k-card--action")} href=${link} onClick=${onClick}>${children}</a>`;
  if (onClick) return html`<button ...${rest} type="button" class=${cx(base, "k-card--action")} onClick=${onClick}>${children}</button>`;
  return html`<div ...${rest} class=${base}>${children}</div>`;
}
