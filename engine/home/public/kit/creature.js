// A department's creature (or the company brain's): a 16 × 16 pixel sprite, shown larger, idling.
// The idle is a CSS steps() animation of the sheet (styles/creature.css): no canvas, no timer, no frame loop.
// It stops for `still`, for data-motion="off" and for reduced motion.
import { html } from "../vendor/preact-htm.js";
import { CREATURES } from "./creature-data.js";
import { cx } from "./util.js";

const SIZES = [16, 32, 48, 64, 96];

export function Creature({ id, size = 32, still, label } = {}) {
  const data = typeof id === "string" && Object.hasOwn(CREATURES, id) ? CREATURES[id] : null;
  if (!data) return null;
  const s = SIZES.includes(Number(size)) ? Number(size) : 32;
  const time = data.durations.reduce((n, d) => n + d, 0);
  const name = typeof label === "string" ? label.trim().slice(0, 120) : "";
  const style = `--k-creature-size: ${s}px; --k-creature-frames: ${data.frames}; --k-creature-time: ${time}ms;`;
  return html`<span
    class=${cx("k-creature", still && "k-creature--still")}
    data-creature=${id}
    style=${style}
    role=${name ? "img" : null}
    aria-label=${name || null}
    aria-hidden=${name ? null : "true"}
  ><span class="k-creature__sheet"></span></span>`;
}
