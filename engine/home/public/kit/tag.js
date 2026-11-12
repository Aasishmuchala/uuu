// A Tag is a small word with a tone (FYI, Passed); a Chip is a quiet pill with an icon (the schedule, the size)
// or a coloured dot (a department's job, a state).
import { html } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { cx } from "./util.js";

const TONES = ["neutral", "ok", "warn", "bad"];
const DEPARTMENTS = ["brain", "operations", "sales", "marketing", "studio", "support", "people", "books"];
const DOT_TONES = ["live", "ok", "warn", "bad", "off"];

export function Tag({ tone = "neutral", children }) {
  const t = TONES.includes(tone) ? tone : "neutral";
  return html`<span class=${cx("k-tag", `k-tag--${t}`)}>${children}</span>`;
}

// `dot`: true for the colour of the nearest `data-dept`, a department id for that department's colour,
// or a state tone (live ok warn bad off). Anything else draws no dot. The dot is decoration: the words carry the meaning.
function Dot({ dot }) {
  if (dot === true) return html`<span class="k-chip__dot" aria-hidden="true"></span>`;
  if (DEPARTMENTS.includes(dot)) return html`<span class="k-chip__dot" data-dept=${dot} aria-hidden="true"></span>`;
  if (DOT_TONES.includes(dot)) return html`<span class=${cx("k-chip__dot", `k-chip__dot--${dot}`)} aria-hidden="true"></span>`;
  return null;
}

// `icon` is an icon name (a string) or anything renderable.
export function Chip({ icon, dot, children }) {
  return html`<span class="k-chip">
    ${dot !== undefined && dot !== null && dot !== false ? html`<${Dot} dot=${dot} />` : null}
    ${typeof icon === "string" ? html`<${Icon} name=${icon} size=${12} />` : icon || null}
    <span class="k-chip__text">${children}</span>
  </span>`;
}
