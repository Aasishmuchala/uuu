// A Tile: a 28 or 32 px rounded square holding a line glyph or one or two letters, the small landmark at a row's or
// a card's left (fix round R5). Neutral is the raised step with the second ink; a tint is one of six quiet identity
// tints (the tint's ink on its own fill of about 14 percent, 4.5 to 1 on a card, a panel and the overlay in both
// themes). A tint names what a thing is (a file's kind, a job's stage, a department), never its state: a state's
// colour stays on its chip. `tintFor(key)` gives the same tint for the same key every time, and the same family
// an avatar of that key takes (kit/avatar.js), so an agent's disc and its department's tile agree.
import { html } from "../vendor/preact-htm.js";
import { avatarTint } from "./avatar.js";
import { Icon } from "./icon.js";
import { cx } from "./util.js";

// The six tints, fixed, in the avatar's order (its sixth is the blue-green it mixes; ours is named teal).
export const TILE_TINTS = ["blue", "green", "violet", "orange", "rose", "teal"];

const SIZES = [28, 32];
const GLYPH = { 28: 16, 32: 18 };

// "md" → always the same one of the six; nothing (no key) → "neutral".
export function tintFor(key) {
  const k = String(key ?? "").trim();
  if (!k) return "neutral";
  return TILE_TINTS[avatarTint(k) - 1];
}

// `icon`: a line icon's name. `text`: one or two letters, drawn when there is no icon (longer words are cut to
// two). `tint`: "neutral" or one of TILE_TINTS; anything else is neutral. `label`: words for a screen reader when
// the tile says something its neighbours do not; without it the tile is decoration and hidden from them.
export function Tile({ icon, text, tint = "neutral", size = 28, label }) {
  const s = SIZES.includes(Number(size)) ? Number(size) : 28;
  const t = TILE_TINTS.includes(tint) ? tint : "neutral";
  const glyph = typeof icon === "string" && icon ? icon : "";
  const letters = glyph ? "" : [...String(text ?? "").trim()].slice(0, 2).join("");
  const named = typeof label === "string" && label.trim() ? label.trim() : "";
  return html`<span class=${cx("k-tile", `k-tile--${s}`, `k-tile--${t}`)}
    role=${named ? "img" : undefined} aria-label=${named || undefined} aria-hidden=${named ? undefined : "true"}>
    ${glyph
      ? html`<${Icon} name=${glyph} size=${GLYPH[s]} />`
      : letters ? html`<span class="k-tile__text">${letters}</span>` : null}
  </span>`;
}
