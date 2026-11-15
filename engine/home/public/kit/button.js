// The one button, and the locked action. `primary` (and `accept`, the same drawing, always large) is the one accent
// fill: one per screen, on its decision. `plain` is the outlined control; `ghost` the same edge with no fill;
// `quiet` is words that fill on hover; `link` is a text link for a secondary way out; `danger` is soft, the problem
// colour's tint and ink. Sizes: `sm` 32 px; `md` and `lg` both 36 px (`lg` only wider at its sides).
import { html, useState } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { cx, isEmpty, nextId, safeHref } from "./util.js";

const VARIANTS = ["primary", "plain", "quiet", "ghost", "link", "danger", "accept"];
const SIZES = ["sm", "md", "lg"];
const TYPES = ["button", "submit", "reset"];

// Other attributes (aria-label, title, id) pass through to the element; `class` is added to the kit's.
export function Button({ variant = "plain", size = "md", busy, disabled, type = "button", href, icon, onClick, children, class: extra, ...rest }) {
  const v = VARIANTS.includes(variant) ? variant : "plain";
  const s = v === "accept" ? "lg" : SIZES.includes(size) ? size : "md";
  const off = Boolean(disabled || busy);
  const bare = isEmpty(children);
  const cls = cx("k-btn", `k-btn--${v}`, `k-btn--${s}`, busy && "k-btn--busy", bare && icon && "k-btn--icon", extra);
  const mark = busy
    ? html`<span class="k-btn__spinner" aria-hidden="true"></span>`
    : icon ? html`<${Icon} name=${icon} size=${s === "sm" ? 14 : 16} />` : null;
  const inner = html`${mark}${bare ? null : html`<span class="k-btn__label">${children}</span>`}`;

  const link = href !== undefined && href !== null ? safeHref(href) : undefined;
  if (link !== undefined) {
    if (off || link === null) {
      return html`<span ...${rest} class=${cx(cls, "k-btn--off")} aria-disabled="true" aria-busy=${busy ? "true" : undefined}>${inner}</span>`;
    }
    return html`<a ...${rest} class=${cls} href=${link} onClick=${onClick}>${inner}</a>`;
  }
  return html`<button
    ...${rest}
    class=${cls}
    type=${TYPES.includes(type) ? type : "button"}
    disabled=${off}
    aria-busy=${busy ? "true" : undefined}
    onClick=${onClick}
  >${inner}</button>`;
}

// An action that cannot be taken yet, with its reason fused under it. Not a disabled button: a group whose label is
// read with its reason, so a screen reader hears why. `children` is the way out (the one primary, under it).
// `tag` is the small word beside the label; an empty tag draws none.
export function LockedAction({ label, why, tag = "Locked", children }) {
  const [id] = useState(() => nextId("k-locked"));
  const hasWhy = !isEmpty(why);
  const hasTag = !isEmpty(tag);
  return html`<div class="k-locked" role="group" aria-label=${typeof label === "string" ? label : undefined}
    aria-describedby=${hasWhy ? `${id}-why` : undefined}>
    <div class="k-locked__block">
      <div class="k-locked__action">
        <${Icon} name="lock" size=${16} />
        <span class="k-locked__label">${label}</span>
        ${hasTag ? html`<span class="k-locked__tag">${tag}</span>` : null}
      </div>
      ${hasWhy ? html`<p class="k-locked__why" id=${`${id}-why`}>${why}</p>` : null}
    </div>
    ${isEmpty(children) ? null : html`<div class="k-locked__out">${children}</div>`}
  </div>`;
}
