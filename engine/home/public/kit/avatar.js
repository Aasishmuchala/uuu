// An agent's picture in a circle; initials on a tinted disc when there is no picture (and always for "you").
import { html, useState } from "../vendor/preact-htm.js";
import { StatusDot } from "./status.js";
import { cx } from "./util.js";

const SIZES = [20, 24, 32, 48, 72];
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
function tint(key) {
  let h = 0;
  for (const ch of String(key ?? "")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return (h % 6) + 1;
}

export function Avatar({ slug, name, size = 24, state }) {
  const [failed, setFailed] = useState(null);
  const s = SIZES.includes(Number(size)) ? Number(size) : 24;
  const you = slug === "you";
  const picture = !you && typeof slug === "string" && SLUG.test(slug) && failed !== slug;
  return html`<span class=${cx("k-avatar", `k-avatar--${s}`, picture ? "k-avatar--picture" : you ? "k-avatar--you" : `k-avatar--tint-${tint(slug || name)}`)}>
    ${picture
      ? html`<img
          class="k-avatar__img"
          src=${`/assets/avatars/${slug}.png`}
          alt=""
          width=${s}
          height=${s}
          decoding="async"
          draggable="false"
          onError=${() => setFailed(slug)}
        />`
      : html`<span class="k-avatar__initials" aria-hidden="true">${initials(name || (you ? "You" : slug))}</span>`}
    ${state ? html`<span class="k-avatar__state"><${StatusDot} tone=${state} hideLabel /></span>` : null}
  </span>`;
}
