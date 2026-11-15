// An agent as one flat disc: its glyph (a line icon, when the caller names one) or its initials, on one of six
// quiet tints picked from the slug, the same for a slug every time; the owner ("you") on the raised step. One
// avatar style everywhere (PLAN-COOK TB4): no picture is drawn, so no page asks the server for a file that may
// not be there.
import { html } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { StatusDot } from "./status.js";
import { cx } from "./util.js";

const SIZES = [20, 24, 32, 40, 48, 72];
const GLYPH = { 20: 12, 24: 14, 32: 16, 40: 20, 48: 24, 72: 32 };

// "Chief of staff" → "CS", "Artist" → "A", "" → "?". Small words such as "of" are skipped.
export function initials(name) {
  const words = String(name ?? "")
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .filter((w, _, all) => all.length < 3 || !/^(of|and|the|for|to)$/i.test(w));
  if (!words.length) return "?";
  const first = [...words[0]][0];
  const last = words.length > 1 ? [...words[words.length - 1]][0] : "";
  return (first + last).toUpperCase();
}

// One of six tints, the same for a slug every time.
export function avatarTint(key) {
  let h = 0;
  for (const ch of String(key ?? "")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return (h % 6) + 1;
}

// Two initials at 12 px do not fit a 20 or 24 px disc, and nothing draws under 12 px: those sizes show the first
// initial alone. `icon`: a line icon's name, drawn instead of the initials. `state`: a status dot's tone at the lower right.
export function Avatar({ slug, name, size = 24, state, icon }) {
  const s = SIZES.includes(Number(size)) ? Number(size) : 24;
  const you = slug === "you";
  const glyph = typeof icon === "string" && icon ? icon : "";
  return html`<span class=${cx("k-avatar", `k-avatar--${s}`, you ? "k-avatar--you" : `k-avatar--tint-${avatarTint(slug || name)}`)}>
    ${glyph
      ? html`<${Icon} name=${glyph} size=${GLYPH[s]} />`
      : html`<span class="k-avatar__initials" aria-hidden="true">${s <= 24 ? [...initials(name || (you ? "You" : slug))][0] : initials(name || (you ? "You" : slug))}</span>`}
    ${state ? html`<span class="k-avatar__state"><${StatusDot} tone=${state} hideLabel /></span>` : null}
  </span>`;
}
