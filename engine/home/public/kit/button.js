// The one button. `primary` is the near-black one; `accept` is the large green Accept and nothing else.
import { html } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { cx, isEmpty, safeHref } from "./util.js";

const VARIANTS = ["primary", "plain", "quiet", "danger", "accept"];
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
