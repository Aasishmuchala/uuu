// A Tag is a small word with a tone (FYI, Passed); a Chip is a quiet label with an icon (the schedule, the size)
// or a coloured dot (a department's job, a state). Both are 22 px, 12 px words on a 6 px corner, grey by default; a
// tone (good, warn, bad, info; `ok` is good) puts the words in its colour on its 14 percent tint. A chip given
// `onClick` is a toggle (a filter): a button whose `on` state is lifted like every selected thing. The neutral fill is
// opaque (--chip), so a grey chip reads on a card (fix round R5); a Tag given `dot` leads with a 6 px dot in its
// own ink.
import { html } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { cx } from "./util.js";

const TONES = ["neutral", "ok", "good", "warn", "bad", "info"];
const DEPARTMENTS = ["brain", "operations", "sales", "marketing", "studio", "support", "people", "books"];
const DOT_TONES = ["live", "ok", "warn", "bad", "off"];

// `quiet` (fix round R6): a state on a row, the tone's words with a 6 px dot and no fill; the filled form is kept
// for what must take the eye (the page's alarm, an urgent item). `dot: false` on a quiet tag draws the words alone,
// for a row whose lamp (kit Lamp) is already its state's mark: one mark, the lamp with its word (PLAN-3D-ALL U16).
export function Tag({ tone = "neutral", dot, quiet, children }) {
  const t = TONES.includes(tone) ? tone : "neutral";
  const q = quiet === true;
  return html`<span class=${cx("k-tag", `k-tag--${t}`, q && "k-tag--quiet")}>${dot === true || (q && dot !== false) ? html`<span class="k-tag__dot" aria-hidden="true"></span>` : null}${children}</span>`;
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
export function Chip({ icon, dot, on, onClick, children }) {
  const inner = html`${dot !== undefined && dot !== null && dot !== false ? html`<${Dot} dot=${dot} />` : null}
    ${typeof icon === "string" ? html`<${Icon} name=${icon} size=${12} />` : icon || null}
    <span class="k-chip__text">${children}</span>`;
  if (typeof onClick === "function") {
    return html`<button type="button" class=${cx("k-chip", "k-chip--toggle", on && "k-chip--on")}
      aria-pressed=${on ? "true" : "false"} onClick=${onClick}>${inner}</button>`;
  }
  return html`<span class="k-chip">${inner}</span>`;
}
