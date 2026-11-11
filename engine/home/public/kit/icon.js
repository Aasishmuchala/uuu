// Our own line icons: drawn on a 24 unit grid, stroked in currentColor, 1.5 px wide at any size.
import { html } from "../vendor/preact-htm.js";
import { cx } from "./util.js";

// A circle as a path, so every icon is a list of paths.
const ring = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

// Each icon is a list of strokes; { d, fill: true } is a filled shape.
const ICONS = {
  search: [ring(11, 11, 6.5), "M20 20l-4.4-4.4"],
  home: ["M4 10.2L12 4l8 6.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"],
  tasks: ["M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17", "M11 6.5h9M11 12.5h9M11 18.5h9"],
  docs: ["M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5", "M14 3.5V7.5h4", "M9 12h6M9 15.5h6"],
  team: [ring(9, 8.5, 3), "M3.5 19.5a5.5 5.5 0 0 1 11 0", ring(16.5, 9.5, 2.5), "M16 14.3a4.5 4.5 0 0 1 4.5 5.2"],
  routines: ["M19.5 12a7.5 7.5 0 0 1-13.4 4.6M4.5 12a7.5 7.5 0 0 1 13.4-4.6", "M18.2 3.8v3.8h-3.8M5.8 20.2v-3.8h3.8"],
  health: ["M3 12h4l2.2-5.5 4.6 11 2.2-5.5h5"],
  settings: ["M4 7h9M17 7h3M4 17h3M11 17h9", ring(15, 7, 2), ring(9, 17, 2)],
  plus: ["M12 5v14M5 12h14"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  cross: ["M6.5 6.5l11 11M17.5 6.5l-11 11"],
  clock: [ring(12, 12, 8), "M12 8v4.2l2.8 2.3"],
  "chevron-right": ["M10 6l6 6-6 6"],
  "chevron-down": ["M6 9.5l6 6 6-6"],
  file: ["M6.5 3.5h7.5l4 4V20a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5", "M14 3.5V7.5h4"],
  download: ["M12 4v11M7.5 10.5L12 15l4.5-4.5", "M5 19.5h14"],
  external: ["M14 4h6v6M20 4l-8.5 8.5", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  play: ["M8 5.5v13l10.5-6.5z"],
  pause: ["M9 5.5v13M15 5.5v13"],
  loop: ["M17 3.5l3 3-3 3", "M4 11.5v-2a3 3 0 0 1 3-3h13", "M7 20.5l-3-3 3-3", "M20 12.5v2a3 3 0 0 1-3 3H4"],
  send: ["M4.5 11.5L20 4l-6.5 16-2.6-6.6z", "M10.9 13.4L20 4"],
  menu: ["M4 7h16M4 12h16M4 17h16"],
  panel: ["M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5", "M15 4.5v15"],
  sun: [ring(12, 12, 4), "M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"],
  moon: ["M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"],
  alert: ["M10.7 4.3a1.5 1.5 0 0 1 2.6 0l7.6 13.4a1.5 1.5 0 0 1-1.3 2.3H4.4a1.5 1.5 0 0 1-1.3-2.3z", "M12 9.5v4.5M12 17v.01"],
  image: ["M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5", ring(9, 9.5, 1.5), "M20.5 15.5l-4.5-4.5-9.5 8.5"],
  layers: ["M12 3.5l8.5 4.5-8.5 4.5L3.5 8z", "M3.5 12.5l8.5 4.5 8.5-4.5", "M3.5 16.5l8.5 4.5 8.5-4.5"],
};

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

function Svg({ size, label, extra, shapes, dashed }) {
  const n = Number(size) > 0 ? Number(size) : 16;
  // The grid is 24 units; scale the stroke so it is 1.5 px on screen whatever the size.
  const width = Math.round((1.5 * 24 * 100) / n) / 100;
  return html`<svg
    class=${cx("k-icon", extra)}
    width=${n}
    height=${n}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width=${width}
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
    role=${label ? "img" : undefined}
    aria-label=${label || undefined}
    aria-hidden=${label ? undefined : "true"}
  >${shapes.map((s, i) =>
    typeof s === "string"
      ? html`<path d=${s} stroke-dasharray=${dashed && i === 0 ? "2.6 2.6" : undefined} />`
      : html`<path d=${s.d} fill="currentColor" stroke="none" />`)}</svg>`;
}

// An unknown name draws an empty square of the same size, so a layout never jumps.
export function Icon({ name, size = 16, label, class: extra }) {
  return html`<${Svg} size=${size} label=${label} extra=${extra} shapes=${ICONS[name] || []} />`;
}

// The six board columns, each with its own shape (not only its colour) and its word for screen readers.
const STATES = {
  backlog: { word: "Backlog", shapes: [ring(12, 12, 8)], dashed: true },
  in_progress: { word: "In progress", shapes: [ring(12, 12, 8), { d: "M12 7.5a4.5 4.5 0 0 1 0 9z", fill: true }] },
  pending_review: { word: "Pending review", shapes: [ring(12, 12, 8), { d: "M12 7.5a4.5 4.5 0 1 1-4.5 4.5H12z", fill: true }] },
  done: { word: "Done", shapes: [ring(12, 12, 8), "M8.6 12.2l2.3 2.3 4.6-4.8"] },
  failed: { word: "Failed", shapes: [ring(12, 12, 8), "M9.5 9.5l5 5M14.5 9.5l-5 5"] },
  canceled: { word: "Canceled", shapes: [ring(12, 12, 8), "M8.8 15.2l6.4-6.4"] },
};

// `label` is optional: by default the column's word; pass "" to hide it where the word is already shown.
export function StateIcon({ column, size = 16, label }) {
  const key = Object.hasOwn(STATES, column) ? column : "backlog";
  const s = STATES[key];
  return html`<${Svg}
    size=${size}
    label=${label === undefined ? s.word : label}
    extra=${cx("k-state-icon", `k-state-icon--${key}`)}
    shapes=${s.shapes}
    dashed=${s.dashed}
  />`;
}
