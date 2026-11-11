// The pill control: a row of choices in one glass capsule, the current one a solid pill.
// Items with `href` are links (the current one carries aria-current="page"); without, buttons with aria-pressed.
// Left and Right (and Home, End) move between the items; Enter or Space picks one.
import { html } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { cx, safeHref } from "./util.js";

const SIZES = ["sm", "md"];

// The index the arrow keys move to, wrapping at both ends. Pure, so it is tested without a document.
export function segStep(index, count, key) {
  if (!(count > 0)) return -1;
  const i = Number.isInteger(index) && index >= 0 && index < count ? index : 0;
  if (key === "ArrowRight" || key === "ArrowDown") return (i + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (i - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return -1;
}

export function Segmented({ items, current, onChange, label, size = "md" }) {
  const list = Array.isArray(items) ? items.filter((it) => it && it.id !== undefined && it.id !== null) : [];
  const s = SIZES.includes(size) ? size : "md";

  const onKeyDown = (event) => {
    const all = Array.from(event.currentTarget?.querySelectorAll?.(".k-seg__item") || []);
    const at = all.indexOf(globalThis.document?.activeElement);
    const next = segStep(at, all.length, event.key);
    if (next < 0) return;
    event.preventDefault();
    all[next].focus();
  };

  return html`<div class=${cx("k-seg", `k-seg--${s}`)} role="group" aria-label=${label || undefined} onKeyDown=${onKeyDown}>
    ${list.map((it) => {
      const on = it.id === current;
      const hasCount = it.count !== undefined && it.count !== null && it.count !== "";
      const inner = html`${it.icon ? html`<${Icon} name=${it.icon} size=${s === "sm" ? 14 : 16} />` : null}
        <span class="k-seg__label">${it.label}</span>
        ${hasCount ? html`<span class="k-seg__count">${it.count}</span>` : null}`;
      const cls = cx("k-seg__item", on && "k-seg__item--on");
      const link = it.href !== undefined && it.href !== null ? safeHref(it.href) : undefined;
      if (link) {
        return html`<a key=${it.id} class=${cls} href=${link} aria-current=${on ? "page" : undefined}
          onClick=${onChange ? () => onChange(it.id) : undefined}>${inner}</a>`;
      }
      return html`<button key=${it.id} type="button" class=${cls} aria-pressed=${on ? "true" : "false"}
        disabled=${link === null} onClick=${() => onChange && onChange(it.id)}>${inner}</button>`;
    })}
  </div>`;
}
