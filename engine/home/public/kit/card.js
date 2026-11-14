// A card: one step up from the ground (the card fill, a hairline edge, the card shadow in light). `ghost` is
// the hairline alone, `plain` and `warm` the card, `sunken` a well inside a card. A card inside a card loses its
// edge and fill (no frame in a frame); a card marked aria-current or aria-pressed is lifted (the accent ring).
// With `href` it is one link, with `onClick` one button.
import { html } from "../vendor/preact-htm.js";
import { cx, safeHref } from "./util.js";

const TONES = ["plain", "warm", "sunken", "ghost"];
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
